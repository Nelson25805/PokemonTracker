"""Rebuild data/ and assets/ from the original C# repo + pokedex.db.
Usage: python3 build_data.py pokedex.db /path/to/pokedexTracker-master /path/to/pokedex-web
"""
import sqlite3, json, os, shutil, sys, glob
DB, SRC, OUT = sys.argv[1:4]
A = os.path.join(SRC, 'PokedexTracker', 'Assets')
ORDER = ["Red","Blue","Yellow","Gold","Silver","Crystal","Ruby","Sapphire","Emerald",
         "Fire Red","Leaf Green","Diamond","Pearl","Platinum","Heart Gold","Soul Silver"]
SETS = {"Red":"Red-Blue","Blue":"Red-Blue","Ruby":"Ruby-Sapphire","Sapphire":"Ruby-Sapphire",
        "Fire Red":"FireRed-LeafGreen","Leaf Green":"FireRed-LeafGreen","Diamond":"Diamond-Pearl",
        "Pearl":"Diamond-Pearl","Heart Gold":"HeartGold-SoulSilver","Soul Silver":"HeartGold-SoulSilver"}
FIX = {"Farfetchd":"Farfetch'd","Mr-mime":"Mr. Mime","Mime-jr":"Mime Jr.","Porygon-z":"Porygon-Z","Ho-oh":"Ho-Oh"}
slug = lambda s: s.lower().replace(' ', '-')
c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True).cursor()

mons = [{"n": n, "name": FIX.get(nm, nm)} for n, nm in
        c.execute("select Number,Name from Pokemon where Number<=493 order by Number")]
print("names still containing '-':", [m["name"] for m in mons if '-' in m["name"]])

gid = {n: i for i, n in c.execute("select Id,Name from Game")}
games, progress = [], {"version": 1, "name": "", "gender": "Boy", "caught": {}, "shiny": {}}
for name in ORDER:
    g = gid[name]
    count = c.execute("select count(*) from Pokedex_Status where Game_Id=?", (g,)).fetchone()[0]
    has_shiny = c.execute("select count(*) from Shiny_Pokedex_Status where Game_Id=?", (g,)).fetchone()[0] > 0
    k = slug(name)
    games.append({"key": k, "name": name, "gen": c.execute("select Generation from Game where Id=?", (g,)).fetchone()[0],
                  "count": count, "sprites": SETS.get(name, name), "shiny": has_shiny})
    progress["caught"][k] = [r[0] for r in c.execute("select Pokemon_Number from Pokedex_Status where Game_Id=? and Is_Caught=1 order by 1", (g,))]
    progress["shiny"][k] = [r[0] for r in c.execute("select Pokemon_Number from Shiny_Pokedex_Status where Game_Id=? and Is_Caught=1 order by 1", (g,))]

os.makedirs(f'{OUT}/data', exist_ok=True)
json.dump(mons, open(f'{OUT}/data/pokemon.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump(games, open(f'{OUT}/data/games.json', 'w'), indent=1)
json.dump(progress, open(f'{OUT}/../my-progress.json', 'w'), separators=(',', ':'))

copied = 0
for tbl, sub in (("Sprites", ""), ("Shiny_Sprites", "shiny")):
    for gname, fp in c.execute(f"select GameName,FilePath from {tbl}").fetchall():
        f = os.path.basename(fp.replace('\\', '/'))
        if int(f.split('.')[0]) > 493: continue
        dst = os.path.join(OUT, 'assets', 'sprites', gname, sub, f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            shutil.copy(os.path.join(A, fp.replace('\\', '/')), dst); copied += 1
print("sprites copied:", copied)

for folder, dst in (("Diplomas", "diplomas"), ("TrainerCard", "trainer-cards"), ("Professor", "professor"),
                    ("PokemonCardBackground", "card-bg")):
    shutil.copytree(os.path.join(A, folder), f'{OUT}/assets/{dst}', dirs_exist_ok=True)
os.makedirs(f'{OUT}/assets/fonts', exist_ok=True)
for f in glob.glob(f'{A}/Fonts/*.ttf'):
    b = os.path.basename(f)
    new = "pkmn-rbygsc.ttf" if b.startswith("PKMN") else "pokemon-rs.ttf" if "RS" in b else "pokemon-frlg.ttf"
    shutil.copy(f, f'{OUT}/assets/fonts/{new}')
