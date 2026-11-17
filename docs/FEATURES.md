# AI Impact Tracker - feature detail

*Moved out of the README so the front page can lead with installation. This is
the long-form tour of what the dashboard does.*

Measure the environmental footprint of your AI usage — energy (Wh), water (mL), and CO2e — and see it in a beautiful, self-contained dashboard that works offline with zero external calls and zero tracking.

The plugin has two halves that share one JSON log:

1. **The `impact-tracker` skill** — after any substantial Claude session, Claude estimates the session's footprint, shows it to you with relatable comparisons ("≈ 2 phone charges"), and appends an entry to your shared log.
2. **The dashboard** — a single HTML file baked from that log: KPI cards with period-over-period deltas, SVG charts (cumulative energy, a rankable by-project board, per-session bars with dates, model mix — the donut is click-to-filter), an **efficiency trend** (Wh per million tokens over time, with right-sizing callouts), project drill-down with per-model breakdown, a sortable session table, an A+–F usage grade, a mitigation checklist, a **real-life footprint panel**, a **shareable impact card**, an editable sourced methodology panel, and light/dark themes (auto-detects your system, toggle in the sticky header).

### Time ranges

Six presets — Today, This week, This month, **Last month**, Last 30 days, All-time — plus a **Custom** From–To window. Either custom date may be left blank for an open-ended range, reversed dates are tolerated rather than erroring, and the resolved window is always spelled out under the chips so there is no ambiguity about what you're looking at.

A **Compare** toggle drives the delta chips: calendar months step back a whole month, everything else steps back by its own span, so "last month" compares against the month before it and a 15-day custom window compares against the previous 15 days. Turn it off when a comparison would be misleading. Your range, custom dates and compare setting persist in the browser.

### Real-life footprint

AI is rarely the biggest thing you do to the climate. The footprint panel takes an optional profile — household size, home energy, vehicle, flights, diet — and shows two deliberately separate views:

- **In context** puts your annualised AI emissions next to your household's, at true scale, and nets nothing. For most people AI turns out to be a rounding error beside driving, flying and home heating, and seeing that honestly is the point.
- **Avoided emissions** is an opt-in ledger of real reductions you've chosen — keeping a car rather than replacing it (deferring ~6 t of manufacturing for a petrol sedan, ~10 t for an EV), driving under your own baseline, eating lower on the food chain, buying clean power. It sits *beside* the AI number and is never subtracted from it: energy consumed cannot be un-consumed, and calling a reduction elsewhere an "offset" would be a lie the tool refuses to tell.

Everything you type stays in your browser's local storage. Every factor is sourced in the Methodology panel and editable in `config/config.json`.

### Share your impact

The **Share** button in the sticky header renders a 1080 x 1080 PNG of whatever range is on screen — energy, water, carbon, the usage grade, one real-world comparison, and either your average session or the change vs. the previous period. The card's background colour follows the grade, so an A reads green and an F reads red at a glance.

It is drawn on a `<canvas>` in your browser from canvas primitives only: no webfonts, no images, no network. **Project names and session context are deliberately excluded**, so the card is safe to post without auditing what is in it first. Download the PNG, copy the image straight to the clipboard, or copy a matching text caption.

### Reading the charts

- **By project** ranks every project on energy, water, CO2e or session count — switch metric with the segmented control in the panel header. Each project keeps the same colour across metrics so you can track it, rows show both the absolute figure and its share of the total, and clicking one drills into that project.
- **Energy per session** puts one bar per logged session in date order, with date ticks along the axis and a dot above the three heaviest. The strip underneath names the heaviest session in view and what it was; click any bar to inspect a different one.

Both charts pick their geometry from the panel width, so axis labels stay readable on a phone. All motion honours `prefers-reduced-motion`.

## Quick Start

Three steps, no configuration required:

1. **Install the plugin.** Open the `ai-impact-tracker.plugin` file in Claude (Cowork or Claude Code) and accept, or copy this folder into your plugins directory.
2. **Say:** *"Set up my impact tracker."* Claude creates your shared log, adds the auto-logging rule to your project, and builds your first dashboard.
3. **Work normally.** After any big session Claude shows the footprint and logs it. Say *"refresh my impact dashboard"* anytime to re-bake the page with your latest data, then open the HTML file in any browser.

Want a preview before installing? Open `dashboard/dist/dashboard.html` — it ships pre-built with fictional sample data.

## Usage Examples

Things to say to Claude once the plugin is installed:

- *"What was the environmental impact of that?"* — footprint of the last response
- *"Show me this week's impact."* — one combined total plus per-project subtotals, highest to lowest
- *"Refresh my impact dashboard."* — re-bakes the HTML from your current log
- *"Backfill my log from last week's sessions."* — estimated entries, clearly marked `[backfill·est]`

Rebuilding the dashboard by hand (any machine with Python 3, no packages needed):

```bash
# bake your own log into a dashboard
python3 dashboard/build.py --log ~/Projects/.environmental-impact-log.json \
    --out My-Impact-Dashboard.html --source-label "my logged data"

# rebuild the sample-data demo, re-dated to end today
python3 dashboard/build.py --shift-dates
```

No Python? The dashboard itself can import data at runtime: drag your log file onto the page, use **Import log**, or **📋 Paste log** (accepts `{"entries":[...]}`, a bare array, NDJSON, even code-fenced JSON).

## Configuration Options

Everything configurable lives in one file, `config/config.json`. Every value has a built-in fallback, so the tool runs out-of-the-box even with no config at all. There are no API keys and no network calls — nothing sensitive to manage.

| Key | Default | What it does |
|---|---|---|
| `logFileName` | `.environmental-impact-log.json` | Name of the shared log the skill appends to. |
| `seedSourceLabel` | `sample data` | Label shown as the data source for baked-in data. |
| `skillLoadTokens` | `2500` | Token overhead counted for loading the skill each display. |
| `rates.models.*` | Opus 50/250, Sonnet 30/150, Haiku 10/50 | Wh per million tokens (input/output/blended) per model family. |
| `rates.waterFactor` | `1.7` | mL of data-center water per Wh (Li et al. 2023). |
| `rates.gridIntensity` | `400` | g CO2e per kWh. **The one most worth tuning** — set it to your regional grid (e.g. ~50 hydro-heavy, ~250 California, ~650 coal-heavy). |
| `comparisons.*` | phone 12 Wh, LED 10 W, bottle 500 mL, car 404 g/mile, kettle 100 Wh | Factors behind the real-world comparisons. |
| `life.*` | EPA / EIA / peer-reviewed defaults | Real-world footprint factors: grid intensity, household energy, per-mile and embodied vehicle emissions, flights, diet. Sourced in `_notes.life`. |

Build-script flags: `--log <file>` (data to bake in), `--config <file>`, `--out <file>`, `--source-label <text>`, `--shift-dates` (re-date demo entries to end today).

Users can also edit model rates, water factor, and grid intensity **live in the dashboard's Methodology panel** — no rebuild needed; changes persist in the browser.

## Project Architecture

```
ai-impact-tracker/
├── .claude-plugin/
│   └── plugin.json              # plugin manifest
├── skills/
│   └── impact-tracker/
│       ├── SKILL.md             # when/how Claude measures, displays, logs, rebuilds
│       └── references/
│           ├── methodology.md   # rates, sources, caveats, update guidance
│           └── log-schema.md    # shared-log schema + invariants
├── config/
│   └── config.json              # central config (rates, factors, life factors, filenames)
├── tools/
│   └── merge_pending.py         # sweeps parked entries into the shared log
├── data/
│   ├── demo-log.json            # anonymized sample data (16 fictional sessions)
│   └── log-template.json        # empty starter log
├── dashboard/
│   ├── src/
│   │   ├── template.html        # markup shell with injection placeholders
│   │   ├── styles.css           # all styling (light + dark, responsive, print)
│   │   ├── config.js            # module: injected config + defaults + persistence
│   │   ├── tracker_core.js      # module: filtering, totals, efficiency, grade (no DOM writes)
│   │   ├── ui_components.js     # module: every renderer (KPIs, charts, table, panels)
│   │   ├── footprint.js         # module: real-life footprint model + both views
│   │   ├── share.js             # module: canvas-rendered 1080x1080 share card
│   │   └── exporters.js         # module: import/export/paste/drag-drop/PDF + init
│   ├── build.py                 # assembles src/ → ONE self-contained HTML (stdlib only)
│   └── dist/
│       └── dashboard.html       # pre-built demo (open in any browser)
└── README.md
```

**How measurement works:** tokens × per-model energy rate → Wh; Wh × water factor → mL; Wh × grid intensity → g CO2e. Session entries append to one shared JSON log with a `project` field, and the build script bakes that log into the dashboard's `/*__SEED__*/` placeholder. Historical energy/water are shown as logged; CO2e is always derived at view time so you can retune your grid factor without rewriting history. Full sources and caveats live in `skills/impact-tracker/references/methodology.md` and in the dashboard's own Methodology panel.

**Never losing an entry — root primary, project fallback.** The canonical log lives at your Projects root, but a session that only has one project folder connected cannot write there. So the log resolves to the first reachable path:

1. `<Projects root>/.environmental-impact-log.json` — canonical, aggregates every project.
2. `<project>/.environmental-impact-log.json` — fallback working log, when only that folder is connected.
3. `<project>/.environmental-impact-log.pending.json` — last resort, if neither is writable.

`tools/merge_pending.py` reconciles all of it into the root log on each refresh: it sweeps pending files (then empties them) and merges project fallback logs (leaving them intact, since each stays that project's own log when opened alone — `--drain-fallback` empties them too). The sweep dedupes on `(timestamp, context)`, preserves optional `input_tokens` / `output_tokens` / `cached_tokens`, and backs the log up first — so it is safe to run on every build and on mounts where deletes are not permitted.

```bash
python3 tools/merge_pending.py --root ~/Projects                   # reconcile, then build
python3 tools/merge_pending.py --root ~/Projects --dry-run         # preview only
python3 tools/merge_pending.py --root ~/Projects --drain-fallback  # force single source of truth
```

Because a log that silently isn't there is this tool's worst failure mode, the skill reads the file back after every write and confirms the entry landed rather than assuming it did.

**Design constraints:** zero runtime dependencies (browser-only ES5, Python-stdlib build), zero network calls, zero tracking; all figures are order-of-magnitude estimates — trust trends over absolutes.

## Privacy

Everything is local: the log is a plain JSON file you own, the dashboard runs entirely in your browser, and nothing is sent anywhere. Session `context` strings describe your work — review them before sharing a built dashboard, since sharing the HTML shares the baked-in data. The **share card is the exception**: it carries only totals, the grade and a comparison, never a project name or a context string, so it can be posted without that review.
