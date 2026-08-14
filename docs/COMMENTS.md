# Comments

Reader comments, self-hosted on Cloudflare. No third-party comment service and no per-site fee.

## Who can comment

Commenters identify themselves with Google. This is controlled by two settings, so the policy
can change without touching code:

| Setting | Default | Effect |
|---|---|---|
| `ALLOW_ANONYMOUS` | `"false"` | When `"true"`, also accepts anonymous comments (name required, Turnstile enforced) |
| `AUTO_APPROVE_VERIFIED` | `"false"` | When `"true"`, Google comments publish immediately instead of queueing |

Both live in `[vars]` in `site/wrangler.toml`. The front end reads the matching
`PUBLIC_ALLOW_ANONYMOUS` build variable so the form renders the right fields; keep the two in
sync.

Identity for a signed-in commenter comes **only** from the verified Google token. Any `name` or
`email` in the request body is ignored, so a signed-in commenter cannot post under someone
else's name.

Google's script is loaded **on click**, not on page load, so readers who never comment get no
third-party code at all. Clicking renders Google's official button and fires the One Tap prompt;
if the prompt is suppressed (cooldown, or a browser without FedCM), the rendered button is there
as a fallback.

## How it works

The site itself stays fully static, so every page is still served from the Cloudflare edge cache.
Comments load client side after the page renders.

```
Browser                     Pages Function              D1
   |                              |                      |
   |-- GET /api/comments?post= -->|                      |
   |                              |-- SELECT approved -->|
   |<---------- JSON -------------|                      |
   |                              |                      |
   |-- POST /api/comments ------->|                      |
   |    (Turnstile token)         |-- verify w/ CF ------|
   |                              |-- INSERT pending --->|
   |<-- "awaiting review" --------|                      |
```

Nothing a commenter writes appears on the site until it is approved.

## Files

| Path | Role |
|---|---|
| `site/functions/_lib/google.js` | Google ID token verification: JWKS fetch with caching, RS256 signature check, issuer/audience/expiry validation. |
| `site/functions/_lib/comments.js` | All validation, D1 queries, and helpers. Pure and unit tested. |
| `site/functions/api/comments.js` | Public endpoint: `GET` approved comments, `POST` a new one. |
| `site/functions/api/admin/comments.js` | Moderation endpoint, bearer-token protected. |
| `site/src/components/Comments.astro` | Thread and form. Themed via CSS custom properties. |
| `site/src/pages/admin/comments.astro` | Moderation queue UI at `/admin/comments`. |
| `site/schema.sql` | D1 table and indexes. |
| `site/tests/` | Vitest suite covering the core logic and both endpoints. |

## Google sign-in setup

In the [Google Cloud Console](https://console.cloud.google.com/):

1. **Create or pick a project.** The OAuth consent screen is per project, and its app name is
   what readers see in the sign-in dialog. Use one project per site if you want each to show its
   own name; one project for both is fine if you do not care.
2. **APIs & Services → OAuth consent screen.** User type **External**. Fill in app name, support
   email, and developer contact. Scopes stay default (`email`, `profile`, `openid`) — these are
   non-sensitive, so no Google verification review is required.
3. **Publish the consent screen.** This matters: while it is in *Testing*, only accounts you list
   as test users can sign in. Everyone else gets an error. Click **Publish app**.
4. **Credentials → Create Credentials → OAuth client ID → Web application.**
5. **Authorized JavaScript origins** — add every origin the button will load from:
   ```
   https://jojojiji.com
   https://www.jojojiji.com
   http://localhost:14024
   ```
   No redirect URIs are needed; the button uses a popup and posts the token back.
6. Copy the **Client ID** (`....apps.googleusercontent.com`) into:
   - `GOOGLE_CLIENT_ID` in `[vars]` in `site/wrangler.toml` (server-side verification)
   - `PUBLIC_GOOGLE_CLIENT_ID` as a GitHub Actions **variable** (build-time, renders the button)

   Both must be the same value. There is no client secret in this flow.

## Setup

### 1. Create the database

```bash
cd site
npx wrangler d1 create jojojiji-comments
```

Copy the returned `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

### 2. Apply the schema

```bash
npm run db:init:local     # local development database
npm run db:init:remote    # production
```

### 3. Set the secrets

```bash
npx wrangler pages secret put ADMIN_TOKEN          --project-name jojojiji
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name jojojiji
npx wrangler pages secret put IP_HASH_SALT         --project-name jojojiji
```

- `ADMIN_TOKEN` gates `/api/admin/comments`. Generate one with `openssl rand -base64 32`.
  Without it the admin endpoint returns 503 and is never open.
- `TURNSTILE_SECRET_KEY` comes from the Turnstile widget you create in the Cloudflare dashboard.
- `IP_HASH_SALT` salts the IP hashes used for rate limiting. Any long random string.

### 4. Set the Turnstile site key

The site key is public and is baked in at build time. Add it as a GitHub Actions **variable**
named `PUBLIC_TURNSTILE_SITE_KEY` on the repo. Without it the form still works, but with no
bot challenge.

### 5. Local development

```bash
cp .dev.vars.example .dev.vars    # never commit .dev.vars
npm run build
npm run preview                    # wrangler pages dev, Functions + D1 included
```

Leaving `TURNSTILE_SECRET_KEY` empty locally skips verification, so the form works without a
widget.

## Moderating

Go to `/admin/comments`, paste the `ADMIN_TOKEN`, and approve, reject, or delete. The token is
kept in `sessionStorage` and cleared on sign out or when the server rejects it.

The page is `noindex` and disallowed in `robots.txt`, but its security comes from the token,
not from being unlisted.

## Protections

| Layer | What it stops |
|---|---|
| Google sign-in required | Drive-by spam entirely. Posting needs a real Google account. |
| Signature verification | Forged or replayed tokens. Checks RS256 signature against Google's keys, plus issuer, audience, and expiry. |
| Identity from token only | Impersonation. A name in the request body is ignored when signed in. |
| Moderation queue | Everything else. Nothing is public until approved. |
| Cloudflare Turnstile | Automated submissions, on the anonymous path only. |
| Honeypot field | Naive form-filling bots. Rejected without explanation. |
| Rate limit | 5 comments per hashed IP per hour. |
| Length and format validation | Oversized payloads, malformed slugs and emails. |
| `textContent` rendering | XSS. Comment text is never parsed as HTML. |
| Parameterised D1 queries | SQL injection. |
| Constant-time token compare | Timing attacks on `ADMIN_TOKEN`. |

Emails are optional, never returned by the public endpoint, and visible only in the admin queue.
Raw IPs are never stored, only a salted SHA-256 hash.

## API

### `GET /api/comments?post=<slug>`

```json
{
  "comments": [
    {
      "id": "...",
      "name": "...",
      "body": "...",
      "createdAt": "2026-08-14T...",
      "provider": "google",
      "avatar": "https://lh3.googleusercontent.com/..."
    }
  ]
}
```

### `POST /api/comments`

Signed in with Google (the default policy):

```json
{ "post": "slug", "body": "...", "googleCredential": "<ID token from Google>" }
```

Anonymous, only when `ALLOW_ANONYMOUS` is `"true"`:

```json
{ "post": "slug", "name": "...", "email": "optional", "body": "...", "turnstileToken": "..." }
```

`201` on success, with `{ "ok": true, "status": "pending" | "approved" }`.
`400` invalid, `401` not signed in or bad credential, `403` failed Turnstile,
`429` rate limited.

### `GET /api/admin/comments?status=pending|approved|rejected|all`

Requires `Authorization: Bearer <ADMIN_TOKEN>`.

### `POST /api/admin/comments`

```json
{ "id": "...", "action": "approve" | "reject" | "delete" }
```

Requires `Authorization: Bearer <ADMIN_TOKEN>`.

## Cost

Cloudflare's free tier covers D1 (5GB storage, 5 million row reads per day), Pages Functions
(100,000 requests per day), and Turnstile (1 million verifications per month). A personal site
will not approach these.
