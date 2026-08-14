---
title: "Placeholder: replace this before launch"
date: "2026-08-14"
published: false
description: "A scaffold post that exercises every feature of the site. Rewrite or delete it."
tags: ["meta"]
---

This post exists so the site has something to render while it is being built. It is
set to `published: false`, so it does not appear on the home page and search engines
are asked to skip it. Rewrite it or delete the file.

## What the frontmatter does

`title` and `description` drive the page title, the listing entry, and the social
card. `date` sets the published date and the sort order on the home page. `tags`
render as pills under the title. Setting `published: true` is what makes a post
appear on the home page.

## Adding a video

Add a `youtubeId` to the frontmatter and the video renders above the body text:

```yaml
youtubeId: "dQw4w9WgXcQ"
```

The embed uses `youtube-nocookie.com` and loads lazily, so a post with a video does
not slow down the rest of the page.

## Formatting

Regular paragraphs, **bold**, *italic*, and [links](https://jojojiji.com) all work.

> Block quotes look like this.

- Lists work
- The way you would expect

## Comments

Every post has a comment thread at the bottom. Comments go into a moderation queue
and only appear on the site after they are approved at `/admin/comments`.
