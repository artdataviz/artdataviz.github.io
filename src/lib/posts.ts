import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** One post as the landing page shows it, whatever it was built with. */
export interface Card {
  slug: string;
  title: string;
  description: string;
  date: Date;
  image: { src: string; width: number; height: number };
}

/** Finished HTML posts and MDX posts in one list, newest first. */
export function mergePosts(html: Card[], mdx: Card[]): Card[] {
  return [...html, ...mdx].sort(
    (a, b) => b.date.getTime() - a.date.getTime() || a.slug.localeCompare(b.slug),
  );
}

/**
 * The first MDX slug already taken by anything in public/, dated or not.
 * Astro would quietly serve the public file and drop the MDX page.
 */
export function publicClash(slugs: string[], publicDir: string): string | undefined {
  return slugs.find((slug) => existsSync(join(publicDir, slug)));
}
