import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onRequestGet as publicGet, onRequestPost as publicPost } from '../functions/api/comments.js';
import {
  onRequestGet as adminGet,
  onRequestPost as adminPost,
} from '../functions/api/admin/comments.js';
import { RATE_LIMIT } from '../functions/_lib/comments.js';

/** D1 stand-in whose responses are keyed by the leading SQL verb. */
function fakeDb({ all = { results: [] }, first = { n: 0 }, run = { meta: { changes: 1 } } } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, params: [] };
      calls.push(call);
      const stmt = {
        bind(...params) {
          call.params = params;
          return stmt;
        },
        all: async () => all,
        first: async () => first,
        run: async () => run,
      };
      return stmt;
    },
  };
}

const req = (url, init = {}) => new Request(url, init);

const postReq = (body, headers = {}) =>
  req('https://example.com/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const validBody = {
  post: 'founding-essay',
  name: 'Reader',
  email: '',
  body: 'A thoughtful comment.',
};

// No Turnstile secret in these tests, so verification is skipped.
// ALLOW_ANONYMOUS is on here so the anonymous path stays exercised; the
// Google-only default is covered in its own describe block below.
const baseEnv = () => ({
  COMMENTS_DB: fakeDb(),
  IP_HASH_SALT: 'salt',
  ALLOW_ANONYMOUS: 'true',
});

describe('GET /api/comments', () => {
  it('returns approved comments for a post', async () => {
    const env = {
      ...baseEnv(),
      COMMENTS_DB: fakeDb({
        all: {
          results: [
            {
              id: '1',
              author_name: 'A',
              body: 'hi',
              created_at: '2026-08-01T00:00:00Z',
              auth_provider: 'google',
              avatar_url: 'https://lh3.googleusercontent.com/a/x',
            },
          ],
        },
      }),
    };
    const res = await publicGet({ request: req('https://example.com/api/comments?post=founding-essay'), env });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      comments: [
        {
          id: '1',
          name: 'A',
          body: 'hi',
          createdAt: '2026-08-01T00:00:00Z',
          provider: 'google',
          avatar: 'https://lh3.googleusercontent.com/a/x',
        },
      ],
    });
  });

  it('400s without a post parameter', async () => {
    const res = await publicGet({ request: req('https://example.com/api/comments'), env: baseEnv() });
    expect(res.status).toBe(400);
  });

  it('503s when the database binding is missing', async () => {
    const res = await publicGet({
      request: req('https://example.com/api/comments?post=x'),
      env: {},
    });
    expect(res.status).toBe(503);
  });

  it('500s when the query throws, without leaking the error', async () => {
    const env = {
      ...baseEnv(),
      COMMENTS_DB: {
        prepare() {
          throw new Error('d1 exploded');
        },
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await publicGet({ request: req('https://example.com/api/comments?post=x'), env });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Could not load comments.' });
  });
});

describe('POST /api/comments', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a valid comment and reports it as pending review', async () => {
    const env = baseEnv();
    const res = await publicPost({ request: postReq(validBody), env });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message).toMatch(/reviewed/i);

    const insert = env.COMMENTS_DB.calls.find((c) => c.sql.startsWith('INSERT'));
    expect(insert).toBeDefined();
    expect(insert.params).toContain('pending');
  });

  it('rejects malformed JSON', async () => {
    const res = await publicPost({ request: postReq('{not json'), env: baseEnv() });
    expect(res.status).toBe(400);
  });

  it('rejects a comment that fails validation', async () => {
    const res = await publicPost({ request: postReq({ ...validBody, name: '' }), env: baseEnv() });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Name is required.' });
  });

  it('rejects a filled honeypot', async () => {
    const env = baseEnv();
    const res = await publicPost({
      request: postReq({ ...validBody, website: 'http://spam.example' }),
      env,
    });
    expect(res.status).toBe(400);
    expect(env.COMMENTS_DB.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('403s when Turnstile verification fails', async () => {
    const env = { ...baseEnv(), TURNSTILE_SECRET_KEY: 'secret' };
    // No token supplied, so verification fails before any network call.
    const res = await publicPost({ request: postReq(validBody), env });

    expect(res.status).toBe(403);
    expect(env.COMMENTS_DB.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('429s once the IP is over the rate limit', async () => {
    const env = {
      ...baseEnv(),
      COMMENTS_DB: fakeDb({ first: { n: RATE_LIMIT } }),
    };
    const res = await publicPost({
      request: postReq(validBody, { 'cf-connecting-ip': '203.0.113.9' }),
      env,
    });

    expect(res.status).toBe(429);
    expect(env.COMMENTS_DB.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('503s when the database binding is missing', async () => {
    const res = await publicPost({ request: postReq(validBody), env: {} });
    expect(res.status).toBe(503);
  });

  it('500s when the insert throws', async () => {
    const env = {
      ...baseEnv(),
      COMMENTS_DB: {
        prepare() {
          throw new Error('d1 exploded');
        },
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await publicPost({ request: postReq(validBody), env });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Could not save your comment.' });
  });
});

describe('POST /api/comments identity policy', () => {
  const GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';

  /** Env with Google required (the default: ALLOW_ANONYMOUS unset). */
  const googleOnlyEnv = (over = {}) => ({
    COMMENTS_DB: fakeDb(),
    IP_HASH_SALT: 'salt',
    GOOGLE_CLIENT_ID,
    ...over,
  });

  it('401s an anonymous post when anonymous is not allowed', async () => {
    const env = googleOnlyEnv();
    const res = await publicPost({ request: postReq(validBody), env });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Please sign in with Google to comment.' });
    expect(env.COMMENTS_DB.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it.each([
    ['false', 'false'],
    ['unset', undefined],
    ['nonsense', 'yes-please'],
  ])('treats ALLOW_ANONYMOUS=%s as off', async (_label, value) => {
    const env = googleOnlyEnv({ ALLOW_ANONYMOUS: value });
    const res = await publicPost({ request: postReq(validBody), env });
    expect(res.status).toBe(401);
  });

  it('401s a bad Google credential without touching the database', async () => {
    const env = googleOnlyEnv();
    const res = await publicPost({
      request: postReq({ ...validBody, googleCredential: 'not-a-real-jwt' }),
      env,
    });

    expect(res.status).toBe(401);
    expect(env.COMMENTS_DB.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('503s when a credential is sent but no client ID is configured', async () => {
    const env = googleOnlyEnv({ GOOGLE_CLIENT_ID: undefined });
    const res = await publicPost({
      request: postReq({ ...validBody, googleCredential: 'anything' }),
      env,
    });
    expect(res.status).toBe(503);
  });

  it('lets an anonymous post through once ALLOW_ANONYMOUS is on', async () => {
    const env = googleOnlyEnv({ ALLOW_ANONYMOUS: 'true' });
    const res = await publicPost({ request: postReq(validBody), env });
    expect(res.status).toBe(201);
  });
});

describe('admin auth', () => {
  const adminEnv = () => ({ COMMENTS_DB: fakeDb(), ADMIN_TOKEN: 'super-secret' });

  it('401s with no Authorization header', async () => {
    const res = await adminGet({
      request: req('https://example.com/api/admin/comments'),
      env: adminEnv(),
    });
    expect(res.status).toBe(401);
  });

  it('401s with the wrong token', async () => {
    const res = await adminGet({
      request: req('https://example.com/api/admin/comments', {
        headers: { authorization: 'Bearer wrong-token' },
      }),
      env: adminEnv(),
    });
    expect(res.status).toBe(401);
  });

  it('401s when the scheme is not Bearer', async () => {
    const res = await adminGet({
      request: req('https://example.com/api/admin/comments', {
        headers: { authorization: 'Basic super-secret' },
      }),
      env: adminEnv(),
    });
    expect(res.status).toBe(401);
  });

  it('503s when no admin token is configured, so the endpoint is never open', async () => {
    const res = await adminGet({
      request: req('https://example.com/api/admin/comments', {
        headers: { authorization: 'Bearer anything' },
      }),
      env: { COMMENTS_DB: fakeDb() },
    });
    expect(res.status).toBe(503);
  });

  it('allows the correct token', async () => {
    const res = await adminGet({
      request: req('https://example.com/api/admin/comments', {
        headers: { authorization: 'Bearer super-secret' },
      }),
      env: adminEnv(),
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/admin/comments', () => {
  const auth = { authorization: 'Bearer super-secret' };
  const adminEnv = (db) => ({ COMMENTS_DB: db ?? fakeDb(), ADMIN_TOKEN: 'super-secret' });

  it('defaults to the pending queue', async () => {
    const env = adminEnv();
    await adminGet({
      request: req('https://example.com/api/admin/comments', { headers: auth }),
      env,
    });
    expect(env.COMMENTS_DB.calls[0].params[0]).toBe('pending');
  });

  it('accepts the "all" filter', async () => {
    const env = adminEnv();
    const res = await adminGet({
      request: req('https://example.com/api/admin/comments?status=all', { headers: auth }),
      env,
    });
    expect(res.status).toBe(200);
    expect(env.COMMENTS_DB.calls[0].sql).not.toMatch(/WHERE status/);
  });

  it('400s on an unknown filter', async () => {
    const res = await adminGet({
      request: req('https://example.com/api/admin/comments?status=bogus', { headers: auth }),
      env: adminEnv(),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/comments', () => {
  const auth = { 'content-type': 'application/json', authorization: 'Bearer super-secret' };
  const adminEnv = (db) => ({ COMMENTS_DB: db ?? fakeDb(), ADMIN_TOKEN: 'super-secret' });

  const action = (body, env) =>
    adminPost({
      request: req('https://example.com/api/admin/comments', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(body),
      }),
      env,
    });

  it.each([
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ])('%s sets status to %s', async (verb, expected) => {
    const env = adminEnv();
    const res = await action({ id: 'c1', action: verb }, env);

    expect(res.status).toBe(200);
    expect(env.COMMENTS_DB.calls[0].sql).toMatch(/^UPDATE/);
    expect(env.COMMENTS_DB.calls[0].params).toEqual([expected, 'c1']);
  });

  it('delete removes the row', async () => {
    const env = adminEnv();
    const res = await action({ id: 'c1', action: 'delete' }, env);

    expect(res.status).toBe(200);
    expect(env.COMMENTS_DB.calls[0].sql).toMatch(/^DELETE/);
  });

  it('404s when the comment does not exist', async () => {
    const env = adminEnv(fakeDb({ run: { meta: { changes: 0 } } }));
    const res = await action({ id: 'missing', action: 'approve' }, env);
    expect(res.status).toBe(404);
  });

  it('400s on an unknown action', async () => {
    const res = await action({ id: 'c1', action: 'launch' }, adminEnv());
    expect(res.status).toBe(400);
  });

  it('400s without an id', async () => {
    const res = await action({ action: 'approve' }, adminEnv());
    expect(res.status).toBe(400);
  });

  it('401s before touching the database', async () => {
    const env = { COMMENTS_DB: fakeDb(), ADMIN_TOKEN: 'super-secret' };
    const res = await adminPost({
      request: req('https://example.com/api/admin/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'c1', action: 'delete' }),
      }),
      env,
    });

    expect(res.status).toBe(401);
    expect(env.COMMENTS_DB.calls).toHaveLength(0);
  });
});
