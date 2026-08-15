# Post patterns

Copy-paste markup for the two shapes most posts need. Markdown cannot import
components, but it accepts raw HTML, so these go straight into a `.md` file and
pick up the styles in `site/src/styles/global.css`.

## The answer box

Put the formula at the top, before the reasoning. Someone who wants only the
number should get it without scrolling, and someone who wants the argument
reads on. This is also the shape that AI answer engines quote.

```html
<div class="answer">
<div class="answer-label">The short answer</div>
<p>Keep the <strong>total</strong> cost of a car under <strong>35% of one year's income</strong>, and never finance it for more than four years.</p>
</div>
```

## A bar chart

Inline SVG. No chart library, no page weight, scales to any screen, and it
inherits the site's colours through `currentColor` and the CSS variables.

The pattern: one row per bar, `y` increasing by 46 each time. Bar width is
`value / max * 420`. Keep `viewBox` height at `count * 46 + 70`.

```html
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
```

## Why one page per question

Give each decision its own post: "How much car can I afford?" not a combined
"money rules" page.

- Each targets a distinct search query. People search the question, not the category.
- Cloudflare Web Analytics **Top Pages** then ranks which decisions readers
  actually care about, which tells you what to write next. One combined page
  gives you a single row and no signal.
- Answer engines cite a page that answers one question far more readily than a
  page that answers ten.

## Two rules for raw HTML in markdown

Both of these silently break the block, and the failure looks like markup
printed on the page rather than rendered.

**No blank lines inside the block.** Markdown ends an HTML block at the first
blank line and parses everything after it as markdown. Keep the whole `<figure>`
or `<div>` as one unbroken run of lines.

**No four-space indentation.** Once the HTML block has ended, four or more
leading spaces make markdown treat the remainder as an indented code block, so
the markup gets syntax-highlighted and displayed as text. Keep nesting to two
spaces, or none.

Together these mean SVG in markdown looks less tidy than SVG in a component
file. That is the trade for markdown not supporting imports.

To check a page rendered correctly, look for escaped markup rather than for the
presence of a string:

```bash
curl -s https://jojojiji.com/posts/<slug>/ | grep -c '&lt;rect'   # must be 0
curl -s https://jojojiji.com/posts/<slug>/ | grep -c 'astro-code' # must be 0
```

Searching for `car-title` alone is not enough: it matches the escaped copy too,
so a broken page still looks fine.

## Accessibility

Every chart needs `role="img"` plus `<title>` and `<desc>`, referenced by
`aria-labelledby`. The `desc` should state the numbers, since a screen reader
cannot see the bars. It is also what a text-only crawler reads, so it doubles as
the machine-readable version of the chart.
