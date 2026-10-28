#!/usr/bin/env python3
"""
rename_unova_areas.py - replace PokeAPI's "Unknown Area NN" names with Bulbapedia's names, in
data/locations.json and data/maps.json. Run from the project folder (the one containing data/).

    python3 rename_unova_areas.py --list       # show every "Unknown" name still in the data (nothing is changed)
    python3 rename_unova_areas.py --dry-run    # show what would change
    python3 rename_unova_areas.py              # apply (writes .bak copies first)

Safe to run again, and run it again after every build_locations.py run (that script writes the PokeAPI names back).

WHY THESE NAMES
PokeAPI numbers the rooms of Victory Road (Black / White) 53-66 with no floor information. Bulbapedia lists the encounters in
four groups, because rooms in a group have the same Pokemon at the same rates:
    1F (middle and rightmost room)             <- Unknown Area 53, 58
    1F (leftmost room), 2F-3F                  <- Unknown Area 54, 55, 57, 59, 60, 61
    4F (middle room)                           <- already named by PokeAPI ("4F Middle Room")
    4F (leftmost and rightmost room), 5F-7F    <- Unknown Area 56, 62, 63, 64, 65, 66
I matched each number to a group by comparing its Pokemon, levels and rates with Bulbapedia's tables. The numbers inside one
group cannot be told apart (same data), so every number in a group gets the group's name, and their encounters are merged
(levels widened, the rate is the highest of the copies, NOT the sum, since each copy describes the same table).
"""
import argparse, json, os, shutil, sys

G_1F_MID_RIGHT = "Unova Victory Road 1F Middle and Rightmost Rooms"
G_1F_LEFT_3F = "Unova Victory Road 1F Leftmost Room and 2F-3F"
G_4F_OUTER_7F = "Unova Victory Road 4F Leftmost and Rightmost Rooms and 5F-7F"

# old name -> Bulbapedia name. Add more lines here (for example the Black 2 / White 2 rooms) and run again.
RENAMES = {f"Unova Victory Road Unknown Area {n}": G_1F_MID_RIGHT for n in (53, 58)}
RENAMES.update({f"Unova Victory Road Unknown Area {n}": G_1F_LEFT_3F for n in (54, 55, 57, 59, 60, 61)})
RENAMES.update({f"Unova Victory Road Unknown Area {n}": G_4F_OUTER_7F for n in (56, 62, 63, 64, 65, 66)})

MAP_FALLBACK = "Unova Victory Road"      # a new name with no box of its own borrows this place's box (same mountain)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, data, **kw):
    shutil.copyfile(path, path + ".bak")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, **kw)


def collapse(rows):
    """rows of [area, method, lo, hi, chance, cond]: rows that now share (area, method, cond) become one."""
    out = {}
    for area, method, lo, hi, chance, cond in rows:
        k = (area, method, cond)
        if k in out:
            o = out[k]
            o[2], o[3], o[4] = min(o[2], lo), max(o[3], hi), max(o[4], chance)
        else:
            out[k] = [area, method, lo, hi, chance, cond]
    return [out[k] for k in sorted(out)]


def fix_locations(db, dry):
    changed = 0
    for game, mons in db["loc"].items():
        for n, rows in mons.items():
            if not any(r[0] in RENAMES for r in rows):
                continue
            new = collapse([[RENAMES.get(r[0], r[0])] + r[1:] for r in rows])
            changed += 1
            if not dry:
                mons[n] = new
    return changed


RENAME_GAMES = {}        # new name -> game keys it applies to (filled from --renames); the built-in ones are Black / White


def fix_maps(db, dry):
    notes = []
    for new in RENAMES.values():
        RENAME_GAMES.setdefault(new, ["black", "white"])
    for mid, table in db.get("areas", {}).items():
        for old, new in RENAMES.items():
            if old in table:
                boxes = table.pop(old)
                if new not in table:
                    table[new] = boxes
                notes.append(f"{mid}: '{old}' -> '{new}'")
        # a renamed place that had no box (Unknown Area 56 and 58 were never drawn) borrows the Victory Road box,
        # on the maps of the games it belongs to
        if MAP_FALLBACK in table:
            for new in set(RENAMES.values()):
                if new not in table and any(mid in db.get("games", {}).get(g, []) for g in RENAME_GAMES.get(new, [])):
                    table[new] = [list(b) for b in table[MAP_FALLBACK]]
                    notes.append(f"{mid}: added '{new}' (box of '{MAP_FALLBACK}')")
    return notes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--locations", default=os.path.join("data", "locations.json"))
    ap.add_argument("--maps", default=os.path.join("data", "maps.json"))
    ap.add_argument("--renames", help="JSON from match_unknown_areas.py --write (adds its renames to the built-in ones)")
    ap.add_argument("--list", action="store_true", help="list names containing 'Unknown' and stop")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.renames:
        extra = load(a.renames)
        RENAMES.update(extra.get("renames", {}))
        RENAME_GAMES.update(extra.get("games", {}))
        print(f"{a.renames}: {len(extra.get('renames', {}))} rename(s) added" +
              (f", {len(extra['ambiguous'])} tie(s) left for you to decide" if extra.get("ambiguous") else ""))
    loc = load(a.locations) if os.path.exists(a.locations) else None
    maps = load(a.maps)

    if a.list:
        names = {}
        if loc:
            for game, mons in loc["loc"].items():
                for rows in mons.values():
                    for r in rows:
                        if "unknown" in r[0].lower():
                            names.setdefault(r[0], set()).add(game)
        for mid, table in maps.get("areas", {}).items():
            for p in table:
                if "unknown" in p.lower():
                    names.setdefault(p, set()).add("maps:" + mid)
        for n, where in sorted(names.items()):
            print(f"{'(will rename)' if n in RENAMES else '(NOT in RENAMES)':<18} {n}   [{', '.join(sorted(where))}]")
        return

    if loc:
        print(f"locations.json: {fix_locations(loc, a.dry_run)} Pokemon entries use a renamed area")
    else:
        print(f"{a.locations} not found: only maps.json will be changed")
    for line in fix_maps(maps, a.dry_run):
        print("  maps.json", line)
    if a.dry_run:
        return print("Dry run - nothing written.")
    if loc:
        save(a.locations, loc, separators=(",", ":"))
    save(a.maps, maps, indent=1)
    print("Done (backups: *.bak)")


if __name__ == "__main__":
    main()
