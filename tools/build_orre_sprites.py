#!/usr/bin/env python3
"""
build_orre_sprites.py - download the Pokémon Colosseum / XD: Gale of Darkness box sprites from Bulbagarden Archives and
save them as assets/sprites/Colosseum-XD/1.png .. 386.png, sized to match the rest of your sprites.

    python3 build_orre_sprites.py                      # crawl the live category, download, resize, save
    python3 build_orre_sprites.py --html p1.html p2.html ...       # same, but read category pages you saved from the browser
    python3 build_orre_sprites.py --dry-run            # list what would be downloaded, change nothing
    python3 build_orre_sprites.py --force              # redo sprites that already exist
    python3 build_orre_sprites.py --size 64            # force the output size instead of detecting it

Sources (Bulbagarden Archives):
  normal  https://archives.bulbagarden.net/wiki/Category:Colosseum_box_sprites          Box_Colo_001.png .. Box_Colo_386.png
  shiny   https://archives.bulbagarden.net/wiki/Category:Colosseum_Shiny_box_sprites    Box_Colo_001_s.png .. Box_Colo_386_s.png
Normal ones are saved as Colosseum-XD/N.png and shiny ones as Colosseum-XD/shiny/N.png. Colosseum and XD share these, so both
games use the one "Colosseum-XD" folder (see data/games.config.json).

Size: the output size is read from your Emerald sprites (the most common size in assets/sprites/Emerald), so the new
sprites match them. 64x64 sprites are saved untouched. A sprite that is a different size is fixed like this:
  - smaller            -> scaled up by a whole number (nearest neighbour, so pixels stay sharp), then centred
  - 1-4px too big      -> only transparent rows/columns are trimmed, no pixel is changed
  - still too big      -> scaled down (nearest neighbour) to fit
  - slightly smaller   -> padded with transparent pixels (bottom-aligned, centred sideways)
The untouched downloads are kept in .cache/orre-sprites-raw/ (already in .gitignore) so --force never needs the internet again.

Forms: Colosseum / XD have no form sprites of their own, so forms/ (and shiny/forms/) are copied from assets/sprites/Emerald
into the new folder (skip with --no-copy). If Emerald has none, run build_forms.py afterwards.

Needs internet (unless --html is used) and Pillow (pip install pillow). Run from the project folder.
"""
import argparse, collections, html, os, re, shutil, struct, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

CATEGORY = "https://archives.bulbagarden.net/wiki/Category:Colosseum_box_sprites"
SHINY_CATEGORY = "https://archives.bulbagarden.net/wiki/Category:Colosseum_Shiny_box_sprites"
UA = "pokedex-tracker-build/1.0"
COUNT = 386
FOLDER = "Colosseum-XD"
# the full-size file as it appears in the page, e.g. https://archives.bulbagarden.net/media/upload/b/bf/Box_Colo_001.png
BASE_RE = r"https://archives\.bulbagarden\.net/media/upload/[0-9a-f]/[0-9a-f]{2}/Box_Colo_(\d{3})"
FILE_RE = {"normal": re.compile(BASE_RE + r"\.png"), "shiny": re.compile(BASE_RE + r"_s\.png")}
NEXT_RE = re.compile(r'href="([^"]*[?&;]filefrom=[^"]*)"')


def get(url, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                return r.read()
        except Exception as e:
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


def parse_page(text, kind="normal"):
    """-> ({national number: file url} of this kind ("normal" or "shiny"), link to the next page of the category or None)."""
    found = {}
    for m in FILE_RE[kind].finditer(text):
        found.setdefault(int(m.group(1)), m.group(0))
    nxt = NEXT_RE.search(text)
    return found, (html.unescape(nxt.group(1)) if nxt else None)


def crawl(start, kind):
    """Follow the category's 'next page' links and collect every file."""
    sprites, url, seen = {}, start, set()
    while url and url not in seen and len(seen) < 30:
        seen.add(url)
        print(f"  reading {urllib.parse.unquote(url)}")
        found, nxt = parse_page(get(url).decode("utf-8", "replace"), kind)
        for n, u in found.items():
            sprites.setdefault(n, u)
        url = urllib.parse.urljoin(url, nxt) if nxt else None
    return sprites


def png_size(path):
    with open(path, "rb") as f:
        h = f.read(24)
    return struct.unpack(">II", h[16:24]) if h[:8] == b"\x89PNG\r\n\x1a\n" else None


def target_size(assets, override):
    """The size of your Emerald sprites (the most common one), or 64 if they can't be read."""
    if override:
        return override
    d = os.path.join(assets, "Emerald")
    sizes = collections.Counter()
    if os.path.isdir(d):
        for n in range(1, COUNT + 1):
            p = os.path.join(d, f"{n}.png")
            if os.path.exists(p):
                s = png_size(p)
                if s:
                    sizes[max(s)] += 1
    if sizes:
        return sizes.most_common(1)[0][0]
    print("  (no Emerald sprites found to measure, using 64)")
    return 64


def cut(lo_free, hi_free, excess):
    """How many pixels to trim at the start and at the end of one axis, using only transparent ones."""
    lo = min(lo_free, (excess + 1) // 2)
    hi = excess - lo
    if hi > hi_free:
        hi = hi_free
        lo = excess - hi
    return lo, hi


def fit(img, T):
    """Return img as exactly T x T: see the notes at the top of the file."""
    from PIL import Image
    img = img.convert("RGBA")
    w, h = img.size
    k = T // max(w, h)
    if k >= 2:                                                     # smaller than the target: whole-number upscale
        img = img.resize((w * k, h * k), Image.NEAREST)
        w, h = img.size
    if w > T or h > T:
        bb = img.getbbox() or (0, 0, w, h)                         # box around the visible pixels
        l, r = cut(bb[0], w - bb[2], max(0, w - T))
        t, b = cut(bb[1], h - bb[3], max(0, h - T))
        if l + r == max(0, w - T) and t + b == max(0, h - T):      # transparent edges were enough
            img = img.crop((l, t, w - r, h - b))
        else:                                                      # real pixels would be lost: scale down instead
            s = T / max(w, h)
            img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.NEAREST)
        w, h = img.size
    out = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    out.paste(img, ((T - w) // 2, T - h))                          # centred sideways, bottom-aligned
    return out


def process(job):
    n, url, raw, dest, T, force = job
    from PIL import Image
    try:
        if force or not os.path.exists(raw) or os.path.getsize(raw) == 0:
            os.makedirs(os.path.dirname(raw), exist_ok=True)
            data = get(url)
            with open(raw, "wb") as f:
                f.write(data)
        with Image.open(raw) as im:
            im.load()
            native = im.size
            out = fit(im, T)
        out.save(dest, optimize=True)
        return n, native, None
    except Exception as e:                                         # reported at the end; run again to retry
        return n, None, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--assets", default=os.path.join("assets", "sprites"))
    ap.add_argument("--cache", default=os.path.join(".cache", "orre-sprites-raw"))
    ap.add_argument("--category", default=CATEGORY, help="the normal sprites' category page to start from")
    ap.add_argument("--shiny-category", default=SHINY_CATEGORY, help="the shiny sprites' category page to start from")
    ap.add_argument("--html", nargs="+", metavar="FILE", help="read these saved category pages (normal and/or shiny) instead of the internet")
    ap.add_argument("--size", type=int, help="output size in px (default: the size of your Emerald sprites)")
    ap.add_argument("--force", action="store_true", help="redo sprites that already exist (and download the originals again)")
    ap.add_argument("--no-copy", action="store_true", help="don't copy forms/ from the Emerald folder")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    try:
        import PIL  # noqa: F401
    except ImportError:
        sys.exit("This script needs Pillow to resize the sprites. Install it with:  pip install pillow")

    found = {"normal": {}, "shiny": {}}
    print("Finding the sprites...")
    if a.html:
        for p in a.html:
            with open(p, encoding="utf-8", errors="replace") as f:
                text = f.read()
            for kind in found:
                for n, u in parse_page(text, kind)[0].items():
                    found[kind].setdefault(n, u)
    else:
        for kind, start in (("normal", a.category), ("shiny", a.shiny_category)):
            print(f" {kind}:")
            found[kind] = crawl(start, kind)
    for kind, sprites in found.items():
        missing = [n for n in range(1, COUNT + 1) if n not in sprites]
        print(f"{kind}: found {len(sprites)}" + (f"; no file for: {', '.join(map(str, missing))}" if missing else f" (1..{COUNT}, all there)."))
    if not found["normal"] and not found["shiny"]:
        sys.exit("Nothing found. Check the addresses, or pass saved pages with --html.")

    T = target_size(a.assets, a.size)
    out_dir = os.path.join(a.assets, FOLDER)
    todo = []
    for kind, sprites in found.items():
        sub = "shiny" if kind == "shiny" else ""
        for n, u in sorted(sprites.items()):
            dest = os.path.join(out_dir, sub, f"{n}.png")
            if n <= COUNT and (a.force or not (os.path.exists(dest) and os.path.getsize(dest) > 0)):
                todo.append((n, u, os.path.join(a.cache, sub, f"{n}.png"), dest, T, a.force))
    print(f"Output size {T}x{T}. {len(todo)} sprite(s) to do into {out_dir}")
    if a.dry_run or not todo:
        return
    os.makedirs(os.path.join(out_dir, "shiny"), exist_ok=True)

    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(process, todo))
    failed = [(j[3], err) for j, (_, _, err) in zip(todo, results) if err]
    odd = collections.Counter(s for _, s, err in results if not err and s != (T, T))
    print(f"Saved {len(results) - len(failed)} sprite(s)." + (f" {len(failed)} failed (run again to retry):" if failed else ""))
    for dest, err in failed[:10]:
        print(f"   {dest}: {err}")
    if odd:
        print("Resized to fit: " + ", ".join(f"{w}x{h} ({c})" for (w, h), c in odd.most_common()))
    else:
        print(f"Every sprite was already {T}x{T}.")

    if not a.no_copy:                                              # no form sprites exist for these games: reuse Emerald's
        src = os.path.join(a.assets, "Emerald")
        for sub in ("forms", os.path.join("shiny", "forms")):
            s, d = os.path.join(src, sub), os.path.join(out_dir, sub)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
                print(f"Copied Emerald/{sub} -> {FOLDER}/{sub}")
            else:
                print(f"No Emerald/{sub} folder to copy; run build_forms.py to fetch it.")
    print("Done. Make sure data/games.config.json has \"sprites\": \"Colosseum-XD\" for colosseum and xd.")


if __name__ == "__main__":
    main()