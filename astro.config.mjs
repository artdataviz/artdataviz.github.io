import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://artdataviz.github.io',
  integrations: [mdx()],
  // Code blocks take the site's own <pre> style, as in the HTML posts.
  markdown: { syntaxHighlight: false },
});
