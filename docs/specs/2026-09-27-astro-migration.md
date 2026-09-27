# Astro migration

Status: built on branch `astro`, 2026-09-27. Goes live after two manual steps (see
Cutover).

## Goal

The site becomes an Astro project deployed by GitHub Actions. The landing list
comes from the posts themselves, so adding a post no longer means editing
`index.html` by hand. Every URL that works today keeps working, byte for byte.

## Rules

- **One folder per post, named by its URL.** A post is either a finished HTML
  folder in `public/<slug>/` or an MDX source folder in `src/posts/<slug>/`.
- **Finished folders stay as they are.** `public/` is copied to the site
  unchanged. Two edits: posts that belong on the landing page gain an
  `article:published_time` meta tag, and `/generative-dataviz/` points its
  GitHub links at the code's new path under `public/`.
- **A post is listed when it has a date.** For HTML posts that is
  `<meta property="article:published_time">`; for MDX posts, the `date` field.
  `cv/` and `speed_research/episode_01.html` have none, so they stay online and
  unlisted.
- **The card reads the post's own head.** Title from `<title>`, text from
  `<meta name="description">`, image from `og:image` and its width and height.
  A dated post missing any of these fails the build.
- **Two posts can't share a slug.** An MDX post whose slug already exists in
  `public/`, listed or not, fails the build.

## Old links

- `/generative-dataviz/generator/` was a README page rendered by Jekyll, which
  the Actions deploy doesn't run. It now redirects to the generator's folder on
  GitHub.
- GitHub links to `tree/main/generative-dataviz/generator` (one sits in a
  LinkedIn comment) land on a pointer README at that old path.
- `/?con=Ori` still forwards to the panorama.

## Layout

```
public/                     copied to the site as is
  8631-stars/  generative-dataviz/  cv/  speed_research/  robots.txt
src/
  content.config.ts         two collections: htmlPosts (public/*/index.html), mdxPosts
  lib/post-head.ts          reads title, description, og:image, date from HTML
  lib/posts.ts              merges both collections, newest first, checks slugs
  lib/dates.ts              "26 Sep 2026"
  layouts/Base.astro        <head>, Open Graph, shared tokens
  layouts/Post.astro        article chrome for MDX posts, same look as the HTML posts
  pages/index.astro         landing
  pages/[slug]/index.astro  renders MDX posts
  pages/404.astro
  posts/<slug>/index.mdx    MDX posts (none yet)
.github/workflows/deploy.yml
```

MDX posts get Astro's bundling: npm packages (three.js, d3), shared components,
optimised images. React or Tailwind get added with `npx astro add` when the
first post needs them, not before.

## CI/CD

One workflow, `.github/workflows/deploy.yml`:

- **Every push, any branch:** install, unit tests, `astro check`, build.
- **Push to `main`:** the same, then deploy `dist/` to GitHub Pages.

Node 24 in CI. Local development needs Node 22.18+, for native TypeScript in
the tests. `npm run dev` serves `public/<dir>/index.html` at `/<dir>/`, as Pages
does.

## Cutover

GitHub Pages currently builds from `main` at the repository root ("legacy"
mode). After the merge the root holds sources, not the site, so the order
matters:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
   The current site stays up until the next deploy.
2. Merge `astro` into `main`. The workflow builds and deploys.

Merging first would let the legacy build publish the source tree and break
every URL until step 1 is done.

Rollback: set Source back to "Deploy from a branch", `main`, `/ (root)`, and
revert the merge commit.

## Verification

- Every file served today is present in `dist/` with the same bytes, except the
  two post pages that gained a date tag.
- The new landing page matches the old one in screenshots at 1280 px and 390 px.
- A throwaway MDX post builds, renders with the post chrome and appears on the
  landing page; then it is deleted.
- CI passes on the branch.

## Out of scope

RSS feed, sitemap, Dependabot, React/Tailwind, rewriting the HTML posts as
Astro components.
