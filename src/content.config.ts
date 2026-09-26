import { readdir, readFile } from 'node:fs/promises';
import { defineCollection } from 'astro:content';
import { glob, type Loader } from 'astro/loaders';
import { z } from 'astro/zod';
import { readPostHead, sitePath } from './lib/post-head';

/**
 * Finished HTML posts: public/<slug>/index.html. The landing card comes from
 * the page's own head, and only pages with article:published_time are listed;
 * the rest (cv/) stay online and unlisted.
 */
const htmlPostsLoader: Loader = {
  name: 'html-posts',
  async load({ store, parseData, config }) {
    store.clear();
    const site = config.site ?? '';
    const folders = await readdir(config.publicDir, { withFileTypes: true });
    for (const folder of folders.filter((f) => f.isDirectory())) {
      const slug = folder.name;
      const file = new URL(`${slug}/index.html`, config.publicDir);
      const html = await readFile(file, 'utf8').catch((err) => {
        if (err.code === 'ENOENT') return undefined;
        throw err;
      });
      if (html === undefined) continue;

      const head = readPostHead(html);
      if (!head.published) continue;

      const data = await parseData({
        id: slug,
        filePath: `public/${slug}/index.html`,
        data: {
          title: head.title,
          description: head.description,
          date: head.published,
          image: {
            src: head.image && sitePath(head.image, slug, site),
            width: head.imageWidth,
            height: head.imageHeight,
          },
        },
      });
      store.set({ id: slug, data, filePath: `public/${slug}/index.html` });
    }
  },
};

const htmlPosts = defineCollection({
  loader: htmlPostsLoader,
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    date: z.coerce.date(),
    image: z.object({
      src: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  }),
});

/** Posts built by Astro: src/posts/<slug>/index.mdx, served at /<slug>/. */
const mdxPosts = defineCollection({
  loader: glob({
    pattern: '*/index.mdx',
    base: './src/posts',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      date: z.coerce.date(),
      /** Share card, 1200×630. Also the landing card. */
      image: image(),
      imageAlt: z.string().min(1),
      /** Line under the heading. */
      subtitle: z.string().optional(),
    }),
});

export const collections = { htmlPosts, mdxPosts };
