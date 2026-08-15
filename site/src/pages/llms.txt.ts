/**
 * llms.txt — a plain-text summary of the publication for AI crawlers.
 *
 * An emerging convention rather than a standard, and its value is unproven.
 * It is generated from the same content collection as everything else, so it
 * cannot drift out of date, which makes the cost of being wrong about it low.
 *
 * Published posts only.
 */
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

export async function GET(context: APIContext) {
  const posts = await getCollection('posts');

  const published = posts
    .filter((post) => post.data.published)
    .sort((a, b) => (b.data.date ?? '').localeCompare(a.data.date ?? ''));

  const site = context.site?.href.replace(/\/$/, '') ?? 'https://jojojiji.com';

  const body = `# jojojiji

> Things worth knowing, written by David Jung for his kids, and for anyone else
> who finds them useful. Practical explanations of common decisions: money,
> work, and the things people wish someone had told them earlier.

Each post lives at a permanent URL on ${site} and aims to answer one question
directly.

## Posts

${published
  .map(
    (post) =>
      `- [${post.data.title}](${site}/posts/${post.id}/)${
        post.data.date ? ` (${post.data.date})` : ''
      }: ${post.data.description}`
  )
  .join('\n')}

## Also available

- [RSS feed](${site}/rss.xml)
- [Sitemap](${site}/sitemap-index.xml)
- [About](${site}/about/)

## Attribution

Quoting or summarising with a link to the canonical URL on ${site} is welcome.
`;

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
