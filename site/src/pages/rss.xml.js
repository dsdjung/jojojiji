/**
 * RSS feed at /rss.xml.
 *
 * Published posts only. Drafts are noindex review copies and must not be
 * pushed to subscribers or aggregators.
 */
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = await getCollection('posts');

  const published = posts
    .filter((post) => post.data.published)
    .sort((a, b) => (b.data.date ?? '').localeCompare(a.data.date ?? ''));

  return rss({
    title: 'jojojiji',
    description: 'Things worth knowing, written for my kids.',
    site: context.site,
    trailingSlash: false,
    items: published.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      link: `/posts/${post.id}/`,
      author: 'David Jung',
      categories: post.data.tags,
      ...(post.data.date ? { pubDate: new Date(`${post.data.date}T12:00:00Z`) } : {}),
    })),
    customData: '<language>en-us</language>',
  });
}
