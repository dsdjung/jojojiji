# Images and video in posts

Both work. The rules differ by type, and the difference matters for page speed.

## Images

Reference them **relative to the markdown file**, and Astro optimises them
automatically at build time:

```markdown
![A description of what the image shows](./images/chart.png)
```

Put the file next to the post, e.g. `posts/images/chart.png`.

Measured on a 1400x700 PNG:

| | Source | Emitted |
|---|---|---|
| Format | PNG | WebP |
| Size | 15,679 bytes | **1,842 bytes** |
| Attributes | — | `loading="lazy"`, `decoding="async"`, intrinsic `width`/`height` |

The intrinsic dimensions matter as much as the size: without them the page
reflows as images load, which is a poor experience and a Core Web Vitals
penalty.

**Do not put images in `public/`.** Files there are served byte-for-byte with no
optimisation, no format conversion, and no dimensions, so they cause layout
shift. `public/` is for files that must keep an exact URL, like `robots.txt` and
the social cards.

Alt text is not optional. Describe what the image shows, not that it is an image.

## Video

Prefer YouTube over self-hosting. A video file in the repo is large, is not
optimised by anything here, and GitHub rejects files over 100MB.

**At the top of a post** (jojojiji only; asymptronix has no such field), use frontmatter:

```yaml
youtubeId: "dQw4w9WgXcQ"
```

**Anywhere in the body**, on either site, use raw HTML. The wrapper keeps it
16:9 and responsive:

```html
<figure>
<div class="video-embed">
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" title="What the video shows" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>
<figcaption>Optional caption.</figcaption>
</figure>
```

`youtube-nocookie.com` avoids setting tracking cookies until the viewer presses
play, and `loading="lazy"` keeps the embed from costing anything on pages where
nobody scrolls that far.

## The one trap

Any raw HTML in markdown, including the video block above, must be **one
unbroken run of lines with no indentation**. A blank line ends the HTML block,
and four-space indentation turns the remainder into a code block. The failure
mode is markup printed on the page.

Markdown image syntax has neither problem. Only raw HTML does.

To verify a page rendered rather than escaped:

```bash
curl -s https://SITE/PATH/ | grep -c '&lt;iframe'   # must be 0
curl -s https://SITE/PATH/ | grep -c 'astro-code'   # must be 0, unless the post has a code block
```
