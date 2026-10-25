#!/usr/bin/env python3
"""
unova_style.py - gives the Unova (Black / White) map the in-game flashing and the "Area Unknown" banner.

    python3 unova_style.py

Run from the project folder. It edits data/maps.json (backup: maps.json.bak): on map "unova-bw" it sets "fx": "unova" (the
measured flashing, see css/style.css) and "unknown" (assets/maps/area-unknown-bw.png, placed over the map like the game does).
Nothing else in maps.json is touched, so it is safe to run more than once.
"""
import json, os, shutil, sys

PATH = os.path.join("data", "maps.json")
db = json.load(open(PATH, encoding="utf-8"))
m = db.get("maps", {}).get("unova-bw")
if not m:
    sys.exit('No map "unova-bw" in data/maps.json yet. Run the add_areas.py command first.')
shutil.copyfile(PATH, PATH + ".bak")
m["fx"] = "unova"
m["unknown"] = {"img": "assets/maps/area-unknown-bw.png", "x": 64.6, "y": 73.5, "w": 126.8, "h": 28.1}
json.dump(db, open(PATH, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("unova-bw: flashing style and Area Unknown banner set (backup: data/maps.json.bak)")
