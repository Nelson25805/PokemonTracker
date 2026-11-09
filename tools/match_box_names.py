#!/usr/bin/env python3
"""
match_box_names.py - line up the names of your drawn Unova map boxes with the area names PokéAPI gave
data/locations.json, so "Where to find" rows and map boxes connect again. Your box coordinates are never touched,
only the names (keys) they are filed under.

    python3 match_box_names.py                 # report + write data/box-renames.json (a file you can edit)
    python3 match_box_names.py --apply         # rename the box keys in data/maps.json using that file

Run it after: python3 build_locations.py --games black,white,black-2,white-2

Report sections (per map):
  OK          box name already equals a PokéAPI area name
  SUGGESTED   box name is close to exactly one PokéAPI name (written to box-renames.json, check them!)
  NO MATCH    box has no counterpart (maybe an old/wrong name: edit box-renames.json by hand)
  NO BOX      PokéAPI area has encounters but no box (draw one, or add an alias)
  PLACEHOLDER PokéAPI still calls the area "Unknown Area NN" (PokéAPI has no real name for it)

box-renames.json format:  { "<map id>": { "<current box name>": "<name to use>" } }
Delete a line to skip it, or change the right-hand side. A rename that would collide with an existing box is refused.
--apply makes data/maps.json.pre-rename.bak first.
"""
import argparse
import difflib
import json
import os
import re
import shutil

MAPGAMES = {"unova-bw": ["black", "white"], "unova-b2w2": ["black-2", "white-2"]}


def norm(s):
    s = s.lower().replace("unova ", "").replace("&", "and")
    s = re.sub(r"\b(area|the)\b", " ", s)
    s = re.sub(r"\binside\b", "inner", s)
    s = re.sub(r"\boutside\b", "outer", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def marks(n):
    """Floor / number tokens (1f, b2f, 53, 7f ...). Two names with different marks are different places."""
    return sorted(re.findall(r"\b(?:b?\d+f?)\b", n))


def box_keys(areas):
    return [k for k in areas if not k.startswith("_")]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", default="data")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--cutoff", type=float, default=0.9, help="similarity needed for a suggestion (0-1)")
    a = ap.parse_args()
    loc_p, map_p, ren_p = (os.path.join(a.data, f) for f in ("locations.json", "maps.json", "box-renames.json"))
    with open(map_p, encoding="utf-8") as f:
        maps = json.load(f)

    if a.apply:
        with open(ren_p, encoding="utf-8") as f:
            ren = json.load(f)
        shutil.copy2(map_p, map_p.replace(".json", ".json.pre-rename.bak"))
        n = 0
        for mid, table in ren.items():
            areas = maps["areas"].get(mid, {})
            for old, new in table.items():
                if old not in areas or old == new or not new:
                    continue
                if new in areas:
                    print(f"  skipped {mid}: '{old}' -> '{new}' (a box named '{new}' already exists)")
                    continue
                areas[new] = areas.pop(old)
                n += 1
        with open(map_p, "w", encoding="utf-8") as f:
            json.dump(maps, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Renamed {n} box(es) in {map_p}. Now run: python3 audit_maps.py")
        return

    with open(loc_p, encoding="utf-8") as f:
        loc = json.load(f)["loc"]
    out = {}
    for mid, games in MAPGAMES.items():
        api = {}                                    # PokéAPI area -> number of Pokémon found there
        for g in games:
            for mons in loc.get(g, {}).values():
                for row in mons:
                    api[row[0]] = api.get(row[0], 0) + 1
        boxes = box_keys(maps["areas"].get(mid, {}))
        placeholder = sorted(x for x in api if re.search(r"unknown area \d+", x.lower()))
        real = [x for x in api if x not in placeholder]
        byn = {}
        for x in real:
            byn.setdefault(norm(x), []).append(x)
        used, ok, sug, nomatch = set(), [], {}, []
        for b in boxes:
            if b in api:
                ok.append(b); used.add(b)
        for b in boxes:
            if b in api:
                continue
            if norm(b) in byn and len(byn[norm(b)]) == 1 and byn[norm(b)][0] not in boxes:
                sug[b] = byn[norm(b)][0]; used.add(sug[b]); continue
            close = [c for c in difflib.get_close_matches(norm(b), list(byn), n=2, cutoff=a.cutoff) if marks(c) == marks(norm(b))]
            if len(close) == 1 and len(byn[close[0]]) == 1:
                sug[b] = byn[close[0]][0]; used.add(sug[b])
            else:
                nomatch.append(b)
        targets = {}
        for b, v in sug.items():
            targets.setdefault(v, []).append(b)
        for v, bs in targets.items():             # two boxes can't both be the same area: don't guess which
            if len(bs) > 1:
                for b in bs:
                    del sug[b]; nomatch.append(b)
                used.discard(v)
        nobox = sorted(x for x in real if x not in used and x not in boxes)
        print(f"\n=== {mid} ({', '.join(games)}): {len(boxes)} boxes, {len(api)} PokéAPI areas ===")
        print(f"OK: {len(ok)}")
        print(f"SUGGESTED ({len(sug)}):")
        for k, v in sorted(sug.items()):
            print(f"   {k!r:46} -> {v!r}")
        print(f"NO MATCH ({len(nomatch)}):", *[f"\n   {b}" for b in sorted(nomatch)])
        print(f"NO BOX ({len(nobox)}):", *[f"\n   {x}  ({api[x]} Pokémon)" for x in nobox])
        print(f"PLACEHOLDER ({len(placeholder)}):", *[f"\n   {x}  ({api[x]} Pokémon)" for x in placeholder])
        out[mid] = {**sug, **{b: "" for b in sorted(nomatch)}}
    with open(ren_p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\nWrote {ren_p}. Fill in the empty \"\" ones you know (or delete those lines), then run with --apply.")


if __name__ == "__main__":
    main()