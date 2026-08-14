import { describe, it, expect, vi } from 'vitest';
import {
  validateComment,
  verifyTurnstile,
  hashIp,
  safeEqual,
  listApproved,
  countRecentByIp,
  insertComment,
  listForAdmin,
  setStatus,
  deleteComment,
  json,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  STATUS_PENDING,
  STATUS_APPROVED,
} from '../functions/_lib/comments.js';

/**
 * Minimal stand-in for a D1 binding. Records every prepare/bind call so tests
 * can assert on the SQL and parameters, and returns canned results.
 */
function fakeDb(responses = {}) {
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
        all: async () => responses.all ?? { results: [] },
        first: async () => responses.first ?? null,
        run: async () => responses.run ?? { meta: { changes: 1 } },
      };
      return stmt;
    },
  };
}

const validInput = {
  post: 'founding-essay',
  name: 'Reader',
  email: 'reader@example.com',
  body: 'A thoughtful comment.',
};

const ANON = { anonymous: true };

describe('validateComment (anonymous mode)', () => {
  it('accepts a well formed comment and normalises it', () => {
    const result = validateComment(
      {
        post: '  founding-essay ',
        name: '  Reader  ',
        email: '  Reader@Example.COM ',
        body: '  A thoughtful comment.  ',
      },
      ANON
    );

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      slug: 'founding-essay',
      name: 'Reader',
      email: 'reader@example.com',
      body: 'A thoughtful comment.',
    });
  });

  it('treats a missing email as null rather than an error', () => {
    const result = validateComment({ ...validInput, email: '' }, ANON);
    expect(result.ok).toBe(true);
    expect(result.value.email).toBeNull();
  });

  it('rejects a non-object body', () => {
    expect(validateComment(null, ANON).ok).toBe(false);
    expect(validateComment('nope', ANON).ok).toBe(false);
  });

  it('rejects a filled honeypot without revealing why', () => {
    const result = validateComment({ ...validInput, website: 'http://spam.example' }, ANON);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['Rejected.']);
  });

  it('ignores an empty honeypot', () => {
    expect(validateComment({ ...validInput, website: '   ' }, ANON).ok).toBe(true);
  });

  it('requires a name', () => {
    const result = validateComment({ ...validInput, name: '   ' }, ANON);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Name is required.');
  });

  it('rejects an over-long name', () => {
    const result = validateComment({ ...validInput, name: 'x'.repeat(81) }, ANON);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/80 characters or fewer/);
  });

  it('requires a comment body of at least two characters', () => {
    const result = validateComment({ ...validInput, body: 'a' }, ANON);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Comment is required.');
  });

  it('rejects an over-long body', () => {
    const result = validateComment({ ...validInput, body: 'x'.repeat(5001) }, ANON);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/5000 characters or fewer/);
  });

  it('rejects a malformed email', () => {
    const result = validateComment({ ...validInput, email: 'not-an-email' }, ANON);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Email address is not valid.');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['uppercase', 'Founding-Essay'],
    ['path traversal', '../secrets'],
    ['leading slash', '/founding-essay'],
    ['too long', 'a'.repeat(201)],
  ])('rejects a %s post slug', (_label, post) => {
    const result = validateComment({ ...validInput, post }, ANON);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing or invalid post reference.');
  });

  it('accepts a nested slug', () => {
    expect(validateComment({ ...validInput, post: 'notes/2026/why-i-write' }, ANON).ok).toBe(true);
  });

  it('collects every error at once', () => {
    const result = validateComment({ post: '', name: '', body: '', email: 'bad' }, ANON);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(4);
  });
});

describe('validateComment (authenticated mode)', () => {
  it('does not require a name, since identity comes from the token', () => {
    const result = validateComment({ post: 'founding-essay', body: 'Signed in comment.' });
    expect(result.ok).toBe(true);
    expect(result.value.name).toBeNull();
    expect(result.value.email).toBeNull();
  });

  it('ignores any name or email supplied in the body, so nobody can impersonate', () => {
    const result = validateComment({
      post: 'founding-essay',
      body: 'Signed in comment.',
      name: 'Someone Else',
      email: 'attacker@example.com',
    });

    expect(result.ok).toBe(true);
    expect(result.value.name).toBeNull();
    expect(result.value.email).toBeNull();
  });

  it('still enforces the honeypot', () => {
    const result = validateComment({
      post: 'founding-essay',
      body: 'text',
      website: 'http://spam.example',
    });
    expect(result.ok).toBe(false);
  });

  it('still enforces slug and body rules', () => {
    expect(validateComment({ post: '../evil', body: 'text' }).ok).toBe(false);
    expect(validateComment({ post: 'ok-slug', body: 'a' }).ok).toBe(false);
    expect(validateComment({ post: 'ok-slug', body: 'x'.repeat(5001) }).ok).toBe(false);
  });
});

describe('verifyTurnstile', () => {
  it('skips verification when no secret is configured', async () => {
    const fetchImpl = vi.fn();
    await expect(verifyTurnstile('anything', '', '1.2.3.4', fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the token is missing but a secret is set', async () => {
    const fetchImpl = vi.fn();
    await expect(verifyTurnstile('', 'secret', null, fetchImpl)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns true when Cloudflare reports success', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    await expect(verifyTurnstile('token', 'secret', '1.2.3.4', fetchImpl)).resolves.toBe(true);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect(init.body.get('secret')).toBe('secret');
    expect(init.body.get('response')).toBe('token');
    expect(init.body.get('remoteip')).toBe('1.2.3.4');
  });

  it('omits remoteip when the IP is unknown', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    await verifyTurnstile('token', 'secret', null, fetchImpl);
    expect(fetchImpl.mock.calls[0][1].body.get('remoteip')).toBeNull();
  });

  it('returns false when Cloudflare reports failure', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ success: false }) });
    await expect(verifyTurnstile('token', 'secret', null, fetchImpl)).resolves.toBe(false);
  });

  it('returns false on a non-200 response', async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
    await expect(verifyTurnstile('token', 'secret', null, fetchImpl)).resolves.toBe(false);
  });

  it('returns false when the network call throws', async () => {
    const fetchImpl = async () => {
      throw new Error('network down');
    };
    await expect(verifyTurnstile('token', 'secret', null, fetchImpl)).resolves.toBe(false);
  });
});

describe('hashIp', () => {
  it('produces a stable hex digest for the same IP and salt', async () => {
    const a = await hashIp('203.0.113.9', 'salt');
    const b = await hashIp('203.0.113.9', 'salt');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different digests for different salts', async () => {
    const a = await hashIp('203.0.113.9', 'salt-one');
    const b = await hashIp('203.0.113.9', 'salt-two');
    expect(a).not.toBe(b);
  });

  it('never returns the raw address', async () => {
    const hash = await hashIp('203.0.113.9', 'salt');
    expect(hash).not.toContain('203.0.113.9');
  });

  it('returns null when there is no IP', async () => {
    await expect(hashIp(null, 'salt')).resolves.toBeNull();
    await expect(hashIp('', 'salt')).resolves.toBeNull();
  });
});

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('token', 'token')).toBe(true);
  });

  it('rejects differing strings of equal length', () => {
    expect(safeEqual('token', 'tokeN')).toBe(false);
  });

  it('rejects differing lengths', () => {
    expect(safeEqual('token', 'token-longer')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(safeEqual(undefined, 'token')).toBe(false);
    expect(safeEqual('token', null)).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });
});

describe('listApproved', () => {
  it('queries only approved comments for the given post', async () => {
    const db = fakeDb({
      all: {
        results: [
          {
            id: '1',
            author_name: 'A',
            body: 'hello',
            created_at: '2026-08-01T00:00:00.000Z',
            auth_provider: 'google',
            avatar_url: 'https://lh3.googleusercontent.com/a/x',
          },
        ],
      },
    });

    const comments = await listApproved(db, 'founding-essay');

    expect(db.calls[0].params).toEqual(['founding-essay', STATUS_APPROVED]);
    expect(db.calls[0].sql).toMatch(/ORDER BY created_at ASC/);
    expect(comments).toEqual([
      {
        id: '1',
        name: 'A',
        body: 'hello',
        createdAt: '2026-08-01T00:00:00.000Z',
        provider: 'google',
        avatar: 'https://lh3.googleusercontent.com/a/x',
      },
    ]);
  });

  it('defaults legacy rows with no provider to anonymous', async () => {
    const db = fakeDb({
      all: { results: [{ id: '1', author_name: 'A', body: 'b', created_at: 't' }] },
    });
    const [comment] = await listApproved(db, 'x');
    expect(comment.provider).toBe('anonymous');
    expect(comment.avatar).toBeNull();
  });

  it('never exposes the provider subject ID publicly', async () => {
    const db = fakeDb();
    await listApproved(db, 'x');
    expect(db.calls[0].sql).not.toMatch(/provider_sub/);
  });

  it('never exposes the commenter email or IP hash', async () => {
    const db = fakeDb();
    await listApproved(db, 'founding-essay');
    expect(db.calls[0].sql).not.toMatch(/author_email|ip_hash/);
  });

  it('returns an empty array when D1 returns no results field', async () => {
    const db = fakeDb({ all: {} });
    await expect(listApproved(db, 'x')).resolves.toEqual([]);
  });
});

describe('countRecentByIp', () => {
  it('returns 0 without querying when there is no IP hash', async () => {
    const db = fakeDb();
    await expect(countRecentByIp(db, null)).resolves.toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it('counts within the rate window', async () => {
    const db = fakeDb({ first: { n: 3 } });
    const now = Date.parse('2026-08-14T12:00:00.000Z');

    await expect(countRecentByIp(db, 'abc', now)).resolves.toBe(3);
    expect(db.calls[0].params[0]).toBe('abc');
    expect(db.calls[0].params[1]).toBe(new Date(now - RATE_WINDOW_MS).toISOString());
  });

  it('returns 0 when the row is missing', async () => {
    const db = fakeDb({ first: null });
    await expect(countRecentByIp(db, 'abc')).resolves.toBe(0);
  });

  it('exposes a rate limit above zero', () => {
    expect(RATE_LIMIT).toBeGreaterThan(0);
  });
});

describe('insertComment', () => {
  it('inserts with pending status and returns the generated id', async () => {
    const db = fakeDb();
    const result = await insertComment(
      db,
      { slug: 'founding-essay', name: 'A', email: null, body: 'hi', ipHash: 'h', userAgent: 'UA' },
      { randomUUID: () => 'fixed-id', now: () => '2026-08-14T00:00:00.000Z' }
    );

    expect(result).toEqual({
      id: 'fixed-id',
      createdAt: '2026-08-14T00:00:00.000Z',
      status: STATUS_PENDING,
    });
    expect(db.calls[0].params).toEqual([
      'fixed-id',
      'founding-essay',
      'A',
      null,
      'hi',
      STATUS_PENDING,
      '2026-08-14T00:00:00.000Z',
      'h',
      'UA',
      'anonymous',
      null,
      null,
    ]);
  });

  it('records the Google identity when one is supplied', async () => {
    const db = fakeDb();
    const result = await insertComment(
      db,
      {
        slug: 'founding-essay',
        name: 'Test Reader',
        email: 'reader@example.com',
        body: 'hi',
        ipHash: 'h',
        provider: 'google',
        providerSub: '110169484474386276334',
        avatarUrl: 'https://lh3.googleusercontent.com/a/x',
      },
      { randomUUID: () => 'id', now: () => 'now' }
    );

    expect(result.status).toBe(STATUS_PENDING);
    expect(db.calls[0].params.slice(9)).toEqual([
      'google',
      '110169484474386276334',
      'https://lh3.googleusercontent.com/a/x',
    ]);
  });

  it('can insert straight to approved when auto-approval is on', async () => {
    const db = fakeDb();
    const result = await insertComment(
      db,
      { slug: 's', name: 'A', email: null, body: 'hi', ipHash: null, status: STATUS_APPROVED },
      { randomUUID: () => 'id', now: () => 'now' }
    );

    expect(result.status).toBe(STATUS_APPROVED);
    expect(db.calls[0].params[5]).toBe(STATUS_APPROVED);
  });

  it('truncates an over-long user agent', async () => {
    const db = fakeDb();
    await insertComment(
      db,
      { slug: 's', name: 'A', email: null, body: 'hi', ipHash: null, userAgent: 'x'.repeat(500) },
      { randomUUID: () => 'id', now: () => 'now' }
    );
    expect(db.calls[0].params[8]).toHaveLength(300);
  });

  it('handles a missing user agent', async () => {
    const db = fakeDb();
    await insertComment(
      db,
      { slug: 's', name: 'A', email: null, body: 'hi', ipHash: null },
      { randomUUID: () => 'id', now: () => 'now' }
    );
    expect(db.calls[0].params[8]).toBe('');
  });
});

describe('listForAdmin', () => {
  it('filters by status by default', async () => {
    const db = fakeDb({ all: { results: [] } });
    await listForAdmin(db);
    expect(db.calls[0].sql).toMatch(/WHERE status = \?1/);
    expect(db.calls[0].params[0]).toBe(STATUS_PENDING);
  });

  it('omits the status filter for "all"', async () => {
    const db = fakeDb({ all: { results: [] } });
    await listForAdmin(db, 'all');
    expect(db.calls[0].sql).not.toMatch(/WHERE status/);
  });

  it('caps the limit at 500', async () => {
    const db = fakeDb({ all: { results: [] } });
    await listForAdmin(db, 'all', 100000);
    expect(db.calls[0].params[0]).toBe(500);
  });

  it('floors a nonsense limit to the default', async () => {
    const db = fakeDb({ all: { results: [] } });
    await listForAdmin(db, 'all', 'abc');
    expect(db.calls[0].params[0]).toBe(200);
  });

  it('maps rows into the admin shape including email', async () => {
    const db = fakeDb({
      all: {
        results: [
          {
            id: '1',
            post_slug: 'p',
            author_name: 'A',
            author_email: 'a@example.com',
            body: 'b',
            status: 'pending',
            created_at: 't',
            auth_provider: 'google',
            avatar_url: 'https://lh3.googleusercontent.com/a/x',
          },
        ],
      },
    });
    await expect(listForAdmin(db)).resolves.toEqual([
      {
        id: '1',
        post: 'p',
        name: 'A',
        email: 'a@example.com',
        body: 'b',
        status: 'pending',
        createdAt: 't',
        provider: 'google',
        avatar: 'https://lh3.googleusercontent.com/a/x',
      },
    ]);
  });
});

describe('setStatus', () => {
  it('updates to an allowed status', async () => {
    const db = fakeDb({ run: { meta: { changes: 1 } } });
    await expect(setStatus(db, 'id-1', STATUS_APPROVED)).resolves.toBe(true);
    expect(db.calls[0].params).toEqual([STATUS_APPROVED, 'id-1']);
  });

  it('reports false when no row matched', async () => {
    const db = fakeDb({ run: { meta: { changes: 0 } } });
    await expect(setStatus(db, 'missing', STATUS_APPROVED)).resolves.toBe(false);
  });

  it('throws on an unknown status rather than writing it', async () => {
    const db = fakeDb();
    await expect(setStatus(db, 'id-1', 'spam')).rejects.toThrow(/Invalid status/);
    expect(db.calls).toHaveLength(0);
  });
});

describe('deleteComment', () => {
  it('reports true when a row was removed', async () => {
    const db = fakeDb({ run: { meta: { changes: 1 } } });
    await expect(deleteComment(db, 'id-1')).resolves.toBe(true);
    expect(db.calls[0].params).toEqual(['id-1']);
  });

  it('reports false when nothing matched', async () => {
    const db = fakeDb({ run: { meta: { changes: 0 } } });
    await expect(deleteComment(db, 'missing')).resolves.toBe(false);
  });

  it('reports false when D1 returns no meta', async () => {
    const db = fakeDb({ run: {} });
    await expect(deleteComment(db, 'id')).resolves.toBe(false);
  });
});

describe('json', () => {
  it('serialises the body with a no-store cache header', async () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('honours a custom status and extra headers', () => {
    const res = json({ error: 'nope' }, 429, { 'retry-after': '60' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});
