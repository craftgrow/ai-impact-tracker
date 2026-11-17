#!/usr/bin/env python3
"""Generate the bundled demo log.

The demo build is the first thing anyone sees, so it has to look like a real
person's record: a long tail of small sessions, a few heavy ones, a realistic
model mix, and - above all - a cache-read share in the nineties, because that
is the finding the whole tool exists to surface. A sparse, tidy sample would
undersell it and teach the wrong intuition.

Deterministic: same seed, same file, so rebuilding it produces no diff noise.
Nothing here describes a real project or a real person.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import random

RATES = {                       # Wh per million tokens
    "claude-opus-4-5":   (50, 250),
    "claude-sonnet-4-5": (30, 150),
    "claude-haiku-4-5":  (10, 50),
}
MODEL_MIX = (["claude-sonnet-4-5"] * 11 + ["claude-opus-4-5"] * 6 +
             ["claude-haiku-4-5"] * 3)

PROJECTS = [
    ("Website Redesign",   22), ("Customer Research",  14),
    ("Data Pipeline",      18), ("Quarterly Report",    9),
    ("Docs Site",          12), ("Marketing Campaign", 11),
    ("Support Triage",      7), ("Budget Model",        5),
    ("Onboarding Flow",     8), ("Unsorted",            4),
]
WORK = [
    "refactored the API client", "drafted the launch brief",
    "debugged a failing test suite", "reviewed a pull request",
    "summarised user interviews", "built a chart from the export",
    "wrote migration notes", "traced a performance regression",
    "cleaned a messy CSV", "planned the sprint",
    "rewrote the onboarding copy", "checked the numbers in the deck",
]


def energy_wh(model, inp, out, cache_read, cache_write):
    i_rate, o_rate = RATES[model]
    return ((inp + cache_write) * i_rate / 1e6
            + cache_read * i_rate * 0.10 / 1e6
            + out * o_rate / 1e6)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=pathlib.Path,
                    default=pathlib.Path(__file__).resolve().parents[1] / "data" / "demo-log.json")
    ap.add_argument("--sessions", type=int, default=430)
    ap.add_argument("--days", type=int, default=152)
    ap.add_argument("--seed", type=int, default=20261116)
    args = ap.parse_args()

    rnd = random.Random(args.seed)
    end = dt.datetime(2026, 11, 10, 18, 0, 0)
    start = end - dt.timedelta(days=args.days)
    names = [p for p, w in PROJECTS for _ in range(w)]

    entries = []
    for n in range(args.sessions):
        # Weekday-weighted, working-hours-weighted timestamps.
        when = start + dt.timedelta(seconds=rnd.random() * args.days * 86400)
        if when.weekday() >= 5 and rnd.random() < 0.72:
            when += dt.timedelta(days=2)
        when = when.replace(hour=min(21, max(7, int(rnd.gauss(13, 3.2)))),
                            minute=rnd.randrange(60), second=rnd.randrange(60))
        if when > end:
            when = end - dt.timedelta(hours=rnd.randrange(400))

        model = rnd.choice(MODEL_MIX)
        # Long tail: most sessions are short, a few are very long.
        turns = max(1, int(rnd.lognormvariate(2.1, 0.95)))
        inp = int(turns * rnd.uniform(420, 1500))
        out = int(turns * rnd.uniform(280, 1400))
        cache_write = int(turns * rnd.uniform(900, 4200))
        # The headline finding: context is re-sent every turn, so cache reads
        # grow with the SQUARE of conversation length, not linearly.
        cache_read = int(turns * max(0, turns - 1) * rnd.uniform(2400, 6400))
        total = inp + out + cache_read + cache_write
        wh = energy_wh(model, inp, out, cache_read, cache_write)

        proj = rnd.choice(names)
        day = when.date().isoformat()
        key = "tr_" + hashlib.sha1(("demo-%d-%s" % (n, day)).encode()).hexdigest()[:16]
        entries.append({
            "timestamp": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "project": proj,
            "model": model,
            "energy_wh": round(wh, 4),
            "water_ml": round(wh * 1.7, 4),
            "total_tokens": total,
            "input_tokens": inp,
            "output_tokens": out,
            "cache_read_tokens": cache_read,
            "cache_write_tokens": cache_write,
            "context": "[transcript] %s - %s" % (proj, rnd.choice(WORK)),
            "import_key": key,
        })

    entries.sort(key=lambda e: e["timestamp"])
    args.out.write_text(json.dumps({"entries": entries}, indent=1) + "\n")

    wh = sum(e["energy_wh"] for e in entries)
    tok = sum(e["total_tokens"] for e in entries)
    cr = sum(e["cache_read_tokens"] for e in entries)
    print("wrote %s" % args.out)
    print("  %d sessions, %s -> %s" % (len(entries), entries[0]["timestamp"][:10],
                                       entries[-1]["timestamp"][:10]))
    print("  %.1f kWh, %.1f L water, %.2fB tokens, cache read %.1f%%"
          % (wh / 1000, wh * 1.7 / 1000, tok / 1e9, 100.0 * cr / tok))
    print("  projects: %d" % len({e["project"] for e in entries}))


if __name__ == "__main__":
    main()
