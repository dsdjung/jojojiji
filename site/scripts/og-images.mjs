#!/usr/bin/env node
/**
 * Generate social card images for published essays.
 *
 *   npm run og
 *
 * Writes 1200x630 PNGs to site/public/og/<slug>.png, which are committed and
 * served as static assets.
 *
 * Why generate here rather than at build time: the two Astro build-time
 * options either break against the current Astro version or require a headless
 * browser or a WASM canvas in CI. Rendering locally and committing the result
 * keeps CI simple and deterministic, at the cost of re-running this when an
 * essay's title or description changes. `npm run og` covers that.
 *
 * Text is rasterised here, so the font only needs to exist on the machine that
 * runs this script, not on the build server.
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Lives under site/ so that `sharp` resolves from site/node_modules.
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(SITE, '..');
const ESSAYS = resolve(REPO, 'posts');
const OUT_DIR = resolve(SITE, 'public/og');

const W = 1200;
const H = 630;
const PAD = 80;

const BRAND = {
  bg: '#fffdf8',
  rule: '#d16b3c',
  title: '#2b2621',
  body: '#5c534a',
  meta: '#8d8377',
  font: '"Trebuchet MS", "Avenir Next", sans-serif',
  site: 'jojojiji.com',
};

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Greedy word wrap using an average advance width.
 *
 * SVG has no automatic wrapping, and measuring precisely would mean parsing
 * font metrics. An average of 0.5em per character is close enough for a serif
 * at these sizes, and the line cap prevents overflow when it is not.
 */
function wrap(text, fontSize, maxWidth, maxLines) {
  const perChar = fontSize * 0.5;
  const maxChars = Math.floor(maxWidth / perChar);
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line !== '') lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line !== '' && lines.length < maxLines) lines.push(line);

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:]?$/, '') + '…';
  }
  return lines;
}

function card({ title, description }) {
  const titleSize = title.length > 55 ? 54 : 64;
  const titleLines = wrap(title, titleSize, W - PAD * 2, 3);
  const descLines = wrap(description, 27, W - PAD * 2, 3);

  const titleTop = PAD + 40;
  const titleLh = titleSize * 1.22;
  const descTop = titleTop + titleLines.length * titleLh + 34;
  const descLh = 27 * 1.5;

  const tspans = (lines, x, top, lh) =>
    lines
      .map((l, i) => `<tspan x="${x}" y="${top + i * lh}">${esc(l)}</tspan>`)
      .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
  <rect width="${W}" height="12" fill="${BRAND.rule}"/>
  <text font-family='${BRAND.font}' font-size="${titleSize}" font-weight="bold" fill="${BRAND.title}">
    ${tspans(titleLines, PAD, titleTop, titleLh)}
  </text>
  <text font-family='${BRAND.font}' font-size="27" fill="${BRAND.body}">
    ${tspans(descLines, PAD, descTop, descLh)}
  </text>
  <text x="${PAD}" y="${H - PAD + 10}" font-family='${BRAND.font}' font-size="24"
        fill="${BRAND.meta}" letter-spacing="1">${BRAND.site}</text>
</svg>`;
}

// --- run --------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(ESSAYS).filter((f) => f.endsWith('.md'));
let written = 0;

for (const file of files) {
  const raw = readFileSync(resolve(ESSAYS, file), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!fm) continue;

  const meta = Object.fromEntries(
    fm[1]
      .split('\n')
      .map((l) => /^(\w+):\s*(.*)$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^"(.*)"$/, '$1')])
  );

  // Drafts are noindex review copies and get no shareable card.
  if (meta.published !== 'true') continue;

  const slug = file.replace(/\.md$/, '');
  const svg = card({ title: meta.title ?? slug, description: meta.description ?? '' });
  const out = resolve(OUT_DIR, `${slug}.png`);

  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
  console.log(`  ${slug}.png`);
  written += 1;
}

// A default card for the home page, about page, and anything without its own.
const fallback = card({
  title: 'jojojiji',
  description:
    'Things worth knowing, written for my kids.',
});
writeFileSync(resolve(OUT_DIR, 'default.svg'), fallback);
await sharp(Buffer.from(fallback)).png({ compressionLevel: 9 }).toFile(resolve(OUT_DIR, 'default.png'));
console.log('  default.png');

console.log(`\nWrote ${written + 1} card(s) to site/public/og/`);
