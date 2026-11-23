# AI Impact Tracker

Measure the environmental footprint of your AI usage — energy, water and CO₂e —
from the session transcripts already sitting on your computer, and see it in a
self-contained dashboard that compares it to your own life rather than to a
national average.

The numbers are **measured, not estimated**. Every assistant turn records its
own token usage, and this reads those records. That matters more than it
sounds: most of what a long conversation costs is cached context re-sent on
every single turn, and a model asked to estimate its own usage at the end of a
turn is structurally blind to all of it.

## Install

```
/plugin marketplace add craftgrow/ai-impact-tracker
/plugin install ai-impact-tracker@craftgrow
```

On Claude Code 2.1.275 or later that is one step:

```
/plugin install ai-impact-tracker --marketplace craftgrow/ai-impact-tracker
```

Then run setup:

```
/ai-impact-tracker:setup
```

It finds your transcripts, measures them, builds the dashboard and publishes it
as a private artifact in your own account. Nothing to configure first.

## Requirements

**This needs a computer.** It reads transcript files written to local disk.

| Surface | Measured? |
|---|---|
| Claude Code (terminal) | Yes — exact token counts |
| Claude desktop app / Cowork | Yes — exact token counts |
| claude.ai in a browser, or mobile | **No** — nothing is written to disk |

claude.ai usage can only be approximated from a data export, where tokens are
guessed from text length. Setup tells you plainly if it can't find anything to
measure, rather than showing you demo numbers and calling them yours.

Python 3 is the only dependency, and it ships with macOS and Linux.

To check what a machine has before installing anything:

```
python3 tools/import_transcripts.py --list-stores
```

## Privacy

Everything stays on your machine. No accounts, no telemetry, no network calls —
the dashboard is a single HTML file that works with the wifi off.

**The part worth understanding before you share it.** Your log holds your
project names and a one-line description of each session. That list is usually
more revealing than the numbers beside it: project names alone can disclose
what you're working on, who with, and what you're planning. Your own dashboard
shows them, because that's what makes it useful. A copy you hand to someone
else should not:

```
python3 dashboard/build.py --log <your-log> --out shareable.html --sanitize
```

That replaces every project name with "Project 1", "Project 2" and withholds
the descriptions. Totals, charts and comparisons are unchanged.

## What you get

A single page, no libraries, works offline:

- **One honest headline** — what share of your *whole yearly footprint* is AI.
  For most people it's a rounding error next to driving, flying and heating,
  and the tool says so rather than inflating it.
- **Sourced comparisons** — 34 real-world anchors across energy, water and
  carbon, each showing the figure behind it and where it came from. The anchor
  is chosen to suit the size of the number, so you get "7.7 days of a US home's
  electricity" instead of "16,143 phone charges".
- **Project drill-down**, a sortable session table, cumulative and per-session
  charts, a model-mix donut and an efficiency trend.
- **A usage grade** and a mitigation checklist, split into things that actually
  move the needle and things that only feel like they do.
- **An Audit section that shows its working** — how many sessions were measured
  versus estimated, what share of your tokens were cache reads, and what the
  tool cannot see. Every figure is computed from your own log.
- **An editable methodology panel** — change the grid intensity or the
  per-model rates and every number on the page updates live.

Full feature tour: [docs/FEATURES.md](docs/FEATURES.md).

## Refreshing

Ask Claude to refresh the impact dashboard. It re-imports anything new and
republishes to the same artifact, so the link keeps working. Weekly is plenty.
The importer is idempotent — re-running picks up only what it hasn't seen.

## What this does not claim

Energy per token is modelled, not metered. Nobody outside a data-centre
operator can measure the draw of a single request, so this uses published
per-model figures and a grid-intensity assumption you can edit. Cache reads are
costed at a fraction of the input rate, and that fraction is an assumption
governing most of the tokens counted. The arithmetic is shown and the
comparisons are sourced, but the inputs carry real uncertainty.

Treat it as a well-founded estimate of scale — good enough to tell a rounding
error from a real problem, not good enough to audit anyone with.

## What's in here

```
.claude-plugin/          plugin + marketplace manifests
skills/setup/            first-run setup (/ai-impact-tracker:setup)
skills/impact-tracker/   per-session logging + methodology reference
tools/                   transcript importer, log merger, demo-log generator
dashboard/               build.py and the HTML/CSS/JS sources
dashboard/dist/          a prebuilt demo dashboard — open it to see the thing
data/                    demo log and an empty log template
docs/                    long-form feature documentation
```

`dashboard/dist/dashboard.html` is built from synthetic demo data generated by
`tools/make_demo_log.py`. Open it in a browser to see what you'd get. No real
person's usage is in this repository.

## Licence

MIT.

The plugin icon was designed with AI assistance (Claude, by Anthropic).
