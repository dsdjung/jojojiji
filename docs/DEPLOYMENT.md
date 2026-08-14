# Deployment

`jojojiji.com` is a static Astro build served by Cloudflare Pages, with Pages Functions for the
comments API and D1 for storage.

Pushing to `main` runs [.github/workflows/deploy.yml](../.github/workflows/deploy.yml): type
check, tests, build, then `wrangler pages deploy`. A failing check or test blocks the deploy.

## Current state

Live as of 2026-08-14.

| Resource | Value |
|---|---|
| Pages project | `jojojiji` (`jojojiji.pages.dev`) |
| D1 database | `jojojiji-comments` / `75671fc8-33d9-4b12-bdc0-6f725c41256b` |
| Turnstile site key | `0x4AAAAAAEPlzpOhi43q3Eve` |
| Account ID | `095fd59b3aac7869fe6b66380d102ee9` |
| Custom domains | `jojojiji.com`, `www.jojojiji.com` |

Both apex and `www` are proxied CNAMEs to `jojojiji.pages.dev`. The zone's Cloudflare Email
Routing records (MX, SPF, DKIM) were left untouched.

**Still outstanding:** `CLOUDFLARE_API_TOKEN` is not set as a GitHub Actions secret, so CI
deploys fail at the last step. Until it is added, deploy manually with
`cd site && npx wrangler pages deploy --project-name=jojojiji --branch=main` (requires Node 22+,
see `.nvmrc`). Creating an API token cannot be scripted through a `wrangler login` OAuth session;
it has to be done in the dashboard.

## One-time setup

### 1. Cloudflare API token

Create a token at **Cloudflare dashboard → My Profile → API Tokens → Create Token** with:

| Scope | Permission |
|---|---|
| Account → Cloudflare Pages | Edit |
| Account → D1 | Edit |
| Account → Account Settings | Read |

The existing DNS-only token in the global `CLAUDE.md` is **not** sufficient. It has no
account-level permissions, so it cannot create or deploy Pages projects.

### 2. Create the Pages project

```bash
cd site
npx wrangler pages project create jojojiji --production-branch main
```

### 3. Create the D1 database

Follow [COMMENTS.md](COMMENTS.md), then paste the `database_id` into `site/wrangler.toml`.

### 4. GitHub repository secrets

**Settings → Secrets and variables → Actions → Secrets:**

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID |

**Settings → Secrets and variables → Actions → Variables** (public, baked into the bundle):

| Name | Value |
|---|---|
| `PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key |
| `PUBLIC_ADSENSE_CLIENT` | `ca-pub-...` publisher ID |
| `PUBLIC_ADSENSE_SLOT` | Default ad unit ID |

Every one of these is optional. Leave a variable unset and the matching feature renders
nothing: no Turnstile widget, no ad markup, no empty boxes.

### 5. Cloudflare Pages secrets

```bash
npx wrangler pages secret put ADMIN_TOKEN          --project-name jojojiji
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name jojojiji
npx wrangler pages secret put IP_HASH_SALT         --project-name jojojiji
```

### 6. Custom domain

In the Cloudflare dashboard: **Workers & Pages → jojojiji → Custom domains → Set up a domain**,
and enter `jojojiji.com`. Because the zone is already on this Cloudflare account, the DNS record
is created automatically. Repeat for `www.jojojiji.com` if wanted.

`jojojiji.com` currently has **no DNS records at all**, so there is nothing to remove first.

## Ads

AdSense is wired in but inert until `PUBLIC_ADSENSE_CLIENT` and `PUBLIC_ADSENSE_SLOT` are set.

- The loader script (`AdSense.astro`) renders only when a publisher ID exists.
- Ad units (`AdUnit.astro`) render only when both a client and a slot exist.
- Units appear on published posts only. Drafts are `noindex` review copies and carry no ads.

AdSense requires review and approval before serving, and the site needs real content first.

This site is treated as **general audience**. If it later becomes genuinely child-directed
(games, activities, content designed for children to browse themselves), it must be tagged as
such in AdSense, which restricts it to non-personalized ads.

## Rollback

Cloudflare Pages keeps every deployment. **Workers & Pages → jojojiji → Deployments →
… → Rollback**, or push a revert commit.
