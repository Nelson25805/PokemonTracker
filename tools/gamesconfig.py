#!/usr/bin/env python3
"""
gamesconfig.py - reads data/games.config.json, the single source of truth for games.

Every build_*.py imports this instead of keeping its own list of games. Run it by itself to check the config:

    python3 gamesconfig.py

It prints a summary, then errors (the config is broken, fix before building) and warnings
(something is probably missing, e.g. an assets folder you haven't added yet).
"""
import json
import os
import sys

PATH = os.path.join("data", "games.config.json")


def load(path=PATH):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit(f"{path} not found. Run this from the project folder (the one that contains data/).")


def max_pokemon(cfg):
    """Highest national dex number any game needs (493 for Gens 1-4)."""
    return max(g["count"] for g in cfg["games"])


def versions(cfg):
    """PokéAPI version name -> game key (build_locations.py)."""
    return {g["pokeapi"]: g["key"] for g in cfg["games"] if g.get("pokeapi")}


def dexes(cfg):
    """PokéAPI regional pokedex names, each once, in game order (build_regional.py)."""
    out = []
    for g in cfg["games"]:
        d = (g.get("region") or {}).get("dex")
        if d and d not in out:
            out.append(d)
    return out


def bulbapedia_groups(cfg):
    """[(Bulbapedia link title, [game keys])] in game order (build_items.py)."""
    groups = {}
    for g in cfg["games"]:
        if g.get("bulbapedia"):
            groups.setdefault(g["bulbapedia"], []).append(g["key"])
    return list(groups.items())


def generations(cfg):
    """game key -> generation number (build_items.py)."""
    return {g["key"]: g["gen"] for g in cfg["games"]}


def sprite_sets(cfg):
    """[(path in the PokéAPI sprite repo, sprite folder, [game keys])] (build_forms.py).
    Games that share a sprite folder share one entry. Games with no "spriteRepo" have no forms."""
    sets = {}
    for g in cfg["games"]:
        if not g.get("spriteRepo"):
            continue
        entry = sets.setdefault(g["sprites"], (g["spriteRepo"], []))
        entry[1].append(g["key"])
    return [(repo, folder, keys) for folder, (repo, keys) in sets.items()]


def check(cfg):
    """-> (errors, warnings), lists of strings."""
    errors, warnings = [], []
    gens = cfg.get("generations", {})
    seen, apis, repos = set(), {}, {}
    for i, g in enumerate(cfg.get("games", [])):
        k = g.get("key", f"#{i}")
        for f in ("key", "name", "gen", "count", "sprites", "shiny"):
            if f not in g:
                errors.append(f"{k}: missing \"{f}\"")
        if k in seen:
            errors.append(f"{k}: duplicate key")
        seen.add(k)
        if str(g.get("gen")) not in gens:
            errors.append(f"{k}: generation {g.get('gen')} is not in \"generations\"")
        c = g.get("card")
        if c and c.get("layout") not in cfg.get("cardLayouts", {}):
            errors.append(f"{k}: card layout \"{c.get('layout')}\" is not in \"cardLayouts\"")
        d = g.get("diploma")
        if d and d not in cfg.get("diplomaLayouts", {}):
            errors.append(f"{k}: diploma layout \"{d}\" is not in \"diplomaLayouts\"")
        if g.get("pokeapi"):
            if g["pokeapi"] in apis:
                errors.append(f"{k}: pokeapi \"{g['pokeapi']}\" is already used by {apis[g['pokeapi']]}")
            apis[g["pokeapi"]] = k
        else:
            warnings.append(f"{k}: no \"pokeapi\" version, so build_locations.py gets no locations for it")
        if not g.get("region"):
            warnings.append(f"{k}: no \"region\" (no regional dex)")
        if not g.get("bulbapedia"):
            warnings.append(f"{k}: no \"bulbapedia\" title (no evolution-item locations)")
        if g.get("spriteRepo"):
            if repos.setdefault(g["sprites"], g["spriteRepo"]) != g["spriteRepo"]:
                errors.append(f"{k}: sprite folder \"{g['sprites']}\" has two different spriteRepo values")
        elif g.get("gen", 0) >= 2:
            warnings.append(f"{k}: no \"spriteRepo\", so it has no alternate forms or gender sprites")
        if os.path.isdir("assets"):
            paths = [os.path.join("assets", "sprites", g.get("sprites", "?"))]
            if c:
                paths.append(os.path.join("assets", "trainer-cards", c.get("dir") or g.get("sprites", "?")))
            if d in cfg.get("diplomaLayouts", {}):
                paths.append(os.path.join("assets", "diplomas", cfg["diplomaLayouts"][d]["dir"]))
            warnings += [f"{k}: folder {p} not found" for p in paths if not os.path.isdir(p)]
    return errors, warnings


if __name__ == "__main__":
    cfg = load()
    print(f"{len(cfg['games'])} games, national dex up to {max_pokemon(cfg)}")
    print("  regional dexes:", ", ".join(dexes(cfg)))
    print("  Bulbapedia groups:", len(bulbapedia_groups(cfg)), "| sprite sets for forms:", len(sprite_sets(cfg)))
    errs, warns = check(cfg)
    for w in warns:
        print("  warning:", w)
    for e in errs:
        print("  ERROR:", e)
    print("OK" if not errs else f"{len(errs)} error(s)")
    sys.exit(1 if errs else 0)
