import { defineConfig } from 'astro/config';

// Base path must match the repo name for GitHub Pages project sites.
export default defineConfig({
  site: 'https://sthudir.github.io',
  base: '/demo-web-hub',
  trailingSlash: 'always',
});
