#!/usr/bin/env python3
"""
Build data/regional.json: the regional Pokédex lists (as national numbers, in regional order).
Data comes from PokéAPI (free, no key). Only the standard library is needed.

    python3 build_regional.py

Shares the .cache/pokeapi cache with build_locations.py.
"""
import json, os, re, time, urllib.request

API = "https://pokeapi.co/api/v2"
MAX = 493
DEXES = ["kanto", "original-johto", "updated-johto", "hoenn", "original-sinnoh", "extended-sinnoh"]
CACHE = os.path.join(".cache", "pokeapi")

def get(path):
    os.makedirs(CACHE, exist_ok=True)
    url = f"{API}/{path}"
    fn = os.path.join(CACHE, re.sub(r"[^a-z0-9]+", "_", url.lower()).strip("_") + ".json")
    if os.path.exists(fn):
        with open(fn, encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": "pokedex-tracker-build/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    with open(fn, "w", encoding="utf-8") as f:
        json.dump(data, f)
    time.sleep(0.1)
    return data

out = {}
for name in DEXES:
    entries = sorted(get(f"pokedex/{name}")["pokemon_entries"], key=lambda e: e["entry_number"])
    ids = [int(re.search(r"/pokemon-species/(\d+)/?", e["pokemon_species"]["url"]).group(1)) for e in entries]
    out[name] = [i for i in ids if i <= MAX]
    print(f"  {name:<18} {len(out[name])} Pokémon")

os.makedirs("data", exist_ok=True)
with open(os.path.join("data", "regional.json"), "w", encoding="utf-8") as f:
    json.dump({"version": 1, "dex": out}, f, separators=(",", ":"))
print("Wrote data/regional.json")
