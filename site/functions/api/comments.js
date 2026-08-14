/**
 * Public comments endpoint.
 *
 *   GET  /api/comments?post=<slug>   List approved comments for a post.
 *   POST /api/comments               Submit a comment. Lands in the moderation queue.
 *
 * Identity policy:
 *   By default only Google-verified commenters may post. Set ALLOW_ANONYMOUS to
 *   "true" to additionally accept anonymous comments, which then require a name
 *   and pass Turnstile. Signed-in commenters skip Turnstile, since Google has
 *   already established they are a person.
 *
 * Bindings expected on `env`:
 *   COMMENTS_DB              D1 database (see schema.sql)
 *   GOOGLE_CLIENT_ID         OAuth client ID. Must match PUBLIC_GOOGLE_CLIENT_ID.
 *   ALLOW_ANONYMOUS          "true" to also accept anonymous comments. Default off.
 *   AUTO_APPROVE_VERIFIED    "true" to publish Google comments without review.
 *   TURNSTILE_SECRET_KEY     Turnstile secret. Omit locally to skip verification.
 *   IP_HASH_SALT             Salt for hashing IPs. Optional but recommended.
 */

import {
  validateComment,
  verifyTurnstile,
  hashIp,
  listApproved,
  countRecentByIp,
  insertComment,
  RATE_LIMIT,
  PROVIDER_GOOGLE,
  PROVIDER_ANONYMOUS,
  STATUS_APPROVED,
  STATUS_PENDING,
  json,
} from '../_lib/comments.js';
import { verifyGoogleIdToken } from '../_lib/google.js';

const isTrue = (value) => String(value ?? '').toLowerCase() === 'true';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get('post') ?? '').trim();

  if (slug === '') {
    return json({ error: 'Missing post parameter.' }, 400);
  }

  if (!env.COMMENTS_DB) {
    return json({ error: 'Comments are not configured.' }, 503);
  }

  try {
    const comments = await listApproved(env.COMMENTS_DB, slug);
    return json({ comments });
  } catch (err) {
    console.error('listApproved failed', err);
    return json({ error: 'Could not load comments.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.COMMENTS_DB) {
    return json({ error: 'Comments are not configured.' }, 503);
  }

  const allowAnonymous = isTrue(env.ALLOW_ANONYMOUS);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  // Establish identity first: it decides which validation rules apply.
  const credential = typeof input?.googleCredential === 'string' ? input.googleCredential : '';
  let profile = null;

  if (credential !== '') {
    if (!env.GOOGLE_CLIENT_ID) {
      return json({ error: 'Google sign-in is not configured.' }, 503);
    }
    const verified = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
    if (!verified.ok) {
      return json({ error: verified.error }, 401);
    }
    profile = verified.profile;
  } else if (!allowAnonymous) {
    return json({ error: 'Please sign in with Google to comment.' }, 401);
  }

  const anonymous = profile === null;

  const validation = validateComment(input, { anonymous });
  if (!validation.ok) {
    return json({ error: validation.errors.join(' ') }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip');

  // Google has already proven personhood, so only anonymous posts see Turnstile.
  if (anonymous) {
    const humanVerified = await verifyTurnstile(
      input.turnstileToken,
      env.TURNSTILE_SECRET_KEY,
      ip
    );
    if (!humanVerified) {
      return json({ error: 'Verification failed. Please try again.' }, 403);
    }
  }

  try {
    const ipHash = await hashIp(ip, env.IP_HASH_SALT);

    const recent = await countRecentByIp(env.COMMENTS_DB, ipHash);
    if (recent >= RATE_LIMIT) {
      return json(
        { error: 'You have posted several comments recently. Please try again later.' },
        429
      );
    }

    const autoApprove = !anonymous && isTrue(env.AUTO_APPROVE_VERIFIED);
    const status = autoApprove ? STATUS_APPROVED : STATUS_PENDING;

    await insertComment(env.COMMENTS_DB, {
      ...validation.value,
      // Identity from the verified token, never from the request body.
      name: anonymous ? validation.value.name : profile.name,
      email: anonymous ? validation.value.email : profile.email,
      provider: anonymous ? PROVIDER_ANONYMOUS : PROVIDER_GOOGLE,
      providerSub: anonymous ? null : profile.sub,
      avatarUrl: anonymous ? null : profile.picture,
      status,
      ipHash,
      userAgent: request.headers.get('user-agent'),
    });

    return json(
      {
        ok: true,
        status,
        message: autoApprove
          ? 'Thanks. Your comment is live.'
          : 'Thanks. Your comment will appear once it has been reviewed.',
      },
      201
    );
  } catch (err) {
    console.error('insertComment failed', err);
    return json({ error: 'Could not save your comment.' }, 500);
  }
}
