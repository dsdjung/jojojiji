# jojojiji

Things worth knowing, written for my kids. Static site at [jojojiji.com](https://jojojiji.com),
built with Astro and deployed to Cloudflare Pages.

## Quick start

```bash
cd site
npm install
npm run dev          # http://localhost:14024
```

## Writing a post

Create a markdown file in `posts/` (symlinked into `site/src/content/posts/`):

```markdown
---
title: "How compound interest actually works"
date: "2026-08-20"
published: true
description: "One sentence for the home page and the social card."
youtubeId: "dQw4w9WgXcQ"   # optional, renders a video above the body
tags: ["money", "math"]     # optional
---

Body text here. Do not repeat the title as an H1; the layout renders it.
```

- `published: false` keeps a post off the home page and out of the sitemap, and marks it
  `noindex`, but the page still builds at `/posts/<slug>/` so the link can be shared for feedback.
- The slug comes from the filename.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 14024 |
| `npm run build` | Static build into `site/dist/` |
| `npm run preview` | Serve the built site with Pages Functions via wrangler |
| `npm run check` | Astro/TypeScript diagnostics |
| `npm test` | Vitest suite for the comments API |
| `npm run db:init:local` | Apply `schema.sql` to the local D1 database |
| `npm run db:init:remote` | Apply `schema.sql` to the production D1 database |

## Comments

Reader comments are stored in Cloudflare D1 and served by Pages Functions in `site/functions/`.
Comments are held in a moderation queue and appear only after approval at `/admin/comments`.

See [docs/COMMENTS.md](docs/COMMENTS.md) for the full setup, schema, and API.

## Video

Source footage is **not** tracked in git. The two masters in `video/` are 470MB and 214MB,
both over GitHub's 100MB per-file limit. Keep masters in cloud storage or on an external
drive; published videos live on YouTube and are embedded by ID through the `youtubeId`
frontmatter field.

## Deployment

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): type check,
tests, build, then `wrangler pages deploy`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the
one-time Cloudflare setup.

## Structure

```
posts/                       # Source markdown (source of truth)
video/                       # Local video masters, git-ignored
assets/                      # Thumbnails and design sources
site/
├── src/
│   ├── content/posts/       # Symlink to posts/
│   ├── components/          # Comments, AdSense, AdUnit, YouTube
│   ├── layouts/             # Base.astro, Post.astro
│   ├── pages/               # index, about, posts/[...slug], admin/comments
│   ├── styles/global.css
│   └── content.config.ts
├── functions/               # Cloudflare Pages Functions (comments API)
├── tests/                   # Vitest suite
├── schema.sql               # D1 schema
├── wrangler.toml            # Pages + D1 configuration
└── astro.config.mjs         # Dev port 14024
docs/                        # Setup documentation
```
