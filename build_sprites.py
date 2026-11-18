#!/usr/bin/env python3
"""
build_sprites.py - download the main-grid sprites (the ones build_forms.py does NOT fetch) for every game in
data/games.config.json whose sprite folder is missing some.

    python3 build_sprites.py                  # every game: only files that are missing are downloaded
    python3 build_sprites.py --only Black-White
    python3 build_sprites.py --dry-run        # just count what is missing

For each sprite folder it needs 1..<dex size> normal sprites, plus shiny/ ones if any game using the folder has "shiny": true.
Source: the PokeAPI sprite repository, at the game's "spriteRepo" path (https://github.com/PokeAPI/sprites).
Black / White / Black 2 / White 2 all share the "Black-White" folder (the repo has no separate Black 2 / White 2 sprites).
Existing files are never re-downloaded. Needs internet and the Python standard library; run from the project folder.
"""
import argparse, os, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
try:
    import gamesconfig as gamesconfig
except ImportError:
    import gamesconfig

import sys, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed


RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/"


def jobs(cfg, only, root):
    sets = {}
    for g in cfg["games"]:
        if not g.get("spriteRepo") or (only and g["sprites"] != only):
            continue
        s = sets.setdefault(g["sprites"], {"repo": g["spriteRepo"], "count": 0, "shiny": False})
        s["count"] = max(s["count"], g["count"])
        s["shiny"] = s["shiny"] or bool(g.get("shiny"))
    out = []
    for folder, s in sets.items():
        for n in range(1, s["count"] + 1):
            out.append((os.path.join(root, folder, f"{n}.png"), f"{s['repo']}/{n}.png"))
            if s["shiny"]:
                out.append((os.path.join(root, folder, "shiny", f"{n}.png"), f"{s['repo']}/shiny/{n}.png"))
    return [(d, r) for d, r in out if not (os.path.exists(d) and os.path.getsize(d) > 0)]


def fetch(job):
    dest, rel = job
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for attempt in range(3):
        try:
            req = urllib.request.Request(RAW + rel, headers={"User-Agent": "pokedex-tracker-build/1.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = r.read()
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, dest)          # no half-written files if interrupted
            return None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return rel + " (404, not in repo)"   # don't retry, it will never exist
            time.sleep(3 * (attempt + 1))            # 429 / 5xx: back off
        except Exception:
            time.sleep(2 ** attempt)
    return rel



def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--assets", default=os.path.join("assets", "sprites"))
    ap.add_argument("--only", help='one sprite folder, e.g. "Black-White"')
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    todo = jobs(gamesconfig.load(), a.only, a.assets)
    print(f"{len(todo)} sprite file(s) missing", flush=True)
    if a.dry_run or not todo:
        return
    failed, done = [], 0
    with ThreadPoolExecutor(8) as pool:
        futs = [pool.submit(fetch, j) for j in todo]
        try:
            for f in as_completed(futs):
                done += 1
                r = f.result()
                if r:
                    failed.append(r)
                if done % 25 == 0 or done == len(todo):
                    print(f"\r{done}/{len(todo)}  ({len(failed)} failed)", end="", flush=True)
        except KeyboardInterrupt:
            pool.shutdown(wait=False, cancel_futures=True)
            print("\nStopped. Run again to resume.")
            sys.exit(1)
    print(f"\nDone. {len(todo) - len(failed)} downloaded, {len(failed)} failed.")
    for r in failed[:20]:
        print("  ", r)


if __name__ == "__main__":
    main()
