#!/usr/bin/env python3
"""
add_shiny_notes.py - adds "(shiny locked)" to the notes in data/orre.json for every Pokemon that is listed in
"shinyLocked" for that game in data/games.config.json (Colosseum and XD).

    python3 add_shiny_notes.py

Run it after build_orre.py (which rewrites orre.json). Safe to run more than once.
"""
import json, os

cfg = json.load(open(os.path.join("data", "games.config.json"), encoding="utf-8"))
path = os.path.join("data", "orre.json")
orre = json.load(open(path, encoding="utf-8"))
tag = "shiny locked"
changed = 0
for g in cfg["games"]:
    locked = set(g.get("shinyLocked", []))
    rows = orre["loc"].get(g["key"])
    if not locked or rows is None:
        continue
    for n, lst in rows.items():
        if int(n) not in locked:
            continue
        for r in lst:                       # [area, method, lo, hi, chance, note]
            if tag in r[5].lower():
                continue
            r[5] = f"{r[5]} (shiny locked)" if r[5] else "Shiny locked"
            changed += 1
with open(path, "w", encoding="utf-8") as f:
    json.dump(orre, f, ensure_ascii=False, separators=(",", ":"))
print(f"added the shiny locked note to {changed} rows in {path}")
