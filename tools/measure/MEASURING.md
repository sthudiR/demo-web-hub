# How the numbers are measured

Each demo site shows a "Behind this page" panel and the hub shows a card chip row. They quote four numbers.
This guide says exactly what each one means, how to measure it by hand, and how to re-measure everything with
one script whenever a site changes.

| Number | Plain meaning | Same on every computer? |
|---|---|---|
| **to load** (size) | Bytes a first-time visitor downloads for the home page, as sent over the network (compressed) | Yes, give or take a few KB |
| **ready in about** | Seconds from clicking the link until the first real content is visible | **No.** Depends on connection, device and distance |
| **builds in** | Seconds the `build` job took on GitHub Actions, median of the last 5 successful runs | **No.** Depends on GitHub's machines. Includes installing the tools |
| **lines of source** | Lines in the files a person writes (pages, code, site-specific styles) | Yes, it only changes when the code changes |

One more number is used in two sentences: the **published size** of the notebooks site (the whole deployed folder, ~82 MB).
It is not what a visitor downloads. It is measured with `du` on a fresh local build.

When quoting these publicly, say they are "median of 5 cold loads on one home connection" and "GitHub Actions build, includes tool setup".

---

## Part 1: Re-measure everything with the scripts

Everything lives in `demo-web-hub/tools/measure/`:

| File | What it does |
|---|---|
| `sites.config.json` | Which sites exist, which element means "ready", where each number is written, and the rules for counting lines |
| `measure.mjs` | Takes the measurements and writes `metrics.json` |
| `apply.mjs` | Copies `metrics.json` into every file that quotes a number |
| `metrics.json` | The last results, including every individual run, so the median can be checked by eye |

### One-time setup

1. Clone all seven repos side by side in one folder (`demo-web-hub`, `demo-web-sim`, `demo-web-quarto`, `demo-web-marimo`, `demo-web-p5`, `demo-web-reference`, `demo-web-notebooks`). If they live somewhere else, set `SITES_DIR=/path/to/that/folder`.
2. Install Node 20 and Google Chrome. Install the GitHub CLI (`gh`) and log in: `gh auth login`.
3. In `demo-web-hub/tools/measure/` run:
   ```
   npm install
   ```
   No Chrome? Run `npx playwright install chromium` and use `CHROME_CHANNEL=chromium` before the commands below.

### Every time you want fresh numbers

1. **Get the latest code in every repo**, on `main`, so the line counts match what is live:
   ```
   for r in hub sim quarto marimo p5 reference notebooks; do git -C demo-web-$r checkout main && git -C demo-web-$r pull; done
   ```
2. **Build the notebooks site** (only needed for its published size, the other sites do not use a local build):
   ```
   cd demo-web-notebooks && bash scripts/build.sh
   ```
3. **Measure:**
   ```
   cd demo-web-hub/tools/measure
   node measure.mjs
   ```
   It takes a few minutes. It loads each live site 5 times in a fresh browser, reads the last 5 CI builds, counts lines, and writes `metrics.json`.
   Useful options: `--only marimo` (one site), `--runs 9` (steadier medians), `--skip-ci` (no GitHub lookup).
4. **Preview what would change:**
   ```
   node apply.mjs --dry-run
   ```
5. **Write the numbers** into the files, then review each repo with `git diff`:
   ```
   node apply.mjs
   ```
   The script stops with an error if a sentence it expects to update no longer exists, so a stale number can't slip through silently.
6. **Ship it the normal way:** in each repo that changed, create a new branch from `origin/main`, commit, push, and open a pull request. Merge after you approve it.
7. Run `node apply.mjs --dry-run` once more. It should say nothing needs changing.

Run measure at a quiet time and on a normal connection. Ready times jump around, so if one site looks odd, re-run just that one:
`node measure.mjs --only marimo --runs 9`.

---

## Part 2: Measure by hand (to double-check the script)

You can check any number without the scripts. The browser steps need nothing installed.

### A. Size: "to load"

1. Open a new **Incognito** window in Chrome (empty cache).
2. Open DevTools (`F12`) → **Network** tab. Tick **Disable cache**. Leave throttling on "No throttling".
3. Visit the site's home page, e.g. `https://sthudir.github.io/demo-web-sim/`.
4. Wait for it to finish (marimo: until the numbers appear). Read the status bar at the bottom: **"X MB transferred"** (not "resources"). That is the number.
5. It should be close to the script's value, not identical. Ad-blockers and extensions change it, which is why Incognito is used.

The script measures the same thing through Chrome's debugging protocol, adds every response's bytes on the wire, and groups them by host. The host split is stored in `metrics.json` under `downloadByHost`, so you can see for example that marimo's download comes from the site itself.

### B. Ready time

1. Same Incognito + **Disable cache** setup as above.
2. DevTools → **Performance** tab → click the reload (record) button. Stop when the page looks done.
3. In the recording, find the moment the first real content appears (the heading, the 3D canvas, the first result). That is the time on the ruler.
4. Repeat 5 times and take the middle value.

"Ready" is a different element on each site, listed in `sites.config.json` under `ready`:

| Site | Ready means |
|---|---|
| quarto, reference, notebooks | The page heading (`h1`) is visible. For notebooks that is the book page only, Python has not loaded yet |
| sim, p5 | The `canvas` element is visible |
| marimo | Python has started and the first computed line ("Sweet-to-sour ratio") is on screen |

So the numbers show how soon each site is usable, but a 0.4 s site and a 6 s site are not doing the same job.

### C. Build time

The same job GitHub reports on every deploy:

1. Go to `https://github.com/sthudiR/<repo>/actions` → open the **Deploy to Pages** workflow.
2. Open a successful run → click the **build** job. The duration is shown next to the job name.
3. Do this for the last 5 successful runs and take the middle one.

Or in a terminal (this is what the script runs):
```
gh run list -R sthudiR/demo-web-sim -w deploy.yml --status success -L 5 --json databaseId
gh api repos/sthudiR/demo-web-sim/actions/runs/<RUN_ID>/jobs --jq '.jobs[]|select(.name=="build")|[.started_at,.completed_at]'
```
The build time is `completed_at - started_at`.

Why it is not "how fast the framework builds": the job also checks out the code, installs Node or Python, and installs the dependencies (and Quarto for the Quarto site). For example, the notebooks site builds in about 7 s on a laptop once everything is installed, but its CI job takes about 44 s. The p5 site has no build at all, it copies files, so its 7 s is all setup.

### D. Lines of source

Run the script's counter alone, or look at the per-file list in `metrics.json`:
```
node -e "const m=JSON.parse(require('fs').readFileSync('metrics.json'));console.log(m.sites['demo-web-sim'].linesByFile)"
```
The rule (in `sites.config.json` under `lines`):

- **Counted:** every file tracked by git with the extension md, qmd, py, js, ts, tsx, css, scss, html, astro, ipynb, hpp, h, cpp or rst.
- **Not counted:** `tokens.css` and `tokens.scss` (shared by all sites), `README.md`, `LICENSE`, `conf.py`, `vite.config.ts`, anything in `vendor/`, `node_modules/`, `dist/`, `_site/`, `_build/`, `site/`, `scripts/`, `public/` or `.github/`, and `*.min.js`.
- **Notebooks (.ipynb)** count the lines of text in their cells, not the JSON around them.
- Each line is a line of the file, blank lines included, like `wc -l`.

To check one by hand, run `git ls-files` in the repo, remove the excluded files from the list, and run `wc -l` on the rest (use the cell text for `.ipynb`).

### E. Published size (notebooks only)

```
cd demo-web-notebooks && bash scripts/build.sh
du -sb --apparent-size site
```
Divide by 1,000,000 for MB. `du -sh` gives a bigger number because it counts whole disk blocks (84 MB vs 82 MB here).

---

## Part 3: How to read and quote the results

- **Medians, not best runs.** `metrics.json` keeps every run (`readyRuns`, `buildRuns`). The spread tells you how steady the number is. The marimo ready time has swung between about 5.5 s and 14 s on different days.
- **Only compare like with like.** Size and lines are comparable across sites. Ready time is "first content" on each site, and build time includes different tools, so treat them as rough.
- **Numbers are a snapshot.** They go stale when a site changes. `metrics.json` records the date, the Chrome version and the git commit each site was counted at (`sourceCommit`). Re-run Part 1 before quoting them again.
- **Tell readers where they came from.** The panel footnote already does: "median of 5 cold loads on one home connection, build time is a GitHub Actions median that includes installing the tools".

## Known limits

- Ready time and download size are measured from one machine and one connection, using headless Chrome. A phone on mobile data will be slower.
- The download size covers the home page only. Other pages, the notebooks Python lab, and the YouTube embed (it is lazy-loaded below the fold, so it is not fetched during the test) are not included.
- Build time reflects GitHub's runner speed at that moment and the tools those workflows install.
- Lines of source depends on the counting rule above. A different rule gives different totals, which is why the rule is written down.
