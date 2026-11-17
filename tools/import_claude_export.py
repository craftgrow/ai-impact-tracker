#!/usr/bin/env python3
"""
import_claude_export.py -- add claude.ai usage from a Claude data export
(Settings > Privacy > Export data) to the AI Impact Tracker log.

Why this exists: import_transcripts.py measures local Cowork / Claude Code
sessions exactly, but claude.ai chats and cloud sessions never touch the Mac's
disk. The data export is the only record of them.

What the export does and doesn't contain (checked against a real export,
Oct 2026):
  conversations.json   every claude.ai chat: message text, thinking, tool calls
                       and tool results, with timestamps. NO token counts, NO
                       model name, NO project link.
  design_chats/*.json  Claude Design chats: message text + timestamps.
  claude_code_cloud/   scheduled-task definitions and run times only. No
                       transcripts, no tokens.
  projects/, memories/, light_metadata/ ... nothing usable for the footprint.

So every number this tool writes is an ESTIMATE, tagged "[export-estimate]".
Only token counts, call counts and dates are stored -- never message text or
chat titles.

How a chat is estimated (per model call, replaying the conversation):
  - Each assistant tool call ends one model call; the final reply ends another.
  - Every call re-reads the whole conversation so far ("context") plus a
    fixed system-prompt overhead.
  - Context is capped at a realistic window. Real sessions drop or summarize
    old material; without the cap one file-heavy chat alone came to ~800M
    tokens, which is impossible.
  - Prompt caching: content added since the previous call is a cache write
    (full input rate). The rest is a cache read (10% of the input rate) --
    unless more than 5 minutes passed since the previous call, when the cache
    has expired and the whole context is re-written at the full input rate.
  - Tokens ~= characters / 4.
  Three scenarios bracket the unknowns (window, system prompt, model):
    low  = 100k window,  5k system prompt, Sonnet rates
    mid  = 150k window, 15k system prompt, rates halfway Sonnet->Opus  (logged)
    high = 200k window, 30k system prompt, Opus rates
  energy_wh holds the mid value; energy_wh_low / energy_wh_high hold the band.

Sessions: a conversation is split into separate log entries wherever it went
quiet for more than 60 minutes, so a chat revisited over several days lands on
the right days.

Overlap with self-reported entries: a self-report (entry with no import_key,
not tagged [measured]) is replaced only when an exported chat provably wrote it
-- the chat's tool calls contain that entry's exact timestamp and energy value.
The chat session then takes the self-report's project name. Time overlap alone
is deliberately not used (see the comment in main()).

Scheduled-task runs: logged with energy 0 and tagged "[no-token-data]" so the
run count is visible without inventing a number. Zero energy means they can
never double-count a self-report of the same run.

Idempotent: entries carry import_key "ce_<hash>" (chat identity + session
start). Re-running with a newer export replaces an earlier estimate for the
same session if the newer one saw more model calls, and adds anything new --
including new chats on days that were already partly imported.

Chat identity is the export's uuid. Some exported chats have none; before
Nov 2026 those all hashed to the same key, so up to 31 different chats that
started in the same second shared one key and a re-run compared them against a
single old row. They now get a stable fallback identity (name, creation time,
first message -- never anything that changes as a chat grows), duplicates of
one chat across several export zips are merged, and rows left behind by the
old collisions are retired when a newer export re-measures them.

Usage:
  python3 import_claude_export.py --export DIR --log LOG [--dry-run]
DIR may hold the export's .zip files or their extracted contents.
Zero dependencies beyond the Python 3 standard library.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone

SCENARIOS = {
    "low":  {"cap": 100_000, "sys": 5_000,  "inp": 30, "out": 150},
    "mid":  {"cap": 150_000, "sys": 15_000, "inp": 40, "out": 200},
    "high": {"cap": 200_000, "sys": 30_000, "inp": 50, "out": 250},
}
CHARS_PER_TOKEN = 4
CACHE_READ_DISCOUNT = 0.10
CACHE_TTL = timedelta(minutes=5)
SESSION_GAP = timedelta(minutes=60)
OVERLAP_BUFFER = timedelta(minutes=30)
WATER_FACTOR = 1.7
MODEL_LABEL = "claude.ai (model unknown)"
TAG = "[export-estimate]"


# ---------------------------------------------------------------- loading
def load_export(path):
    """Return dict name -> parsed JSON for the files we use, from zips or folders."""
    wanted = ("conversations.json", "design_chats/", "claude_code_cloud/routine_runs.json",
              "claude_code_cloud/routines.json")
    out = {"conversations": [], "design_chats": [], "routine_runs": [], "routines": []}

    def take(name, raw):
        base = name.replace("\\", "/")
        if base.endswith("conversations.json"):
            out["conversations"].extend(json.loads(raw))
        elif "/design_chats/" in "/" + base and base.endswith(".json"):
            out["design_chats"].append(json.loads(raw))
        elif base.endswith("claude_code_cloud/routine_runs.json"):
            out["routine_runs"].extend(json.loads(raw).get("claude_code_cloud", []))
        elif base.endswith("claude_code_cloud/routines.json"):
            out["routines"].extend(json.loads(raw).get("claude_code_cloud", []))

    for z in sorted(glob.glob(os.path.join(path, "*.zip"))):
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if any(w in n for w in wanted):
                    take(n, zf.read(n))
    if not any(out.values()):
        for f in glob.glob(os.path.join(path, "**", "*.json"), recursive=True):
            rel = os.path.relpath(f, path)
            if any(w in rel.replace("\\", "/") for w in wanted):
                with open(f, "rb") as fh:
                    take(rel, fh.read())
    return out


def parse_ts(s):
    """Parse ISO-8601 with any number of fractional-second digits (exports mix 5,
    6 and 9). Python <3.11 fromisoformat only accepts exactly 3 or 6, so the
    fraction is normalised to 6 digits first."""
    if not s:
        return None
    s = s.strip().replace("Z", "+00:00")
    m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$", s)
    if m:
        frac = ((m.group(2) or "") + "000000")[:6]
        s = m.group(1) + "." + frac + (m.group(3) or "")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso_z(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- events
def block_chars(b):
    t = b.get("type")
    if t == "text":
        return len(b.get("text") or "")
    if t == "thinking":
        return len(b.get("thinking") or "")
    if t == "tool_use":
        return len(json.dumps(b.get("input") or {}))
    if t == "tool_result":
        return len(json.dumps(b.get("content") or ""))
    return 0


def chat_events(conv):
    """Flatten a claude.ai conversation into ordered events:
    ("in", t, chars)   -- content added to context (human turn, tool result)
    ("call", t, chars) -- one model call producing `chars` of output
    """
    ev = []
    for m in sorted(conv.get("chat_messages") or [], key=lambda m: m.get("created_at") or ""):
        mt = parse_ts(m.get("created_at"))
        blocks = m.get("content") or [{"type": "text", "text": m.get("text") or ""}]
        if m.get("sender") == "human":
            n = sum(block_chars(b) for b in blocks)
            n += sum(len(a.get("extracted_content") or "") for a in m.get("attachments") or [])
            ev.append(("in", mt, n))
            continue
        out, t_call = 0, None
        for b in blocks:
            bt = parse_ts(b.get("start_timestamp")) or mt
            if b.get("type") == "tool_result":
                ev.append(("in", bt, block_chars(b)))
                continue
            t_call = t_call or bt
            out += block_chars(b)
            if b.get("type") == "tool_use":
                ev.append(("call", t_call, out))
                out, t_call = 0, None
        if out or t_call:
            ev.append(("call", t_call or mt, out))
    return [e for e in ev if e[1] is not None]


def design_events(chat):
    ev = []
    for m in sorted(chat.get("messages") or [], key=lambda m: m.get("created_at") or ""):
        t = parse_ts(m.get("created_at"))
        c = m.get("content")
        n = len(c.get("content") or "") if isinstance(c, dict) else len(json.dumps(c or ""))
        role = (c.get("role") if isinstance(c, dict) else None) or m.get("role")
        ev.append(("in" if role == "user" else "call", t, n))
    return [e for e in ev if e[1] is not None]


def split_sessions(events):
    sessions, cur, last = [], [], None
    for e in events:
        if last is not None and e[1] - last > SESSION_GAP and cur:
            sessions.append(cur)
            cur = []
        cur.append(e)
        last = e[1]
    if cur:
        sessions.append(cur)
    return [s for s in sessions if any(e[0] == "call" for e in s)]


# ---------------------------------------------------------------- estimate
def estimate(session, sc):
    cap = sc["cap"] * CHARS_PER_TOKEN
    ctx = sc["sys"] * CHARS_PER_TOKEN
    pending_new = ctx            # chars added since the last call (all of it, first time)
    last_call = None
    fresh = write = read = out = 0
    calls = 0
    for kind, t, n in session:
        if kind == "in":
            room = cap - ctx
            add = min(n, max(room, 0))
            ctx += add
            pending_new += add
            continue
        calls += 1
        if last_call is None or t - last_call > CACHE_TTL:
            write += ctx                     # cache cold: whole context re-sent at full rate
        else:
            write += min(pending_new, ctx)
            read += max(ctx - pending_new, 0)
        out += n
        ctx = min(cap, ctx + n)               # the reply joins the context
        pending_new = min(n, cap)
        last_call = t
    tok = lambda c: c / CHARS_PER_TOKEN
    write_t, read_t, out_t = tok(write), tok(read), tok(out)
    energy = ((write_t * sc["inp"]) + (read_t * sc["inp"] * CACHE_READ_DISCOUNT)
              + (out_t * sc["out"])) / 1_000_000
    return {"calls": calls, "cache_write_tokens": int(write_t), "cache_read_tokens": int(read_t),
            "output_tokens": int(out_t), "energy_wh": energy}


def chat_identity(obj, kind):
    """Stable identity for an exported chat, used in its import_key.

    The export's uuid when present -- the same value earlier versions used, so
    keys already in a log still match. Without one, hash things a growing chat
    never changes: kind, name, creation time and its first message. Later
    messages are deliberately excluded, or the key would move every time the
    conversation continued."""
    uid = obj.get("uuid")
    if uid:
        return uid
    msgs = obj.get("chat_messages") or obj.get("messages") or []
    first = min(msgs, key=lambda m: m.get("created_at") or "") if msgs else {}
    first_text = first.get("text") or json.dumps(first.get("content") or "", sort_keys=True)
    basis = "|".join([kind, obj.get("name") or "", obj.get("created_at") or "",
                      first.get("uuid") or "", first.get("created_at") or "", first_text])
    return "nouuid-" + hashlib.sha1(basis.encode("utf-8")).hexdigest()


def make_entry(kind_label, source_id, session, project):
    start, end = session[0][1], session[-1][1]
    est = {k: estimate(session, sc) for k, sc in SCENARIOS.items()}
    mid = est["mid"]
    total = mid["cache_write_tokens"] + mid["cache_read_tokens"] + mid["output_tokens"]
    key = "ce_" + hashlib.sha1((source_id + "|" + iso_z(start)).encode()).hexdigest()[:16]
    return {
        "timestamp": iso_z(start),
        "project": project,
        "model": MODEL_LABEL,
        "energy_wh": round(mid["energy_wh"], 4),
        "energy_wh_low": round(est["low"]["energy_wh"], 4),
        "energy_wh_high": round(est["high"]["energy_wh"], 4),
        "water_ml": round(mid["energy_wh"] * WATER_FACTOR, 4),
        "total_tokens": total,
        "input_tokens": 0,
        "output_tokens": mid["output_tokens"],
        "cache_write_tokens": mid["cache_write_tokens"],
        "cache_read_tokens": mid["cache_read_tokens"],
        "model_calls": mid["calls"],
        "context": "{} {} · {}".format(TAG, kind_label, start.date().isoformat()),
        "import_key": key,
        "_end": end,
    }


# ---------------------------------------------------------------- main
def is_self_report(e):
    ctx = e.get("context") or ""
    return not e.get("import_key") and not ctx.startswith("[measured]")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", required=True, help="folder with the export .zip files (or extracted)")
    ap.add_argument("--log", required=True, help="path to the root .environmental-impact-log.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data = load_export(args.export)
    with open(args.log) as f:
        log = json.load(f)
    entries = log["entries"]

    new = []
    data["blobs"] = {}
    for conv in data["conversations"]:
        cid = chat_identity(conv, "chat")
        data["blobs"][cid] = json.dumps(conv.get("chat_messages") or [], ensure_ascii=False).replace('\\"', '"')
        for s in split_sessions(chat_events(conv)):
            n = make_entry("claude.ai chat", cid, s, "claude.ai")
            n["_conv"] = cid
            new.append(n)
    for chat in data["design_chats"]:
        did = chat_identity(chat, "design")
        for s in split_sessions(design_events(chat)):
            n = make_entry("Claude Design chat", did, s, "Claude Design")
            n["_conv"] = did
            new.append(n)

    # Self-reports written FROM an exported chat are the same usage: drop them and
    # let the chat session inherit their project. Proof of origin is strict -- the
    # chat's own tool calls must contain that entry's exact timestamp and energy
    # value. Time overlap alone is NOT used: cloud coding sessions (not in the
    # export) routinely run while a chat is open, and matching on time deleted
    # ~4.9 kWh of real, unrelated usage in testing.
    sessions_by_conv = {}
    for n in new:
        sessions_by_conv.setdefault(n["_conv"], []).append(n)
    superseded = set()
    for i, e in enumerate(entries):
        if not is_self_report(e):
            continue
        ts, wh = e.get("timestamp") or "", e.get("energy_wh")
        if not ts or wh is None:
            continue
        for conv_id, blob in data["blobs"].items():
            if ts in blob and ('"energy_wh": %s' % wh in blob or '"energy_wh":%s' % wh in blob):
                superseded.add(i)
                t = parse_ts(ts)
                cands = sessions_by_conv.get(conv_id) or []
                if cands:
                    best = min(cands, key=lambda n: abs((parse_ts(n["timestamp"]) - t).total_seconds()))
                    if best["project"] in ("claude.ai", "Claude Design") and e.get("project"):
                        best["project"] = e["project"]
                    best["replaced_self_reports"] = best.get("replaced_self_reports", 0) + 1
                break

    # Scheduled-task runs: logged at zero energy so they can never double-count a
    # self-report; they only make the run count visible.
    names = {r["routine_id"]: r.get("name") or "scheduled task" for r in data["routines"]}
    runs_added = 0
    for r in data["routine_runs"]:
        st, fin = parse_ts(r.get("started_at")), parse_ts(r.get("finished_at"))
        if not st:
            continue
        fin = fin or st
        runs_added += 1
        new.append({
            "timestamp": iso_z(st), "project": "Scheduled tasks", "model": "unknown",
            "energy_wh": 0, "water_ml": 0, "total_tokens": 0,
            "context": "[no-token-data] scheduled task run: {} · {}".format(
                names.get(r["routine_id"], "scheduled task"), st.date().isoformat()),
            "import_key": "ce_" + hashlib.sha1((r.get("session_id") or iso_z(st)).encode()).hexdigest()[:16],
            "_end": fin,
        })

    # The same chat can appear more than once in one run (an export split across
    # several zips, or two exports in one folder). Keep the fullest copy of each.
    best_new = {}
    for n in new:
        k = n["import_key"]
        if k not in best_new or n.get("model_calls", 0) > best_new[k].get("model_calls", 0):
            best_new[k] = n
    merged_in_run = len(new) - len(best_new)
    new = list(best_new.values())

    # Index earlier export rows by key. A key held by more than one row is proof
    # of the pre-fix collision (uuid-less chats all hashed alike). Those rows are
    # retired wherever this export re-measures the same moment; collided rows it
    # does not cover are left alone rather than guessed at.
    by_key = {}
    for i, e in enumerate(entries):
        if (e.get("import_key") or "").startswith("ce_"):
            by_key.setdefault(e["import_key"], []).append(i)
    new_stamps = {n["timestamp"] for n in new}
    legacy_retired = set()
    for k, idx in list(by_key.items()):
        if len(idx) > 1:
            hit = [i for i in idx if entries[i].get("timestamp") in new_stamps]
            legacy_retired.update(hit)
            rest = [i for i in idx if i not in hit]
            if rest:
                by_key[k] = rest
            else:
                del by_key[k]

    # Idempotency: replace an earlier estimate of the same session only if this one saw more.
    added, replaced, skipped = [], 0, 0
    drop_idx = set(superseded) | legacy_retired
    for n in new:
        n.pop("_end", None)
        n.pop("_conv", None)
        k = n["import_key"]
        if k in by_key:
            old_idx = by_key[k]
            if n.get("model_calls", 0) > max(entries[i].get("model_calls", 0) for i in old_idx):
                drop_idx.update(old_idx)
                replaced += 1
                added.append(n)
            else:
                skipped += 1
            continue
        added.append(n)

    final = [e for i, e in enumerate(entries) if i not in drop_idx] + added
    final.sort(key=lambda e: e.get("timestamp", ""))

    est = [n for n in added if n["context"].startswith(TAG)]
    summary = {
        "chats_in_export": len(data["conversations"]),
        "design_chats_in_export": len(data["design_chats"]),
        "export_sessions_added": len(est),
        "model_calls_estimated": sum(n.get("model_calls", 0) for n in est),
        "energy_wh_added_mid": round(sum(n["energy_wh"] for n in est), 1),
        "energy_wh_added_low": round(sum(n["energy_wh_low"] for n in est), 1),
        "energy_wh_added_high": round(sum(n["energy_wh_high"] for n in est), 1),
        "self_reports_replaced": len(superseded),
        "energy_wh_of_replaced_self_reports": round(sum(entries[i].get("energy_wh") or 0 for i in superseded), 1),
        "sessions_named_from_self_reports": sum(1 for n in est if n.get("replaced_self_reports")),
        "scheduled_runs_added_zero_energy": sum(1 for n in added if n["context"].startswith("[no-token-data]")),
        "already_imported_skipped": skipped,
        "earlier_estimates_replaced": replaced,
        "duplicate_chats_merged_in_run": merged_in_run,
        "legacy_collided_rows_retired": len(legacy_retired),
        "log_entries_before": len(entries),
        "log_entries_after": len(final),
        "total_energy_wh_before": round(sum(e.get("energy_wh") or 0 for e in entries), 1),
        "total_energy_wh_after": round(sum(e.get("energy_wh") or 0 for e in final), 1),
    }
    print(json.dumps(summary, indent=2))
    if args.dry_run:
        print("DRY RUN -- log not written")
        return

    backup = args.log + ".backup-preexport-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(args.log, backup)
    log["entries"] = final
    tmp = args.log + ".tmp"
    with open(tmp, "w") as f:
        json.dump(log, f, indent=1)
    os.replace(tmp, args.log)
    print("backup:", backup)
    print("wrote:", args.log)


if __name__ == "__main__":
    main()
