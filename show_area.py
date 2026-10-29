#!/usr/bin/env python3
"""
show_area.py - print what PokéAPI says lives in an area, so you can compare it with Bulbapedia by eye.

    python3 show_area.py "Unknown Area 78" --games black-2,white-2
    python3 show_area.py "Castelia Sewers" --games black-2,white-2     # every area whose name contains the text

Reads data/locations.json and data/pokemon.json. Prints one block per game and area: Pokémon, method, levels, rate, condition.
"""
import argparse
import json
import os

ap = argparse.ArgumentParser()
ap.add_argument("text", help="part of the area name (case-insensitive)")
ap.add_argument("--games", default="black,white,black-2,white-2")
ap.add_argument("--locations", default=os.path.join("data", "locations.json"))
ap.add_argument("--pokemon", default=os.path.join("data", "pokemon.json"))
a = ap.parse_args()
names = {m["n"]: m["name"] for m in json.load(open(a.pokemon, encoding="utf-8"))}
loc = json.load(open(a.locations, encoding="utf-8"))["loc"]
for g in (x.strip() for x in a.games.split(",")):
    areas = {}
    for n, rows in loc.get(g, {}).items():
        for area, method, lo, hi, chance, cond in rows:
            if a.text.lower() in area.lower():
                areas.setdefault(area, []).append((int(n), method, lo, hi, chance, cond))
    for area, rows in sorted(areas.items()):
        print(f"\n[{g}] {area}  ({len(rows)} rows)")
        for n, m, lo, hi, c, cond in sorted(rows, key=lambda r: (r[1], r[0])):
            lv = f"{lo}" if lo == hi else f"{lo}-{hi}"
            print(f"   {names.get(n, '#' + str(n)):<14} {m:<16} Lv {lv:<7} {c:>3}%  {cond}")
