#!/usr/bin/env python3
"""
import_transcripts.py -- pull exact token usage from local session transcripts
into the AI Impact Tracker log, in place of the self-reported estimates for
any session a transcript covers.

Sources:
  1. Cowork local sessions: ~/Library/Application Support/Claude/local-agent-mode-sessions/**/*.jsonl
     No project field exists anywhere in these files (every one is literally
     named "audit.jsonl" under opaque org/user/session UUID folders), so every
     Cowork session is bucketed under the fixed project name "Cowork".
  2. Claude Code sessions: ~/.claude/projects/**/*.jsonl
     Each line carries `cwd` -- the real working directory -- so the project
     is the basename of that path.

For each session file: sum token usage across all `assistant`-type lines,
deduped on (requestId / request_id / message.id) in case a line is repeated.
Compute energy/water with the two-rate formula (cache writes at the input
rate, cache reads at 10% of the input rate -- matches the dashboard's own
convention, see plugin/ai-impact-tracker/config/config.json _notes).

Overlap with the existing self-report log: a self-report entry is DROPPED
(replaced by the exact transcript number) if its timestamp falls within any
imported session's [start - buffer, end + buffer] window. Self-report entries
with no matching transcript window are kept as-is (these are sessions no
transcript covers -- e.g. a cloud-only Cowork session or a claude.ai chat).

Idempotent: run it again and already-imported sessions (tracked by
`import_key`, a hash of the absolute file path) are skipped.

Zero dependencies beyond the Python 3 standard library.
"""
import argparse
import glob
import hashlib
import json
import os
import shutil
import sys
from collections import Counter
from datetime import datetime, timezone

RATES = {
    "opus":   {"inp": 50, "out": 250},
    "sonnet": {"inp": 30, "out": 150},
    "haiku":  {"inp": 10, "out": 50},
    "fable":  {"inp": 30, "out": 150},
    "other":  {"inp": 30, "out": 150},
}
WATER_FACTOR = 1.7
CACHE_READ_DISCOUNT = 0.10
OVERLAP_BUFFER_SECONDS = 30 * 60  # 30 min on either side of a session's span


def family_for_model(model):
    m = (model or "").lower()
    if "opus" in m:
        return "opus"
    if "sonnet" in m:
        return "sonnet"
    if "haiku" in m:
        return "haiku"
    if "fable" in m:
        return "fable"
    return "other"


def parse_ts(s):
    if not s:
        return None
    try:
        s2 = s.replace("Z", "+00:00")
        return datetime.fromisoformat(s2)
    except Exception:
        return None


def to_iso_z(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def import_key_for(path):
    return "tr_" + hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]


def scan_session_file(path, is_claude_code):
    """Return a dict of aggregated usage for one session file, or None if empty/unreadable."""
    seen_ids = set()
    input_tokens = 0
    output_tokens = 0
    cache_write_tokens = 0
    cache_read_tokens = 0
    models = Counter()
    timestamps = []

    try:
        with open(path, "r", errors="replace") as fh:
            lines = fh.readlines()
    except Exception:
        return None

    project = None

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue

        ts = parse_ts(d.get("timestamp"))
        if ts:
            timestamps.append(ts)

        if is_claude_code and not project:
            cwd = d.get("cwd")
            if cwd:
                project = os.path.basename(cwd.rstrip("/")) or cwd

        if d.get("type") != "assistant":
            continue

        dedup_id = d.get("requestId") or d.get("request_id")
        msg = d.get("message") or {}
        if not dedup_id:
            dedup_id = msg.get("id")
        if dedup_id:
            if dedup_id in seen_ids:
                continue
            seen_ids.add(dedup_id)

        usage = msg.get("usage") or {}
        input_tokens += usage.get("input_tokens", 0) or 0
        output_tokens += usage.get("output_tokens", 0) or 0
        cache_write_tokens += usage.get("cache_creation_input_tokens", 0) or 0
        cache_read_tokens += usage.get("cache_read_input_tokens", 0) or 0
        model = msg.get("model")
        if model:
            models[model] += 1

    if not timestamps:
        return None
    total_tokens = input_tokens + output_tokens + cache_write_tokens + cache_read_tokens
    if total_tokens <= 0:
        return None

    if not is_claude_code:
        project = "Cowork"
    if not project:
        project = "Other"

    model = models.most_common(1)[0][0] if models else "unknown"
    family = family_for_model(model)
    rates = RATES[family]

    energy_wh = (
        (input_tokens + cache_write_tokens) * rates["inp"] / 1_000_000
        + cache_read_tokens * rates["inp"] * CACHE_READ_DISCOUNT / 1_000_000
        + output_tokens * rates["out"] / 1_000_000
    )
    water_ml = energy_wh * WATER_FACTOR

    start = min(timestamps)
    end = max(timestamps)

    return {
        "path": path,
        "project": project,
        "model": model,
        "energy_wh": round(energy_wh, 4),
        "water_ml": round(water_ml, 4),
        "total_tokens": total_tokens,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_write_tokens": cache_write_tokens,
        "cache_read_tokens": cache_read_tokens,
        "start": start,
        "end": end,
        "context": "[transcript] {} · {}".format(project, start.date().isoformat()),
    }


# The desktop app writes its session transcripts to a different place on each
# OS, and on an unfamiliar setup it may be somewhere else entirely. Try the
# known candidates and report what was actually found rather than assuming one
# path and silently importing nothing - that failure mode looks exactly like
# "you have no usage", which is the wrong thing to tell someone.
def cowork_candidates():
    home = os.path.expanduser("~")
    out = [
        os.path.join(home, "Library", "Application Support", "Claude",
                     "local-agent-mode-sessions"),                      # macOS
        os.path.join(home, ".config", "Claude",
                     "local-agent-mode-sessions"),                      # Linux
    ]
    appdata = os.environ.get("APPDATA")
    if appdata:                                                         # Windows
        out.append(os.path.join(appdata, "Claude", "local-agent-mode-sessions"))
    return out


def first_existing(paths):
    for p in paths:
        if os.path.isdir(p):
            return p
    return paths[0]


def count_jsonl(root):
    if not os.path.isdir(root):
        return None
    return len(glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True))


def report_stores(cowork_root, cc_root):
    print("Transcript stores visible to this importer:\n")
    rows = [("Claude Code", cc_root), ("Desktop app / Cowork", cowork_root)]
    for label, root in rows:
        n = count_jsonl(root)
        if n is None:
            print("  %-22s not found   %s" % (label, root))
        else:
            print("  %-22s %-5d files  %s" % (label, n, root))
    others = [p for p in cowork_candidates() if p != cowork_root and os.path.isdir(p)]
    for p in others:
        print("  %-22s %-5d files  %s" % ("(also found)", count_jsonl(p) or 0, p))
    total = sum(count_jsonl(r) or 0 for _, r in rows)
    print("")
    if total:
        print("%d transcript file(s) available to measure." % total)
    else:
        print("No transcript files found. This machine has no local Claude")
        print("sessions to measure - claude.ai in a browser does not write")
        print("transcripts to disk.")
    return total


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cowork-root", default=first_existing(cowork_candidates()),
                    help="desktop-app session store; auto-detected per OS")
    ap.add_argument("--claude-code-root", default=os.path.expanduser("~/.claude/projects"))
    ap.add_argument("--log", required=False, help="path to the root .environmental-impact-log.json")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list-stores", action="store_true",
                    help="report which transcript stores exist on this machine "
                         "and exit, without reading the log or importing")
    args = ap.parse_args()

    if args.list_stores:
        report_stores(args.cowork_root, args.claude_code_root)
        return

    if not args.log:
        sys.exit("--log is required (except with --list-stores)")

    with open(args.log) as f:
        log = json.load(f)
    entries = log["entries"]

    already_imported = {e["import_key"] for e in entries if e.get("import_key")}

    cowork_files = sorted(glob.glob(os.path.join(args.cowork_root, "**", "*.jsonl"), recursive=True))
    cc_files = sorted(glob.glob(os.path.join(args.claude_code_root, "**", "*.jsonl"), recursive=True))

    sessions = []
    skipped_already = 0
    skipped_empty = 0
    for path in cowork_files:
        key = import_key_for(path)
        if key in already_imported:
            skipped_already += 1
            continue
        s = scan_session_file(path, is_claude_code=False)
        if s is None:
            skipped_empty += 1
            continue
        s["import_key"] = key
        sessions.append(s)
    for path in cc_files:
        key = import_key_for(path)
        if key in already_imported:
            skipped_already += 1
            continue
        s = scan_session_file(path, is_claude_code=True)
        if s is None:
            skipped_empty += 1
            continue
        s["import_key"] = key
        sessions.append(s)

    sessions.sort(key=lambda s: s["start"])

    # Determine which existing self-report entries are superseded: a self-report
    # entry (no import_key) whose timestamp falls inside any new session's
    # [start-buffer, end+buffer] window.
    # Project-aware windows. A self-report is only a duplicate of a transcript
    # session that covers it AND belongs to the same project. The time window
    # alone was fine when one session ran at a time; with thousands of Claude
    # Code transcripts the windows blanket the calendar and swallow cloud
    # sessions that never had a transcript and were never duplicated.
    windows = []
    for s in sessions:
        from datetime import timedelta
        buf = timedelta(seconds=OVERLAP_BUFFER_SECONDS)
        windows.append((s["start"] - buf, s["end"] + buf, s["project"]))

    kept_entries = []
    dropped_entries = []
    for e in entries:
        if e.get("import_key"):
            kept_entries.append(e)  # previously imported transcript entry, always keep
            continue
        ts = parse_ts(e.get("timestamp"))
        superseded = False
        if ts:
            proj = e.get("project")
            for lo, hi, wproj in windows:
                if lo <= ts <= hi and proj == wproj:
                    superseded = True
                    break
        if superseded:
            dropped_entries.append(e)
        else:
            kept_entries.append(e)

    new_log_entries = []
    for s in sessions:
        new_log_entries.append({
            "timestamp": to_iso_z(s["start"]),
            "project": s["project"],
            "model": s["model"],
            "energy_wh": s["energy_wh"],
            "water_ml": s["water_ml"],
            "total_tokens": s["total_tokens"],
            "input_tokens": s["input_tokens"],
            "output_tokens": s["output_tokens"],
            "cache_read_tokens": s["cache_read_tokens"],
            "cache_write_tokens": s["cache_write_tokens"],
            "context": s["context"],
            "import_key": s["import_key"],
        })

    final_entries = kept_entries + new_log_entries
    final_entries.sort(key=lambda e: e.get("timestamp", ""))

    summary = {
        "cowork_files_found": len(cowork_files),
        "claude_code_files_found": len(cc_files),
        "sessions_imported_this_run": len(sessions),
        "sessions_already_imported_skipped": skipped_already,
        "sessions_empty_skipped": skipped_empty,
        "self_report_entries_dropped_superseded": len(dropped_entries),
        "self_report_entries_kept": len([e for e in kept_entries if not e.get("import_key")]),
        "log_entries_before": len(entries),
        "log_entries_after": len(final_entries),
        "total_energy_wh_before": round(sum(e.get("energy_wh", 0) or 0 for e in entries), 2),
        "total_energy_wh_after": round(sum(e.get("energy_wh", 0) or 0 for e in final_entries), 2),
    }
    print(json.dumps(summary, indent=2))

    if args.dry_run:
        print("DRY RUN -- log not written")
        return

    backup_path = args.log + ".backup-preimport-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(args.log, backup_path)

    log["entries"] = final_entries
    with open(args.log, "w") as f:
        json.dump(log, f, indent=1)

    print("backup:", backup_path)
    print("wrote:", args.log)


if __name__ == "__main__":
    main()
