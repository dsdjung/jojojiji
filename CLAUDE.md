# CLAUDE.md: jojojiji Project Instructions

## Project Overview

jojojiji is a personal publication: things worth knowing, written for my kids and readable by
anyone. It is a static Astro site at **jojojiji.com**, deployed to Cloudflare Pages, with reader
comments backed by Cloudflare D1.

The repo also holds the source assets for the jojojiji YouTube channel. Video masters are
**not** tracked in git.

## Directory Structure

```
posts/                          # Source posts (markdown with YAML frontmatter)
video/                          # Local video masters. GIT-IGNORED, see below.
assets/                         # Thumbnails and design sources (tracked)
site/                           # Astro static site
├── src/
│   ├── content/posts/          # Symlink to posts/ (source of truth)
│   ├── components/             # AdSense, AdUnit, Comments, YouTube
│   ├── layouts/                # Base.astro, Post.astro
│   ├── pages/                  # index, about, posts/[...slug], admin/comments
│   ├── styles/global.css       # Warm palette, design tokens
│   └── content.config.ts       # Content collection schema
├── functions/                  # Cloudflare Pages Functions (comments API)
│   ├── _lib/comments.js        # Validation, D1 queries, helpers
│   └── api/                    # comments.js, admin/comments.js
├── tests/                      # Vitest suite for the comments API
├── schema.sql                  # D1 schema
├── wrangler.toml               # Pages + D1 configuration
└── astro.config.mjs            # Dev port 14024, static output
docs/                           # COMMENTS.md, DEPLOYMENT.md
```

## Commands

- **Dev server**: `cd site && npm run dev` (port 14024)
- **Build**: `cd site && npm run build`
- **Type check**: `cd site && npm run check` (must report 0 errors, 0 warnings, 0 hints)
- **Tests**: `cd site && npm test`
- **Preview with Functions**: `cd site && npm run preview` (wrangler pages dev)

Before committing any site change, all three of `npm run check`, `npm test`, and
`npm run build` must be clean.

## Post Frontmatter

```yaml
---
title: "Post Title"
date: "YYYY-MM-DD"
published: false
description: "One sentence for the home page and the social card."
youtubeId: "dQw4w9WgXcQ"   # optional, renders a video above the body
tags: ["money", "math"]     # optional
---
```

- Posts should NOT repeat the title as an H1; the layout renders it from frontmatter.
- `published: false` keeps a post off the home page and out of the sitemap, and marks it
  `noindex`. The page still builds at `/posts/<slug>/` so the link can be shared for feedback.
- The slug comes from the filename.
- Set `published: true` and add `date` to publish.

## Video

**Never `git add` files under `video/`.** The two masters there are 470MB and 214MB, over
GitHub's 100MB per-file hard limit; a commit containing them will be rejected and will bloat the
repo permanently even after a revert. `.gitignore` covers `.mp4`, `.mov`, `.m4v`, `.avi`,
`.prproj`, `.wav`, and `.aiff` under `video/`.

Published videos live on YouTube and are embedded by ID through the `youtubeId` frontmatter
field. The `YouTube.astro` component uses `youtube-nocookie.com` and lazy loading.

## Comments

Every post page carries a comment thread, including drafts. Comments are stored in Cloudflare D1,
served by Pages Functions, and held in a moderation queue until approved at `/admin/comments`.
See `docs/COMMENTS.md`.

**Commenting requires Google sign-in.** Identity comes only from the verified Google ID token;
any name or email in the request body is ignored, so nobody can post under another name. Two
`[vars]` in `site/wrangler.toml` control the policy without code changes:

- `ALLOW_ANONYMOUS` (default `"false"`) also accepts anonymous comments, which then require a
  name and must pass Turnstile. Keep the `PUBLIC_ALLOW_ANONYMOUS` build variable in sync so the
  form renders the matching fields.
- `AUTO_APPROVE_VERIFIED` (default `"false"`) publishes Google comments without review.

Google's script loads on click, not on page load, so readers who never comment get no
third-party code.

The core logic lives in `site/functions/_lib/comments.js` and `site/functions/_lib/google.js`,
both unit tested. When changing either, update `site/tests/` in the same commit.

Schema changes go in `site/migrations/` as a numbered file, and into `site/schema.sql` for
fresh databases.

This code is shared verbatim with the asymptronix repo. A fix in one belongs in the other.

## Ads

Google AdSense is wired in but renders nothing until `PUBLIC_ADSENSE_CLIENT` and
`PUBLIC_ADSENSE_SLOT` are set as GitHub Actions variables. Ad units appear on published posts
only; drafts carry no ads.

The site is treated as **general audience**. If it becomes genuinely child-directed (games,
activities, content designed for children to browse themselves), it must be tagged as such in
AdSense, which restricts it to non-personalized ads.

## Design

Deliberately warmer and more personal than asymptronix. Cream background (`#fffdf8`), warm ink,
a terracotta accent (`#d16b3c`), rounded corners, sans-serif headings over a serif body. All
values are CSS custom properties on `:root` in `global.css`, including the hooks that theme the
shared `Comments` and `AdUnit` components.

## Deployment

Push to `main` triggers `.github/workflows/deploy.yml`: type check, tests, build, then
`wrangler pages deploy`. Full setup is in `docs/DEPLOYMENT.md`.
