#!/usr/bin/env python3
"""
Build data/form-areas.json automatically: which FORM of a Pokémon appears in which area (and segment), read from the
"Game locations" tables on Bulbapedia (same method, cache and credit as build_items.py).

    python3 build_form_areas.py --dry-run          # show what it found and what it could not match; writes nothing
    python3 build_form_areas.py                    # write data/form-areas.json
    python3 build_form_areas.py --only 422         # one Pokémon
    python3 build_form_areas.py --html page.json   # parse a saved page instead of fetching (with --only)

Only species whose form depends on WHERE you catch them need this (see SPECIES): the script looks for a form name
(from data/forms.json, plus the base form) written next to a location, e.g. "Route 213 (East Sea)", and matches that
location to the names in data/locations.json. Entries it cannot match are printed so nothing is guessed silently.
Rules it writes are marked "auto": true and replaced on every run; rules you add by hand (no "auto") are kept.
Needs internet (about 5 requests, cached in .cache/bulbapedia/) and run from the project folder.
"""
import argparse, json, os, re
import build_items as B            # reuses its tiny HTML tree, Bulbapedia fetch + cache and game-title table

SPECIES = {422: "Shellos", 423: "Gastrodon", 479: "Rotom", 386: "Deoxys", 201: "Unown"}
COMPASS = "north|south|east|west|northeast|northwest|southeast|southwest"
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def area_base(a):
    w = re.split(r"\s+towards\s+", a, flags=re.I)[0].split()
    while len(w) > 1 and re.fullmatch(rf"b?\d+[fr]|{COMPASS}", w[-1], re.I):
        w.pop()
    return " ".join(w)


def seg_of(a):
    m = re.search(rf"\b({COMPASS})\s*$", re.split(r"\s+towards\s+", a, flags=re.I)[0].strip(), re.I)
    return m.group(1).lower() if m else ""


def places(text):
    """'Routes 205, 218 and 221, Fuego Ironworks (tall grass)' -> [('Route 205', ''), ('Route 218', ''), ..., ('Fuego Ironworks', '')]"""
    text = re.sub(r"\((?!\s*(?:%s)\s*\))[^)]*\)" % COMPASS, "", text)           # drop notes like (tall grass), keep (north)
    out, route = [], False
    for t in re.split(r",\s*|\s+and\s+", text):
        t = re.sub(r"^and\s+", "", t.strip(), flags=re.I)
        sm = re.search(rf"\(?\b({COMPASS})\b\)?", t, re.I)
        seg = sm.group(1).lower() if sm else ""
        t = re.sub(r"\s+", " ", re.sub(rf"\(?\b({COMPASS})\b\)?", "", t, flags=re.I)).strip(" .")
        m = re.fullmatch(r"Routes?\s+(\d+)", t, re.I)
        if m: t, route = "Route " + m[1], True
        elif route and re.fullmatch(r"\d+", t): t = "Route " + t
        else: route = False
        if t: out.append((t, seg))
    return out


BLOCK = {"p", "li", "div", "ul", "ol", "tr", "td", "th", "table", "br", "h1", "h3", "h4", "dd", "dt"}
GAME_TITLE = re.compile(r"\bVersions?\b|^Pokémon (Legends|Brilliant|Shining|Scarlet|Violet|Sword|Shield|Let's)")


NAME2KEY = {norm(n): [k] for n, k in [("Red", "red"), ("Blue", "blue"), ("Yellow", "yellow"), ("Gold", "gold"), ("Silver", "silver"),
            ("Crystal", "crystal"), ("Ruby", "ruby"), ("Sapphire", "sapphire"), ("Emerald", "emerald"), ("FireRed", "fire-red"),
            ("LeafGreen", "leaf-green"), ("Diamond", "diamond"), ("Pearl", "pearl"), ("Platinum", "platinum"),
            ("HeartGold", "heart-gold"), ("SoulSilver", "soul-silver")]}
NOISE = re.compile(r"^(Trade|Breed|Transfer|Pokémon HOME|Pokéwalker|Unobtainable)", re.I)


def tokens(n, out):
    """Document-order stream: ('t', text), ('g', [game keys]) for a game link, ('b',) for a line break, ('h2',), ('id', x)."""
    for k in n.kids:
        if isinstance(k, str):
            out.append(("t", k)); continue
        if k.tag in ("style", "script"):
            continue
        if k.tag == "h2":
            out.append(("h2",))
        if k.attrs.get("id"):
            out.append(("id", k.attrs["id"]))
        title = k.attrs.get("title", "")
        if k.tag == "a" and (title in B.TITLE_KEYS or GAME_TITLE.search(title)):
            out.append(("g", list(B.TITLE_KEYS.get(title, [])))); continue      # games outside Gen 1-4 reset the group with no keys
        blk = k.tag in BLOCK
        if blk:
            out.append(("b",))
        tokens(k, out)
        if blk:
            out.append(("b",))


def records(html):
    """The 'Game locations' section as [(game keys, text line)], whatever table layout Bulbapedia uses: a line belongs to the
    game links that came just before it."""
    toks = []
    tokens(B.build(html), toks)
    start = next((i for i, t in enumerate(toks) if t == ("id", "Game_locations")), None)
    if start is None:
        return []
    recs, games, fresh, buf = [], [], True, []

    def add_games(keys):
        nonlocal fresh
        if fresh:
            games.clear(); fresh = False
        games.extend(g for g in keys if g not in games)

    def flush():
        nonlocal fresh
        line = re.sub(r"\s+", " ", "".join(buf)).strip(); buf.clear()
        if not line:
            return
        if norm(line) in NAME2KEY:                                    # a game name written as plain text ("Diamond", "Pearl", "Platinum")
            add_games(NAME2KEY[norm(line)])
        elif line.startswith("Generation "):                           # new generation: forget the previous games
            games.clear(); fresh = True
        else:
            recs.append((list(games), line)); fresh = True
    for t in toks[start + 1:]:
        if t[0] == "h2":
            break
        if t[0] == "t":
            buf.append(t[1])
        elif t[0] == "b":
            flush()
        elif t[0] == "g":
            flush()
            add_games(t[1])
    flush()
    return recs


def parse(html, n, forms, loc):
    """forms: {'names': {form id or 'base': display name}, 'games': ...}. loc: locations.json['loc']. -> (rules, unmatched, stats)."""
    names, ok_games = forms["names"], forms["games"]
    rules, miss, recs = {}, [], records(html)
    seen = {"lines": len(recs), "form lines": 0, "sample": [f"{','.join(g) or '(other game)'}: {l[:110]}" for g, l in recs[:14]]}
    for games, line in recs:
        hit = [fid for fid, disp in names.items() if re.search(rf"\b{re.escape(disp)}\b", line, re.I)]
        if len(hit) != 1 or not games:
            continue                                              # no form mentioned (or ambiguous), or not a Gen 1-4 game
        seen["form lines"] += 1
        fid = hit[0]
        rest = re.sub(rf"\(?\b{re.escape(names[fid])}\b(?:\s+form(?:e)?)?\)?", "", line, flags=re.I)
        for text, seg in places(rest):
            for g in (x for x in games if fid == "base" or x in ok_games.get(fid, [])):
                cands = {a[0] for a in loc.get(g, {}).get(str(n), [])}
                m = sorted(c for c in cands if text and norm(area_base(c)).endswith(norm(text)) and (not seg or seg_of(c) == seg))
                if not m:
                    if not NOISE.match(text):
                        miss.append(f"{g}: '{text}' (from: {line})")
                    continue
                area = m[0] if seg else area_base(m[0])
                rules.setdefault((area, fid), []).append(g)
    return [{"n": n, "g": sorted(set(gs)), "area": a, "form": f, "auto": True} for (a, f), gs in sorted(rules.items())], miss, seen


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=os.path.join("data", "form-areas.json"))
    ap.add_argument("--cache", default=os.path.join(".cache", "bulbapedia"))
    ap.add_argument("--only", type=int, help="one national dex number, e.g. 422")
    ap.add_argument("--html", help="a saved page (API .json or .html) to parse instead of fetching; needs --only")
    ap.add_argument("--delay", type=float, default=1.5)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    load = lambda f: json.load(open(os.path.join("data", f + ".json"), encoding="utf-8"))
    forms, loc = load("forms")["species"], load("locations")["loc"]
    old = json.load(open(a.out, encoding="utf-8")) if os.path.exists(a.out) else {"version": 1, "rules": []}
    rules = [r for r in old.get("rules", []) if not r.get("auto") or (a.only and r["n"] != a.only)]   # --only keeps other species' auto rules
    for n, page in SPECIES.items():
        if a.only and n != a.only:
            continue
        sp = forms.get(str(n))
        if not sp:
            continue
        info = {"names": {"base": sp["base"], **{f["id"]: f["name"] for f in sp["forms"]}}, "games": {f["id"]: f["g"] for f in sp["forms"]}}
        print(f"\n== {page} ({n})")
        try:
            if a.html:
                t = open(a.html, encoding="utf-8").read()
                html = json.loads(t)["parse"]["text"]["*"] if t.lstrip().startswith("{") else t
            else:
                html = B.fetch_html(page, a.cache, a.delay)
            found, miss, seen = parse(html, n, info, loc)
        except Exception as e:
            print(f"   could not fetch/parse ({e}); skipped")
            continue
        for r in found:
            print(f"   {r['area']}: {info['names'][r['form']]}   [{', '.join(r['g'])}]")
        for m in miss:
            print(f"   NOT MATCHED to a location name: {m}")
        if not found:
            print(f"   no form-by-location entries found. Parsed: {seen['lines']} lines, {seen['form lines']} naming a form. First lines seen:")
            for l in seen["sample"]:
                print("     |", l)
        rules += found
    if a.dry_run:
        return print("\nDry run: nothing written.")
    old["rules"] = rules
    json.dump(old, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nWrote {a.out}: {len(rules)} rules")


if __name__ == "__main__":
    main()