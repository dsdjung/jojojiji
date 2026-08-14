import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  verifyGoogleIdToken,
  fetchGoogleJwks,
  resetJwksCache,
  GOOGLE_JWKS_URL,
} from '../functions/_lib/google.js';

const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com';

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

/** Generate an RSA key pair and the matching JWKS entry. */
async function makeKey(kid = 'test-key-1') {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

/** Sign a JWT with the given private key. */
async function signJwt(privateKey, payload, header = {}) {
  const head = b64urlJson({ alg: 'RS256', typ: 'JWT', kid: 'test-key-1', ...header });
  const body = b64urlJson(payload);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(`${head}.${body}`)
  );
  return `${head}.${body}.${b64url(signature)}`;
}

const NOW = Date.parse('2026-08-14T12:00:00.000Z');
const NOW_SEC = Math.floor(NOW / 1000);

function basePayload(overrides = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '110169484474386276334',
    email: 'Reader@Example.com',
    email_verified: true,
    name: 'Test Reader',
    picture: 'https://lh3.googleusercontent.com/a/photo',
    iat: NOW_SEC - 30,
    exp: NOW_SEC + 3600,
    ...overrides,
  };
}

/** A fetch stub serving the given JWKS. */
function jwksFetch(jwk, { headers = null, status = 200, body = null } = {}) {
  return vi.fn(async (url) => {
    expect(url).toBe(GOOGLE_JWKS_URL);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: headers ?? new Headers({ 'cache-control': 'public, max-age=3600' }),
      json: async () => body ?? { keys: [jwk] },
    };
  });
}

let key;

beforeEach(async () => {
  resetJwksCache();
  key ??= await makeKey();
});

describe('verifyGoogleIdToken', () => {
  it('accepts a valid token and returns the profile', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload());
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(result.profile).toEqual({
      sub: '110169484474386276334',
      email: 'reader@example.com',
      emailVerified: true,
      name: 'Test Reader',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    });
  });

  it('accepts the bare accounts.google.com issuer', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload({ iss: 'accounts.google.com' }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('treats email_verified:"true" as verified', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload({ email_verified: 'true' }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });
    expect(result.profile.emailVerified).toBe(true);
  });

  it('falls back to a placeholder name when Google sends none', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload({ name: '   ' }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });
    expect(result.profile.name).toBe('Google user');
  });

  // --- rejection cases -----------------------------------------------------

  it('rejects a token signed by a different key', async () => {
    const attacker = await makeKey('test-key-1'); // same kid, different key
    const token = await signJwt(attacker.pair.privateKey, basePayload());

    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/signature is invalid/i);
  });

  it('rejects a tampered payload', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload());
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64urlJson(basePayload({ name: 'Someone Else' }))}.${s}`;

    const result = await verifyGoogleIdToken(forged, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/signature is invalid/i);
  });

  it('rejects alg:none', async () => {
    const head = b64urlJson({ alg: 'none', typ: 'JWT', kid: 'test-key-1' });
    const body = b64urlJson(basePayload());
    const result = await verifyGoogleIdToken(`${head}.${body}.`, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/algorithm/i);
  });

  it('rejects a token minted for a different site', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload({ aud: 'someone-else.apps.googleusercontent.com' }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not issued for this site/i);
  });

  it('rejects an untrusted issuer', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload({ iss: 'https://evil.example' }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/issuer/i);
  });

  it('rejects an expired token', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload({ exp: NOW_SEC - 3600 }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('allows a token that expired within the clock-skew window', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload({ exp: NOW_SEC - 30 }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a token issued in the future', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload({ iat: NOW_SEC + 600 }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not valid yet/i);
  });

  it('rejects a token whose kid is not in the key set', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload(), { kid: 'rotated-away' });
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown google signing key/i);
  });

  it('rejects a token with no subject', async () => {
    const payload = basePayload();
    delete payload.sub;
    const token = await signJwt(key.pair.privateKey, payload);
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/subject/i);
  });

  it.each([
    ['empty string', ''],
    ['not a jwt', 'hello'],
    ['two segments', 'aaa.bbb'],
    ['non-string', 12345],
  ])('rejects a malformed credential (%s)', async (_label, token) => {
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: jwksFetch(key.jwk),
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses to verify when no client ID is configured', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload());
    const fetchImpl = jwksFetch(key.jwk);
    const result = await verifyGoogleIdToken(token, '', { fetchImpl, now: NOW });

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when Google cannot be reached', async () => {
    const token = await signJwt(key.pair.privateKey, basePayload());
    const result = await verifyGoogleIdToken(token, CLIENT_ID, {
      fetchImpl: async () => {
        throw new Error('network down');
      },
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not reach google/i);
  });
});

describe('fetchGoogleJwks', () => {
  it('caches keys across calls', async () => {
    const fetchImpl = jwksFetch(key.jwk);
    await fetchGoogleJwks(fetchImpl, NOW);
    await fetchGoogleJwks(fetchImpl, NOW + 1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache-control max-age has passed', async () => {
    const fetchImpl = jwksFetch(key.jwk);
    await fetchGoogleJwks(fetchImpl, NOW);
    await fetchGoogleJwks(fetchImpl, NOW + 3600 * 1000 + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to a default TTL when no cache-control is sent', async () => {
    const fetchImpl = jwksFetch(key.jwk, { headers: new Headers() });
    await fetchGoogleJwks(fetchImpl, NOW);
    await fetchGoogleJwks(fetchImpl, NOW + 1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-200 response', async () => {
    const fetchImpl = jwksFetch(key.jwk, { status: 503 });
    await expect(fetchGoogleJwks(fetchImpl, NOW)).rejects.toThrow(/signing keys/i);
  });

  it('throws on an empty key set', async () => {
    const fetchImpl = jwksFetch(key.jwk, { body: { keys: [] } });
    await expect(fetchGoogleJwks(fetchImpl, NOW)).rejects.toThrow(/empty/i);
  });
});
