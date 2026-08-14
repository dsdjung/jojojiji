/**
 * Core comment logic, shared by the public and admin Pages Functions.
 *
 * Everything here is a pure function or takes its dependencies (D1 binding,
 * fetch implementation) as arguments, so it can be unit tested without a
 * Workers runtime.
 */

export const STATUS_PENDING = 'pending';
export const STATUS_APPROVED = 'approved';
export const STATUS_REJECTED = 'rejected';

export const VALID_STATUSES = [STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED];

export const LIMITS = {
  name: { min: 1, max: 80 },
  email: { max: 254 },
  body: { min: 2, max: 5000 },
  slug: { min: 1, max: 200 },
};

/** Comments accepted from a single IP within RATE_WINDOW_MS before we start rejecting. */
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9/-]*$/;

/**
 * Validate and normalise a submitted comment.
 *
 * @param {object} input Raw parsed JSON body from the client.
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
export function validateComment(input) {
  const errors = [];

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Request body must be a JSON object.'] };
  }

  // Honeypot: a real browser leaves this hidden field empty. Bots fill it in.
  if (typeof input.website === 'string' && input.website.trim() !== '') {
    return { ok: false, errors: ['Rejected.'] };
  }

  const slug = typeof input.post === 'string' ? input.post.trim() : '';
  if (slug.length < LIMITS.slug.min || slug.length > LIMITS.slug.max) {
    errors.push('Missing or invalid post reference.');
  } else if (!SLUG_RE.test(slug)) {
    errors.push('Missing or invalid post reference.');
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < LIMITS.name.min) {
    errors.push('Name is required.');
  } else if (name.length > LIMITS.name.max) {
    errors.push(`Name must be ${LIMITS.name.max} characters or fewer.`);
  }

  const rawEmail = typeof input.email === 'string' ? input.email.trim() : '';
  let email = null;
  if (rawEmail !== '') {
    if (rawEmail.length > LIMITS.email.max || !EMAIL_RE.test(rawEmail)) {
      errors.push('Email address is not valid.');
    } else {
      email = rawEmail.toLowerCase();
    }
  }

  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length < LIMITS.body.min) {
    errors.push('Comment is required.');
  } else if (body.length > LIMITS.body.max) {
    errors.push(`Comment must be ${LIMITS.body.max} characters or fewer.`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: { slug, name, email, body } };
}

/**
 * Verify a Cloudflare Turnstile token.
 *
 * When no secret is configured (local development), verification is skipped so
 * the form still works against `wrangler pages dev`.
 *
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstile(token, secret, remoteIp, fetchImpl = fetch) {
  if (!secret) return true;
  if (typeof token !== 'string' || token === '') return false;

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);

  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

/**
 * Hash an IP address so we can rate limit without storing the address itself.
 *
 * @returns {Promise<string|null>}
 */
export async function hashIp(ip, salt, subtle = globalThis.crypto?.subtle) {
  if (!ip || !subtle) return null;
  const data = new TextEncoder().encode(`${salt ?? ''}:${ip}`);
  const digest = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string comparison, used for the admin token so that a wrong
 * guess does not leak how much of the token was correct via timing.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Fetch approved comments for one post, oldest first. */
export async function listApproved(db, slug) {
  const { results } = await db
    .prepare(
      `SELECT id, author_name, body, created_at
       FROM comments
       WHERE post_slug = ?1 AND status = ?2
       ORDER BY created_at ASC`
    )
    .bind(slug, STATUS_APPROVED)
    .all();

  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  }));
}

/** Count how many comments this IP hash has submitted inside the rate window. */
export async function countRecentByIp(db, ipHash, now = Date.now()) {
  if (!ipHash) return 0;
  const since = new Date(now - RATE_WINDOW_MS).toISOString();
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ?1 AND created_at >= ?2`)
    .bind(ipHash, since)
    .first();
  return row?.n ?? 0;
}

/**
 * Insert a comment in the pending state. Returns the generated id.
 */
export async function insertComment(db, { slug, name, email, body, ipHash, userAgent }, deps = {}) {
  const id = (deps.randomUUID ?? (() => globalThis.crypto.randomUUID()))();
  const createdAt = (deps.now ?? (() => new Date().toISOString()))();

  await db
    .prepare(
      `INSERT INTO comments
         (id, post_slug, author_name, author_email, body, status, created_at, ip_hash, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )
    .bind(
      id,
      slug,
      name,
      email,
      body,
      STATUS_PENDING,
      createdAt,
      ipHash,
      (userAgent ?? '').slice(0, 300)
    )
    .run();

  return { id, createdAt };
}

/** Admin listing. `status` of 'all' returns every comment, newest first. */
export async function listForAdmin(db, status = STATUS_PENDING, limit = 200) {
  const capped = Math.min(Math.max(Number(limit) || 200, 1), 500);

  const stmt =
    status === 'all'
      ? db
          .prepare(
            `SELECT id, post_slug, author_name, author_email, body, status, created_at
             FROM comments ORDER BY created_at DESC LIMIT ?1`
          )
          .bind(capped)
      : db
          .prepare(
            `SELECT id, post_slug, author_name, author_email, body, status, created_at
             FROM comments WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2`
          )
          .bind(status, capped);

  const { results } = await stmt.all();
  return (results ?? []).map((row) => ({
    id: row.id,
    post: row.post_slug,
    name: row.author_name,
    email: row.author_email,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/** Move a comment to approved or rejected. Returns true if a row changed. */
export async function setStatus(db, id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  const res = await db
    .prepare(`UPDATE comments SET status = ?1 WHERE id = ?2`)
    .bind(status, id)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

/** Permanently remove a comment. Returns true if a row was deleted. */
export async function deleteComment(db, id) {
  const res = await db.prepare(`DELETE FROM comments WHERE id = ?1`).bind(id).run();
  return (res?.meta?.changes ?? 0) > 0;
}

/** JSON response helper with no-store caching, used by every endpoint. */
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
