// Measures the four numbers shown for each demo site and writes them to metrics.json.
//
//   node measure.mjs                 all sites, 5 cold loads each
//   node measure.mjs --only sim      one site (matches the end of the id)
//   node measure.mjs --runs 9        more runs = steadier medians
//   node measure.mjs --skip-ci       skip the GitHub Actions build-time lookup
//
// What each number means (full write-up in MEASURING.md):
//   download  bytes sent over the network on a first visit (cold cache), including CDN files
//   ready     seconds from navigation start until the site's first real content is visible
//   build     seconds the "build" job took in GitHub Actions (includes installing the tools)
//   lines     lines in the hand-written source files tracked in git (rules in sites.config.json)
//
// Needs: Node 20+, `npm install` in this folder, Google Chrome, and `gh` logged in (for build time).
// The site repos are expected next to the hub repo (../../../demo-web-<name>); override with SITES_DIR.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'sites.config.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const RUNS = Number(opt('runs', 5));
const ONLY = opt('only', null);
const SKIP_CI = args.includes('--skip-ci');
const CI_RUNS = 5;
const CHANNEL = process.env.CHROME_CHANNEL ?? 'chrome'; // set CHROME_CHANNEL=chromium to use Playwright's own Chromium
const SITES_DIR = resolve(process.env.SITES_DIR ?? join(here, '..', '..', '..'));

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sh = (cmd, a, cwd) => execFileSync(cmd, a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ---- lines of source -------------------------------------------------------
function countLines(dir) {
  const { include, excludeDirs, excludeFiles } = cfg.lines;
  const files = sh('git', ['ls-files'], dir).split('\n').filter(Boolean).filter((f) => {
    const parts = f.split('/');
    if (parts.slice(0, -1).some((d) => excludeDirs.includes(d))) return false;
    if (excludeFiles.includes(basename(f)) || f.endsWith('.min.js')) return false;
    return include.includes(extname(f).slice(1));
  });
  let total = 0;
  const perFile = {};
  for (const f of files) {
    let n;
    if (f.endsWith('.ipynb')) { // a notebook counts as the text of its cells, not its JSON wrapper
      const nb = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      n = nb.cells.reduce((sum, c) => sum + (Array.isArray(c.source) ? c.source.join('') : c.source).split('\n').length, 0);
    } else {
      const text = readFileSync(join(dir, f), 'utf8');
      n = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    }
    perFile[f] = n;
    total += n;
  }
  return { total, perFile };
}

// ---- build time from GitHub Actions ---------------------------------------
function buildTimes(repo) {
  const ids = JSON.parse(sh('gh', ['run', 'list', '-R', `${cfg.owner}/${repo}`, '-w', cfg.workflow, '--status', 'success', '-L', String(CI_RUNS), '--json', 'databaseId']))
    .map((r) => r.databaseId);
  const secs = [];
  for (const id of ids) {
    const jobs = JSON.parse(sh('gh', ['api', `repos/${cfg.owner}/${repo}/actions/runs/${id}/jobs`])).jobs;
    const job = jobs.find((j) => j.name === cfg.buildJob);
    if (job) secs.push({ run: id, seconds: (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000 });
  }
  return secs;
}

// ---- published size (folder on disk) ---------------------------------------
function publishedBytes(dir, buildDir) {
  const p = join(dir, buildDir);
  if (!existsSync(p)) return null;
  return Number(sh('du', ['-sb', '--apparent-size', p]).split('\t')[0]);
}

// ---- cold loads in a real browser ------------------------------------------
async function coldLoad(browser, url, selector) {
  const ctx = await browser.newContext(); // fresh context = empty cache, no service workers
  try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    const hostOf = new Map();
    const bytesByHost = {};
    cdp.on('Network.requestWillBeSent', (e) => hostOf.set(e.requestId, new URL(e.request.url).host));
    cdp.on('Network.loadingFinished', (e) => {
      const h = hostOf.get(e.requestId) ?? 'unknown';
      bytesByHost[h] = (bytesByHost[h] ?? 0) + e.encodedDataLength;
    });
    const t0 = performance.now();
    await page.goto(url, { waitUntil: 'commit' });
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 90000 });
    const seconds = (performance.now() - t0) / 1000;
    await page.waitForTimeout(1500); // let requests that are still in flight finish being counted
    return { seconds, bytes: Object.values(bytesByHost).reduce((a, b) => a + b, 0), bytesByHost };
  } finally {
    await ctx.close();
  }
}

async function measureBrowser(browser, site) {
  const url = `${cfg.pagesOrigin}/${site.id}/`;
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    try { runs.push(await coldLoad(browser, url, site.ready)); }
    catch (e) { // one retry for a flaky network blip; a second failure is a real failure
      console.warn(`  ${site.id}: run ${i + 1} failed (${e.message.split('\n')[0]}), retrying once`);
      runs.push(await coldLoad(browser, url, site.ready));
    }
  }
  const mid = [...runs].sort((a, b) => a.bytes - b.bytes)[runs.length >> 1];
  return {
    readySeconds: median(runs.map((r) => r.seconds)),
    readyRuns: runs.map((r) => +r.seconds.toFixed(2)),
    downloadBytes: median(runs.map((r) => r.bytes)),
    downloadByHost: mid.bytesByHost,
  };
}

// ---- main -------------------------------------------------------------------
const sites = cfg.sites.filter((s) => !ONLY || s.id.endsWith(ONLY));
if (!sites.length) { console.error(`No site matches --only ${ONLY}`); process.exit(1); }
const browser = await chromium.launch({ headless: true, ...(CHANNEL === 'chromium' ? {} : { channel: CHANNEL }) });
const out = { measuredAt: new Date().toISOString(), runs: RUNS, ciRuns: CI_RUNS, chrome: browser.version(), sites: {} };

for (const site of sites) {
  const dir = join(SITES_DIR, site.id);
  if (!existsSync(dir)) throw new Error(`Missing ${dir}. Clone the site repos next to the hub, or set SITES_DIR.`);
  console.log(`\n${site.id}`);
  const m = {};
  Object.assign(m, await measureBrowser(browser, site));
  console.log(`  ready     runs ${m.readyRuns.join(' ')}  -> median ${m.readySeconds.toFixed(2)} s`);
  console.log(`  download  ${(m.downloadBytes / 1e6).toFixed(2)} MB  ${JSON.stringify(Object.fromEntries(Object.entries(m.downloadByHost).map(([h, b]) => [h, +(b / 1e6).toFixed(2)])))}`);
  const { total, perFile } = countLines(dir);
  m.lines = total; m.linesByFile = perFile;
  m.sourceCommit = sh('git', ['rev-parse', '--short', 'HEAD'], dir);
  m.sourceBranch = sh('git', ['branch', '--show-current'], dir);
  console.log(`  lines     ${total}  (git ${m.sourceBranch} @ ${m.sourceCommit})`);
  if (!SKIP_CI) {
    const ci = buildTimes(site.id);
    m.buildRuns = ci;
    m.buildSeconds = ci.length ? median(ci.map((c) => c.seconds)) : null;
    console.log(`  build     ${ci.map((c) => c.seconds + 's').join(' ')}  -> median ${m.buildSeconds} s`);
  }
  if (site.publishedSize) {
    m.publishedBytes = publishedBytes(dir, site.buildDir);
    console.log(`  published ${m.publishedBytes == null ? `(no ${site.buildDir}/ folder: build the site first)` : (m.publishedBytes / 1e6).toFixed(1) + ' MB'} (${site.buildDir}/ on disk)`);
  }
  out.sites[site.id] = m;
}
await browser.close();

// Keep earlier results for sites that were not re-measured this time (--only).
const file = join(here, 'metrics.json');
if (ONLY && existsSync(file)) {
  const prev = JSON.parse(readFileSync(file, 'utf8'));
  out.sites = { ...prev.sites, ...out.sites };
}
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`\nWrote ${file}`);
