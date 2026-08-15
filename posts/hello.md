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

## The answer box and charts

Two shapes most posts need. Both are raw HTML, since markdown cannot import
components. Copy them from `docs/POST-PATTERNS.md`.

<div class="answer">
<div class="answer-label">The short answer</div>
<p>Keep the <strong>total</strong> cost of a car under <strong>35% of one year's income</strong>, and never finance it for more than four years.</p>
</div>

<figure class="chart">
<svg viewBox="0 0 640 254" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="car-title car-desc">
<title id="car-title">Maximum car price by income</title>
<desc id="car-desc">At 35% of annual income: $50,000 income supports $17,500; $75,000 supports $26,250; $100,000 supports $35,000; $150,000 supports $52,500.</desc>
<g font-family="'Trebuchet MS', 'Avenir Next', sans-serif" font-size="13">
<text x="0" y="46" fill="#5c534a">$50k</text>
<rect x="70" y="34" width="140" height="18" fill="#d16b3c" opacity="0.85" rx="3"/>
<text x="220" y="46" fill="#8d8377">$17,500</text>
<text x="0" y="92" fill="#5c534a">$75k</text>
<rect x="70" y="80" width="210" height="18" fill="#d16b3c" opacity="0.85" rx="3"/>
<text x="290" y="92" fill="#8d8377">$26,250</text>
<text x="0" y="138" fill="#5c534a">$100k</text>
<rect x="70" y="126" width="280" height="18" fill="#d16b3c" opacity="0.85" rx="3"/>
<text x="360" y="138" fill="#8d8377">$35,000</text>
<text x="0" y="184" fill="#5c534a">$150k</text>
<rect x="70" y="172" width="420" height="18" fill="#d16b3c" opacity="0.85" rx="3"/>
<text x="500" y="184" fill="#8d8377">$52,500</text>
<line x1="70" y1="206" x2="560" y2="206" stroke="#ece3d5" stroke-width="1"/>
<text x="70" y="228" fill="#8d8377" font-size="12">Annual income &#8594; maximum total car cost, at 35%</text>
</g>
</svg>
<figcaption>Total cost means purchase price plus interest, not the monthly payment. Monthly payments hide the real number, which is the point of quoting them.</figcaption>
</figure>

## Formatting

Regular paragraphs, **bold**, *italic*, and [links](https://jojojiji.com) all work.

> Block quotes look like this.

- Lists work
- The way you would expect

## Comments

Every post has a comment thread at the bottom. Comments go into a moderation queue
and only appear on the site after they are approved at `/admin/comments`.
