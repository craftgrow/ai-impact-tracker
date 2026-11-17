# Shared Log Schema

One JSON file aggregates every project. Default name:
`.environmental-impact-log.json` (config: `logFileName`).

```json
{
  "entries": [
    {
      "timestamp": "2026-07-12T20:33:00Z",
      "project": "Website Redesign",
      "model": "claude-sonnet-4-6",
      "energy_wh": 6.7,
      "water_ml": 11.4,
      "total_tokens": 86500,
      "input_tokens": 71200,
      "output_tokens": 15300,
      "context": "Homepage hero + nav restructure, responsive audit"
    }
  ]
}
```

## Fields

| Field | Type | Notes |
|---|---|---|
| `timestamp` | string | ISO-8601 UTC (`...Z`). Time the session ended. |
| `project` | string | Required. The project/workspace name — this powers per-project drill-down. |
| `model` | string | Model identifier; matched to a family by substring (opus/sonnet/haiku). |
| `energy_wh` | number | Estimated watt-hours for the session. |
| `water_ml` | number | Estimated millilitres (energy × waterFactor). |
| `total_tokens` | number | All tokens counted for the session, incl. skill load and subagents. |
| `input_tokens` | number | *Optional but strongly preferred.* Input/context tokens. |
| `output_tokens` | number | *Optional but strongly preferred.* Generated tokens. |
| `cached_tokens` | number | *Optional.* Cache reads, billed at ~10% of the input rate. |
| `context` | string | One-line description of the work. Prefix `[backfill·est]` or `[backfill·measured]` for retroactive entries. |

### Why the token split matters

`input_tokens` / `output_tokens` are the only way the context-vs-generation split
becomes measurable. It **cannot** be recovered later from `energy_wh` and
`total_tokens`: solving `energy = tokens × ((1−f)·inp + f·out) / 1e6` for the output
share `f` returns values outside `[0,1]` for any entry that was costed with a blended
rate, because the blended constants sit close to the pure output rate. Log the two
counts when you know them, and **omit them entirely** when you don't — the dashboard
distinguishes "no split logged" from "the split is zero", and reports coverage rather
than inventing a number.

## Invariants

- Append-only: never rewrite or delete existing entries.
- Optional fields are omitted, never written as `0` to mean "unknown".
- The file must always parse as `{"entries":[...]}`.
- CO2e is **not** stored — it is derived at display time from `energy_wh` ×
  grid intensity, so users can retune their grid factor without rewriting
  history.
- The dashboard's importer also tolerates a bare `[...]` array, NDJSON
  (one object per line), and code-fenced JSON — but always *write* the
  canonical shape above.
