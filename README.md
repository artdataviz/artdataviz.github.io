# artdataviz

Source of https://artdataviz.github.io: data visualisations by Aleksey Zabelin,
each with a write-up of how it was made. Built with [Astro](https://astro.build),
deployed to GitHub Pages by GitHub Actions on every push to `main`.

## Run it

Node 22.18 or newer (the tests run TypeScript natively).

```sh
npm install
npm run dev       # http://localhost:4321, reloads on save
npm test          # unit tests
npm run build     # type check, then build into dist/
npm run preview   # serve dist/
```

## Add a post

Every post is one folder named by its URL. The landing page lists posts newest
first; nobody edits it by hand.

### A finished HTML page

Put the folder in `public/<slug>/` with an `index.html`. It is copied to the site
unchanged. To list it on the landing page, its `<head>` needs:

```html
<title>8,631 stars</title>
<meta name="description" content="…">                              <!-- card text -->
<meta property="og:image" content="https://artdataviz.github.io/8631-stars/og.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="article:published_time" content="2026-09-09" />   <!-- lists it -->
```

No `article:published_time`, no listing: the page is online but unlisted, like
`/cv/`. A dated page missing any other tag stops the build with the name of the
field. Restart `npm run dev` to see a new folder on the landing page.

### A post built with Astro

Write `src/posts/<slug>/index.mdx`. It gets the same look as the HTML posts, and
can import npm packages (three.js, d3) and components.

```mdx
---
title: Every bit counts
description: One website behind two CDNs, drawn as bars of streaming ones and zeros.
date: 2026-09-26
image: ./og.jpg           # 1200×630 share card, next to this file
imageAlt: A dark bar chart built from orange and purple ones and zeros.
subtitle: Line under the heading. Optional.
---
import Wide from '../../components/Wide.astro';
import chart from './chart.png';

<Wide>
  <figure>
    <img src={chart.src} width={chart.width} height={chart.height} alt="…" />
    <figcaption>Caption.</figcaption>
  </figure>
</Wide>

<p class="lede">Opening paragraph, set larger.</p>

Markdown from here on. `## 1 · Section` headings, tables inside
`<div class="tablewrap">`, `<p class="note">` for asides.
```

`<Wide>` lets a block run up to 1200 px, past the text column. React, Svelte or
Tailwind get added with `npx astro add react` (etc.) when a post needs them.

Until the first MDX post exists, the build warns that `mdxPosts` is empty. That
is expected.

Two posts can't share a slug: an MDX post whose slug is already taken in
`public/` stops the build.

## Layout

```
public/                    copied to the site as is: HTML posts, cv/, robots.txt
src/content.config.ts      the two post collections
src/lib/                   head parser, date format, post merge (+ tests)
src/layouts/               Base (head, Open Graph), Post (MDX post chrome)
src/pages/                 landing, 404, MDX post route
src/posts/                 MDX posts
docs/specs/                design notes
.github/workflows/         build on every push, deploy from main
```

`generative-dataviz/generator/README.md` at the root is a pointer: older links to
the generator's code land there and find its new place in `public/`.

`marketing/` holds source material for social posts; it is git-ignored and never
published.
