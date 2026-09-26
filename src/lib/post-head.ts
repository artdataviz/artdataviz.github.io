import { decodeHTML } from 'entities';

/** What a finished HTML post says about itself in its <head>. */
export interface PostHead {
  title?: string;
  description?: string;
  /** article:published_time, as written. A post without it is unlisted. */
  published?: string;
  /** og:image, as written: absolute, root-relative or relative. */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
}

const COMMENT = /<!--[\s\S]*?-->/g;
const META = /<meta\b([^>]*)>/gi;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function readPostHead(html: string): PostHead {
  const end = html.search(/<\/head>/i);
  const head = (end === -1 ? html : html.slice(0, end)).replace(COMMENT, '');

  // name="description" and property="og:…" share one map; their keys never collide.
  const meta = new Map<string, string>();
  for (const [, attrs] of head.matchAll(META)) {
    const a = Object.fromEntries(
      [...attrs.matchAll(ATTR)].map(([, key, dq, sq, bare]) => [key.toLowerCase(), dq ?? sq ?? bare]),
    );
    const key = (a.property ?? a.name)?.toLowerCase();
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, decodeHTML(a.content).trim());
  }

  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const int = (key: string) => (meta.has(key) ? Number(meta.get(key)) : undefined);

  return {
    title: title === undefined ? undefined : decodeHTML(title).trim(),
    description: meta.get('description'),
    published: meta.get('article:published_time'),
    image: meta.get('og:image'),
    imageWidth: int('og:image:width'),
    imageHeight: int('og:image:height'),
    imageAlt: meta.get('og:image:alt'),
  };
}

/** A link from a post's head, as a path on this site when it points here. */
export function sitePath(url: string, slug: string, site: string): string {
  const resolved = new URL(url, `${site}/${slug}/`);
  return resolved.origin === new URL(site).origin ? resolved.pathname : resolved.href;
}
