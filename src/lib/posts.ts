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
  const taken = new Set(html.map((p) => p.slug));
  for (const { slug } of mdx) {
    if (taken.has(slug)) {
      throw new Error(
        `Two posts claim /${slug}/: public/${slug}/index.html and src/posts/${slug}/index.mdx. Rename one.`,
      );
    }
  }
  return [...html, ...mdx].sort(
    (a, b) => b.date.getTime() - a.date.getTime() || a.slug.localeCompare(b.slug),
  );
}
