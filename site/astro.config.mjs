// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * URL paths for posts whose frontmatter is not `published: true`.
 *
 * Those pages are rendered (so a direct link can be shared for feedback) but
 * carry `noindex`, so they must not appear in the sitemap.
 *
 * @returns {string[]} e.g. ['/posts/hello/']
 */
function draftPaths() {
  const dir = fileURLToPath(new URL('./src/content/posts', import.meta.url));
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .filter((file) => {
        const source = readFileSync(new URL(`./src/content/posts/${file}`, import.meta.url), 'utf8');
        return !/^published:\s*true\s*$/m.test(source);
      })
      .map((file) => `/posts/${file.replace(/\.md$/, '')}/`);
  } catch {
    return [];
  }
}

const excluded = draftPaths();

// https://astro.build/config
export default defineConfig({
  site: 'https://jojojiji.com',
  server: { port: 14024 },
  output: 'static',
  integrations: [
    sitemap({
      // Keep the moderation queue and unpublished drafts out of the sitemap.
      filter: (page) => {
        if (page.includes('/admin/')) return false;
        const path = new URL(page).pathname;
        return !excluded.includes(path);
      },
    }),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-light',
    },
  },
});
