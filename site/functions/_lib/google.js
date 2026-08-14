/**
 * Google Identity Services ID token verification.
 *
 * The browser gets a signed JWT from Google and posts it to us. We verify the
 * signature against Google's published keys rather than calling Google on every
 * request, so verification costs one cached HTTPS fetch per key rotation.
 *
 * Everything takes its dependencies as arguments so it can be unit tested with
 * a generated key pair and a fake JWKS endpoint.
 */

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** Small clock skew allowance, in seconds. */
const CLOCK_SKEW = 60;

/** Fallback JWKS lifetime when Google sends no usable cache-control. */
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;

/** Module-level cache. Lives for the life of the isolate. */
let jwksCache = { keys: null, expiresAt: 0 };

/** Test seam: drop the cached JWKS. */
export function resetJwksCache() {
  jwksCache = { keys: null, expiresAt: 0 };
}

function base64UrlToBytes(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

/** Seconds from a `cache-control: max-age=N` header, or null. */
function maxAgeMs(headers) {
  const cc = headers?.get?.('cache-control');
  const match = cc && /max-age=(\d+)/.exec(cc);
  return match ? Number(match[1]) * 1000 : null;
}

/**
 * Fetch Google's signing keys, caching them until they expire.
 *
 * @returns {Promise<object[]>} JWK entries
 */
export async function fetchGoogleJwks(fetchImpl = fetch, now = Date.now()) {
  if (jwksCache.keys && now < jwksCache.expiresAt) {
    return jwksCache.keys;
  }

  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) {
    throw new Error(`Could not fetch Google signing keys (HTTP ${res.status}).`);
  }

  const body = await res.json();
  const keys = body?.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('Google signing key set was empty.');
  }

  jwksCache = {
    keys,
    expiresAt: now + (maxAgeMs(res.headers) ?? DEFAULT_JWKS_TTL_MS),
  };
  return keys;
}

/**
 * Verify a Google ID token and return the profile it asserts.
 *
 * Checks, in order: token shape, algorithm, signing key, signature, issuer,
 * audience, and expiry. Any failure returns `{ ok: false }` with a reason, and
 * never a partially trusted profile.
 *
 * @param {string} idToken The credential from Google Identity Services.
 * @param {string} clientId Our OAuth client ID. The token's `aud` must match.
 * @returns {Promise<{ok: true, profile: object} | {ok: false, error: string}>}
 */
export async function verifyGoogleIdToken(idToken, clientId, opts = {}) {
  const {
    fetchImpl = fetch,
    now = Date.now(),
    subtle = globalThis.crypto?.subtle,
  } = opts;

  if (!clientId) return { ok: false, error: 'Google sign-in is not configured.' };
  if (typeof idToken !== 'string' || idToken === '') {
    return { ok: false, error: 'Missing Google credential.' };
  }
  if (!subtle) return { ok: false, error: 'No WebCrypto available.' };

  const parts = idToken.split('.');
  if (parts.length !== 3) return { ok: false, error: 'Malformed Google credential.' };

  let header;
  let payload;
  try {
    header = decodeJsonSegment(parts[0]);
    payload = decodeJsonSegment(parts[1]);
  } catch {
    return { ok: false, error: 'Malformed Google credential.' };
  }

  // Pin the algorithm. Without this, a token could claim alg:none.
  if (header.alg !== 'RS256') {
    return { ok: false, error: 'Unexpected Google credential algorithm.' };
  }

  let keys;
  try {
    keys = await fetchGoogleJwks(fetchImpl, now);
  } catch {
    return { ok: false, error: 'Could not reach Google to verify sign-in.' };
  }

  const jwk = keys.find((k) => k.kid === header.kid) ?? null;
  if (!jwk) return { ok: false, error: 'Unknown Google signing key.' };

  let signatureValid = false;
  try {
    const key = await subtle.importKey(
      'jwk',
      { ...jwk, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    signatureValid = await subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    return { ok: false, error: 'Could not verify Google credential.' };
  }

  if (!signatureValid) return { ok: false, error: 'Google credential signature is invalid.' };

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    return { ok: false, error: 'Google credential has an unexpected issuer.' };
  }

  // Audience must be OUR client ID, otherwise a token minted for a different
  // site could be replayed here.
  if (payload.aud !== clientId) {
    return { ok: false, error: 'Google credential was not issued for this site.' };
  }

  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW < nowSec) {
    return { ok: false, error: 'Google sign-in expired. Please sign in again.' };
  }
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW > nowSec) {
    return { ok: false, error: 'Google credential is not valid yet.' };
  }

  if (typeof payload.sub !== 'string' || payload.sub === '') {
    return { ok: false, error: 'Google credential is missing a subject.' };
  }

  return {
    ok: true,
    profile: {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      // Google sends this as a boolean or the string "true" depending on flow.
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      name: typeof payload.name === 'string' && payload.name.trim() !== ''
        ? payload.name.trim()
        : 'Google user',
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    },
  };
}
