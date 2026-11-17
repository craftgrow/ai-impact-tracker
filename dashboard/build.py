#!/usr/bin/env python3
"""
Build the AI Environmental Impact Dashboard.

Assembles the src/ modules into ONE self-contained HTML file (no external
calls, works offline), baking in a config and a usage log ("seed").

Usage:
    python3 build.py                          # demo seed  -> dist/dashboard.html
    python3 build.py --log /path/to/log.json  # your log   -> dist/dashboard.html
    python3 build.py --log my.json --out My-Dashboard.html
    python3 build.py --shift-dates            # re-date demo entries to end today

Zero dependencies beyond the Python 3 standard library.
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = HERE / "src"

# Concatenation order matters only for top-level statements;
# function declarations are hoisted within the shared IIFE.
JS_MODULES = ["config.js", "tracker_core.js", "ui_components.js", "footprint.js", "share.js", "exporters.js"]


def fail(msg: str) -> None:
    sys.exit(f"build.py: error: {msg}")


def read(path: Path) -> str:
    if not path.is_file():
        fail(f"missing file: {path}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path, what: str):
    try:
        return json.loads(read(path))
    except json.JSONDecodeError as e:
        fail(f"{what} is not valid JSON ({path}): {e}")


def load_entries(log_path: Path):
    """Accept {'entries':[...]} or a bare [...] and validate lightly."""
    data = load_json(log_path, "log file")
    entries = data.get("entries") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        fail(f"log file must be {{\"entries\": [...]}} or a JSON array: {log_path}")
    clean = []
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            continue
        row = {
            "timestamp": str(e.get("timestamp", "")),
            "project": str(e.get("project", "Unlabeled")),
            "model": str(e.get("model", "other")),
            "energy_wh": float(e.get("energy_wh", 0) or 0),
            "water_ml": float(e.get("water_ml", 0) or 0),
            "total_tokens": int(e.get("total_tokens", 0) or 0),
            "context": str(e.get("context", "")),
        }
        # Optional per-token detail: only baked in when actually present, so
        # the dashboard can tell "no split logged" from "split is zero".
        # Deliberately NOT cache_read_tokens / cache_write_tokens: nothing on
        # the page reads them (the audit figures are computed at build time from
        # the raw log), and baking them in cost 274 KB for no rendered benefit.
        for opt in ("input_tokens", "output_tokens", "cached_tokens"):
            if e.get(opt):
                try:
                    row[opt] = int(e[opt])
                except (TypeError, ValueError):
                    pass
        clean.append(row)
    if not clean:
        print(f"build.py: warning: no usable entries in {log_path}", file=sys.stderr)
    return clean


def shift_dates(entries, end: dt.datetime):
    """Shift all timestamps so the newest entry lands on `end` (spacing kept)."""
    stamps = []
    for e in entries:
        try:
            stamps.append(dt.datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00")))
        except ValueError:
            stamps.append(None)
    known = [s for s in stamps if s]
    if not known:
        return entries
    delta = end.astimezone(dt.timezone.utc) - max(known)
    for e, s in zip(entries, stamps):
        if s:
            e["timestamp"] = (s + delta).strftime("%Y-%m-%dT%H:%M:%SZ")
    return entries


def sanitize(entries):
    """Replace project names with stable generic labels and drop the free-text
    context. A log's project names and session descriptions are the most
    revealing thing in it - far more than the numbers - so a copy meant for
    anyone else should never carry them."""
    order, mapping, out = [], {}, []
    for e in entries:
        p = e.get("project") or "Unsorted"
        if p not in mapping:
            order.append(p)
            mapping[p] = "Project %d" % len(order)
    for e in entries:
        c = dict(e)
        c["project"] = mapping.get(e.get("project") or "Unsorted", "Project 1")
        c["context"] = "(description withheld)"
        c.pop("import_key", None)      # a path hash is still a fingerprint
        c.pop("recovered_from", None)
        out.append(c)
    return out


def audit_stats(entries):
    """Every figure the audit section quotes, derived from the log in hand so
    the section describes the reader's own data and not the author's."""
    def wh(rows):
        return sum(float(r.get("energy_wh") or 0) for r in rows)

    def fmt_n(n):
        return "{:,}".format(int(n))

    def fmt_kwh(v):
        return ("%.1f kWh" % (v / 1000.0)) if v >= 1000 else ("%.0f Wh" % v)

    def fmt_tok(n):
        if n >= 1e9:
            return "%.2f billion" % (n / 1e9)
        if n >= 1e6:
            return "%.0f million" % (n / 1e6)
        return fmt_n(n)

    measured = [e for e in entries if str(e.get("import_key") or "").startswith("tr_")]
    export = [e for e in entries if str(e.get("import_key") or "").startswith("ce_")]
    selfrep = [e for e in entries if not e.get("import_key")]
    total_wh = wh(entries) or 1.0
    tokens = sum(int(e.get("total_tokens") or 0) for e in entries)
    cache = sum(int(e.get("cache_read_tokens") or 0) for e in entries)
    stamps = sorted(str(e.get("timestamp") or "") for e in entries if e.get("timestamp"))
    first = stamps[0][:10] if stamps else "unknown"
    projects = len({e.get("project") for e in entries})

    def row(rows, zero="Not covered"):
        if not rows:
            return zero
        return "%s %s, %s" % (fmt_n(len(rows)),
                              "sessions" if rows is measured else "entries",
                              fmt_kwh(wh(rows)))

    return {
        "__AUDIT_SESSIONS__": fmt_n(len(measured)),
        "__AUDIT_EXACT_PCT__": "%.0f" % (100.0 * wh(measured) / total_wh),
        "__AUDIT_CACHE_PCT__": "%.0f" % (100.0 * cache / tokens) if tokens else "0",
        "__AUDIT_TOKENS__": fmt_tok(tokens),
        "__AUDIT_CACHE_TOKENS__": fmt_tok(cache),
        "__AUDIT_FIRST__": first,
        "__AUDIT_PRUNED__": "Some sessions may",
        "__AUDIT_PROJECTS__": fmt_n(projects),
        "__AUDIT_MEASURED_ROW__": row(measured),
        "__AUDIT_SELF_ROW__": row(selfrep, "None - nothing self-reported"),
        "__AUDIT_EXPORT_ROW__": row(export, "Not imported"),
    }


def inject(html: str, marker: str, payload: str, required: bool = True) -> str:
    """Replace `/*__MARKER__*/<old-value>` up to the next , or ; terminator,
    or an HTML comment placeholder, with payload."""
    if marker.startswith("<!--"):
        if marker not in html:
            fail(f"template placeholder not found: {marker}")
        return html.replace(marker, payload, 1)
    pattern = re.compile(re.escape(marker) + r"[^,;\n]*")
    if not pattern.search(html):
        if required:
            fail(f"placeholder not found in assembled JS: {marker}")
        return html
    return pattern.sub(lambda _: marker + payload, html, count=1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--log", type=Path, default=ROOT / "data" / "demo-log.json",
                    help="log JSON to bake in (default: data/demo-log.json)")
    ap.add_argument("--config", type=Path, default=ROOT / "config" / "config.json",
                    help="config JSON (default: config/config.json)")
    ap.add_argument("--out", type=Path, default=HERE / "dist" / "dashboard.html",
                    help="output HTML path (default: dist/dashboard.html)")
    ap.add_argument("--source-label", default=None,
                    help="label shown as the data source (default: from config, or 'sample data')")
    ap.add_argument("--sanitize", action="store_true",
                    help="strip project names and session descriptions - use for "
                         "any copy you intend to share")
    ap.add_argument("--changelog", type=Path, default=None,
                    help="optional HTML fragment appended to the audit section; "
                         "omit it for a build you are giving to someone else")
    ap.add_argument("--shift-dates", action="store_true",
                    help="re-date entries so the newest lands today (for demo data)")
    args = ap.parse_args()

    config = load_json(args.config, "config file") if args.config.is_file() else {}
    entries = load_entries(args.log)
    if args.shift_dates:
        entries = shift_dates(entries, dt.datetime.now(dt.timezone.utc))
    if args.source_label:
        config = dict(config, seedSourceLabel=args.source_label)

    template = read(SRC / "template.html")
    styles = read(SRC / "styles.css")
    js = "\n\n".join(read(SRC / m) for m in JS_MODULES)

    log_name = config.get("logFileName", ".environmental-impact-log.json")
    # The audit figures describe the RECORD, so they are derived from the log
    # as written - including the fields load_entries() drops to keep the baked
    # seed small (import_key, the cache_* counts). Those stay out of the HTML.
    raw = load_json(args.log, "log file")
    raw = raw.get("entries") if isinstance(raw, dict) else raw
    raw = [r for r in raw if isinstance(r, dict)]

    if args.sanitize:
        entries = sanitize(entries)
        raw = sanitize(raw)

    html = template.replace("__LOG_FILENAME__", log_name)
    for key, val in audit_stats(raw).items():
        html = html.replace(key, val)
    html = html.replace(
        "<!--__CHANGELOG__-->",
        read(args.changelog) if args.changelog else "")
    html = inject(html, "<!--__STYLES__-->", "<style>\n" + styles + "\n</style>")
    script = '(function(){\n"use strict";\n\n' + js + "\n\n})();"
    html = inject(html, "<!--__SCRIPTS__-->", "<script>\n" + script + "\n</script>")
    html = inject(html, "/*__SEED__*/", json.dumps(entries, ensure_ascii=False, separators=(",", ":")))
    html = inject(html, "/*__CONFIG__*/", json.dumps(config, ensure_ascii=False, separators=(",", ":")))
    html = inject(html, "/*__BUILT__*/", json.dumps(dt.date.today().isoformat()))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    print(f"built {args.out}  ({len(entries)} entries baked in, {len(html):,} bytes)")


if __name__ == "__main__":
    main()
