/**
 * Admin moderation endpoint. Protected by a bearer token.
 *
 *   GET  /api/admin/comments?status=pending|approved|rejected|all
 *   POST /api/admin/comments   { id, action: 'approve' | 'reject' | 'delete' }
 *
 * Bindings expected on `env`:
 *   COMMENTS_DB   D1 database
 *   ADMIN_TOKEN   Shared secret. Without it the endpoint refuses every request.
 */

import {
  listForAdmin,
  setStatus,
  deleteComment,
  safeEqual,
  json,
  VALID_STATUSES,
  STATUS_APPROVED,
  STATUS_REJECTED,
} from '../../_lib/comments.js';

/**
 * @returns {Response|null} A 401/503 response when the caller is not authorised,
 *   or null when the request may proceed.
 */
function authorize(request, env) {
  if (!env.ADMIN_TOKEN) {
    return json({ error: 'Moderation is not configured.' }, 503);
  }
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!safeEqual(token, env.ADMIN_TOKEN)) {
    return json({ error: 'Unauthorized.' }, 401);
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;

  if (!env.COMMENTS_DB) {
    return json({ error: 'Comments are not configured.' }, 503);
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'pending';
  if (status !== 'all' && !VALID_STATUSES.includes(status)) {
    return json({ error: 'Invalid status filter.' }, 400);
  }

  try {
    const comments = await listForAdmin(env.COMMENTS_DB, status);
    return json({ comments });
  } catch (err) {
    console.error('listForAdmin failed', err);
    return json({ error: 'Could not load comments.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;

  if (!env.COMMENTS_DB) {
    return json({ error: 'Comments are not configured.' }, 503);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  const action = typeof input?.action === 'string' ? input.action : '';

  if (id === '') {
    return json({ error: 'Missing comment id.' }, 400);
  }

  try {
    let changed;
    if (action === 'approve') {
      changed = await setStatus(env.COMMENTS_DB, id, STATUS_APPROVED);
    } else if (action === 'reject') {
      changed = await setStatus(env.COMMENTS_DB, id, STATUS_REJECTED);
    } else if (action === 'delete') {
      changed = await deleteComment(env.COMMENTS_DB, id);
    } else {
      return json({ error: 'Action must be approve, reject, or delete.' }, 400);
    }

    if (!changed) {
      return json({ error: 'Comment not found.' }, 404);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('moderation action failed', err);
    return json({ error: 'Could not update the comment.' }, 500);
  }
}
