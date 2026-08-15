import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    /** Publication date, ISO `YYYY-MM-DD`. Required once published. */
    date: z.string().optional(),
    /** Last substantive revision. Surfaced as schema.org dateModified. */
    updated: z.string().optional(),
    /** Drafts are excluded from listings and the sitemap, but still build at their URL. */
    published: z.boolean().default(false),
    description: z.string(),
    /** Optional YouTube video ID rendered above the post body. */
    youtubeId: z.string().optional(),
    /** Free-form topic tags, shown as pills under the title. */
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { posts };
