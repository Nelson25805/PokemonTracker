#!/usr/bin/env python3
"""build_dreamradar.py: scrape Pokémon Dream Radar data (Black 2 / White 2) from Serebii + Bulbapedia.

    python3 build_dreamradar.py                          # fetch both live pages
    python3 build_dreamradar.py --serebii-file a.html --bulba-file b.html
    python3 build_dreamradar.py --prefer bulbapedia      # if the two sites disagree on a Pokémon's orb colours

Writes  data/dreamradar.json            (read by js/where.js, same shape as pokewalker.json)
Updates data/special-encounters.json    (adds / replaces the "Dream Radar" how-it-works blurb; --no-blurb to skip)

Only the standard library is used.

Sources
  Serebii   /dreamradar/pokemon.shtml : every Pokémon, its Hidden Ability, the orb colours that attract it, how it unlocks.
  Bulbapedia /wiki/Pokémon_Dream_Radar : items per unlock stage, plus a second opinion on the orb colours.

NEITHER SITE LISTS ENCOUNTER PERCENTAGES, so every row has chance 0 (no % chip). Nothing is invented.
If the sites disagree about a Pokémon's orb colours a WARNING is printed. Serebii wins unless --prefer bulbapedia.

What ends up in data/dreamradar.json
  loc    { "black-2": { "<national no>": [[ "Dream Radar", "dream-radar", 5, 40, 0, cond ]] }, "white-2": {...} }
         level 5-40 because it depends on the badges in your save (blurb explains).
         cond = "Pink Orb, Green Orb, Unlock: After catching Tornadus" (shown as small tags)
  items  { "Sun Stone": ["Dream Radar, after catching Tornadus: stormy Dream Clouds"], ... }   evolution items only
  itemNote  text where.js shows under an item that comes from Dream Radar
  pokemon / stages  the full parsed data, for reference
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

SEREBII_URL = "https://www.serebii.net/dreamradar/pokemon.shtml"
BULBA_URL = "https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Dream_Radar"
GAMES = ["black-2", "white-2"]
METHOD = "dream-radar"
AREA = "Dream Radar"            # area name of every encounter row (where.js looks for this prefix)
ITEM_TAG = "Dream Radar"        # every item source line starts with this (where.js looks for it)
LV_LO, LV_HI = 5, 40            # 0 badges = Lv 5 ... 7-8 badges = Lv 40
ORB_ORDER = ["Pink", "Green", "Orange", "Blue"]
FLYING = {641, 642, 645}        # Tornadus / Thundurus / Landorus fly freely (Therian Forme); everything else is a glowing sphere
EXPECTED_POKEMON = 26

EVO_NAMES = ["Fire Stone", "Water Stone", "Thunder Stone", "Leaf Stone", "Moon Stone", "Sun Stone", "Shiny Stone",
             "Dusk Stone", "Dawn Stone", "Oval Stone", "King's Rock", "Metal Coat", "Dragon Scale", "Up-Grade",
             "Deep Sea Tooth", "Deep Sea Scale", "Razor Claw", "Razor Fang", "Protector", "Electirizer",
             "Magmarizer", "Reaper Cloth", "Dubious Disc"]
squash = lambda s: re.sub(r"[^a-z]", "", s.lower())
EVO = {squash(n): n for n in EVO_NAMES}

BLURB_INTRO = [
    "You can only get this with Pokémon Dream Radar, a Nintendo 3DS eShop app (removed from the eShop on March 27, 2023). "
    "You shoot Dream Clouds, battle the Pokémon inside them, then send your research data to Black 2 / White 2 "
    "(Unova Link > Nintendo 3DS Link). Pokémon arrive in a Dream Ball with their Hidden Ability (Rotom has none).",
    "The level depends on the Badges in your Black 2 / White 2 save: 5 with none, 10 with 1-2, 20 with 3-4, 30 with 5-6, 40 with 7-8. "
    "The Orb tags show which Dream Orb colour attracts it: the colour you collected most on your last exploration decides which Pokémon can turn up next. "
    "Unlock tags say what you need first (catching Tornadus, Thundurus or Landorus, an extension, a code or a Gen 4 game card). "
    "Legendary Pokémon can only be caught once per Dream Radar save and received once per Black 2 / White 2 save. "
    "No official encounter rates exist, so no % is shown.",
]
ITEM_NOTE = ("Dream Radar items come out of stormy Dream Clouds (instead of a Pokémon) once you reach the stage shown. "
             "No official rates are published. They are sent to Black 2 / White 2 with your research data and go straight into your bag.")
BLURB_ENTRY = {
    "id": "dream-radar",
    "title": "Dream Radar (3DS app, no longer sold)",
    "g": GAMES,
    "intro": BLURB_INTRO,
    "match": {"method": METHOD, "cond": "."},
}


# ---------------------------------------------------------------- HTML -> tables (nested tables are flattened into their cell)
class Tables(HTMLParser):
    """Collects every top-level <table> as {cls, rows: [[cell, ...], ...]}; a cell is {lines (split at <br>), hrefs, imgs}.
    Tables nested inside a cell (Serebii's sprite cell) are ignored structurally; their text/links/images land in the outer cell."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.t, self.row, self.cell, self.depth = [], None, None, None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.t = {"cls": a.get("class", ""), "rows": []}
            return
        if self.t is None:
            return
        if tag == "tr" and self.depth == 1:
            self.row = []
            self.t["rows"].append(self.row)
        elif tag in ("td", "th") and self.depth == 1:
            if self.row is None:
                self.row = []
                self.t["rows"].append(self.row)
            self.cell = {"lines": [""], "hrefs": [], "imgs": []}
            self.row.append(self.cell)
        elif self.cell is not None:
            if tag == "br":
                self.cell["lines"].append("")
            elif tag == "a" and a.get("href"):
                self.cell["hrefs"].append(a["href"])
            elif tag == "img":
                self.cell["imgs"].append(a.get("src", ""))

    def handle_endtag(self, tag):
        if tag == "table" and self.depth:
            self.depth -= 1
            if self.depth == 0 and self.t is not None:
                self.tables.append(self.t)
                self.t = self.row = self.cell = None
        elif self.depth == 1 and tag in ("td", "th"):
            self.cell = None
        elif self.depth == 1 and tag == "tr":
            self.row = self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["lines"][-1] += data


def fix_text(s):
    return s.replace("Pok\ufffddex", "Pokédex").replace("Pok\ufffd", "Poké").replace("\ufffd", "é")


def clean(s):
    return fix_text(re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip())


def lines(cell):
    return [x for x in (clean(l) for l in cell["lines"]) if x]


def text(cell):
    return clean(" ".join(cell["lines"]))


def warn(msg):
    print("WARNING:", msg, file=sys.stderr)


def decode(raw):
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def sort_orbs(orbs):
    return sorted(set(orbs), key=lambda o: ORB_ORDER.index(o) if o in ORB_ORDER else 99)


# ---------------------------------------------------------------- Serebii: Pokémon, abilities, orbs, unlocks
def parse_access(ls):
    """['After capture of Tornadus', 'Pink & Orange Orb Levels'] -> (unlock, orbs, code)"""
    unlock, orbs, code = "", [], ""
    for l in ls:
        m = re.match(r"(.+?)\s+Orb Levels?$", l, re.I)
        if m:
            orbs = sort_orbs(x.strip().capitalize() for x in re.split(r"\s*[,&]\s*|\s+and\s+", m.group(1)) if x.strip())
        elif l.lower().startswith("intl"):
            code = re.sub(r"^intl\.?\s*:\s*", "", l, flags=re.I)
        elif l.lower().startswith("japan"):
            pass
        elif not unlock:
            unlock = l
    return unlock, orbs, re.sub(r"\s*,\s*", " ", code).strip()


def describe_unlock(unlock):
    u = unlock.strip()
    if not u or u.lower() == "beginning":
        return ""
    m = re.match(r"after capture of (.+)$", u, re.I)
    if m:
        return "After catching " + m.group(1).strip()
    m = re.match(r"complete (Eureka Extension \S+)\s*-\s*obtain (\d+) dream orbs", u, re.I)
    if m:
        return f"{m.group(1)} ({m.group(2)} Dream Orbs collected)"
    m = re.match(r"play with pok.mon (\w+) in 3ds", u, re.I)
    if m:
        return f"Pokémon {m.group(1)} in the 3DS (after catching Landorus)"     # 'after catching Landorus' is from Bulbapedia
    return u


def parse_serebii(html):
    p = Tables()
    p.feed(html)
    out = []
    for t in p.tables:
        for row in t["rows"]:
            if len(row) < 12:
                continue
            m = re.search(r"#?\s*(\d{1,3})\b", text(row[0]))
            nm = lines(row[2])
            if not m or not nm:
                continue
            n = int(m.group(1))
            unlock, orbs, code = parse_access(lines(row[-1]))
            special = unlock.lower().startswith("special extension")
            out.append({
                "n": n, "name": nm[0], "ability": text(row[4]), "orbs": orbs,
                "unlock": unlock, "code": code,
                "legendary": (not orbs) and not special,
            })
    return out


# ---------------------------------------------------------------- Bulbapedia: items per stage + orb colours (second opinion)
def parse_bulba(html):
    p = Tables()
    p.feed(html)
    orbs, items = {}, []
    for t in p.tables:
        rows = t["rows"]
        is_items = any("Bag_" in i for r in rows for c in r for i in c["imgs"])
        if is_items:
            stage = ""
            for r in rows:
                if len(r) == 1:
                    stage = text(r[0])
                    continue
                for c in r:
                    if any("Bag_" in i for i in c["imgs"]) and text(c):
                        items.append((stage, text(c)))
            continue
        for r in rows:
            if len(r) == 5 and text(r[1]) in ("✔", "✘") and text(r[0]):
                orbs[text(r[0])] = sort_orbs(o for o, c in zip(ORB_ORDER, r[1:]) if text(c) == "✔")
    return orbs, items


def stage_phrase(stage):
    s = re.sub(r"^available\s+", "", stage.strip(), flags=re.I)
    if re.match(r"from start", s, re.I):
        return "from the start of the game"
    m = re.match(r"after catching (.+)", s, re.I)
    if m:
        return "after catching " + m.group(1).strip()
    m = re.match(r"using (.+)", s, re.I)
    if m:
        ext = m.group(1).strip()
        return f"{ext} extension (unlocked after catching Landorus and viewing the credits)" if ext.lower().startswith("simulator") else f"{ext} extension"
    return s[:1].lower() + s[1:]


# ---------------------------------------------------------------- output
def cond_of(p):
    tags = [f"{o} Orb" for o in p["orbs"]]
    if p["n"] in FLYING:
        tags.append("Flies freely")
    d = describe_unlock(p["unlock"])
    if d:
        tags.append("Unlock: " + d)
    if p["code"]:
        tags.append("Code: " + p["code"])
    if p["legendary"]:
        tags.append("One per save file")
    return ", ".join(t.replace(", ", "; ") for t in tags)


def build(pokemon, items):
    loc = {g: {} for g in GAMES}
    for p in pokemon:
        row = [AREA, METHOD, LV_LO, LV_HI, 0, cond_of(p)]
        for g in GAMES:
            loc[g].setdefault(str(p["n"]), []).append(row)
    for g in loc:
        loc[g] = {n: loc[g][n] for n in sorted(loc[g], key=int)}
    evo = {}
    for stage, raw in items:
        name = EVO.get(squash(raw))
        if not name:
            continue
        line = f"{ITEM_TAG}, {stage_phrase(stage)}: stormy Dream Clouds"
        if line not in evo.setdefault(name, []):
            evo[name].append(line)
    return loc, {k: evo[k] for k in sorted(evo)}


def install_blurb(path):
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"version": 1, "encounters": []}
    data["encounters"] = [e for e in data.get("encounters", []) if e.get("id") != "dream-radar"] + [BLURB_ENTRY]
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def fetch(url, file):
    if file:
        return decode(Path(file).read_bytes())
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (pokedex-tracker data build)"})
    return decode(urllib.request.urlopen(req, timeout=30).read())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--serebii-url", default=SEREBII_URL)
    ap.add_argument("--bulba-url", default=BULBA_URL)
    ap.add_argument("--serebii-file")
    ap.add_argument("--bulba-file")
    ap.add_argument("--prefer", choices=["serebii", "bulbapedia"], default="serebii", help="which site wins when orb colours differ")
    ap.add_argument("--out", default="data/dreamradar.json")
    ap.add_argument("--special", default="data/special-encounters.json")
    ap.add_argument("--no-blurb", action="store_true")
    a = ap.parse_args()

    pokemon = parse_serebii(fetch(a.serebii_url, a.serebii_file))
    b_orbs, b_items = parse_bulba(fetch(a.bulba_url, a.bulba_file))
    if len(pokemon) != EXPECTED_POKEMON:
        warn(f"found {len(pokemon)} Pokémon, expected {EXPECTED_POKEMON}. Has the Serebii layout changed?")
    if not b_items:
        warn("no items found on the Bulbapedia page. Has its layout changed?")

    for p in pokemon:
        other = b_orbs.get(p["name"])
        if other is not None and p["orbs"] and other != p["orbs"]:
            warn(f"{p['name']}: Serebii says {'/'.join(p['orbs'])}, Bulbapedia says {'/'.join(other) or 'none'} "
                 f"(using {a.prefer}; re-run with --prefer to switch)")
            if a.prefer == "bulbapedia":
                p["orbs"] = other

    loc, items = build(pokemon, b_items)
    stages = {}
    for stage, raw in b_items:
        stages.setdefault(stage, []).append(EVO.get(squash(raw), raw))
    out = {
        "version": 1, "generated": date.today().isoformat(),
        "source": f"Serebii.net ({a.serebii_url}); Bulbapedia ({a.bulba_url})",
        "games": GAMES, "itemNote": ITEM_NOTE, "loc": loc, "items": items,
        "pokemon": pokemon, "stages": stages,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if not a.no_blurb:
        install_blurb(a.special)
    print(f"{len(pokemon)} Pokémon, {sum(len(v) for v in items.values())} evolution-item sources ({', '.join(items) or 'none'}) -> {a.out}")


if __name__ == "__main__":
    main()
