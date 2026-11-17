---
name: impact-tracker
description: Calculates, displays, and logs the environmental footprint (energy Wh, water mL, CO2e) of Claude's token usage, and builds/refreshes the AI Environmental Impact dashboard. Use when (1) a turn involves subagents or is estimated to exceed 5,000 tokens, (2) completing a complex task like coding, document generation, or research, (3) the user asks about environmental impact, energy use, sustainability, or their impact log, (4) the user asks to see, refresh, re-bake, or rebuild their impact dashboard, (5) the user asks for session, weekly, monthly, or per-project impact totals.
---

# AI Impact Tracker

Track the environmental footprint of AI usage: estimate each session's energy, water, and CO2e; append it to a shared JSON log; and bake that log into a self-contained HTML dashboard.

All rates and defaults live in `${CLAUDE_PLUGIN_ROOT}/config/config.json`. If that file is missing or unreadable, use the fallback rates in the Calculation section below — never fail for lack of config.

## Setup (first use)

1. **Choose the log location.** The log resolves **root primary, project fallback** — always
   use the first reachable path:

   1. `<Projects root>/.environmental-impact-log.json` — canonical, aggregates every project.
   2. `<this project folder>/.environmental-impact-log.json` — fallback working log, used when
      only the project folder is connected (the common case in Cowork).

   Both are real logs with the same schema, not copies. `tools/merge_pending.py` reconciles
   the fallback into the root log whenever the root is reachable, deduping on
   `(timestamp, context)` — so nothing is lost and nothing is double-counted. Confirm the
   resolved path with the user on first setup.
2. **Create the log** if it doesn't exist, from `${CLAUDE_PLUGIN_ROOT}/data/log-template.json`: `{ "entries": [] }`.
3. **Add the enforcement rule** to the project's `CLAUDE.md` (or equivalent) if not already present:

```markdown
## Environmental Impact
After any turn that involves subagents OR is estimated to exceed 5,000 tokens, display
the environmental impact using the `impact-tracker` skill. This is a hard rule — do not skip it.
Append every entry — with a "project" field set to this project's name, plus input_tokens and
output_tokens when known — to the first reachable log: the Projects-root
.environmental-impact-log.json, else the one in THIS folder. If neither is writable, append to
.environmental-impact-log.pending.json in THIS folder — never skip logging.
Then read the file back and confirm the entry landed before reporting success.
```

4. **Build the user's first dashboard** (see "Dashboard" below) and tell them where it lives.

## When to display impact

- A single turn exceeds **5,000 tokens**, involves subagents, or completes a complex task
- The user asks about environmental impact, energy use, or sustainability
- After displaying, offer: "Want to see your session, weekly, or project total?"

## Calculation

```
Energy_input   (Wh) = input_tokens  × model_input_rate  / 1,000,000
Energy_output  (Wh) = output_tokens × model_output_rate / 1,000,000
Energy_skill   (Wh) = skillLoadTokens × model_input_rate / 1,000,000   (this skill's load cost, default 2,500 tokens)
Energy_agents  (Wh) = sum(agent total_tokens) × model_blended_rate / 1,000,000
Total_energy   (Wh) = sum of all above
Total_water    (mL) = Total_energy × waterFactor          (default 1.7)
CO2e            (g) = Total_energy × gridIntensity / 1000 (default 400 g/kWh)
```

Fallback model rates (Wh per million tokens) when config is unavailable:

| Model family | Input | Output | Blended |
|---|---|---|---|
| Opus | 50 | 250 | ~240 |
| Sonnet | 30 | 150 | ~145 |
| Haiku | 10 | 50 | ~50 |
| Unknown/other | 30 | 150 | ~145 |

- Cached reads: 10% of input rate
- Blended rate assumes ~80/20 input/output mix — use the split formula when counts are known
- Subagent tokens: read from `total_tokens` usage blocks in agent results; use the blended rate
- Match a model to a family by substring (e.g. "claude-opus-4-8" → Opus)

Full sources, caveats, and update guidance: `references/methodology.md`.

## Display template

```
🌍 Environmental Impact of This Response

Energy: [X.XX] Wh ([relatable comparison])
Water:  [X.XX] mL ([relatable comparison])

Model: [model name]
Tokens: [input] in + [output] out + ~[skillLoadTokens] skill = [total]
[If agents]: + [N] agent tokens across [X] agents = [grand total]

💡 If a lighter model had been used:
  [Model]: [X.XX] Wh / [X.XX] mL  ([Y]x less)

Note: Estimates — see the dashboard's Methodology panel for sources.
```

Omit the agent line if no subagents ran. Omit the lighter-model section if Haiku was used. Opus → show Sonnet + Haiku alternatives; Sonnet → show Haiku only. Present as neutral data, not a reprimand. Comparison factors (phone charge ≈ 12 Wh, LED bulb 10 W, bottle 500 mL, car ≈ 404 g CO2/mile, kettle boil ≈ 100 Wh) are in config under `comparisons`.

## Logging

After every impact display, append one entry to the shared log (schema details: `references/log-schema.md`):

```json
{ "timestamp": "<ISO8601 UTC>", "project": "<project name>", "model": "<model id>",
  "energy_wh": 0.0, "water_ml": 0.0, "total_tokens": 0,
  "input_tokens": 0, "output_tokens": 0,
  "context": "<brief description of the work>" }
```

**Always log `input_tokens` and `output_tokens` when you know them** (and
`cached_tokens` if available). They are what make the context-vs-generation split
measurable: it cannot be recovered afterwards from `energy_wh` and `total_tokens`
alone, because any entry costed with a blended rate back-solves to an impossible
output share. Omit the fields entirely rather than guessing — the dashboard
distinguishes "no split logged" from "the split is zero". Prefer the two-rate
formula over the blended rate whenever you have the counts; the blended constants
sit close to the pure output rate and therefore read high.

Rules: always include `project`; never rewrite or delete existing entries; keep the file valid JSON (`{"entries":[...]}`); mark estimates for past sessions with a `[backfill·est]` or `[backfill·measured]` prefix in `context`.

### Where the entry goes — and confirming it landed

Walk the resolution order from "Setup" and write to the first path that works:

1. `<Projects root>/.environmental-impact-log.json` — try this first, always.
2. `<this project folder>/.environmental-impact-log.json` — the fallback working log, when
   the root is genuinely outside every connected folder.
3. `<this project folder>/.environmental-impact-log.pending.json` — last resort, when
   neither log is writable. Same shape (`{"note": "…", "entries": [ … ]}`), appending to
   `entries`. Tell the user in one line that the entry was parked.

**Then verify.** Read the file back and confirm the entry count grew by one. This is not
optional bookkeeping: silent logging failure is this tool's documented failure mode — an
install once went three weeks writing nothing because the resolved path did not exist and
nothing checked. If the read-back does not show the entry, say so plainly rather than
reporting success.

Never silently skip logging. An entry parked in the wrong place is recoverable; an entry
never written is gone.

### Reconcile: sweep pending files and fallback logs into the root log

Whenever you touch the root log — every dashboard build/refresh, and every weekly or
monthly summary — reconcile first, so parked and fallback entries land before anything is
counted:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/tools/merge_pending.py" --root "<Projects root>" --log "<path to root log>"
```

This sweeps two things into the root log: every `.environmental-impact-log.pending.json`
(then empties it), and every project-level `.environmental-impact-log.json` **fallback**
log (left intact, since it stays that project's own working log — pass
`--drain-fallback` if you'd rather force a single source of truth).

The sweep is idempotent: it dedupes on `(timestamp, context)`, preserves optional
`input_tokens` / `output_tokens` / `cached_tokens`, merges in timestamp order, backs the
root log up before writing, and empties pending files rather than deleting them — so the
drop-point survives, and it works on mounts where deletes are not permitted. Add
`--dry-run` to preview. If Python is unavailable, merge by hand using the same dedupe key.

Report what the sweep recovered — "merged 3 parked entries from 2 projects" — rather than
folding it in silently.

## Summaries

Read the log, then aggregate:

- **Session** — entries since today's first entry
- **This week** — entries within the current Mon–Sun week; report ONE combined total across all projects plus per-project subtotals grouped by `project`, highest → lowest
- **This month / all time / per project** — same pattern over the relevant slice

## Dashboard

The dashboard is a single self-contained HTML file (offline, zero external calls) built from `${CLAUDE_PLUGIN_ROOT}/dashboard/src/` by `${CLAUDE_PLUGIN_ROOT}/dashboard/build.py`.

**Build or refresh** (when the user asks to see/refresh/re-bake the dashboard, or after appending entries if the user has auto-refresh set up). Always sweep pending files first — see "Sweep pending files into the shared log" above — so parked entries are baked in:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/tools/merge_pending.py" --root "<Projects root>" --log "<path to user's log>"
python3 "${CLAUDE_PLUGIN_ROOT}/dashboard/build.py" --log "<path to user's log>" \
  --out "<user's dashboard location>/AI-Impact-Dashboard.html" --source-label "my logged data"
```

If Python is unavailable, fall back to string-injection: copy the previous built dashboard (or `dashboard/dist/dashboard.html`), then replace the array following the `/*__SEED__*/` placeholder with the log's entries as compact JSON, and the value after `/*__BUILT__*/` with today's date.

Keep the user's dashboard file where they chose to keep it; overwrite it in place on refresh so links/bookmarks keep working. After building, tell the user the file path and present a link to it.

## Tone

Informative, not preachy. Specific — never say "negligible." Honest — these are estimates; trends matter more than any single absolute number.
