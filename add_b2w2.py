#!/usr/bin/env python3
"""
add_b2w2.py - adds the Unova 2 map (Black 2 / White 2) to the Pokedex Tracker.

Run from the project folder (the one that contains data/ and css/):

    python3 add_b2w2.py

What it does (safe to run more than once, backups are written as *.bak):
  * data/maps.json : adds map "unova-b2w2" (same flashing Unova style as Black / White), the ~88 route / town /
                     cave boxes, and links it to the games black-2 and white-2.
  * css/style.css  : lets the "Area Unknown" banner of the new map use smooth scaling like Black / White.
  * data/locations.json (if present): lists any B2W2 location names that still have no box.

You must also save the map picture (see README-B2W2.txt) to  assets/maps/unova-b2w2.png
"""
import json, os, re, shutil, struct, sys

MAP = "unova-b2w2"
AREAS = json.loads(r'''{"Nuvema Town":[["e",226,152,12,12]],"Accumula Town":[["e",226,132,12,12]],"Striaton City":[["e",222,112,12,12]],"Nacrene City":[["e",197,112,11,12]],"Castelia City":[["e",125,124,13,12]],"Nimbasa City":[["e",125,85,13,12]],"Driftveil City":[["e",68,85,12,12]],"Mistralton City":[["e",34,61,12,12]],"Icirrus City":[["e",68,37,12,12]],"Opelucid City":[["e",125,37,13,12]],"Lacunosa Town":[["e",183,37,13,12]],"Undella Town":[["e",218,61,12,12]],"Black Tower":[["p",196.0,85.1,196.0,97.0,183.4,97.0]],"White Treehollow":[["p",183.4,85.1,196.0,85.1,183.4,97.0]],"Humilau City":[["e",229,30,12,12]],"Lentimas Town":[["e",181,61,12,12]],"Aspertia City":[["e",8,147,12,12]],"Floccesy Town":[["e",26,121,13,12]],"Virbank City":[["e",63,121,12,12]],"Unova Victory Road":[["e",179,12,8,8]],"Ns Castle":[["e",179,3,6,6]],"Pokémon League":[["e",164,9,12,11]],"Unity Tower":[["e",94,153,9,8]],"Liberty Garden":[["e",71,142,6,6]],"Relic Castle":[["e",112,101,5,6]],"PWT":[["e",73,99,7,8]],"Chargestone Cave":[["e",39,77,6,5]],"Mistralton Cave":[["e",61,68,6,6]],"Anville Town":[["e",4,26,6,7]],"Celestial Tower":[["e",51,47,6,6]],"Twist Mountain":[["e",69,51,6,7]],"Dragonspiral Tower":[["e",63,28,6,6]],"Moor of Icirrus":[["e",84,33,6,6]],"Challenger's Cave":[["e",113,46,6,5]],"Entralink":[["e",129,64,6,6]],"Lostlorn Forest":[["e",143,80,5,7]],"Poké Transfer Lab":[["e",174,80,5,7]],"Abundant Shrine":[["e",194,74,6,6]],"Giant Chasm":[["e",205,33,5,6]],"Wellspring Cave":[["e",212,107,6,6]],"Pinwheel Forest":[["e",191,122,6,6]],"P2 Laboratory":[["e",210,148,6,6]],"Plasma Frigate":[["e",218,148,7,6]],"Dreamyard":[["e",236,115,5,6]],"Join Avenue":[["e",128,100,8,8]],"Reversal Mountain":[["p",192.7,66.0,202.6,66.0,202.6,64.0,208.5,64.0,208.5,66.0,217.7,66.0,217.7,68.0,208.5,68.0,208.5,69.9,202.6,69.9,202.6,68.0,192.7,68.0]],"Strange House":[["e",195,56,6,6]],"Undella Bay":[["p",229.6,62.7,229.6,60.7,228.9,60.7,233.6,56.1,236.9,56.1]],"Seaside Cave":[["e",232,49,6,7]],"Marine Tube":[["p",240.8,35.0,240.8,36.9,243.5,38.9,249.4,38.9,250.7,39.6,250.7,66.6,249.4,68.0,234.9,68.0,232.9,66.0,229.6,66.0,229.6,68.0,231.6,68.0,233.6,69.9,250.7,69.9,252.7,68.0,252.7,38.9,250.7,36.9,244.8,36.9,242.8,35.0]],"Relic Passage":[["e",102,115,6,6]],"Clay Tunnel":[["e",69,74,6,6]],"Castelia Sewers":[["e",152,140,6,6]],"Pokéstar Studios":[["e",59,111,9,8]],"Virbank Complex":[["e",61,135,6,6]],"Cave of Being":[["e",38,135,6,6]],"Floccesy Ranch":[["e",38,115,6,6]],"Abyssal Ruins":[["e",239,60,6,6]],"Unova Route 1":[[231,144,2,8]],"Unova Route 2":[["p",229.6,132.0,231.6,132.0,230.9,124.0,228.9,124.0]],"Unova Route 3":[[208,117,14,2]],"Unova Route 4":[[131,97,2,27]],"Unova Route 5":[[113,90,12,2]],"Unova Route 6":[["p",45.5,69.9,45.5,72.6,68.0,87.8,68.0,85.1]],"Unova Route 7":[["p",45.5,64.0,45.5,60.7,68.0,44.9,68.0,47.5]],"Unova Route 8":[[80,42,14,2]],"Unova Route 9":[[113,42,12,2]],"Unova Route 11":[[138,42,12,2]],"Unova Route 12":[[171,42,12,2]],"Unova Route 13":[["p",196.0,45.5,196.0,48.8,217.7,64.0,217.7,60.7]],"Unova Route 14":[["p",217.7,69.9,217.7,72.6,196.0,87.8,196.0,85.1]],"Unova Route 15":[[170,90,13,2]],"Unova Route 16":[[138,90,12,2]],"Unova Route 17":[[210,157,16,2]],"Unova Route 18":[[202,157,8,2]],"Unova Route 19":[["p",12.5,147.1,14.5,147.1,14.5,132.6,26.4,128.7,26.4,126.0,12.5,130.6]],"Unova Route 20":[[39,126,24,2]],"Unova Route 21":[[234,42,2,7]],"Unova Route 22":[[210,35,19,2]],"Unova Route 23":[["p",187.4,14.5,194.6,14.5,196.6,16.5,196.6,33.6,197.9,35.0,204.5,35.0,204.5,36.9,196.6,36.9,194.6,35.0,194.6,17.8,194.0,16.5,187.4,16.5]],"Skyarrow Bridge":[["p",196.6,116.8,196.6,118.8,186.7,118.8,171.5,122.7,171.5,120.7,149.8,124.7,148.5,128.0,137.9,130.0,137.9,128.0,146.5,126.0,147.8,122.7,173.5,118.1,173.5,120.1,185.4,116.8]],"Desert Resort":[[117,103,11,2]],"Driftveil Drawbridge":[["p",113.5,91.7,113.5,89.1,112.8,87.8,94.4,87.8,93.7,89.7,79.8,89.7,79.8,91.7,94.4,91.7,95.7,89.7,111.5,89.7]],"Tubeline Bridge":[["p",93.7,40.9,93.7,43.5,95.7,41.6,110.8,41.6,113.5,43.5,113.5,40.9,111.5,39.6,94.4,39.6]],"Village Bridge":[["p",149.8,43.5,149.8,41.6,151.8,39.6,167.6,39.6,170.9,41.6,170.9,43.5,167.6,41.6,151.8,41.6]],"Marvelous Bridge":[["p",149.8,91.7,151.8,89.7,167.6,89.7,169.6,91.7,169.6,89.7,167.6,87.8,151.8,87.8,149.8,89.7]],"Nature Preserve":[["p",167.6,159.0,167.6,161.6,170.9,161.0,175.5,153.1,184.7,151.8,187.4,143.8,180.8,137.9,174.8,137.9,175.5,141.9,182.8,145.2,181.4,147.8,173.5,149.1]],"Victory Road":[["e",179,12,8,8]]}''')
# extra spellings that PokeAPI uses for B2W2 places, sharing the same boxes
ALIASES = {
    "Castelia Sewers": ["Castelia Sewers Unknown Area 38"],
    "Relic Passage": ["Relic Passage Entrance", "Relic Passage Castelia Sewers Entrance"],
    "Virbank Complex": ["Virbank Complex Inside", "Virbank Complex Outside"],
    "PWT": ["Pokemon World Tournament", "Pokémon World Tournament"],
    "Pokestar Studios": ["Pokéstar Studios"],
    "Marine Tube": ["Marine Tube Entrance"],
    "Black Tower": ["Black Tower Entrance", "Black Tower Inside"],
    "White Treehollow": ["White Treehollow Entrance", "White Treehollow Inside"],
    "Unova Victory Road": ["Unova Victory Road 1F", "Unova Victory Road 2F", "Unova Victory Road 3F",
                           "Unova Victory Road 4F", "Unova Victory Road 5F", "Unova Victory Road 6F", "Unova Victory Road 7F"],
    "Victory Road": [],
    "Nature Preserve": ["Nature Preserve Entrance"],
    "Reversal Mountain": ["Reversal Mountain Interior", "Reversal Mountain Outside", "Reversal Mountain Peak"],
    "Challenger's Cave": ["Challengers Cave", "Challengers Cave 1F", "Challengers Cave B1F", "Challengers Cave B2F"],
    "Chargestone Cave": ["Chargestone Cave 1F", "Chargestone Cave B1F", "Chargestone Cave B2F"],
    "Clay Tunnel": ["Clay Tunnel 1F", "Clay Tunnel B1F"],
    "Twist Mountain": ["Twist Mountain B1F 3F", "Twist Mountain B4F", "Twist Mountain 1F"],
    "Dragonspiral Tower": ["Dragonspiral Tower 1F", "Dragonspiral Tower 2F", "Dragonspiral Tower 7F",
                           "Dragonspiral Tower Entrance", "Dragonspiral Tower Outside"],
    "Celestial Tower": ["Celestial Tower 2F", "Celestial Tower 3F", "Celestial Tower 4F", "Celestial Tower 5F"],
    "Relic Castle": ["Relic Castle A", "Relic Castle B", "Relic Castle C", "Relic Castle D"],
    "Giant Chasm": ["Giant Chasm Forest", "Giant Chasm Forest Cave", "Giant Chasm Hidden Grotto", "Giant Chasm Outside"],
    "Pinwheel Forest": ["Pinwheel Forest Inside", "Pinwheel Forest Outside", "Pinwheel Forest Hidden Grotto Inner",
                        "Pinwheel Forest Hidden Grotto Outer", "Pinwheel Forest Rumination Field"],
    "Lostlorn Forest": ["Lostlorn Forest Hidden Grotto"],
    "Abundant Shrine": ["Abundant Shrine Hidden Grotto Near Youngster", "Abundant Shrine Hidden Grotto Shrine"],
    "Liberty Garden": ["Liberty Garden Lighthouse Basement"],
    "Dreamyard": ["Dreamyard B1F"],
    "Desert Resort": ["Desert Resort Entrance"],
    "Floccesy Ranch": ["Floccesy Ranch Inside"],
    "Wellspring Cave": ["Wellspring Cave Inside"],
    "Seaside Cave": ["Seaside Cave 1F", "Seaside Cave B1F"],
    "Abyssal Ruins": ["Abyssal Ruins 1F", "Abyssal Ruins B1F"],
    "Cave of Being": ["Cave of Being Inside"],
    "Strange House": ["Strange House Inside"],
}
BANNER = {"img": "assets/maps/area-unknown-bw.png", "x": 64.6, "y": 73.5, "w": 126.8, "h": 28.1}


def png_size(path):
    try:
        with open(path, "rb") as f:
            b = f.read(24)
        return struct.unpack(">II", b[16:24]) if b[:8] == b"\x89PNG\r\n\x1a\n" else None
    except OSError:
        return None


def backup(p):
    if not os.path.exists(p + ".bak"):
        shutil.copyfile(p, p + ".bak")


# ---- maps.json ----
MJ = os.path.join("data", "maps.json")
if not os.path.isfile(MJ):
    sys.exit("Run this from the project folder (data/maps.json not found here).")
db = json.load(open(MJ, encoding="utf-8"))
sz = png_size(os.path.join("assets", "maps", MAP + ".png"))
if sz:
    w, h = sz
    print(f"  map picture found: {w}x{h}")
else:
    w, h = 256, 168
    print("  ! assets/maps/unova-b2w2.png not found yet - assuming 256x168 (same as Black / White). Save the picture, then run again.")
prev = db["maps"].get(MAP, {})
db["maps"][MAP] = {"name": "Unova", "img": "assets/maps/unova-b2w2.png", "w": w, "h": h, "grid": 8, "flash": True,
                   "fx": "unova", "unknown": prev.get("unknown", BANNER), "variant": "Black 2 / White 2"}
for g in ("black-2", "white-2"):
    lst = db.setdefault("games", {}).setdefault(g, [])
    if MAP not in lst:
        lst.append(MAP)
table = {k: [list(r) for r in v] for k, v in AREAS.items()}
for name, alts in ALIASES.items():
    if name in table:
        for a in alts:
            table.setdefault(a, [list(r) for r in table[name]])
db.setdefault("areas", {})[MAP] = table
backup(MJ)
json.dump(db, open(MJ, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"data/maps.json: map {MAP} with {len(table)} place names, linked to black-2 and white-2")

# ---- style.css ----
for CSS in (os.path.join("css", "style.css"), "style.css"):
    if os.path.isfile(CSS):
        s = open(CSS, encoding="utf-8").read()
        old = ".amap[data-map=unova-bw] .amapimg .unk{image-rendering:auto}"
        new = ".amap[data-map=unova-bw] .amapimg .unk,.amap[data-map=unova-b2w2] .amapimg .unk{image-rendering:auto}"
        if "unova-b2w2" in s:
            print(f"{CSS}: already updated")
        elif old in s:
            backup(CSS)
            open(CSS, "w", encoding="utf-8").write(s.replace(old, new))
            print(f"{CSS}: Area Unknown smoothing added for the new map")
        else:
            print(f"{CSS}: expected rule not found - edit by hand (see README-B2W2.txt)")
        break

# ---- check against locations.json ----
LJ = os.path.join("data", "locations.json")
if os.path.isfile(LJ):
    FLOOR = re.compile(r"^b?\d+[fr]$", re.I)
    WORDS = {"north", "south", "east", "west", "area", "entrance", "exterior", "outside"}
    def key(a):
        w = re.split(r"\s+towards\s+", a, flags=re.I)[0].split()
        while len(w) > 1 and (FLOOR.match(w[-1]) or w[-1].lower() in WORDS):
            w.pop()
        return " ".join(w)
    locs = json.load(open(LJ, encoding="utf-8"))["loc"]
    miss = {}
    for g in ("black-2", "white-2"):
        for rows in locs.get(g, {}).values():
            for r in rows:
                if r[0] not in table and key(r[0]) not in table:
                    miss[key(r[0])] = miss.get(key(r[0]), 0) + 1
    print(f"check: {len(miss)} B2W2 location name(s) have no box" + (":" if miss else " - all covered"))
    for k, c in sorted(miss.items(), key=lambda t: -t[1]):
        print(f"  {c:4d} rows  {k!r}")
print("Done.")
