import registry from './sites.json';

export interface Site {
  id: string;
  url: string;
  title: string;
  blurb: string;
  framework: string;
  tags: string[];
  thumbnail: string;
  live: boolean;
}

// Each site publishes /site.json. We read it at build time so cards stay current;
// sites.json is the registry and also the fallback when a site is unreachable.
export async function loadSites(): Promise<Site[]> {
  return Promise.all(
    registry.map(async (entry) => {
      try {
        const res = await fetch(new URL('site.json', entry.url), {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const m = await res.json();
        return {
          ...entry,
          ...m,
          url: entry.url,
          thumbnail: new URL(m.thumbnail ?? entry.thumbnail, entry.url).href,
          live: true,
        } as Site;
      } catch {
        return {
          ...entry,
          thumbnail: new URL(entry.thumbnail, entry.url).href,
          live: false,
        } as Site;
      }
    }),
  );
}
