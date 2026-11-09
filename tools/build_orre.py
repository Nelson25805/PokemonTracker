#!/usr/bin/env python3
"""
build_orre.py - writes data/orre.json: the Pokemon Colosseum and Pokemon XD data.

    python3 build_orre.py

Neither game exists in PokeAPI's encounter data, so the data is typed in below (from Serebii.net:
colosseum/pokemon.shtml, xd/pokemon.shtml, and Bulbapedia's Poke Spot page for the Poke Spot rates).
Edit the tables, run it again.

Output: { "dex": { "colosseum": [national numbers], "xd": [...] },
          "loc": { "<game>": { "<n>": [[area, method, lo, hi, chance, cond], ...] } } }
  dex  -> the game's Pokemon list (js/app.js merges it into the regional lists)
  loc  -> "Where to find" rows (js/where.js merges them into locations.json when the page loads)
Table lines:  national number | area | method | level (30 or 10-20, blank = unknown) | note
Methods: shadow (snag), gift, only-one (one-time reward), trade (in-game trade), ecard, download, pokespot (wild).
For shadow lines "Trainer: " is added to the note automatically. Avoid commas in notes.
For pokespot lines the note is the encounter rate (for example 50%): it becomes the rate shown in the
"Where to find" panel (the chance field) and no note is added.
"""
import json, os

COLOSSEUM = """
196|Starting Pokémon|gift|25|Given at the start of the game
197|Starting Pokémon|gift|26|Given at the start of the game
296|Phenac City|shadow|30|Miror B. Peon Trudly
153|Phenac City Gates|shadow|30|Mystery Troop Verde (choose 1 of 3)
156|Phenac City Gates|shadow|30|Mystery Troop Rosso (choose 1 of 3)
159|Phenac City Gates|shadow|30|Mystery Troop Bluno (choose 1 of 3)
153|Shadow Research Lab / Snagem Hideout|shadow|30|Mystery Troop Verde (if you did not choose it)
156|Shadow Research Lab / Snagem Hideout|shadow|30|Mystery Troop Rosso (if you did not choose it)
159|Shadow Research Lab / Snagem Hideout|shadow|30|Mystery Troop Bluno (if you did not choose it)
200|Pyrite City Street|shadow|30|Rider Vant
218|Pyrite City Street|shadow|30|St. Performer Lon
164|Pyrite City Street|shadow|30|Rider Nover
180|Pyrite City Street|shadow|30|Performer Diogo
188|Pyrite City Street|shadow|30|Rider Leba
195|Pyrite City Street|shadow|30|Bandana Guy Divel
162|Pyrite City Gates|shadow|33|Rogue Cail
193|Pyrite Town|shadow|33|Cipher Peon Nore
223|Pyrite Town|shadow|20|Miror B Peon Reath
226|Pyrite Town|shadow|33|Miror B Peon Ferma
211|Outside Pyrite Cave|shadow|33|Hunter Doken
206|Pyrite Cave|shadow|33|Rider Sosh
307|Pyrite Cave|shadow|33|Rider Twan
333|Pyrite Cave|shadow|33|Hunter Zalo
185|Pyrite City|shadow|35|Cipher Admin Miror B.
311|Pyrite City|gift|13|Given by Ginzaru
237|Celebi Shrine - Agate|shadow|38|Cipher Peon Skrub
244|Mt. Battle|shadow|40|Cipher Admin Dakim
166|The Under City|shadow|43|Cipher Peon Kloak
245|The Under City|shadow|40|Cipher Admin Venus
207|The Under City|shadow|43|Hunter Frena
215|The Under City|shadow|43|Rider Nelis
221|The Under City|shadow|43|Bodybuilder Lonia
234|The Under City|shadow|43|Chaser Liaks
168|Shadow Research Institute|shadow|43|Cipher Peon Lesar
190|Shadow Research Institute|shadow|43|Cipher Peon Cole
198|Shadow Research Institute|shadow|43|Cipher Peon Lare
205|Shadow Research Institute|shadow|43|Cipher Peon Vana
210|Shadow Research Institute|shadow|43|Cipher Peon Tanie
329|Shadow Research Institute|shadow|43|Cipher Peon Remil
243|Shadow Research Institute|shadow|40|Cipher Admin Ein
192|Realgam Tower|shadow|45|Cipher Peon Baila
225|Realgam Tower|shadow|45|Cipher Peon Arton
214|Realgam Tower|shadow|45|Cipher Peon Dioge
227|Realgam Tower|shadow|47|Snagem Leader Gonzap
241|Realgam Tower|shadow|48|Bodybuilder Jonas
359|Realgam Tower|shadow|48|Rider Delan
229|Realgam Tower|shadow|48|Cipher Peon Nella
357|Realgam Tower|shadow|49|Cipher Peon Ston
376|Realgam Tower|shadow|50|Cipher Nascour
248|Realgam Tower|shadow|55|Cipher Head Evice
235|Snagem Hideout|shadow|45|Snagem Grunt Biden
217|Snagem Hideout|shadow|45|Snagem Grunt Agrev
213|Deep Colosseum|shadow|45|Deep King Agnol
176|Outskirt Stand|shadow|20|Cipher Peon Grunt Fake
250|Mt. Battle - 100th Battle|only-one|70|Reward for clearing the 100th Mt. Battle battle
251|Download|download|10|Japanese Bonus Disc only
25|Download|download|10|Japanese Bonus Disc only
385|Download|download||US Bonus Disc only
175|Card E Room - Phenac City|ecard||Needs an e-Reader card
179|Card E Room - Phenac City|ecard||Needs an e-Reader card
212|Card E Room - Phenac City|ecard||Needs an e-Reader card
"""

XD = """
133|Starting Pokémon|gift|10|Your starter
216|Krane's Lab|shadow|11|Spy Naps
165|Gateon Port|shadow|10|Casual Guy Cyle
261|Gateon Port|shadow|10|Bodybuilder Kilen
228|Cipher Lab|shadow|17|Cipher Peon Resix
343|Cipher Lab|shadow|17|Cipher Peon Browsix
363|Cipher Lab|shadow|17|Cipher Peon Blusix
179|Cipher Lab|shadow|17|Cipher Peon Yellosix
316|Cipher Lab|shadow|17|Cipher Peon Purpsix
273|Cipher Lab|shadow|17|Cipher Peon Greesix
167|Cipher Lab|shadow|14|Cipher Peon Nexir
322|Cipher Lab|shadow|14|Cipher Peon Solox
285|Cipher Lab|shadow|15|Cipher R&D Klots
318|Cipher Lab|shadow|15|Cipher Peon Cabol
301|Cipher Lab|shadow|18|Cipher Admin Lovrina
100|Cave PokéSpot|shadow|19|Wanderer Miror.B
296|ONBS Station|shadow|18|Cipher Peon Torkin
37|ONBS Station|shadow|18|Cipher Peon Mesin
355|ONBS Station|shadow|19|Cipher Peon Labor
280|ONBS Station Top|shadow|20|Cipher Peon Feldas
303|ONBS Station Top|shadow|22|Cipher Cmdr. Exol
361|Phenac Mayor's House|shadow|20|Cipher Peon Exinn
204|Phenac Mayor's House|shadow|20|Cipher Peon Gonrag
177|Phenac Training School|shadow|22|Cipher Peon Eloin
315|Phenac Training School|shadow|22|Cipher Peon Fasin
52|Phenac Training School|shadow|22|Cipher Peon Fostin
220|Phenac Stadium|shadow|22|Cipher Peon Greck
21|Phenac Stadium|shadow|22|Cipher Peon Ezin
88|Phenac Stadium|shadow|23|Cipher Peon Faltly
86|Phenac Stadium|shadow|23|Cipher Peon Egrog
337|Phenac Stadium|shadow|25|Cipher Admin Snattle
299|Phenac Stadium|shadow|26|Wanderer Miror. B
335|Cipher Key Lair|shadow|28|Thug Zook
175|Outskirt Stand|shadow|25|Hordel
239|Outskirt Stand|trade|20|Hordel trades this for a purified Shadow Togepi or Togetic
213|Duking|trade|20|Give Duking a Surskit from the Oasis PokéSpot
307|Duking|trade|20|Give Duking a Trapinch from the Rock PokéSpot
246|Duking|trade|20|Give Duking a Wooper from the Cave PokéSpot
152|Mt. Battle|only-one|5|Reward for beating 100 opponents in a row with the same party (Chikorita)
155|Mt. Battle|only-one|5|Reward for beating 100 opponents in a row with the same party (Cyndaquil)
158|Mt. Battle|only-one|5|Reward for beating 100 opponents in a row with the same party (Totodile)
46|Cipher Key Lair|shadow|28|Cipher Peon Humah
58|Cipher Key Lair|shadow|28|Cipher Peon Humah
90|Cipher Key Lair|shadow|29|Cipher Peon Gorog
15|Cipher Key Lair|shadow|30|Cipher Peon Lok
17|Cipher Key Lair|shadow|30|Cipher Peon Lok
114|Cipher Key Lair|shadow|30|Cipher Peon Targ
12|Cipher Key Lair|shadow|30|Cipher Peon Targ
82|Cipher Key Lair|shadow|30|Cipher Peon Snidle
49|Cipher Key Lair|shadow|32|Cipher Peon Angic
70|Cipher Key Lair|shadow|32|Cipher Peon Angic
24|Cipher Key Lair|shadow|33|Cipher Peon Smarton
57|Cipher Key Lair|shadow|34|Cipher Admin Gorigan
97|Cipher Key Lair|shadow|34|Cipher Admin Gorigan
55|Citadark Isle|shadow|33|Navigator Abson
302|Citadark Isle|shadow|33|Navigator Abson
20|Citadark Isle|shadow|34|Chaser Furgy
85|Citadark Isle|shadow|34|Chaser Furgy
83|Citadark Isle|shadow|36|Cipher Admin Lovrina
334|Citadark Isle|shadow|36|Cipher Admin Lovrina
115|Citadark Isle|shadow|36|Cipher Peon Litnar
354|Citadark Isle|shadow|37|Cipher Peon Litnar
126|Citadark Isle|shadow|36|Cipher Peon Grupel
127|Citadark Isle|shadow|35|Cipher Peon Grupel
219|Citadark Isle|shadow|38|Cipher Peon Kolest
78|Citadark Isle|shadow|40|Cipher Peon Kolest
106|Citadark Isle|shadow|38|Cipher Peon Petro
107|Citadark Isle|shadow|38|Cipher Peon Karbon
108|Citadark Isle|shadow|38|Cipher Peon Gefta
123|Citadark Isle|shadow|40|Cipher Peon Leden
113|Citadark Isle|shadow|39|Cipher Peon Leden
338|Citadark Isle|shadow|41|Cipher Admin Snattle
121|Citadark Isle|shadow|41|Cipher Admin Snattle
125|Citadark Isle|shadow|43|Cipher Admin Ardos
277|Citadark Isle|shadow|43|Cipher Admin Ardos
143|Citadark Isle|shadow|43|Cipher Admin Ardos
62|Citadark Isle|shadow|43|Cipher Admin Gorigan
122|Citadark Isle|shadow|43|Cipher Admin Gorigan
51|Citadark Isle|shadow|40|Cipher Peon Stron
310|Citadark Isle|shadow|44|Cipher Admin Eldes
373|Citadark Isle|shadow|50|Cipher Admin Eldes
105|Citadark Isle|shadow|44|Cipher Admin Eldes
131|Citadark Isle|shadow|44|Cipher Admin Eldes
249|Citadark Isle|shadow|50|Cipher Boss Greevil (XD001)
144|Citadark Isle|shadow|50|Cipher Boss Greevil
145|Citadark Isle|shadow|50|Cipher Boss Greevil
146|Citadark Isle|shadow|50|Cipher Boss Greevil
128|Citadark Isle|shadow|46|Cipher Boss Greevil
112|Citadark Isle|shadow|46|Cipher Boss Greevil
103|Citadark Isle|shadow|46|Cipher Boss Greevil
149|Gateon Port|shadow|55|Wanderer Miror. B
27|RockGround PokéSpot|pokespot|10-23|50%
207|RockGround PokéSpot|pokespot|10-20|35%
328|RockGround PokéSpot|pokespot|10-20|15%
187|Oasis PokéSpot|pokespot|10-20|50%
231|Oasis PokéSpot|pokespot|10-20|35%
283|Oasis PokéSpot|pokespot|10-20|15%
41|Cave PokéSpot|pokespot|10-21|50%
304|Cave PokéSpot|pokespot|10-21|35%
194|Cave PokéSpot|pokespot|10-21|15%
"""

# Miror B.'s 2nd Chances (XD): if you miss a Shadow Pokemon whose trainer walks away, Miror B. steals it and battles you for it
# until you snag it. national number : level (Serebii.net xd/mirorb.shtml). Edit the list and run build_orre.py again.
MIRORB_LIST = "167:14 322:14 285:15 318:15 301:18 296:18 37:18 355:19 280:20 303:22 361:20 204:20 177:22 315:22 52:22 220:22 21:22 88:23 86:23 337:25 335:28 46:28 58:28 90:29 15:30 17:30 114:30 12:30 82:30 49:32 70:32 24:33 57:34 97:34 55:33 302:33 20:34 85:34 83:36 334:36 115:36 354:37 126:36 127:35 219:38 78:40 106:38 107:38 108:38 123:40 113:39 338:41 121:41 125:43 277:43 143:43 62:43 122:43 51:40 310:44 373:50 105:44 131:44"
MIRORB = "\n".join(f"{n}|Miror B. (radar)|mirorb|{lv}|Only if you missed the original Shadow Pokémon" for n, lv in (x.split(":") for x in MIRORB_LIST.split()))

def parse(block):
    loc = {}
    for line in block.strip().splitlines():
        n, area, method, lv, note = [x.strip() for x in line.split("|")]
        lo, _, hi = lv.partition("-")
        lo = int(lo) if lo else 0
        hi = int(hi) if hi else lo
        chance = 0
        if method == "shadow":
            note = "Trainer: " + note
        elif method == "pokespot" and note.endswith("%"):
            chance, note = int(note[:-1]), ""          # the rate goes in the chance field; nothing else to say
        loc.setdefault(n, []).append([area, method, lo, hi, chance, note])
    return loc

out = {"version": 1, "source": "Serebii.net (Colosseum / XD pages); Poké Spot rates from Bulbapedia", "dex": {}, "loc": {}}
for key, block in (("colosseum", COLOSSEUM), ("xd", XD)):
    out["loc"][key] = parse(block)
    if key == "xd":                                  # Miror B.'s 2nd chances are extra rows on top of the normal ones
        for n, rows in parse(MIRORB).items():
            out["loc"][key].setdefault(n, []).extend(rows)
    out["dex"][key] = sorted(int(n) for n in out["loc"][key])
os.makedirs("data", exist_ok=True)
with open(os.path.join("data", "orre.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print({k: len(v) for k, v in out["dex"].items()}, "Pokémon; wrote data/orre.json")