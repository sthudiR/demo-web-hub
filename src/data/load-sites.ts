import registry from './sites.json';

export interface Metrics { size: string; ready: string; writes: string }

export interface Site {
  id: string;
  url: string;
  title: string;
  blurb: string;
  framework: string;
  tags: string[];
  thumbnail: string;
  kind: 'site' | 'piece';
  metrics: Metrics;
  goodFor: string;
  notFor: string;
  /** Absolute URLs of the hover-preview clips (webm, mp4). */
  previews: { webm: string; mp4: string };
  live: boolean;
}

// Each site publishes /site.json. We read it at build time so cards stay current;
// sites.json is the registry and also the fallback when a site is unreachable.
export async function loadSites(): Promise<Site[]> {
  return Promise.all(
    registry.map(async (entry) => {
      let meta: Record<string, unknown> = {};
      let live = false;
      try {
        const res = await fetch(new URL('site.json', entry.url), {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(String(res.status));
        meta = await res.json();
        live = true;
      } catch {
        /* fall back to the registry entry */
      }
      const m = { ...entry, ...meta } as typeof entry & { preview?: string };
      const preview = m.preview ?? entry.preview;
      return {
        ...m,
        url: entry.url,
        thumbnail: new URL(m.thumbnail ?? entry.thumbnail, entry.url).href,
        previews: {
          webm: new URL(`${preview}.webm`, entry.url).href,
          mp4: new URL(`${preview}.mp4`, entry.url).href,
        },
        live,
      } as Site;
    }),
  );
}

export const KIND_LABEL = { site: 'Builds a site', piece: 'Interactive piece' } as const;
