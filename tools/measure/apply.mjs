// Copies the numbers in metrics.json into every place they are written down, so nothing is typed by hand:
//   - each site's site.json            (metrics.size / ready / build / lines)
//   - each site's "Behind this page" panel  (the "The numbers" line and the "Ready time:" footnote)
//   - the hub registry src/data/sites.json  (card chips)
//   - the few sentences that quote a number (see "rewrites" in sites.config.json)
//
//   node apply.mjs --dry-run     show what would change, write nothing
//   node apply.mjs               write the changes (then review with `git diff` in each repo)
//
// Every pattern must match, otherwise the script stops. A silent "no match" would leave a stale number behind.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hubDir = resolve(here, '..', '..');
const SITES_DIR = resolve(process.env.SITES_DIR ?? join(here, '..', '..', '..'));
const DRY = process.argv.includes('--dry-run');
const cfg = JSON.parse(readFileSync(join(here, 'sites.config.json'), 'utf8'));
const metrics = JSON.parse(readFileSync(join(here, 'metrics.json'), 'utf8'));

const fmtMB = (b) => {
  if (b < 1e6) return `${Math.max(1, Math.round(b / 1e3))} KB`;
  const mb = b / 1e6;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
};
const fmtS = (s) => `${s < 2 ? +s.toFixed(1) : Math.round(s)} s`;
const date = new Date(metrics.measuredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const changed = new Set();
const pending = new Map(); // path -> text, so several edits to one file stack up before writing
const read = (p) => (pending.has(p) ? pending.get(p) : readFileSync(p, 'utf8'));
const edit = (p, fn) => {
  if (!existsSync(p)) throw new Error(`Missing file: ${p}`);
  const before = readFileSync(p, 'utf8');
  const after = fn(read(p));
  pending.set(p, after);
  if (after !== before) changed.add(p);
};
const mustReplace = (text, re, to, where) => {
  if (!re.test(text)) throw new Error(`Pattern ${re} not found in ${where}. The text changed; update sites.config.json or apply.mjs.`);
  return text.replace(re, to);
};

const footnote = `Ready time: median of ${metrics.runs} cold loads on one home connection, ${date}. `
  + `Size is what a first visit downloads. Build time is the median of the last ${metrics.ciRuns} GitHub Actions builds and includes installing the tools.`;

for (const site of cfg.sites) {
  const m = metrics.sites[site.id];
  if (!m) { console.warn(`skip ${site.id}: not in metrics.json`); continue; }
  const dir = join(SITES_DIR, site.id);
  const v = {
    size: fmtMB(m.downloadBytes),
    ready: fmtS(m.readySeconds),
    readyInt: String(Math.max(1, Math.round(m.readySeconds))),
    build: m.buildSeconds == null ? null : `${Math.round(m.buildSeconds)} s`,
    lines: m.lines,
    published: m.publishedBytes == null ? null : fmtMB(m.publishedBytes),
  };

  // 1. the site's own site.json
  const sj = join(dir, site.siteJson);
  edit(sj, (t) => {
    const j = JSON.parse(t);
    j.metrics = { ...j.metrics, size: v.size, ready: v.ready, ...(v.build && { build: v.build }), lines: v.lines };
    return JSON.stringify(j, null, 2) + '\n';
  });

  // 2. the "Behind this page" panel
  const panel = join(dir, site.panel);
  edit(panel, (t) => {
    const lines = t.split('\n');
    const i = lines.findIndex((l) => l.includes('The numbers'));
    if (i < 0) throw new Error(`No "The numbers" line in ${panel}`);
    let l = lines[i];
    l = mustReplace(l, /\d+(?:\.\d+)? (?:MB|KB)(?: to load)?/, `${v.size} to load`, panel);
    l = mustReplace(l, /ready in about [\d.]+ s/, `ready in about ${v.ready}`, panel);
    if (v.build) l = mustReplace(l, /builds in \d+ s/, `builds in ${v.build}`, panel);
    l = mustReplace(l, /\d+ lines of source/, `${v.lines} lines of source`, panel);
    lines[i] = l;
    return mustReplace(lines.join('\n'), /Ready time:[^<\n]*/, footnote, panel);
  });

  // 3. the hub registry (card chips)
  edit(join(hubDir, 'src/data/sites.json'), (t) => {
    const reg = JSON.parse(t);
    const e = reg.find((s) => s.id === site.id);
    if (!e) throw new Error(`${site.id} missing from hub sites.json`);
    e.metrics = { ...e.metrics, size: v.size, ready: v.ready };
    return JSON.stringify(reg, null, 2) + '\n';
  });

  // 4. sentences that quote a number
  for (const r of site.rewrites ?? []) {
    if (r.template.includes('{published}') && !v.published) throw new Error(`${site.id}: no published size. Build the site first (see MEASURING.md).`);
    const file = r.file.startsWith('hub:') ? join(hubDir, r.file.slice(4)) : join(dir, r.file);
    const to = r.template.replace('{readyInt}', v.readyInt).replace('{published}', v.published ?? '');
    edit(file, (t) => mustReplace(t, new RegExp(r.pattern, 'g'), to, file));
  }
}

for (const [p, text] of pending) if (changed.has(p)) { if (!DRY) writeFileSync(p, text); }
console.log(`${DRY ? 'Would change' : 'Changed'} ${changed.size} file(s):`);
for (const p of [...changed].sort()) console.log('  ' + p.replace(resolve(hubDir, '..') + '/', ''));
if (!changed.size) console.log('  (nothing: files already match metrics.json)');
