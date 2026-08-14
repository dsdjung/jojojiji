/**
 * Public comments endpoint.
 *
 *   GET  /api/comments?post=<slug>   List approved comments for a post.
 *   POST /api/comments               Submit a comment. Lands in the moderation queue.
 *
 * Bindings expected on `env`:
 *   COMMENTS_DB           D1 database (see schema.sql)
 *   TURNSTILE_SECRET_KEY  Turnstile secret. Omit locally to skip verification.
 *   IP_HASH_SALT          Salt for hashing IPs. Optional but recommended.
 */

import {
  validateComment,
  verifyTurnstile,
  hashIp,
  listApproved,
  countRecentByIp,
  insertComment,
  RATE_LIMIT,
  json,
} from '../_lib/comments.js';

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

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const validation = validateComment(input);
  if (!validation.ok) {
    return json({ error: validation.errors.join(' ') }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip');

  const humanVerified = await verifyTurnstile(
    input.turnstileToken,
    env.TURNSTILE_SECRET_KEY,
    ip
  );
  if (!humanVerified) {
    return json({ error: 'Verification failed. Please try again.' }, 403);
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

    await insertComment(env.COMMENTS_DB, {
      ...validation.value,
      ipHash,
      userAgent: request.headers.get('user-agent'),
    });

    return json(
      { ok: true, message: 'Thanks. Your comment will appear once it has been reviewed.' },
      201
    );
  } catch (err) {
    console.error('insertComment failed', err);
    return json({ error: 'Could not save your comment.' }, 500);
  }
}
