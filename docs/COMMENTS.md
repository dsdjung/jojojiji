# Comments

Reader comments, self-hosted on Cloudflare. No third-party service, no per-site fee, and no
account required to comment.

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
| `site/functions/_lib/comments.js` | All validation, D1 queries, and helpers. Pure and unit tested. |
| `site/functions/api/comments.js` | Public endpoint: `GET` approved comments, `POST` a new one. |
| `site/functions/api/admin/comments.js` | Moderation endpoint, bearer-token protected. |
| `site/src/components/Comments.astro` | Thread and form. Themed via CSS custom properties. |
| `site/src/pages/admin/comments.astro` | Moderation queue UI at `/admin/comments`. |
| `site/schema.sql` | D1 table and indexes. |
| `site/tests/` | Vitest suite covering the core logic and both endpoints. |

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
| Moderation queue | Everything. Nothing is public until approved. |
| Cloudflare Turnstile | Automated submissions. |
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
{ "comments": [{ "id": "...", "name": "...", "body": "...", "createdAt": "2026-08-14T..." }] }
```

### `POST /api/comments`

```json
{ "post": "slug", "name": "...", "email": "optional", "body": "...", "turnstileToken": "..." }
```

`201` on success. `400` invalid, `403` failed verification, `429` rate limited.

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
