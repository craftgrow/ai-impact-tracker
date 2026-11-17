#!/usr/bin/env python3
"""
Reconcile parked and fallback impact entries into the root log.

The log resolves root-primary / project-fallback. A session that only has its own
project folder connected cannot write to the root log, so it writes to one of two
places instead — and this tool sweeps both into the root log:

  1. `<project>/.environmental-impact-log.pending.json` — parked entries. Merged,
     then EMPTIED (never deleted).
  2. `<project>/.environmental-impact-log.json` — the project's fallback working
     log. Merged, then LEFT INTACT, because it remains that project's own log when
     opened alone. Pass --drain-fallback to empty it and force a single source of
     truth.

Idempotent and safe to run on every dashboard refresh:
  - dedupes on (timestamp, context), so a double-run adds nothing
  - preserves optional input_tokens / output_tokens / cached_tokens
  - merges in timestamp order
  - backs the root log up before writing
  - empties rather than deletes, so drop-points survive and the tool works on
    mounts where deletes are not permitted

Usage:
    python3 merge_pending.py --root ~/Projects
    python3 merge_pending.py --root <dir> --log <dir>/.environmental-impact-log.json
    python3 merge_pending.py --root <dir> --dry-run
    python3 merge_pending.py --root <dir> --drain-fallback

Zero dependencies beyond the Python 3 standard library.
"""
import argparse
import datetime as dt
import json
import shutil
import sys
from pathlib import Path

PENDING_NAME = ".environmental-impact-log.pending.json"
DEFAULT_LOG_NAME = ".environmental-impact-log.json"
FIELDS = ("timestamp", "project", "model", "energy_wh", "water_ml", "total_tokens", "context")
# Optional, preserved only when present. Never written as 0 to mean "unknown":
# the dashboard distinguishes "no split logged" from "the split is zero".
OPTIONAL_INT_FIELDS = ("input_tokens", "output_tokens", "cached_tokens")

PENDING_NOTE = (
    "Parked impact entries. Written here when neither the root log nor this "
    "project's fallback log was writable. Merged into the root log by "
    "tools/merge_pending.py — an empty entries array means everything has been swept."
)

DRAINED_FALLBACK_NOTE = (
    "Fallback impact log, drained into the root log by tools/merge_pending.py "
    "(--drain-fallback). The root log at your Projects folder is the source of truth."
)


def warn(msg: str) -> None:
    print(f"merge_pending: {msg}", file=sys.stderr)


def read_json(path: Path):
    """Return parsed JSON, or None if unreadable/invalid (never raise)."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        warn(f"skipping unreadable file {path}: {e}")
        return None


def entries_of(blob) -> list:
    """Accept {'entries':[...]} or a bare [...]; anything else yields nothing."""
    if isinstance(blob, dict):
        got = blob.get("entries")
    else:
        got = blob
    return [e for e in got if isinstance(e, dict)] if isinstance(got, list) else []


def normalize(e: dict, fallback_project: str) -> dict:
    """Coerce one entry to the canonical schema, tolerating missing/odd fields.

    Required fields are always present. Optional token-split fields are carried
    through only when the source actually had them: omitting a field and writing
    it as 0 mean different things downstream, so a missing split must stay missing.
    """
    def fnum(v, cast):
        try:
            return cast(v or 0)
        except (TypeError, ValueError):
            return cast(0)

    out = {
        "timestamp": str(e.get("timestamp", "")).strip(),
        "project": str(e.get("project") or fallback_project or "Unlabeled"),
        "model": str(e.get("model") or "other"),
        "energy_wh": fnum(e.get("energy_wh"), float),
        "water_ml": fnum(e.get("water_ml"), float),
        "total_tokens": fnum(e.get("total_tokens"), int),
        "context": str(e.get("context") or ""),
    }

    for f in OPTIONAL_INT_FIELDS:
        if e.get(f) is None:
            continue  # absent, or explicitly null — leave it absent
        try:
            out[f] = int(e[f])
        except (TypeError, ValueError):
            warn(f"dropping non-numeric {f}={e[f]!r} on entry {out['timestamp']!r}")

    # Unknown-field carry-through. Anything this tool doesn't know about is
    # preserved verbatim: import_key and the cache_* token counts written by
    # tools/import_transcripts.py, plus whatever a future writer adds. Dropping
    # them silently breaks the importer's idempotency -- it stops recognising
    # already-imported sessions and re-imports the whole history.
    for f, v in e.items():
        if f not in out and v is not None:
            out[f] = v

    return out


def key_of(e: dict):
    return (e["timestamp"], e["context"])


def sort_key(e: dict):
    """Sort by timestamp; unparseable timestamps sink to the end, order kept."""
    ts = e.get("timestamp") or ""
    try:
        d = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return (0, d.astimezone(dt.timezone.utc).timestamp())
    except ValueError:
        return (1, 0.0)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--root", type=Path, required=True,
                    help="Projects root to scan for pending and fallback logs")
    ap.add_argument("--log", type=Path, default=None,
                    help=f"root log path (default: <root>/{DEFAULT_LOG_NAME})")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be merged, change nothing")
    ap.add_argument("--drain-fallback", action="store_true",
                    help="also empty project fallback logs after merging them "
                         "(default: merge but leave them intact)")
    ap.add_argument("--quiet", action="store_true", help="only report on change")
    args = ap.parse_args()

    root = args.root.expanduser().resolve()
    if not root.is_dir():
        warn(f"error: --root is not a directory: {root}")
        return 2
    log_path = (args.log.expanduser() if args.log else root / DEFAULT_LOG_NAME).resolve()

    # --- existing root log ---
    shared_blob = read_json(log_path) if log_path.is_file() else {"entries": []}
    if shared_blob is None:
        warn(f"error: root log exists but is not valid JSON, refusing to overwrite: {log_path}")
        return 2
    shared = [normalize(e, "Unlabeled") for e in entries_of(shared_blob)]
    seen = {key_of(e) for e in shared}
    before = len(shared)

    # --- collect sources: pending files, then project fallback logs ---
    # Fallback logs are any <project>/.environmental-impact-log.json that is not the
    # root log itself. Sweeping them is what makes root-primary/project-fallback safe.
    sources = [(p, "pending") for p in sorted(root.rglob(PENDING_NAME)) if p.is_file()]
    sources += [
        (p, "fallback") for p in sorted(root.rglob(DEFAULT_LOG_NAME))
        if p.is_file() and p.resolve() != log_path
    ]

    merged, per_project, touched = [], {}, []
    for p, kind in sources:
        blob = read_json(p)
        if blob is None:
            continue
        raw = entries_of(blob)
        if not raw:
            continue
        # A file sitting directly in a project folder names that project.
        fallback = p.parent.name if p.parent != root else "Unlabeled"
        added_here = 0
        for e in raw:
            n = normalize(e, fallback)
            k = key_of(n)
            if k in seen:
                continue
            seen.add(k)
            merged.append(n)
            per_project[n["project"]] = per_project.get(n["project"], 0) + 1
            added_here += 1
        touched.append((p, kind, len(raw), added_here))

    if not touched:
        if not args.quiet:
            print(f"merge_pending: no pending or fallback logs under {root} — nothing to sweep.")
        return 0

    for p, kind, found, added in touched:
        rel = p.relative_to(root)
        dupes = found - added
        note = f"{added} new" + (f", {dupes} already merged" if dupes else "")
        print(f"  {rel}: {found} {kind} ({note})")

    # Files safe to empty: always pending; fallback logs only when asked, since a
    # fallback log stays that project's own working log when opened on its own.
    def drainable():
        return [
            (p, kind) for p, kind, _, _ in touched
            if kind == "pending" or args.drain_fallback
        ]

    if not merged:
        if args.dry_run:
            print("merge_pending: dry run — every entry is already in the root log.")
            return 0
        # Still clear the drainable files: their contents are fully accounted for.
        cleared = clear_sources(drainable())
        print(f"merge_pending: nothing new; cleared {cleared} already-merged file(s).")
        return 0

    if args.dry_run:
        print(f"merge_pending: dry run — would merge {len(merged)} entr(ies): "
              + ", ".join(f"{k} ×{v}" for k, v in sorted(per_project.items())))
        return 0

    shared.extend(merged)
    shared.sort(key=sort_key)

    # --- back up, then write ---
    if log_path.is_file():
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = log_path.with_name(f"{log_path.name}.backup-{stamp}")
        try:
            shutil.copy2(log_path, backup)
        except OSError as e:
            warn(f"error: could not back up the root log, refusing to write: {e}")
            return 2

    out = shared_blob if isinstance(shared_blob, dict) else {}
    out["entries"] = shared
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    except OSError as e:
        warn(f"error: could not write the root log: {e}")
        return 2

    cleared = clear_sources(drainable())
    kinds = {}
    for _, kind, _, _ in touched:
        kinds[kind] = kinds.get(kind, 0) + 1
    src_desc = ", ".join(f"{v} {k}" for k, v in sorted(kinds.items()))
    print(f"merge_pending: merged {len(merged)} entr(ies) from {src_desc} file(s) "
          f"— {', '.join(f'{k} x{v}' for k, v in sorted(per_project.items()))}")
    print(f"merge_pending: root log {before} -> {len(shared)} entries ({log_path}); "
          f"cleared {cleared} file(s).")
    return 0


def clear_sources(pairs) -> int:
    """Empty each file's entries array, keeping a note. Never deletes."""
    n = 0
    for p, kind in pairs:
        note = PENDING_NOTE if kind == "pending" else DRAINED_FALLBACK_NOTE
        try:
            p.write_text(
                json.dumps({"note": note, "entries": []}, ensure_ascii=False, indent=1) + "\n",
                encoding="utf-8",
            )
            n += 1
        except OSError as e:
            warn(f"could not clear {p} (entries are already safely merged): {e}")
    return n


if __name__ == "__main__":
    sys.exit(main())
