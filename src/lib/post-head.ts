import { decodeHTML, decodeHTMLAttribute } from 'entities';

/** What a finished HTML post says about itself in its <head>. */
export interface PostHead {
  title?: string;
  description?: string;
  /** The YYYY-MM-DD day of article:published_time, as written. A post without it is unlisted. */
  published?: string;
  /** og:image, as written: absolute, root-relative or relative. */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
}

const COMMENT = /<!--[\s\S]*?-->/g;
// Quoted values may hold ">", so attributes are matched quote-aware.
const META = /<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function readPostHead(html: string): PostHead {
  const page = html.replace(COMMENT, '');
  const end = page.search(/<\/head>/i);
  const head = end === -1 ? page : page.slice(0, end);

  // name="description" and property="og:…" share one map; their keys never collide.
  const meta = new Map<string, string>();
  for (const [, attrs] of head.matchAll(META)) {
    const a = Object.fromEntries(
      [...attrs.matchAll(ATTR)].map(([, key, dq, sq, bare]) => [key.toLowerCase(), dq ?? sq ?? bare]),
    );
    const key = (a.property ?? a.name)?.toLowerCase();
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, decodeHTMLAttribute(a.content).trim());
  }

  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const int = (key: string) => (meta.has(key) ? Number(meta.get(key)) : undefined);

  return {
    title: title === undefined ? undefined : decodeHTML(title).trim(),
    description: meta.get('description'),
    // The card shows the day the author wrote, not that day moved to UTC.
    published: meta.get('article:published_time')?.slice(0, 10),
    image: meta.get('og:image'),
    imageWidth: int('og:image:width'),
    imageHeight: int('og:image:height'),
    imageAlt: meta.get('og:image:alt'),
  };
}

/** A link from a post's head, as a path on this site when it points here. */
export function sitePath(url: string, slug: string, site: string): string {
  const resolved = new URL(url, new URL(`/${slug}/`, site));
  return resolved.origin === new URL(site).origin ? resolved.pathname : resolved.href;
}
