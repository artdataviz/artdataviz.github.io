import { existsSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

const generator = 'https://github.com/artdataviz/artdataviz.github.io/tree/main/public/generative-dataviz/generator';

/** In dev, serve public/<dir>/index.html at /<dir>/, as GitHub Pages does. */
const publicIndexes = {
  name: 'public-indexes',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/' && url.pathname.endsWith('/') && existsSync(`public${url.pathname}index.html`)) {
        req.url = `${url.pathname}index.html${url.search}`;
      }
      next();
    });
  },
};

export default defineConfig({
  site: 'https://artdataviz.github.io',
  integrations: [mdx()],
  // Code blocks take the site's own <pre> style, as in the HTML posts.
  markdown: { syntaxHighlight: false },
  // GitHub Pages' Jekyll used to render the generator's README here.
  redirects: { '/generative-dataviz/generator/': generator },
  vite: { plugins: [publicIndexes] },
});
