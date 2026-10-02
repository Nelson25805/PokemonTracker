#!/usr/bin/env python3
"""
Build data/locations.json: where each Pokémon can be found in each game (Gen 1-4), plus what it
evolves from. The data comes from PokéAPI (https://pokeapi.co), which is free and needs no key.

    python3 build_locations.py                  # all 493 Pokémon -> data/locations.json
    python3 build_locations.py --limit 30       # quick trial run (first 30 Pokémon)
    python3 build_locations.py --no-evo         # skip evolution info (about half the requests)

Needs internet and only the Python standard library. It makes about 1,000 requests, so the first run
takes a few minutes. Every response is cached in .cache/pokeapi/, so an interrupted run picks up where
it stopped and a second run is instant. Please keep the cache; PokéAPI asks clients not to re-download.

Output format (what js/where.js reads):
    {
      "version": 1, "generated": "2026-10-02", "source": "...",
      "loc": { "<game key>": { "<national dex number>": [[area, method, minLevel, maxLevel, chance, conditions], ...] } },
      "evo": { "<national dex number>": [<number it evolves from>, "Level 16"] }
    }
Game keys match games.json (red, fire-red, heart-gold, ...).

Known gaps: PokéAPI records wild encounters, gifts and one-time (static) encounters, but not every
trade NPC, Game Corner prize, fossil or event Pokémon. The site's panel links to Bulbapedia for those.
"""
import argparse
import datetime
import json
import os
import re
import time
import urllib.error
import urllib.request

API = "https://pokeapi.co/api/v2"
MAX_POKEMON = 493

# PokéAPI version name -> this project's game key (the keys in games.json / config.js).
# PokéAPI also has things like "red-japan"; anything not listed here is ignored.
VERSIONS = {
    "red": "red", "blue": "blue", "yellow": "yellow",
    "gold": "gold", "silver": "silver", "crystal": "crystal",
    "ruby": "ruby", "sapphire": "sapphire", "emerald": "emerald",
    "firered": "fire-red", "leafgreen": "leaf-green",
    "diamond": "diamond", "pearl": "pearl", "platinum": "platinum",
    "heartgold": "heart-gold", "soulsilver": "soul-silver",
}


# ---------------------------------------------------------------- name tidying

ITEMS = {  # PokéAPI slugs that Title Case would get wrong
    "kings-rock": "King's Rock", "up-grade": "Up-Grade", "poke-ball": "Poké Ball",
    "mr-mime": "Mr. Mime", "mime-jr": "Mime Jr.", "farfetchd": "Farfetch'd",
    "nidoran-f": "Nidoran♀", "nidoran-m": "Nidoran♂",
}
LOWER = {"of", "the", "in", "to", "and", "towards", "from", "at", "on"}
SLOT2 = {"ruby": "Ruby", "sapphire": "Sapphire", "emerald": "Emerald", "firered": "FireRed", "leafgreen": "LeafGreen"}


def pretty(slug):
    """'thunder-stone' -> 'Thunder Stone'."""
    if slug in ITEMS:
        return ITEMS[slug]
    return " ".join(w.capitalize() for w in slug.split("-"))


def pretty_area(slug):
    """'kanto-route-2-south-towards-viridian-city' -> 'Kanto Route 2 South towards Viridian City'."""
    words = slug.split("-")
    if len(words) > 1 and words[-1] == "area":
        words = words[:-1]
    out = []
    for i, w in enumerate(words):
        if re.fullmatch(r"b?\d+f", w):
            out.append(w.upper())            # 1f -> 1F, b2f -> B2F
        elif w == "mt":
            out.append("Mt.")
        elif w == "ss":
            out.append("S.S.")
        elif w in LOWER and i > 0:
            out.append(w)
        else:
            out.append(w.capitalize())
    return " ".join(out)


def pretty_cond(slug):
    """Encounter condition -> short label, or None for the default / 'off' case (nothing worth showing)."""
    if slug.startswith("time-"):
        return slug[5:].capitalize()
    if slug == "swarm-yes":
        return "Swarm"
    if slug == "radar-on":
        return "Poké Radar"
    if slug.startswith("slot2-"):
        game = slug[6:]
        return None if game == "none" else f"{SLOT2.get(game, pretty(game))} in GBA slot"
    if slug.startswith("radio-"):
        r = slug[6:]
        return None if r == "off" else f"{r.capitalize()} radio"
    if slug.endswith(("-no", "-off", "-none")):
        return None
    return slug.replace("-", " ").capitalize()


# ---------------------------------------------------------------- evolution text

def describe_one(d):
    trigger = (d.get("trigger") or {}).get("name", "")
    held = (d.get("held_item") or {}).get("name")
    item = (d.get("item") or {}).get("name")
    if trigger == "use-item":
        text = f"Use {pretty(item)}" if item else "Use an item"
    elif trigger == "trade":
        text = "Trade"
        if held:
            text += f" holding {pretty(held)}"
        if d.get("trade_species"):
            text += f" for {pretty(d['trade_species']['name'])}"
    elif trigger == "level-up":
        if d.get("min_level"):
            text = f"Level {d['min_level']}"
        elif d.get("min_happiness"):
            text = "High friendship"
        elif d.get("min_beauty"):
            text = "High Beauty"
        elif d.get("known_move"):
            text = f"Level up knowing {pretty(d['known_move']['name'])}"
        elif d.get("known_move_type"):
            text = f"Level up knowing a {pretty(d['known_move_type']['name'])}-type move"
        elif d.get("location"):
            text = f"Level up at {pretty_area(d['location']['name'])}"
        elif d.get("party_species"):
            text = f"Level up with {pretty(d['party_species']['name'])} in the party"
        elif d.get("party_type"):
            text = f"Level up with a {pretty(d['party_type']['name'])}-type in the party"
        else:
            text = "Level up"
        if held:
            text += f" holding {pretty(held)}"
    else:
        text = pretty(trigger) if trigger else "Evolve"
    if d.get("time_of_day"):
        text += f" ({d['time_of_day']}time)" if d["time_of_day"] == "day" else f" ({d['time_of_day']})"
    if d.get("gender") in (1, 2):
        text += " (female)" if d["gender"] == 1 else " (male)"
    rel = d.get("relative_physical_stats")
    if rel is not None:
        text += {1: " (Attack > Defense)", -1: " (Defense > Attack)", 0: " (Attack = Defense)"}.get(rel, "")
    return text


def describe(details):
    seen, out = set(), []
    for d in details:
        t = describe_one(d)
        if t not in seen:
            seen.add(t)
            out.append(t)
    return " or ".join(out) if out else "Evolve"


def species_id(url):
    return int(re.search(r"/pokemon-species/(\d+)/?", url).group(1))


# ---------------------------------------------------------------- the build

def build(get, limit=MAX_POKEMON, with_evo=True, log=print):
    """get(path_or_url) -> parsed JSON. Kept separate from the network code so it can be tested."""
    loc = {key: {} for key in VERSIONS.values()}
    for n in range(1, limit + 1):
        per_game = {}  # game key -> {(area, method, conditions): [minLv, maxLv, chance]}
        for entry in get(f"pokemon/{n}/encounters"):
            area = pretty_area(entry["location_area"]["name"])
            for vd in entry["version_details"]:
                key = VERSIONS.get(vd["version"]["name"])
                if not key:
                    continue
                rows = per_game.setdefault(key, {})
                for d in vd["encounter_details"]:
                    conds = sorted(filter(None, (pretty_cond(c["name"]) for c in d.get("condition_values", []))))
                    row = rows.setdefault((area, d["method"]["name"], ", ".join(conds)), [d["min_level"], d["max_level"], 0])
                    row[0] = min(row[0], d["min_level"])
                    row[1] = max(row[1], d["max_level"])
                    row[2] += d["chance"]   # several slots of one method add up to the overall chance
        for key, rows in per_game.items():
            loc[key][str(n)] = [[a, m, r[0], r[1], min(r[2], 100), c] for (a, m, c), r in sorted(rows.items())]
        if n % 25 == 0 or n == limit:
            log(f"  encounters {n}/{limit}")

    evo = {}
    if with_evo:
        chains = get("evolution-chain?limit=2000")["results"]
        for i, ref in enumerate(chains, 1):
            def walk(node, parent):
                sid = species_id(node["species"]["url"])
                if parent and sid <= limit and parent <= limit:
                    evo[sid] = [parent, describe(node.get("evolution_details", []))]
                for child in node.get("evolves_to", []):
                    walk(child, sid)
            walk(get(ref["url"])["chain"], None)
            if i % 50 == 0 or i == len(chains):
                log(f"  evolution chains {i}/{len(chains)}")

    return {
        "version": 1,
        "generated": datetime.date.today().isoformat(),
        "source": "PokéAPI (https://pokeapi.co)",
        "loc": loc,
        "evo": {str(k): v for k, v in sorted(evo.items())},
    }


# ---------------------------------------------------------------- network + cache

def make_getter(cache_dir, delay):
    os.makedirs(cache_dir, exist_ok=True)

    def get(path):
        url = path if path.startswith("http") else f"{API}/{path}"
        fn = os.path.join(cache_dir, re.sub(r"[^a-z0-9]+", "_", url.lower()).strip("_") + ".json")
        if os.path.exists(fn):
            with open(fn, encoding="utf-8") as f:
                return json.load(f)
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "pokedex-tracker-build/1.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.load(r)
                break
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 4:
                    raise SystemExit(f"Giving up on {url}: {e}")
                time.sleep(2 ** attempt)
        with open(fn, "w", encoding="utf-8") as f:
            json.dump(data, f)
        time.sleep(delay)   # be polite to a free service
        return data

    return get


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=os.path.join("data", "locations.json"))
    ap.add_argument("--cache", default=os.path.join(".cache", "pokeapi"))
    ap.add_argument("--limit", type=int, default=MAX_POKEMON, help="only the first N Pokémon (default 493)")
    ap.add_argument("--delay", type=float, default=0.05, help="seconds to wait after each uncached request")
    ap.add_argument("--no-evo", action="store_true", help="skip evolution info")
    args = ap.parse_args()

    print(f"Fetching from PokéAPI (cached in {args.cache}) ...")
    data = build(make_getter(args.cache, args.delay), args.limit, not args.no_evo)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(args.out) / 1024
    print(f"Wrote {args.out} ({kb:,.0f} KB)")
    for key, mons in data["loc"].items():
        print(f"  {key:<12} {len(mons):>3} Pokémon with at least one location")
    print(f"  evolution info for {len(data['evo'])} Pokémon")


if __name__ == "__main__":
    main()
