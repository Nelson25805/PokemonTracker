#!/usr/bin/env python3
"""build_pokewalker.py: scrape the HeartGold / SoulSilver PokéWalker courses from Serebii.

    python3 build_pokewalker.py                 # fetch the live page
    python3 build_pokewalker.py --file page.html   # or use a saved copy of it

Writes  data/pokewalker.json            (read by js/where.js, same shape as orre.json plus an "items" block)
Updates data/special-encounters.json    (adds / replaces the "PokéWalker" how-it-works blurb; --no-blurb to skip)

Only the standard library is used.

What ends up in data/pokewalker.json
  loc    { "heart-gold": { "<national no>": [[area, "pokewalker", lo, hi, chance, cond], ...] }, "soul-silver": {...} }
         exactly the row shape of locations.json, so where.js can merge it like orre.json.
         area   = "PokéWalker: <course>"
         cond   = "Group A, 2000+ steps, holds Water Stone, Unlock: 50 Watts" (shown as small tags)
         chance = the % Serebii lists for that Pokémon at its own step milestone (first row of its odds cell).
                  Group C (0 steps) and cells whose odds only make sense next to another Pokémon get 0 = no % shown.
  items  { "Fire Stone": ["PokéWalker, Warm Beach course: 5% from 5000+ steps", ...] }
         only evolution items (stones, Electirizer, Dragon Scale ...): found as a course item OR held by a walker Pokémon.
         where.js merges these into the item sources used by the "Evolve X / Get <item>" rows.
  itemNote  the short text where.js shows under an item that comes from the PokéWalker.
  courses   the full parsed data (levels, moves, odds per step milestone, every item) for reference / future use.
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

URL = "https://www.serebii.net/heartgoldsoulsilver/pokewalker-area.shtml"
GAMES = ["heart-gold", "soul-silver"]
METHOD = "pokewalker"
AREA_PREFIX = "PokéWalker: "          # area name of every encounter row
ITEM_TAG = "PokéWalker"               # every item source line starts with this (where.js looks for it)
EXPECTED_COURSES = 27

# ---- evolution items (canonical names as used in items.json / where.js ITEM_GEN) ----
EVO_NAMES = ["Fire Stone", "Water Stone", "Thunder Stone", "Leaf Stone", "Moon Stone", "Sun Stone", "Shiny Stone",
             "Dusk Stone", "Dawn Stone", "Oval Stone", "King's Rock", "Metal Coat", "Dragon Scale", "Up-Grade",
             "Deep Sea Tooth", "Deep Sea Scale", "Razor Claw", "Razor Fang", "Protector", "Electirizer",
             "Magmarizer", "Reaper Cloth", "Dubious Disc"]
squash = lambda s: re.sub(r"[^a-z]", "", s.lower())
EVO = {squash(n): n for n in EVO_NAMES}   # "thunderstone" -> "Thunder Stone", "moonstone" -> "Moon Stone", ...

# ---- the blurbs (kept short on purpose) ----
BLURB_INTRO = [
    "You can only get this with the PokéWalker, the infrared pedometer that came with HeartGold / SoulSilver. "
    "Send a Pokémon to it, pick a course and walk with it for real. When you sync it back to the game, what you caught comes back with it.",
    "Each course has three groups of Pokémon (A = rare, B = uncommon, C = common). Every Pokémon needs a minimum number of steps "
    "on that course (shown on its row) and only one Pokémon per group can turn up at a time. The % is the chance at that step count "
    "and drops as rarer groups take over. To roll again, take the Pokémon out and send it again. "
    "Sending a Pokémon of one of the course's special types cuts the steps needed by 25%.",
    "Courses unlock with Watts, the National Pokédex or events (see the Unlock tag). Event courses were limited-time "
    "distributions and are hard to get today.",
]
ITEM_NOTE = ("PokéWalker items turn up as you walk a course: the more steps you walk on it, the rarer the item (the rate shown "
             "is at the first step count it can appear). Items come back to the game when you sync the PokéWalker, and some "
             "Pokémon arrive already holding one. A Pokémon of the course's special type cuts the steps needed by 25%.")
BLURB_ENTRY = {
    "id": "pokewalker",
    "title": "PokéWalker (extra hardware)",
    "g": GAMES,
    "intro": BLURB_INTRO,
    "match": {"method": METHOD, "cond": "."},
}


# ---------------------------------------------------------------- HTML -> tables
class Tables(HTMLParser):
    """Collects every top-level <table> as {cls, anchors, rows: [[cell, ...], ...]}.
    A cell is {cls, lines (split at <br>), hrefs, imgs}."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.t, self.row, self.cell, self.depth = [], None, None, None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.t = {"cls": a.get("class", ""), "anchors": [], "rows": []}
            return
        if self.t is None:
            return
        if tag == "tr":
            self.row = []
            self.t["rows"].append(self.row)
        elif tag in ("td", "th"):
            if self.row is None:
                self.row = []
                self.t["rows"].append(self.row)
            self.cell = {"cls": a.get("class", ""), "lines": [""], "hrefs": [], "imgs": []}
            self.row.append(self.cell)
        elif tag == "br" and self.cell is not None:
            self.cell["lines"].append("")
        elif tag == "a":
            if a.get("name"):
                self.t["anchors"].append(a["name"])
            if a.get("href") and self.cell is not None:
                self.cell["hrefs"].append(a["href"])
        elif tag == "img" and self.cell is not None:
            self.cell["imgs"].append(a.get("src", ""))

    def handle_endtag(self, tag):
        if tag == "table" and self.depth:
            self.depth -= 1
            if self.depth == 0 and self.t is not None:
                self.tables.append(self.t)
                self.t = self.row = self.cell = None
        elif tag in ("td", "th"):
            self.cell = None
        elif tag == "tr":
            self.row = self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["lines"][-1] += data


def clean(s):
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def lines(cell):
    return [x for x in (clean(l) for l in cell["lines"]) if x]


def text(cell):
    return clean(" ".join(cell["lines"]))


def num(s):
    try:
        v = float(s.strip().rstrip("%"))
    except ValueError:
        return 0
    return int(v) if v == int(v) else v


def warn(msg):
    print("WARNING:", msg, file=sys.stderr)


# ---------------------------------------------------------------- parsing one course
def parse_header(t):
    cells = t["rows"][0]
    name = lines(cells[0])[0]
    unlock = " + ".join(lines(cells[3])[1:]) if len(cells) > 3 else ""
    return {
        "id": t["anchors"][0].lower(),
        "name": name,
        "location": " ".join(lines(cells[1])[1:]) if len(cells) > 1 else "",
        "types": [x.strip() for x in " ".join(lines(cells[2])[1:]).split(",") if x.strip()] if len(cells) > 2 else [],
        "unlock": unlock,
        "pokemon": [],
        "items": [],
    }


def parse_odds(ls):
    """['Doduo', '0+ St: 0%', '500+ St: 75%', ...] -> {'Doduo': [[0, 0], [500, 75]]} ('' = no label)."""
    out, label = {}, ""
    for l in ls:
        m = re.match(r"(\d+)\+ St:\s*([\d.]+)%", l)
        if m:
            out.setdefault(label, []).append([int(m.group(1)), num(m.group(2))])
        else:
            label = l.rstrip(":").strip()
    return out


def own_chance(odds, steps):
    """The % at the Pokémon's own step milestone, from the first row of its odds cell. 0 when unknown (0 steps)."""
    if not steps or not odds:
        return 0
    for s, p in next(iter(odds.values())):
        if s == steps:
            return p
    return 0


def parse_pokemon(t, course):
    r = t["rows"]
    if len(r) < 6 or any(len(r[i]) != 6 for i in range(1, 6)):
        warn(f"{course['name']}: Pokémon table does not have the expected 6 columns x 5 rows, skipped")
        return
    for i in range(6):
        pc, lv, mv, st, od = (r[k][i] for k in range(1, 6))
        href = next((h for h in pc["hrefs"] if "/pokedex" in h), "")
        m = re.search(r"/(\d+)\.shtml", href)
        if not m:
            warn(f"{course['name']}: no Pokédex link in Pokémon cell {i + 1}")
            continue
        n = int(m.group(1))
        pl = lines(pc)
        name = re.sub(r"^#\d+\s*", "", pl[0]).strip() if pl else ""
        if n not in (29, 32):                                   # Nidoran keeps its sex sign
            name = re.sub(r"\s*[♀♂]$", "", name)
        held = ""
        if len(pl) > 1:
            held = EVO.get(squash(pl[1]), pl[1])
        level = re.search(r"Level\s+(\d+)", text(lv))
        steps = re.search(r"(\d+)\+", text(st))
        gender = next((g.group(1) for g in (re.search(r"-(m|f)\.png", s) for s in pc["imgs"]) if g), "")
        odds = parse_odds(lines(od))
        course["pokemon"].append({
            "n": n, "name": name, "group": "ABC"[i // 2],
            "level": int(level.group(1)) if level else 0,
            "steps": int(steps.group(1)) if steps else 0,
            "chance": own_chance(odds, int(steps.group(1)) if steps else 0),
            "held": held, "gender": gender,
            "moves": lines(mv)[1:], "odds": odds,
        })


def parse_items(t, course):
    r = t["rows"]
    steps = []
    for h in r[0][2:]:
        m = re.search(r"(\d+)\+", text(h))
        steps.append(int(m.group(1)) if m else 0)
    for row in r[1:]:
        if len(row) < 3:
            continue
        raw = text(row[1])
        name = EVO.get(squash(raw), raw)
        odds = [[s, num(text(c))] for s, c in zip(steps, row[2:])]
        course["items"].append({"name": name, "odds": [o for o in odds if o[1] > 0]})


def parse(html):
    p = Tables()
    p.feed(html)
    p.close()
    courses, cur, pk, it = [], None, {}, {}
    for t in p.tables:
        cls = t["cls"].split()
        if t["anchors"] and "tab" in cls:                       # a course header: the table with <a name="...">
            cur = parse_header(t)
            courses.append(cur)
        elif cur is not None and "dextable" in cls and t["rows"]:
            first = text(t["rows"][0][0]) if t["rows"][0] else ""
            if first.startswith("Group A"):
                pk[cur["id"]] = (t, cur)
            elif first == "Image":
                it[cur["id"]] = (t, cur)
    for t, c in pk.values():
        parse_pokemon(t, c)
    for t, c in it.values():
        parse_items(t, c)
    return courses


# ---------------------------------------------------------------- output
def cond_of(p, course):
    parts = [f"Group {p['group']}"]
    if p["steps"]:
        parts.append(f"{p['steps']}+ steps")
    if p["held"]:
        parts.append(f"holds {p['held']}")
    if course["unlock"] and course["unlock"] != "Beginning":
        parts.append("Unlock: " + course["unlock"].replace(",", ";"))   # "," separates the tags in where.js
    return ", ".join(parts)


def build(courses):
    loc = {g: {} for g in GAMES}
    items = {}
    seen = set()
    for c in courses:
        area = AREA_PREFIX + c["name"]
        for p in c["pokemon"]:
            row = [area, METHOD, p["level"], p["level"], p["chance"], cond_of(p, c)]
            key = json.dumps([p["n"], row])
            if key not in seen:                                  # never list the identical row twice (where.js adds rates up)
                seen.add(key)
                for g in GAMES:
                    loc[g].setdefault(str(p["n"]), []).append(row)
            if p["held"] in EVO.values():
                line = f"{ITEM_TAG}, {c['name']} course: wild {p['name']} holds it (Lv {p['level']}" + (f", {p['steps']}+ steps)" if p["steps"] else ")")
                items.setdefault(p["held"], []).append(line)
        for i in c["items"]:
            if i["name"] in EVO.values() and i["odds"]:
                s, pct = i["odds"][0]
                items.setdefault(i["name"], []).append(f"{ITEM_TAG}, {c['name']} course: {pct}% from {s}+ steps")
    for k in loc:
        loc[k] = {n: loc[k][n] for n in sorted(loc[k], key=int)}
    return loc, {k: items[k] for k in sorted(items)}


def install_blurb(path):
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"version": 1, "encounters": []}
    data["encounters"] = [e for e in data.get("encounters", []) if e.get("id") != "pokewalker"] + [BLURB_ENTRY]
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=URL)
    ap.add_argument("--file", help="read this saved HTML file instead of fetching the page")
    ap.add_argument("--out", default="data/pokewalker.json")
    ap.add_argument("--special", default="data/special-encounters.json")
    ap.add_argument("--no-blurb", action="store_true", help="don't touch special-encounters.json")
    a = ap.parse_args()

    if a.file:
        html = Path(a.file).read_text(encoding="utf-8", errors="replace")
    else:
        req = urllib.request.Request(a.url, headers={"User-Agent": "Mozilla/5.0 (pokedex-tracker data build)"})
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", errors="replace")

    courses = parse(html)
    if len(courses) != EXPECTED_COURSES:
        warn(f"found {len(courses)} courses, expected {EXPECTED_COURSES}. Has the page layout changed?")
    loc, items = build(courses)

    out = {
        "version": 1, "generated": date.today().isoformat(), "source": f"Serebii.net ({a.url})",
        "games": GAMES, "itemNote": ITEM_NOTE, "loc": loc, "items": items, "courses": courses,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if not a.no_blurb:
        install_blurb(a.special)

    npk = sum(len(c["pokemon"]) for c in courses)
    species = len(loc[GAMES[0]])
    print(f"{len(courses)} courses, {npk} Pokémon slots ({species} species), {sum(len(v) for v in items.values())} evolution-item sources "
          f"({', '.join(items) or 'none'}) -> {a.out}")
    for c in courses:
        if len(c["pokemon"]) != 6:
            warn(f"{c['name']}: {len(c['pokemon'])} Pokémon parsed (expected 6)")
        if not c["items"]:
            warn(f"{c['name']}: no items parsed")


if __name__ == "__main__":
    main()
