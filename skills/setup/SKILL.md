---
name: setup
description: First-run setup for the AI Impact Tracker. Finds the Claude session transcripts already on this machine, measures their exact energy, water and CO2e cost, builds the dashboard and publishes it as an artifact. Use when the user installs the plugin, asks to set up or start the impact tracker, asks how much energy their AI use has cost, or wants their first dashboard.
---

# Set up the AI Impact Tracker

One pass: find the transcripts, measure them, build the dashboard, publish it.
Do not ask the user to run anything in a terminal - run it yourself and report
what happened.

## Step 0 - check this machine can be measured (do this first)

This plugin reads session transcripts written to local disk. **It cannot
measure claude.ai usage from the web or a phone**, because nothing is written
to disk there.

| What | Where |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Desktop app / Cowork (macOS) | `~/Library/Application Support/Claude/local-agent-mode-sessions/**/*.jsonl` |
| Desktop app / Cowork (Windows) | `%APPDATA%\Claude\local-agent-mode-sessions\**\*.jsonl` |
| Desktop app / Cowork (Linux) | `~/.config/Claude/local-agent-mode-sessions/**/*.jsonl` |

Run this to have the importer report which stores it can actually see:

```
python3 "${CLAUDE_PLUGIN_ROOT}/tools/import_transcripts.py" --list-stores
```

**If neither store holds any files, stop.** Say plainly:

> This tracker measures the session transcripts that Claude Code and the Claude
> desktop app write to your computer. I can't find either on this machine, so
> there's nothing to measure yet. It works from a terminal session or the
> desktop app; claude.ai in a browser doesn't write transcripts to disk, so
> usage there can only be estimated from a data export, which this setup
> doesn't cover.

Do not build a dashboard from the bundled demo data and present it as theirs.

## Step 1 - pick where the log lives

Ask once, then remember it. A good default is a folder the user already keeps
work in. The file is `.environmental-impact-log.json`.

The log is the private part of this tool. Tell the user in one line that it
will hold their project names and a short description of each session, and
that it never leaves their machine.

If the file does not exist, create it from
`${CLAUDE_PLUGIN_ROOT}/data/log-template.json`, which is `{"entries": []}`.

## Step 2 - import

```
python3 "${CLAUDE_PLUGIN_ROOT}/tools/import_transcripts.py" --log <LOG> --dry-run
```

Show the user the counts it reports, then run it again without `--dry-run`.
It writes a timestamped backup before touching anything, and it is idempotent:
a later run picks up only what is new, so re-running weekly is safe.

Expect a first run on a well-used machine to find thousands of sessions and a
total far higher than anyone would guess. That gap is the point of the tool.
Most of it is cached context - the conversation re-sent on every turn - which
an end-of-turn self-estimate structurally cannot see.

## Step 3 - build the dashboard

```
python3 "${CLAUDE_PLUGIN_ROOT}/dashboard/build.py" \
  --log <LOG> --out <OUT>.html --source-label "my logged data"
```

Every figure in the Audit section is computed from the log you pass, so the
page describes their data rather than anyone else's.

## Step 4 - publish it as their artifact

Publish the built HTML as an artifact using whatever artifact tool this session
has, titled **Personal AI Usage & Impact**, and give them the link.

That link is the copy they come back to. It is private to their account until
they choose to share it. On later refreshes, republish to the same artifact
instead of creating a new one so the link keeps working.

If no artifact tool is available, leave the HTML where it was built, tell them
the path, and note that it opens in any browser with no server and no network.

## Step 5 - tell them the two things they need to know

1. **To refresh:** ask Claude to refresh the impact dashboard. It re-imports
   and republishes to the same link. Weekly is plenty.

2. **Before sharing it with anyone**, build a sanitised copy:

   ```
   python3 "${CLAUDE_PLUGIN_ROOT}/dashboard/build.py" \
     --log <LOG> --out shareable.html --sanitize
   ```

   Their own dashboard shows real project names and session descriptions,
   because that is what makes it useful to them. `--sanitize` replaces every
   project name with "Project 1", "Project 2" and withholds the descriptions.
   Say this at setup rather than later: a list of someone's project names is
   usually more revealing than the numbers beside them, and people do not
   expect that when they share a chart.

## Keeping it fed

The `impact-tracker` skill in this plugin logs sessions as they happen; the
importer is what makes the record exact. Both write to the same log and
de-duplicate against each other, so running both is correct and
double-counts nothing.
