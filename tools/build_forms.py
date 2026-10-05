#!/usr/bin/env python3
"""
Build data/forms.json (which Pokémon have alternate forms or gender differences, and in which games) and
download the matching sprites into assets/sprites/<set>/forms/.

    python3 build_forms.py                # forms.json + sprites
    python3 build_forms.py --no-download  # forms.json only

Sprites come from the PokéAPI sprite repository (https://github.com/PokeAPI/sprites). The script makes a
"blobless" clone (file names only, a few MB) into .cache/sprites-repo to see which files exist, so a form is
only listed for a game when its sprite really exists. Needs git, internet and the Python standard library.
Delete .cache/sprites-repo to pick up new upstream files. Existing sprites are never re-downloaded.

What counts as a form (and the names shown) is the table ALT below. Edit it to add or drop forms; for a new
game, add its sprite set to SETS. Infinite or cosmetic variations (Spinda spots), forms that only exist in
glitches or unreleased data (Arceus "???", beta sprites) and eggs/substitute sprites are left out on purpose.

Output (what the app reads):
    { "version": 1, "generated": "...", "source": "...",
      "cats":    { "gender": "Gender differences", "alt": "Alternate forms" },
      "species": { "<national dex number>": { "base": "A", "forms": [
                     { "id": "201-b", "name": "B", "cat": "alt", "g": ["gold", "silver", ...] } ] } } }
The base form is the Pokémon's normal Pokédex entry (tracked by the main grid), so only the extra forms are listed.
Sprites:  assets/sprites/<Folder>/forms/<id>.png   and   assets/sprites/<Folder>/shiny/forms/<id>.png
(<Folder> is the same sprite folder name games.json uses, e.g. "Ruby-Sapphire".)
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = "https://github.com/PokeAPI/sprites"
RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/"
MAX_POKEMON = 493

# (path in the sprite repo, sprite folder under assets/sprites, game keys that use that artwork)
SETS = [
    ("generation-ii/gold/transparent",                   "Gold",                 ["gold"]),
    ("generation-ii/silver/transparent",                 "Silver",               ["silver"]),
    ("generation-ii/crystal/transparent",                "Crystal",              ["crystal"]),
    ("generation-iii/ruby-sapphire",         "Ruby-Sapphire",        ["ruby", "sapphire"]),
    ("generation-iii/emerald",               "Emerald",              ["emerald"]),
    ("generation-iii/firered-leafgreen",     "FireRed-LeafGreen",    ["fire-red", "leaf-green"]),
    ("generation-iv/diamond-pearl",          "Diamond-Pearl",        ["diamond", "pearl"]),
    ("generation-iv/platinum",               "Platinum",             ["platinum"]),
    ("generation-iv/heartgold-soulsilver",   "HeartGold-SoulSilver", ["heart-gold", "soul-silver"]),
]
# (Red, Blue and Yellow have no forms or gender differences. The Gen 2 sprites use the repo's "transparent"
#  versions, because the plain ones come with a white box behind them.)

CATS = {"gender": "Gender differences", "alt": "Alternate forms"}


def forms(n, *items):
    """items: (suffix, display name, [candidate file names in the sprite repo])."""
    return [(f"{n}-{suffix}", name, cands) for suffix, name, cands in items]


# national number -> (name of the base form, [(id, display name, candidate files)])
# Candidate files: PokéAPI numbers many alternate forms 10001+ (10001 = Deoxys Attack ... 10015 = Castform Snowy).
ALT = {
    172: ("Normal", forms(172, ("spiky-eared", "Spiky-eared", ["172-spiky-eared.png"]))),                      # Pichu, HGSS event
    201: ("A", forms(201, *[(c, c.upper(), [f"201-{c}.png"]) for c in "bcdefghijklmnopqrstuvwxyz"],
                      ("exclamation", "!", ["201-exclamation.png"]), ("question", "?", ["201-question.png"]))),  # Unown (! and ? from Gen 3)
    351: ("Normal", forms(351, ("sunny", "Sunny", ["10013.png"]), ("rainy", "Rainy", ["10014.png"]), ("snowy", "Snowy", ["10015.png"]))),
    386: ("Normal", forms(386, ("attack", "Attack", ["10001.png"]), ("defense", "Defense", ["10002.png"]), ("speed", "Speed", ["10003.png"]))),
    412: ("Plant Cloak", forms(412, ("sandy", "Sandy Cloak", ["412-sandy.png"]), ("trash", "Trash Cloak", ["412-trash.png"]))),   # Burmy
    413: ("Plant Cloak", forms(413, ("sandy", "Sandy Cloak", ["10004.png"]), ("trash", "Trash Cloak", ["10005.png"]))),            # Wormadam
    421: ("Overcast", forms(421, ("sunshine", "Sunshine", ["421-sunshine.png"]))),                              # Cherrim
    422: ("West Sea", forms(422, ("east", "East Sea", ["422-east.png"]))),                                      # Shellos
    423: ("West Sea", forms(423, ("east", "East Sea", ["423-east.png"]))),                                      # Gastrodon
    479: ("Normal", forms(479, ("heat", "Heat", ["10008.png"]), ("wash", "Wash", ["10009.png"]), ("frost", "Frost", ["10010.png"]),
                           ("fan", "Fan", ["10011.png"]), ("mow", "Mow", ["10012.png"]))),                      # Rotom
    487: ("Altered", forms(487, ("origin", "Origin", ["10007.png"]))),                                          # Giratina
    492: ("Land", forms(492, ("sky", "Sky", ["10006.png"]))),                                                   # Shaymin
    493: ("Normal", forms(493, *[(t, t.capitalize(), [f"493-{t}.png"]) for t in
                                 "fighting flying poison ground rock bug ghost steel fire water grass electric psychic ice dragon dark".split()])),
}


# ---------------------------------------------------------------- the sprite repo's file list

def list_files(cache):
    """Every path under sprites/pokemon/versions/ in the sprite repo (names only, no images)."""
    if not os.path.isdir(os.path.join(cache, ".git")):
        os.makedirs(os.path.dirname(cache) or ".", exist_ok=True)
        print(f"Cloning the file list of {REPO} (names only) into {cache} ...")
        subprocess.run(["git", "clone", "-q", "--filter=blob:none", "--no-checkout", "--depth", "1", REPO, cache], check=True)
    out = subprocess.run(["git", "-C", cache, "ls-tree", "-r", "--name-only", "HEAD", "sprites/pokemon/versions"],
                         capture_output=True, text=True, check=True).stdout
    prefix = "sprites/pokemon/versions/"
    return {l[len(prefix):] for l in out.splitlines() if l.startswith(prefix)}


# ---------------------------------------------------------------- build

def build(files):
    """Pure: file set -> (forms.json dict, download jobs [(repo path, destination under assets/sprites)])."""
    species, jobs, warnings = {}, {}, []

    def add(n, base, fid, name, cat, games, folder, rel, srel):
        sp = species.setdefault(n, {"base": base, "forms": {}})
        f = sp["forms"].setdefault(fid, {"id": fid, "name": name, "cat": cat, "g": []})
        f["g"] += [g for g in games if g not in f["g"]]
        jobs[f"{folder}/forms/{fid}.png"] = rel
        if srel:
            jobs[f"{folder}/shiny/forms/{fid}.png"] = srel
        else:
            warnings.append(f"no shiny sprite for {fid} in {folder}")

    for path, folder, games in SETS:
        has = lambda rel: f"{path}/{rel}" in files
        for n, (base, items) in ALT.items():
            for fid, name, cands in items:
                rel = next((c for c in cands if has(c)), None)
                if not rel:
                    continue
                srel = f"shiny/{rel}" if has(f"shiny/{rel}") else None
                add(n, base, fid, name, "alt", games, folder, f"{path}/{rel}", srel and f"{path}/{srel}")
        # gender differences: the repo keeps the female sprite in female/<n>.png when it looks different
        for rel in sorted(f[len(path) + 1:] for f in files if f.startswith(path + "/female/")):
            m = re.fullmatch(r"female/(\d+)\.png", rel)
            if not m or int(m.group(1)) > MAX_POKEMON:
                continue
            n = int(m.group(1))
            srel = f"shiny/{rel}" if has(f"shiny/{rel}") else None
            add(n, "Male", f"{n}-f", "Female", "gender", games, folder, f"{path}/{rel}", srel and f"{path}/{srel}")

    out = {}
    for n in sorted(species):
        sp = species[n]
        out[str(n)] = {"base": sp["base"], "forms": list(sp["forms"].values())}
    data = {
        "version": 1,
        "generated": datetime.date.today().isoformat(),
        "source": "PokéAPI sprites (https://github.com/PokeAPI/sprites)",
        "cats": CATS,
        "species": out,
    }
    return data, jobs, warnings


# ---------------------------------------------------------------- download

def fetch(job):
    dest, rel = job
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return None
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for attempt in range(4):
        try:
            req = urllib.request.Request(RAW + rel, headers={"User-Agent": "pokedex-tracker-build/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(dest, "wb") as f:
                f.write(data)
            return None
        except Exception:
            time.sleep(2 ** attempt)
    return rel


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=os.path.join("data", "forms.json"))
    ap.add_argument("--assets", default=os.path.join("assets", "sprites"))
    ap.add_argument("--cache", default=os.path.join(".cache", "sprites-repo"))
    ap.add_argument("--no-download", action="store_true", help="only write forms.json")
    args = ap.parse_args()

    data, jobs, warnings = build(list_files(args.cache))
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    total = sum(len(s["forms"]) for s in data["species"].values())
    print(f"Wrote {args.out}: {len(data['species'])} Pokémon, {total} forms, {len(jobs)} sprites")
    per = {}
    for s in data["species"].values():
        for form in s["forms"]:
            for g in form["g"]:
                per[g] = per.get(g, 0) + 1
    for g in sorted(per):
        print(f"  {g:<12} {per[g]:>3} forms")
    for w in warnings:
        print("  warning:", w)

    if args.no_download:
        return
    todo = [(os.path.join(args.assets, *dest.split("/")), rel) for dest, rel in sorted(jobs.items())]
    print(f"Downloading sprites (existing files are skipped) ...")
    with ThreadPoolExecutor(8) as pool:
        failed = [r for r in pool.map(fetch, todo) if r]
    print(f"Done. {len(todo) - len(failed)} sprites in place" + (f", {len(failed)} failed (run again):" if failed else "."))
    for r in failed[:10]:
        print("  ", r)


if __name__ == "__main__":
    main()
