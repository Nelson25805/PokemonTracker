#!/usr/bin/env python3
"""
Build data/items.json: where to get each evolution item in each Gen 1-4 game, read from the
"Acquisition" table on the item's Bulbapedia page (https://bulbapedia.bulbagarden.net).

    python3 build_items.py --dry-run               # parse everything, print it, write nothing (do this first)
    python3 build_items.py                         # update data/items.json
    python3 build_items.py --only "Thunder Stone"  # one item

Needs internet and only the Python standard library. About 23 requests, cached in .cache/bulbapedia/
(delete a file there to refetch it). Bulbapedia text is CC BY-NC-SA 2.5, so keep the credit in the page footer.

How it works: the MediaWiki API returns each page's HTML. The first table after the "Acquisition" heading has one row
per game group with "Finite methods" (one-time) and "Repeatable methods" columns. Small version tags such as [Pt] or [C]
inside a cell limit that entry to that game. Items or pages that can't be parsed keep their existing entry, so a bad run
never wipes data. ALWAYS read the --dry-run output against the Bulbapedia page for a couple of items before trusting it.

Output (what js/where.js reads):
    { "items": { "Thunder Stone": { "where": [ { "g": ["gold","silver"], "t": ["Sea Cottage (from Bill's grandfather)"], "k": "once" } ] } } }
k is "once" (finite) or "repeat" (repeatable).
"""
import argparse, datetime, json, os, re, time, urllib.parse, urllib.request
from html.parser import HTMLParser

API = "https://bulbapedia.bulbagarden.net/w/api.php"
UA = "pokedex-tracker-build/1.0 (personal fan project; cached, low volume)"

# item name used in the app (matches ITEM_GEN in where.js) -> (Bulbapedia page, generation it appeared in)
ITEMS = {
    "Fire Stone": ("Fire_Stone", 1), "Water Stone": ("Water_Stone", 1), "Thunder Stone": ("Thunder_Stone", 1),
    "Leaf Stone": ("Leaf_Stone", 1), "Moon Stone": ("Moon_Stone", 1), "Sun Stone": ("Sun_Stone", 2),
    "King's Rock": ("King's_Rock", 2), "Metal Coat": ("Metal_Coat", 2), "Dragon Scale": ("Dragon_Scale", 2),
    "Up-Grade": ("Upgrade", 2), "Deep Sea Tooth": ("Deep_Sea_Tooth", 3), "Deep Sea Scale": ("Deep_Sea_Scale", 3),
    "Shiny Stone": ("Shiny_Stone", 4), "Dusk Stone": ("Dusk_Stone", 4), "Dawn Stone": ("Dawn_Stone", 4),
    "Oval Stone": ("Oval_Stone", 4), "Razor Claw": ("Razor_Claw", 4), "Razor Fang": ("Razor_Fang", 4),
    "Protector": ("Protector", 4), "Electirizer": ("Electirizer", 4), "Magmarizer": ("Magmarizer", 4),
    "Reaper Cloth": ("Reaper_Cloth", 4), "Dubious Disc": ("Dubious_Disc", 4),
}

# link title on Bulbapedia -> this project's game keys (the keys in games.json)
GAMES = [
    ("Pokémon Red and Blue Versions", ["red", "blue"]), ("Pokémon Yellow Version", ["yellow"]),
    ("Pokémon Gold and Silver Versions", ["gold", "silver"]), ("Pokémon Crystal Version", ["crystal"]),
    ("Pokémon Ruby and Sapphire Versions", ["ruby", "sapphire"]), ("Pokémon Emerald Version", ["emerald"]),
    ("Pokémon FireRed and LeafGreen Versions", ["fire-red", "leaf-green"]),
    ("Pokémon Diamond and Pearl Versions", ["diamond", "pearl"]), ("Pokémon Platinum Version", ["platinum"]),
    ("Pokémon HeartGold and SoulSilver Versions", ["heart-gold", "soul-silver"]),
]
TITLE_KEYS = dict(GAMES)
ORDER = [k for _, ks in GAMES for k in ks]
GEN = {**{k: 1 for k in ("red", "blue", "yellow")}, **{k: 2 for k in ("gold", "silver", "crystal")},
       **{k: 3 for k in ("ruby", "sapphire", "emerald", "fire-red", "leaf-green")},
       **{k: 4 for k in ("diamond", "pearl", "platinum", "heart-gold", "soul-silver")}}


# ---------------------------------------------------------------- a tiny HTML tree

class Node:
    def __init__(self, tag, attrs=None, parent=None):
        self.tag, self.attrs, self.parent, self.kids = tag, attrs or {}, parent, []


class Builder(HTMLParser):
    VOID = {"br", "img", "hr", "meta", "link", "input", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = self.cur = Node("root")

    def handle_starttag(self, tag, attrs):
        n = Node(tag, dict(attrs), self.cur)
        self.cur.kids.append(n)
        if tag not in self.VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(Node(tag, dict(attrs), self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, d):
        self.cur.kids.append(d)


def build(html):
    b = Builder()
    b.feed(html)
    return b.root


def walk(n):
    for k in n.kids:
        if isinstance(k, Node):
            yield k
            yield from walk(k)


def plain(n):
    return "".join(k if isinstance(k, str) else plain(k) for k in n.kids)


# ---------------------------------------------------------------- the Acquisition table

BLOCK = {"p", "li", "div", "ul", "ol", "tr"}


def flatten(n, out):
    """Cell -> text. <br> and block tags become newlines; a version tag link ([Pt]) becomes \\x00key|key\\x01."""
    for k in n.kids:
        if isinstance(k, str):
            out.append(k)
        elif k.tag == "br":
            out.append("\n")
        elif k.tag in ("style", "script"):
            continue
        elif k.tag == "a" and k.attrs.get("title") in TITLE_KEYS and len(plain(k).strip()) <= 4:
            out.append("\x00" + "|".join(TITLE_KEYS[k.attrs["title"]]) + "\x01")
        else:
            if k.tag in BLOCK:
                out.append("\n")
            flatten(k, out)
            if k.tag in BLOCK:
                out.append("\n")
    return "".join(out)


def split_entries(s):
    """Split on newlines and on commas that are not inside parentheses."""
    out, buf, depth = [], [], 0
    for ch in s:
        depth += (ch == "(") - (ch == ")" and depth > 0)
        if ch == "\n" or (ch == "," and depth == 0):
            out.append("".join(buf)); buf = []
        else:
            buf.append(ch)
    out.append("".join(buf))
    return [e for e in out if e.strip()]


def clean(e):
    tags = set()
    for m in re.finditer("\x00([^\x01]*)\x01", e):
        tags.update(m.group(1).split("|"))
    e = re.sub("\x00[^\x01]*\x01", "", e)
    e = re.sub(r"\s+", " ", e).strip().strip("*†‡ ").strip()
    e = re.sub(r"\s*\(\s*\)", "", e)
    m = re.search(r"((?:\s(?:Mo|Tu|We|Th|Fr|Sa|Su))+)$", e)           # day tags: "Pokéathlon Dome (2500 Pts.) We Th Sa"
    if m:
        e = e[:m.start()] + " (" + "/".join(m.group(1).split()) + ")"
    return e, tags


def parse_acquisition(html):
    """HTML of an item page -> list of { g: [game keys], t: [lines], k: once|repeat }, or None if no table found."""
    root, started, table = build(html), False, None
    for n in walk(root):
        if not started:
            started = n.attrs.get("id") == "Acquisition"
        elif n.tag == "table":
            table = n
            break
    if table is None:
        return None
    acc = {}
    for tr in (n for n in walk(table) if n.tag == "tr"):
        cells = [k for k in tr.kids if isinstance(k, Node) and k.tag in ("th", "td")]
        if len(cells) < 3:
            continue
        games = []
        for a in walk(cells[-3]):
            games += [g for g in TITLE_KEYS.get(a.attrs.get("title"), []) if g not in games] if a.tag == "a" else []
        if not games:                                                    # header row, or only games outside Gen 1-4
            continue
        for kind, cell in (("once", cells[-2]), ("repeat", cells[-1])):
            for raw in split_entries(flatten(cell, [])):
                line, tags = clean(raw)
                gs = sorted((g for g in games if not tags or g in tags), key=ORDER.index)
                if line and gs:
                    acc.setdefault((kind, tuple(gs)), [])
                    if line not in acc[(kind, tuple(gs))]:
                        acc[(kind, tuple(gs))].append(line)
    rows = [{"g": list(gs), "t": lines, "k": kind} for (kind, gs), lines in acc.items()]
    rows.sort(key=lambda r: (ORDER.index(r["g"][0]), r["k"] != "once"))
    return rows


# ---------------------------------------------------------------- network + cache

def fetch_html(page, cache, delay):
    os.makedirs(cache, exist_ok=True)
    fn = os.path.join(cache, re.sub(r"[^A-Za-z0-9_-]+", "_", page) + ".json")
    if os.path.exists(fn):
        with open(fn, encoding="utf-8") as f:
            data = json.load(f)
    else:
        q = urllib.parse.urlencode({"action": "parse", "page": page, "prop": "text", "format": "json", "redirects": 1})
        req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        with open(fn, "w", encoding="utf-8") as f:
            json.dump(data, f)
        time.sleep(delay)
    t = data["parse"]["text"]
    return t["*"] if isinstance(t, dict) else t


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=os.path.join("data", "items.json"))
    ap.add_argument("--cache", default=os.path.join(".cache", "bulbapedia"))
    ap.add_argument("--only", help='one item, e.g. "Thunder Stone"')
    ap.add_argument("--delay", type=float, default=1.5, help="seconds between uncached requests")
    ap.add_argument("--dry-run", action="store_true", help="print what was found, write nothing")
    args = ap.parse_args()

    old = {}
    if os.path.exists(args.out):
        with open(args.out, encoding="utf-8") as f:
            old = json.load(f)
    items = dict(old.get("items", {}))
    for name, (page, gen) in ITEMS.items():
        if args.only and name != args.only:
            continue
        print(f"\n== {name}   https://bulbapedia.bulbagarden.net/wiki/{urllib.parse.quote(page)}#Acquisition")
        try:
            rows = parse_acquisition(fetch_html(page, args.cache, args.delay))
        except Exception as e:
            print(f"   could not fetch/parse ({e}); keeping the existing entry")
            continue
        if not rows:
            print("   no Gen 1-4 rows found; keeping the existing entry")
            continue
        for r in rows:
            print(f"   [{r['k']:<6}] {', '.join(r['g'])}: " + " | ".join(r["t"]))
        covered = {g for r in rows for g in r["g"]}
        none = [g for g in ORDER if GEN[g] >= gen and g not in covered]
        if none:
            print(f"   no location listed for: {', '.join(none)}   (can be right: the item may not be obtainable there)")
        items[name] = {"where": rows}

    if args.dry_run:
        print("\nDry run: nothing written.")
        return
    out = {"version": 1, "generated": datetime.date.today().isoformat(),
           "source": "Bulbapedia (https://bulbapedia.bulbagarden.net), CC BY-NC-SA 2.5", "items": items}
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\nWrote {args.out}: {len(items)} items")


if __name__ == "__main__":
    main()
