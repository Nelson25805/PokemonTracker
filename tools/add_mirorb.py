#!/usr/bin/env python3
"""
add_mirorb.py - adds Miror B.'s 2nd Chances (Pokemon XD) to the tracker.

Run ONCE from the project folder (the one that contains data/ and js/):

    python3 add_mirorb.py

It edits three files (a .bak copy of each is made first) and then rebuilds data/orre.json:
  1. build_orre.py                    new MIRORB table; its rows are added to the XD "Where to find" data
  2. js/where.js                      friendly label for the new "mirorb" method + the "static" colour chip
  3. data/special-encounters.json     the "how Miror B.'s 2nd chances work" explanation row
Running it twice does nothing the second time. Source: Serebii.net (xd/mirorb.shtml).
"""
import json, os, shutil, subprocess, sys

# national number: level of the Pokemon when Miror B. battles you with it (Serebii list).
# Voltorb, Nosepass and Dragonite are left out: they are Miror B.'s own Shadow Pokemon and already have a normal snag row.
LIST = ("167:14 322:14 285:15 318:15 301:18 296:18 37:18 355:19 280:20 303:22 361:20 204:20 177:22 315:22 52:22 "
        "220:22 21:22 88:23 86:23 337:25 335:28 46:28 58:28 90:29 15:30 17:30 114:30 12:30 82:30 49:32 70:32 "
        "24:33 57:34 97:34 55:33 302:33 20:34 85:34 83:36 334:36 115:36 354:37 126:36 127:35 219:38 78:40 "
        "106:38 107:38 108:38 123:40 113:39 338:41 121:41 125:43 277:43 143:43 62:43 122:43 51:40 310:44 "
        "373:50 105:44 131:44")


def patch(path, edits):
    if not os.path.isfile(path):
        sys.exit(f"{path} not found. Run this from the project folder.")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    new = text
    for old, rep, marker in edits:
        if marker in new:
            continue                                   # already patched
        if old not in new:
            sys.exit(f"Could not find the expected text in {path}:\n  {old!r}\n(The file was changed by hand? Nothing was written.)")
        new = new.replace(old, rep, 1)
    if new != text:
        shutil.copy2(path, path + ".bak")
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        print(f"patched {path}")
    else:
        print(f"{path}: already up to date")


# ---- 1. build_orre.py ----
table = (
    "# Miror B.'s 2nd Chances (XD): if you miss a Shadow Pokemon whose trainer walks away, Miror B. steals it and battles you for it\n"
    "# until you snag it. national number : level (Serebii.net xd/mirorb.shtml). Edit the list and run build_orre.py again.\n"
    f'MIRORB_LIST = "{LIST}"\n'
    'MIRORB = "\\n".join(f"{n}|Miror B. (radar)|mirorb|{lv}|Only if you missed the original Shadow Pokémon" '
    "for n, lv in (x.split(\":\") for x in MIRORB_LIST.split()))\n\n"
)
patch("build_orre.py", [
    ("def parse(block):", table + "def parse(block):", "MIRORB_LIST"),
    ('    out["loc"][key] = parse(block)\n',
     '    out["loc"][key] = parse(block)\n'
     '    if key == "xd":                                  # Miror B.\'s 2nd chances are extra rows on top of the normal ones\n'
     '        for n, rows in parse(MIRORB).items():\n'
     '            out["loc"][key].setdefault(n, []).extend(rows)\n',
     "parse(MIRORB)"),
])

# ---- 2. js/where.js ----
patch(os.path.join("js", "where.js"), [
    ('shadow: "Snag (Shadow Pokémon)",',
     'shadow: "Snag (Shadow Pokémon)", mirorb: "Miror B.\'s 2nd chance (snag)",', "mirorb:"),
    ("/^(gift|only-one|shadow|ecard|download)/", "/^(gift|only-one|shadow|mirorb|ecard|download)/", "shadow|mirorb"),
])

# ---- 3. data/special-encounters.json ----
sp = os.path.join("data", "special-encounters.json")
with open(sp, encoding="utf-8") as f:
    data = json.load(f)
if not any(e.get("id") == "mirorb" for e in data["encounters"]):
    shutil.copy2(sp, sp + ".bak")
    data["encounters"].append({
        "id": "mirorb",
        "title": "Miror B.'s 2nd Chances (missed Shadow Pokémon)",
        "g": ["xd"],
        "intro": [
            "Some Shadow Pokémon belong to trainers who don't stay in one place (Cipher Admins and wandering Cipher Peons). If you miss one, Miror B. steals it, and you get a second chance to snag it from him.",
            "Once you have found Miror B., a radar alert tells you where he is. He can turn up anywhere: at a PokéSpot, in a town or at a stadium. He will battle you with the stolen Pokémon as many times as it takes for you to snag it.",
            "When every one of the 83 Shadow Pokémon is snagged, whether from him or from their trainers, he destroys the radar. The levels listed here are the ones he uses.",
        ],
        "match": {"method": "mirorb", "cond": "."},
    })
    with open(sp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"patched {sp}")
else:
    print(f"{sp}: already up to date")

# ---- rebuild data/orre.json ----
subprocess.run([sys.executable, "build_orre.py"], check=True)
print("\nDone. Upload build_orre.py, js/where.js, data/special-encounters.json and data/orre.json.")
