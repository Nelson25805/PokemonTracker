#!/usr/bin/env python3
"""
match_unknown_areas.py - finds the real name of PokeAPI "Unknown Area NN" places by comparing their encounters with the
encounter tables on a Bulbapedia location page. Run from the project folder (needs internet the first time; pages are cached in
.cache/bulbapedia/ like build_items.py, which this script imports).

    # Victory Road, Black / White
    python3 match_unknown_areas.py --page "Victory_Road_(Black_and_White)" --games black,white --newprefix "Unova Victory Road"
    # Victory Road, Black 2 / White 2
    python3 match_unknown_areas.py --page "Victory_Road_(Black_2_and_White_2)" --games black-2,white-2 --newprefix "Unova Victory Road"
    # Castelia Sewers
    python3 match_unknown_areas.py --page "Castelia_Sewers" --games black,white,black-2,white-2 --newprefix "Castelia Sewers"

Nothing is written unless you add --write. Look at the printed table first.

How it matches: the page's tables are read section by section (the heading above each table is the section name). For every
"Unknown" area of the chosen games in data/locations.json, its set of (Pokemon, lowest level, highest level, rate) is compared
with each section's set, and the section with the highest overlap (Jaccard score) wins. Methods are ignored (PokeAPI and Bulbapedia
name them differently). Output marks each area:
    MATCH      one section is clearly best
    TIE        several sections score the same (rooms with identical Pokemon; the data can't tell them apart)
    WEAK       best score below --min (default 0.75): probably not on this page, or a different version's table
--write saves data/area-renames.json, which rename_unova_areas.py --renames reads. TIEs are skipped unless --ties first.
"""
import argparse, json, os, re, sys

try:
    import build_items as B                       # tiny HTML tree + cached Bulbapedia fetch (same folder)
except ImportError:
    sys.exit("Run this from the project folder: it imports build_items.py.")

HEADINGS = {"h2", "h3", "h4", "h5"}


def clean_title(t):
    """'1F (leftmost room), 2F-3F' -> '1F Leftmost Room and 2F-3F'"""
    t = re.sub(r"\[edit\]|\[.*?\]", "", t).strip()
    t = re.sub(r"\s*\(([^)]*)\)", r" \1", t)
    t = re.sub(r"\s*,\s*", " and ", t)
    words = re.sub(r"\s+", " ", t).split(" ")
    return " ".join(w if (w.lower() == "and" or re.match(r"^\d", w)) else w[:1].upper() + w[1:] for w in words)


def blocks(root):
    """Document order: ('h', heading text) and ('t', table node). Does not look inside tables."""
    def rec(n):
        for k in n.kids:
            if isinstance(k, str):
                continue
            if k.tag in HEADINGS:
                yield ("h", B.plain(k))
            elif k.tag == "table":
                yield ("t", k)
            else:
                yield from rec(k)
    yield from rec(root)


def mon_of(cell):
    for a in B.walk(cell):
        t = a.attrs.get("title", "")
        if a.tag == "a" and t.endswith("(Pokémon)"):
            return t[: -len("(Pokémon)")].strip()
    for im in B.walk(cell):
        if im.tag == "img" and im.attrs.get("alt") and not re.search(r"icon|\.png", im.attrs["alt"], re.I):
            return im.attrs["alt"].strip()
    return None


def parse_table(tbl):
    """-> set of (name, lo, hi, rate) for an encounter table (needs Levels and Rate cells); empty for other tables."""
    out = set()
    for tr in (n for n in B.walk(tbl) if n.tag == "tr"):
        cells = [k for k in tr.kids if isinstance(k, B.Node) and k.tag in ("td", "th")]
        name = next((m for m in (mon_of(c) for c in cells) if m), None)
        if not name:
            continue
        texts = [re.sub(r"\s+", " ", B.plain(c)).strip() for c in cells]
        rate = next((t for t in texts[::-1] if re.fullmatch(r"\d+(?:\.\d+)?%", t)), None)
        lvl = next((t for t in texts if re.fullmatch(r"\d+(?:\s*[-–,]\s*\d+)*", t)), None)
        if rate and lvl:
            nums = [int(x) for x in re.findall(r"\d+", lvl)]
            out.add((name, min(nums), max(nums), round(float(rate[:-1]))))
    return out


def sections(html):
    """[(title, set of encounters)] in page order; a heading's tables are merged."""
    secs, cur = [], None
    for kind, v in blocks(B.build(html)):
        if kind == "h":
            cur = clean_title(v)
        else:
            enc = parse_table(v)
            if enc:
                if secs and secs[-1][0] == cur:
                    secs[-1][1].update(enc)
                else:
                    secs.append((cur or "(no heading)", set(enc)))
    return secs


def jaccard(a, b):
    return len(a & b) / len(a | b) if a | b else 0.0


def title_case(s):
    return s


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--page", required=True, help='Bulbapedia page title, e.g. "Victory_Road_(Black_and_White)"')
    ap.add_argument("--games", required=True, help="comma-separated game keys the page covers, e.g. black,white")
    ap.add_argument("--newprefix", help='prefix for the new names, e.g. "Unova Victory Road" (default: the old name without "Unknown Area N")')
    ap.add_argument("--only", default="Unknown", help='only areas whose name contains this text (default "Unknown")')
    ap.add_argument("--match", help="regex the old name must match, e.g. '^Unova Victory Road'")
    ap.add_argument("--min", type=float, default=0.75, help="lowest score accepted as a match")
    ap.add_argument("--ties", choices=["skip", "first"], default="skip", help="what --write does with TIEs")
    ap.add_argument("--locations", default=os.path.join("data", "locations.json"))
    ap.add_argument("--pokemon", default=os.path.join("data", "pokemon.json"))
    ap.add_argument("--out", default=os.path.join("data", "area-renames.json"))
    ap.add_argument("--cache", default=os.path.join(".cache", "bulbapedia"))
    ap.add_argument("--delay", type=float, default=1.5)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    games = [g.strip() for g in a.games.split(",") if g.strip()]

    secs = sections(B.fetch_html(a.page, a.cache, a.delay))
    print(f"{a.page}: {len(secs)} encounter section(s)")
    for t, e in secs:
        print(f"   [{len(e):>2} rows] {t}")
    if not secs:
        sys.exit("No encounter tables found. Is the page title right? (Open it in a browser, copy the part after /wiki/.)")

    names = {m["n"]: m["name"] for m in json.load(open(a.pokemon, encoding="utf-8"))}
    loc = json.load(open(a.locations, encoding="utf-8"))["loc"]
    areas = {}                                         # old area name -> set of (name, lo, hi, rate)
    for g in games:
        for n, rows in loc.get(g, {}).items():
            for area, method, lo, hi, chance, cond in rows:
                if a.only.lower() in area.lower() and (not a.match or re.search(a.match, area)):
                    areas.setdefault(area, set()).add((names.get(int(n), f"#{n}"), lo, hi, round(chance)))
    if not areas:
        sys.exit(f"No area of {', '.join(games)} in {a.locations} matches '{a.only}'.")

    renames, gmap, amb = {}, {}, {}
    print(f"\n{'old name':<52} {'verdict':<6} {'score':>5}  Bulbapedia section")
    for old in sorted(areas, key=lambda s: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", s)]):
        sc = sorted(((jaccard(areas[old], e), t) for t, e in secs), key=lambda x: -x[0])
        best = sc[0][0]
        top = [t for s, t in sc if abs(s - best) < 1e-9]
        verdict = "WEAK" if best < a.min else "TIE" if len(top) > 1 else "MATCH"
        print(f"{old:<52} {verdict:<6} {best:5.2f}  {' | '.join(top)}")
        if verdict == "WEAK":
            continue
        prefix = a.newprefix or re.sub(r"\s*Unknown\s+\w+(\s+\d+)?\s*$", "", old).strip()
        if verdict == "TIE":
            amb[old] = [f"{prefix} {t}" for t in top]
            if a.ties == "skip":
                continue
        new = f"{prefix} {top[0]}"
        renames[old] = new
        gmap.setdefault(new, [])
        gmap[new] = sorted(set(gmap[new]) | set(games))

    print(f"\n{len(renames)} rename(s) proposed, {len(amb)} tie(s){' (skipped)' if a.ties == 'skip' and amb else ''}, "
          f"{len(areas) - len(renames) - (len(amb) if a.ties == 'skip' else 0)} weak.")
    if not a.write:
        return print("Preview only. Add --write to save", a.out)
    old = json.load(open(a.out, encoding="utf-8")) if os.path.exists(a.out) else {}
    old.setdefault("renames", {}).update(renames)
    old.setdefault("games", {})
    for k, v in gmap.items():
        old["games"][k] = sorted(set(old["games"].get(k, [])) | set(v))
    old.setdefault("ambiguous", {}).update(amb)
    json.dump(old, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("Wrote", a.out, "- now run: python3 rename_unova_areas.py --renames", a.out, "--dry-run")


if __name__ == "__main__":
    main()
