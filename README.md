# demo-web-hub

Main page of the demo-web family. Built with Astro (static output) and hosted on GitHub Pages at https://sthudir.github.io/demo-web-hub/.

## How it works
- `src/data/sites.json` lists the sites. At build time `src/data/load-sites.ts` fetches each site's `site.json` and falls back to the registry entry if the site is unreachable.
- Each site gets a card linking to it. All sites share the `sthudir.github.io` origin.
- The deploy workflow also runs on `repository_dispatch` (`site-updated`) and weekly.

## Develop
```
npm install
npm run dev
npm run build   # output in dist/
```

## Add a site
1. Give the site repo its own base path `/<repo>/` and publish `site.json` + `thumbnail.svg` at its output root.
2. Add an entry to `src/data/sites.json`.
3. Optional: in the site's deploy workflow, dispatch `site-updated` to this repo (needs a `HUB_DISPATCH_TOKEN` secret there).

## Base path
`astro.config.mjs` sets `base: '/demo-web-hub'`. Change it if the repo is renamed or a custom domain is used.
