#!/usr/bin/env python3
"""
audit_maps.py - compares data/locations.json with data/maps.json. Offline, reads only, changes nothing.
Run from the project folder (the one containing data/).

    python3 audit_maps.py                    # every game
    python3 audit_maps.py --game black-2     # one game
    python3 audit_maps.py --unknown          # only the "Unknown" names

Per game it reports:
  NO BOX    location names that have no box on any of the game's maps (the site can't draw or outline them).
            Uses the same lookup as js/maps.js: the exact name, then the name without floors / compass words / "towards ...".
  UNKNOWN   names that still look like PokeAPI placeholders ("Unknown Area 53", "Unknown Room").
  UNUSED    per map: boxes whose name no location row of that map's games uses (leftovers, wrong-map entries, typos).
            Spelling aliases that share a box are listed too; only look at the ones whose name looks wrong.
Names that are meant to have no box (Roaming ..., Honey Trees, Pokewalker and similar) are skipped.
"""
import argparse, json, os, re
from collections import Counter

FLOOR = re.compile(r"^b?\d+[fr]$", re.I)
WORDS = {"north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
         "ne", "nw", "se", "sw", "area", "entrance", "exterior", "outside"}
SKIP = re.compile(r"^(roaming|honey tree)", re.I)
UNKNOWN = re.compile(r"unknown|\bunk\b", re.I)


def place_key(area):                                   # same rule as Maps.placeKey in js/maps.js
    w = re.split(r"\s+towards\s+", str(area), flags=re.I)[0].strip().split()
    while len(w) > 1 and (FLOOR.match(w[-1]) or w[-1].lower() in WORDS):
        w.pop()
    return " ".join(w)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--locations", default=os.path.join("data", "locations.json"))
    ap.add_argument("--maps", default=os.path.join("data", "maps.json"))
    ap.add_argument("--game", help="only this game key, e.g. black-2")
    ap.add_argument("--unknown", action="store_true", help="only report UNKNOWN names")
    a = ap.parse_args()
    loc = json.load(open(a.locations, encoding="utf-8"))["loc"]
    db = json.load(open(a.maps, encoding="utf-8"))
    maps, games, areas = db["maps"], db["games"], db.get("areas", {})

    def table(mid):                                    # a map's boxes: its own, or those of the map it shares them with ("areasOf")
        return areas.get((maps[mid] or {}).get("areasOf") or mid, {})

    used = {mid: set() for mid in maps}                # names (and place keys) that location rows of this map's games use
    total = {"nobox": 0, "unknown": 0, "unused": 0}
    for g in loc:                                      # first pass over ALL games, so --game never makes a shared map look unused
        for lst in loc[g].values():
            for r in lst:
                for mid in games.get(g, []):
                    used[mid].update({r[0], place_key(r[0])})
    for g in sorted(loc):
        if a.game and g != a.game:
            continue
        mids = games.get(g, [])
        rows = Counter()                               # area name -> number of encounter rows
        for lst in loc[g].values():
            for r in lst:
                rows[r[0]] += 1
        print(f"\n== {g}   maps: {', '.join(mids) or 'NONE'}   ({len(rows)} area names)")
        if not mids:
            print("   no map is assigned to this game in maps.json")
        unk = sorted(n for n in rows if UNKNOWN.search(n))
        for n in unk:
            print(f"   UNKNOWN  {n}   ({rows[n]} rows)")
        total["unknown"] += len(unk)
        if a.unknown:
            continue
        miss = []
        for n in sorted(rows):
            if SKIP.match(n) or not mids:
                continue
            if not any(n in table(m) or place_key(n) in table(m) for m in mids):
                miss.append(n)
        for n in miss:
            print(f"   NO BOX   {n}   ({rows[n]} rows){'   [also UNKNOWN]' if UNKNOWN.search(n) else ''}")
        total["nobox"] += len(miss)

    if not a.unknown:
        for mid in maps:
            if a.game and a.game not in [g for g, ids in games.items() if mid in ids]:
                continue
            leftovers = sorted(p for p in table(mid) if p not in used[mid] and not SKIP.match(p) and not p.startswith("Honey Tree"))
            if (maps[mid] or {}).get("areasOf"):
                continue                               # its boxes are reported under the map that owns them
            print(f"\n== map {mid}: {len(leftovers)} UNUSED box name(s) (no location row of its games uses them)")
            for p in leftovers:
                print(f"   UNUSED   {p}")
            total["unused"] += len(leftovers)
    print(f"\nTotals: {total['nobox']} no box, {total['unknown']} unknown, {total['unused']} unused")


if __name__ == "__main__":
    main()
