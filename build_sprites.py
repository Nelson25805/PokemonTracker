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


ROOT = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/"
FALLBACK_USED = []


def jobs(cfg, only, root):
    """(destination, path under versions/, fallback URL or None) for every missing sprite file.
    A game may list "spriteRanges": [[1, 151], [808, 809]] when it only needs some Pokémon (Let's Go), and
    "spriteFallback": "default" to use the repo's default sprite (sprites/pokemon/<n>.png) when its own set lacks a number."""
    sets = {}
    for g in cfg["games"]:
        if not g.get("spriteRepo") or (only and g["sprites"] != only):
            continue
        s = sets.setdefault(g["sprites"], {"repo": g["spriteRepo"], "nums": set(), "shiny": False, "fallback": False})
        if g.get("spriteRanges"):
            for lo, hi in g["spriteRanges"]:
                s["nums"].update(range(lo, hi + 1))
        else:
            s["nums"].update(range(1, g["count"] + 1))
        s["shiny"] = s["shiny"] or bool(g.get("shiny"))
        s["fallback"] = s["fallback"] or g.get("spriteFallback") == "default"
    out = []
    for folder, s in sets.items():
        for n in sorted(s["nums"]):
            out.append((os.path.join(root, folder, f"{n}.png"), f"{s['repo']}/{n}.png", ROOT + f"{n}.png" if s["fallback"] else None))
            if s["shiny"]:
                out.append((os.path.join(root, folder, "shiny", f"{n}.png"), f"{s['repo']}/shiny/{n}.png", ROOT + f"shiny/{n}.png" if s["fallback"] else None))
    return [j for j in out if not (os.path.exists(j[0]) and os.path.getsize(j[0]) > 0)]


def to_png(data):
    """GIF bytes -> PNG bytes. Keeps the first frame and its transparency, then softens the edges: GIFs can only
    cut transparency on or off, which leaves jagged outlines, so the image is enlarged 3x and the outline is
    blurred a little (in premultiplied colour, so no halo). The art itself is not replaced or redrawn. Needs Pillow."""
    import io
    from PIL import Image, ImageFilter
    im = Image.open(io.BytesIO(data))
    im.seek(0)
    im = im.convert("RGBA")
    big = im.resize((im.width * 3, im.height * 3), Image.BICUBIC)
    soft = big.convert("RGBa").filter(ImageFilter.GaussianBlur(0.9)).convert("RGBA")
    r, g, b, a = soft.split()
    a = a.point(lambda v: max(0, min(255, int((v - 60) * 255 / 140))))
    out = io.BytesIO()
    Image.merge("RGBA", (r, g, b, a)).save(out, "PNG")
    return out.getvalue()


def fetch(job):
    """Download one sprite as <n>.png. Tries the game's own repo path, then the fallback if there is one.
    Folders that only have .gif files are converted to PNG (first frame); that needs Pillow: pip install pillow"""
    dest, rel, alt = job
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for url_png in [RAW + rel] + ([alt] if alt else []):
        for ext in (".png", ".gif"):
            url = url_png[:-4] + ext
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "pokedex-tracker-build/1.0"})
                    with urllib.request.urlopen(req, timeout=15) as r:
                        data = r.read()
                    if ext == ".gif":
                        try:
                            data = to_png(data)
                        except ImportError:
                            return "the repo has GIFs here and converting them needs Pillow: run  pip install pillow"
                    tmp = dest + ".part"
                    with open(tmp, "wb") as f:
                        f.write(data)
                    os.replace(tmp, dest)          # no half-written files if interrupted
                    if url_png == alt:
                        FALLBACK_USED.append(dest)
                    return None
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        break                       # not this extension / not this place: try the next
                    time.sleep(3 * (attempt + 1))   # 429 / 5xx: back off
                except Exception:
                    time.sleep(2 ** attempt)
            else:
                return url + " (failed)"
    return RAW + rel + " (404, not in repo as .png or .gif)"



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
    # preflight: try the first file of every sprite folder, so a wrong repo path is reported once instead of thousands of times
    top = lambda j: os.path.relpath(j[0], a.assets).split(os.sep)[0]
    first, dead = {}, set()
    for j in todo:
        first.setdefault(top(j), j)
    for folder, j in first.items():
        err = fetch(j)
        if err:
            print(f"  {folder}: first file failed: {err}")
            dead.add(folder)
    todo = [j for j in todo if top(j) not in dead and not os.path.exists(j[0])]
    if dead:
        print(f"Skipping {len(dead)} folder(s) that failed the preflight: {', '.join(sorted(dead))}")
    print(f"{len(todo)} file(s) to download", flush=True)
    if not todo:
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
    if FALLBACK_USED:
        print(f"{len(FALLBACK_USED)} file(s) came from the repo's default sprites (sprites/pokemon/), because the game's own set lacks them.")
    for r in failed[:20]:
        print("  ", r)


if __name__ == "__main__":
    main()