#!/usr/bin/env python3
"""
add_areas.py - import location boxes for ANY map into data/maps.json.

Run from the project folder (the one containing data/). Typical use:

  # HTML copied from the SimplyBLG page (anything containing <area ... coords=... title=...> tags)
  python3 add_areas.py --map hoenn-rse --input hoenn.html --prefix Hoenn

  # A later game, with different files / scale
  python3 add_areas.py --map sinnoh-dp --input sinnoh.html --scale 1.5

  # Map still a placeholder (w/h/grid = 0)? Give it its real size. Scale "auto" = canvas width on the page / map width
  python3 add_areas.py --map kanto-frlg --input kanto-frlg.html --prefix Kanto --size 192x144 --grid 8 --scale auto --panel 1

  # A brand-new map in one go (name, flashing style, which games use it, picture saved to assets/maps/):
  python3 add_areas.py --map sevii-123-frlg --new --name "Sevii Islands 1, 2 & 3" --flash --games fire-red,leaf-green \\
          --input sevii-123.html --scale auto --panel 2 --save-image

  # Several files at once, preview only
  python3 add_areas.py --map unova-bw --input a.html b.json --dry-run

Input formats (auto-detected, can be mixed):
  .html/.htm/.txt with <area> tags     title="Name" coords="x1,y1,x2,y2,..."  (poly / rect / circle)
  .json   {"Name": "x1,y1,..."}   or   {"Name": [[x,y,w,h], ...]}   or   [{"name":..., "coords":...}, ...]
  .csv    Name,x1,y1,x2,y2,...   (one polygon per line; repeat the name for multi-part places)

How it works
  * Source coords are divided by --scale (default 1.5: SimplyBLG draws on a canvas 1.5x your map), then
    painted onto your --tile grid (default 8px) and merged into rectangles. Non-rectangular shapes
    (L-shaped routes etc.) therefore come out as several exact boxes, not one big bounding box.
  * Existing areas on that map are KEPT; same-named entries are overwritten. Use --replace to wipe the map first.
  * Names are tidied (typos such as "Rotue", extra spaces). --prefix adds a region prefix to routes,
    Victory Road and Safari Zone (matching how your build_locations.py names them, e.g. "Hoenn Route 104").
  * --aliases file.json gives extra spellings that share the same boxes:
        {"Mt. Pyre": ["Mt. Pyre Summit", "Mt. Pyre Interior"], "Shoal Cave": ["Shoal Cave Low Tide"]}
    Alias sets for places PokeAPI splits into rooms live nicely in one file per region.
    An extra name may contain a * wildcard ({"Mt. Coronet": ["Mt. Coronet *"]}): it is expanded against every name in the
    --check locations.json file, so you don't have to list each floor or room by hand.
  * --tile auto works out the map's grid from the shapes themselves (use it when boxes look slightly off), and
    --preview check.html writes a page that draws every box over the map picture so you can see the result at once.
  * --times marks the map as having a Morning / Day / Night clock (Sinnoh): the hover tooltip then says when a Pokemon is there.
  * A backup (maps.json.bak) is written before saving. Nothing is written with --dry-run.
"""
import argparse, base64, csv, difflib, fnmatch, json, os, re, shutil, struct, sys
from collections import defaultdict
from html.parser import HTMLParser

TYPOS = {"Rotue": "Route", "Safron": "Saffron"}
DEFAULT_PREFIX_PATTERN = r"^(Route \d+|Victory Road|Safari Zone)\b"


# ---------- parsing ----------
class _AreaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        if tag != "area":
            return
        a = dict(attrs)
        if a.get("coords") and (a.get("title") or a.get("alt")):
            self.found.append((a.get("title") or a.get("alt"), a.get("shape", "poly"), a["coords"]))


def nums(s):
    return [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", s)]


def shape_to_polygon(shape, coords):
    n = nums(coords) if isinstance(coords, str) else list(coords)
    shape = (shape or "poly").lower()
    if shape == "rect" and len(n) >= 4:
        x1, y1, x2, y2 = n[:4]
        return [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
    if shape == "circle" and len(n) >= 3:
        x, y, r = n[:3]
        return [(x - r, y - r), (x + r, y - r), (x + r, y + r), (x - r, y + r)]
    pts = list(zip(n[0::2], n[1::2]))
    return pts if len(pts) >= 3 else None


def load_source(path):
    """Returns list of (name, polygon-in-source-px) or (name, ('rects', [[x,y,w,h]...]) already in map px)."""
    ext = os.path.splitext(path)[1].lower()
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    out = []
    if ext == ".json" or text.lstrip().startswith(("{", "[")):
        data = json.loads(text)
        items = data.items() if isinstance(data, dict) else [(d.get("name") or d.get("title"), d.get("coords")) for d in data]
        for name, val in items:
            if isinstance(val, list) and val and isinstance(val[0], list):
                out.append((name, ("rects", val)))
            else:
                poly = shape_to_polygon("poly", val)
                if poly:
                    out.append((name, poly))
    elif ext == ".csv":
        for row in csv.reader(text.splitlines()):
            if len(row) >= 7 and row[0].strip():
                poly = shape_to_polygon("poly", ",".join(row[1:]))
                if poly:
                    out.append((row[0], poly))
    else:
        p = _AreaParser()
        p.feed(text)
        for name, shape, coords in p.found:
            poly = shape_to_polygon(shape, coords)
            if poly:
                out.append((name, poly))
    return out


def find_canvas_width(paths):
    return (find_canvas_size(paths) or (None, None))[0]


def find_canvas_size(paths):
    """(width, height) of the <canvas> in the first HTML input that has one (height may be None)."""
    for p in paths:
        if os.path.splitext(p)[1].lower() in (".json", ".csv"):
            continue
        with open(p, encoding="utf-8-sig") as f:
            tag = re.search(r"<canvas[^>]*>", f.read())
        if tag:
            w = re.search(r"\swidth=\"(\d+)\"", tag[0])
            h = re.search(r"\sheight=\"(\d+)\"", tag[0])
            if w:
                return int(w[1]), (int(h[1]) if h else None)
    return None


def find_embedded_png(paths):
    """The map picture, if the HTML has it inline: <img id="mapIMG" src="data:image/png;base64,...">  -> bytes or None."""
    for p in paths:
        if os.path.splitext(p)[1].lower() in (".json", ".csv"):
            continue
        with open(p, encoding="utf-8-sig") as f:
            m = re.search(r'<img[^>]*id="mapIMG"[^>]*src="data:image/png;base64,([^"]+)"', f.read())
        if m:
            try:
                return base64.b64decode(re.sub(r"\s+", "", m[1]))
            except ValueError:
                return None
    return None


_FLOOR = re.compile(r"^b?\d+[fr]$", re.I)
_WORDS = {"north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "ne", "nw", "se", "sw",
          "area", "entrance", "exterior", "outside"}


def place_key(area):
    """Same rule as Maps.placeKey in maps.js: 'Mt. Moon B1F' -> 'Mt. Moon', 'Route 2 South towards X' -> 'Route 2'."""
    w = re.split(r"\s+towards\s+", str(area), flags=re.I)[0].strip().split()
    while len(w) > 1 and (_FLOOR.match(w[-1]) or w[-1].lower() in _WORDS):
        w.pop()
    return " ".join(w)


def png_size(b):
    return struct.unpack(">II", b[16:24]) if b and b[:8] == b"\x89PNG\r\n\x1a\n" else None


# ---------- geometry ----------
def inside(px, py, poly):
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def is_rect(poly):
    xs, ys = {p[0] for p in poly}, {p[1] for p in poly}
    return len(xs) == 2 and len(ys) == 2 and len(poly) == 4


def snapped_rect(poly, scale, tile, yscale=None):
    """Axis-aligned box: round each edge to the grid (at least one tile)."""
    ys_ = yscale or scale
    sn = lambda v, s_: round(v / s_ / tile) * tile
    x0, x1 = sn(min(p[0] for p in poly), scale), sn(max(p[0] for p in poly), scale)
    y0, y1 = sn(min(p[1] for p in poly), ys_), sn(max(p[1] for p in poly), ys_)
    return [[x0, y0, max(tile, x1 - x0), max(tile, y1 - y0)]]


def polygon_to_cells(poly, scale, tile, yscale=None):
    """Paint the polygon (source px) onto the tile grid; a cell is on if its centre is inside."""
    pts = [(x / scale, y / (yscale or scale)) for x, y in poly]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    c0, c1 = int(min(xs) // tile), int(max(xs) // tile)
    r0, r1 = int(min(ys) // tile), int(max(ys) // tile)
    cells = {(c, r) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)
             if inside((c + .5) * tile, (r + .5) * tile, pts)}
    if not cells:  # tiny shape: keep at least the cell under its centre
        cells = {(int(sum(xs) / len(xs) // tile), int(sum(ys) / len(ys) // tile))}
    return cells


def cells_to_rects(cells, tile):
    """Merge a set of grid cells into few rectangles: horizontal runs, then stack identical runs."""
    rows = defaultdict(list)
    for c, r in sorted(cells, key=lambda t: (t[1], t[0])):
        rows[r].append(c)
    runs = []  # (r, c_start, c_end)
    for r, cs in rows.items():
        start = prev = cs[0]
        for c in cs[1:]:
            if c != prev + 1:
                runs.append((r, start, prev))
                start = c
            prev = c
        runs.append((r, start, prev))
    runs.sort(key=lambda t: (t[1], t[2], t[0]))
    rects, cur = [], None
    for r, a, b in runs:
        if cur and cur[1] == a and cur[2] == b and cur[4] == r - 1:
            cur[4] = r
        else:
            if cur:
                rects.append(cur)
            cur = [None, a, b, r, r]
    if cur:
        rects.append(cur)
    return [[a * tile, r0 * tile, (b - a + 1) * tile, (r1 - r0 + 1) * tile] for _, a, b, r0, r1 in rects]


def detect_tile(shapes, sx, sy):
    """Find the map's tile size: the biggest T (4..24 map px) that nearly all polygon corners sit on. None if no clean grid."""
    pts = [(x / sx, y / sy) for sh in shapes for x, y in sh]
    if len(pts) < 12:
        return None
    tol = 0.7 / min(sx, sy) + 0.1                                       # source coords are whole numbers, so allow their rounding
    score = {t: sum(1 for x, y in pts if abs(x - round(x / t) * t) <= tol and abs(y - round(y / t) * t) <= tol) / len(pts)
             for t in range(4, 25)}
    best = max(score.values())
    if best < 0.75:
        return None
    # the biggest tile that still fits nearly as well as the best one (a grid of 8 also fits a grid of 4, only less well)
    return max(t for t, v in score.items() if v >= max(0.75, best - 0.2))


def preview_html(mp, boxes, path):
    """A stand-alone page: the map picture with every imported box drawn on it (hover a box for its name)."""
    w, h = mp["w"], mp["h"]
    items = []
    for name, rs in sorted(boxes.items()):
        for x, y, bw, bh in rs:
            nm = name.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
            items.append(f'<i title="{nm}" data-n="{nm}" style="left:{x / w * 100:.3f}%;top:{y / h * 100:.3f}%;'
                         f'width:{bw / w * 100:.3f}%;height:{bh / h * 100:.3f}%"></i>')
    page = ("<!doctype html><meta charset=utf-8><title>Import preview</title>"
            "<style>body{font:14px sans-serif;margin:12px}#m{position:relative;max-width:900px;line-height:0}#m img{width:100%;image-rendering:pixelated}"
            "#m i{position:absolute;background:rgba(255,0,0,.35);outline:1px solid rgba(255,255,255,.9);box-sizing:border-box}"
            "#m i:hover{background:rgba(255,230,0,.7);z-index:2}#t{margin:8px 0;min-height:1.4em;font-weight:600}</style>"
            f"<p>Every box the import made, over <code>{mp['img']}</code>. They should sit exactly on the routes and places of the picture. "
            f"({len(boxes)} places, map {w}x{h})</p><label><input type=range min=0 max=100 value=100 oninput=\"m.querySelector('img').style.opacity=this.value/100\"> picture opacity</label>"
            f"<div id=t>Hover a box</div><div id=m><img src=\"{mp['img']}\">{''.join(items)}</div>"
            "<script>m.onmouseover=e=>{if(e.target.dataset.n)t.textContent=e.target.dataset.n}</script>")
    with open(path, "w", encoding="utf-8") as f:
        f.write(page)


# ---------- names ----------
def clean_name(name, prefix, prefix_pattern):
    name = re.sub(r"\s+", " ", name).strip()
    for bad, good in TYPOS.items():
        name = name.replace(bad, good)
    if prefix and re.match(prefix_pattern, name) and not name.startswith(prefix + " "):
        name = f"{prefix} {name}"
    return name


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--map", required=True, help='map id in maps.json, e.g. "hoenn-rse"')
    ap.add_argument("--input", required=True, nargs="+", help="one or more source files")
    ap.add_argument("--data", default=os.path.join("data", "maps.json"), help="path to maps.json")
    ap.add_argument("--scale", default="1.5", help='source px per map px (default 1.5), or "auto" = <canvas> width in the HTML / map width')
    ap.add_argument("--tile", default="8", help='grid size in map px (default 8), or "auto" = work it out from the shapes (exact boxes if there is no clean grid)')
    ap.add_argument("--yscale", type=float, help="vertical scale if it differs from --scale (default: from the page's canvas height, when it has one)")
    ap.add_argument("--preview", metavar="FILE.html", help="also write a page that draws every imported box over the map picture, to check the result by eye")
    ap.add_argument("--prefix", default="", help='region prefix for routes etc., e.g. "Hoenn"')
    ap.add_argument("--prefix-pattern", default=DEFAULT_PREFIX_PATTERN, help="regex for names that get the prefix")
    ap.add_argument("--size", metavar="WxH", help="map pixel size if it is missing / 0, e.g. 192x144 (default: read from the embedded picture)")
    ap.add_argument("--grid", type=int, help="set the map's grid if it is missing / 0 (defaults to --tile)")
    ap.add_argument("--region", metavar="x0,y0,x1,y1",
                    help="only import shapes inside this source-px rectangle and shift it to the origin "
                         "(for pages that stack several maps in one coordinate space)")
    ap.add_argument("--panel", type=int, metavar="N",
                    help="for pages that stack several maps vertically: import only the N-th map (1 = first). The panel height is "
                         "worked out from the map height and the scale, so it does not depend on the browser window width the page "
                         "was saved at (unlike --region)")
    ap.add_argument("--rename", help='JSON file: {"source name": "your name"} applied before prefixing; '
                                     "sources renamed to the same name are merged")
    ap.add_argument("--save-image", metavar="PNG", nargs="?", const="auto",
                    help="also save the map picture if the HTML embeds it. Bare --save-image = assets/maps/<map id>.png")
    ap.add_argument("--image", metavar="PNG",
                    help="a map picture you already have, e.g. assets\\maps\\sevii-67-frlg.png: sets the map's size and img path from it")
    ap.add_argument("--check", metavar="locations.json",
                    help="after importing, list every location in data/locations.json (for this map's games) that still has no box")
    ap.add_argument("--new", action="store_true",
                    help="create the map in maps.json if it isn't there (size from --size or from the embedded picture)")
    ap.add_argument("--name", help='display name / tab label, e.g. "Sevii Islands 1, 2 & 3"')
    ap.add_argument("--times", action="store_true", help='map has a Morning / Day / Night clock (maps.json "times": true; Sinnoh)')
    ap.add_argument("--flash", action="store_true", help="use the flashing Gen 3 style for this map (maps.json \"flash\": true)")
    ap.add_argument("--games", help="comma-separated game keys that use this map, e.g. fire-red,leaf-green (added to maps.json \"games\")")
    ap.add_argument("--aliases", help="JSON file: {name: [extra names sharing the same boxes]}")
    ap.add_argument("--replace", action="store_true", help="remove the map's existing areas first")
    ap.add_argument("--create", metavar="WxH", help="like --new, with an explicit size, e.g. 192x144")
    ap.add_argument("--dry-run", action="store_true", help="show what would change; write nothing")
    args = ap.parse_args()
    auto_tile = str(args.tile).lower() == "auto"
    try:
        args.tile = 8 if auto_tile else int(args.tile)                  # "auto" is settled below, once the shapes are read
    except ValueError:
        sys.exit('--tile needs a whole number (e.g. 8) or the word auto')

    # fail early, and helpfully, if any file path is wrong
    for label, p in [("--data", args.data)] + [("--input", p) for p in args.input] + \
            [(f"--{k}", getattr(args, k)) for k in ("rename", "aliases") if getattr(args, k)]:
        if not os.path.isfile(p):
            here = os.path.dirname(os.path.abspath(p)) or "."
            near = difflib.get_close_matches(os.path.basename(p),
                                             os.listdir(here) if os.path.isdir(here) else [], n=3, cutoff=0.5)
            html = [n for n in os.listdir(".") if n.lower().endswith((".html", ".htm", ".json", ".csv"))][:8]
            sys.exit(f'{label}: file not found: "{p}"\n'
                     f'  Running from: {os.getcwd()}\n'
                     + (f'  Did you mean: {", ".join(near)}?\n' if near else "")
                     + (f'  Data files in this folder: {", ".join(html)}\n' if html else "")
                     + "  Tip: save the page next to maps.json's folder, or pass the full path in quotes.")

    with open(args.data, encoding="utf-8") as f:
        db = json.load(f)
    maps = db.setdefault("maps", {})
    emb = find_embedded_png(args.input)
    wh = None                                                           # size to use if the map has none
    for label, val in (("--size", args.size), ("--create", args.create)):
        if val:
            m = re.fullmatch(r"(\d+)x(\d+)", val.lower().strip())
            if not m:
                sys.exit(f'{label} needs real numbers such as 192x144 (you gave "{val}"; WxH was only a placeholder)')
            wh = (int(m[1]), int(m[2]))
    img_path = None
    if args.image:
        if not os.path.isfile(args.image):
            sys.exit(f'--image: file not found: "{args.image}" (running from {os.getcwd()})')
        with open(args.image, "rb") as f:
            sz = png_size(f.read(32))
        if not sz:
            sys.exit(f'--image: "{args.image}" is not a PNG file')
        img_path = os.path.relpath(args.image).replace("\\", "/")
        if not wh:
            wh = sz
    if not wh and png_size(emb):
        wh = png_size(emb)
        print(f"  size {wh[0]}x{wh[1]} read from the embedded map picture")
    if not wh and args.map in maps:                                     # no embedded picture: use the map's picture file if it is already on disk
        for cand in (maps[args.map].get("img"), os.path.join("assets", "maps", args.map + ".png")):
            if cand and os.path.isfile(cand):
                with open(cand, "rb") as f:
                    sz = png_size(f.read(32))
                if sz:
                    wh = sz
                    print(f"  size {wh[0]}x{wh[1]} read from {cand}")
                    break
    if args.map not in maps:
        close = difflib.get_close_matches(args.map, list(maps), n=3, cutoff=0.6)
        hint = f' Did you mean: {", ".join(close)}?' if close else ""
        if not (args.new or args.create):
            sys.exit(f'No map "{args.map}" in {args.data}.{hint}\nKnown maps: {", ".join(maps) or "none"}.\n'
                     f'(To add a new map on purpose, add --new)')
        if not wh:
            sys.exit('--new needs a size: add --image <the map picture>, or --size 192x144 (the picture\'s pixel size).')
        maps[args.map] = {"name": args.name or args.map, "img": img_path or f"assets/maps/{args.map}.png", "w": wh[0], "h": wh[1],
                          "grid": args.grid or args.tile}
        print(f'  created map "{args.map}" ({wh[0]}x{wh[1]})')
    mp = maps[args.map]
    if not mp.get("w") or not mp.get("h"):
        if not wh:
            sys.exit(f'Map "{args.map}" has no size yet (w/h are 0), and this page does not contain the map picture.\n'
                     f'  Fix: save the map picture from the website (right-click it > Save image as) to assets\\maps\\{args.map}.png and run again,\n'
                     f'  or give the size yourself: --size WIDTHxHEIGHT using the picture\'s real pixel size (e.g. --size 256x192).')
        mp["w"], mp["h"] = wh
        print(f'  set {args.map} size to {wh[0]}x{wh[1]}')
    elif wh and args.size and tuple(wh) != (mp["w"], mp["h"]):
        print(f'  ! --size ignored: map already has size {mp["w"]}x{mp["h"]}')
    grid_unset = not mp.get("grid")
    if grid_unset:
        mp["grid"] = args.grid or args.tile
    if args.name:
        mp["name"] = args.name
    if img_path:
        mp["img"] = img_path
    if args.flash:
        mp["flash"] = True
    if args.times:
        mp["times"] = True
    mw, mh = mp["w"], mp["h"]
    for g in [x.strip() for x in (args.games or "").split(",") if x.strip()]:
        lst = db.setdefault("games", {}).setdefault(g, [])
        if args.map not in lst:
            lst.append(args.map)
            print(f"  added {args.map} to {g}")
    if emb and png_size(emb) and (mw, mh) != tuple(png_size(emb)):
        print(f"  ! the embedded picture is {png_size(emb)[0]}x{png_size(emb)[1]} but the map is {mw}x{mh}")

    canvas_h = None
    if str(args.scale).lower() == "auto":
        size = find_canvas_size(args.input)
        if not size:
            sys.exit('--scale auto needs a <canvas width="..."> in an HTML input; pass a number instead.')
        cw, canvas_h = size
        args.scale = cw / mw
        print(f"  auto scale = {cw} / {mw} = {args.scale:.4f}")
    else:
        args.scale = float(args.scale)
    # Some pages draw the map slightly stretched (Hoenn's canvas was 388x240 for a 256x156 map: 1.516 across, 1.538 down).
    # When the canvas height is known (and the page is not a stack of several maps) use a separate vertical scale.
    yscale = args.yscale
    if not yscale and canvas_h and not (args.panel or args.region):
        ys = canvas_h / mh
        if abs(ys / args.scale - 1) > 0.015:
            yscale = ys
            print(f"  vertical scale = {canvas_h} / {mh} = {ys:.4f} (differs from the horizontal {args.scale:.4f}, so it is used separately)")
    yscale = yscale or args.scale
    region = None
    if args.region and args.panel:
        sys.exit("Use either --region or --panel, not both.")
    if args.region:
        region = nums(args.region)
        if len(region) != 4:
            sys.exit("--region needs four numbers: x0,y0,x1,y1")
    if args.panel:
        if args.panel < 1:
            sys.exit("--panel counts from 1")
        ph = mh * args.scale                                            # one panel's height in the page's pixels
        region = [0, (args.panel - 1) * ph, float("inf"), args.panel * ph]
        print(f"  panel {args.panel}: page y {region[1]:.0f} to {region[3]:.0f} (panel height {ph:.0f})")
    renames = {}
    if args.rename:
        with open(args.rename, encoding="utf-8") as f:
            renames = json.load(f)

    if args.save_image:
        dest = os.path.join("assets", "maps", f"{args.map}.png") if args.save_image == "auto" else args.save_image
        if emb:
            if not args.dry_run:
                os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
                with open(dest, "wb") as out:
                    out.write(emb)
            print(f"  map picture {'would be saved' if args.dry_run else 'saved'} to {dest}")
        elif not img_path:
            print("  ! no embedded map picture in the input (the page only links to it). "
                  "Open the site's image URL in your browser and save it manually.")

    # read every shape (cut to the panel if there is one)
    shapes = []                                                         # (name, polygon in page px, or ("rects", ...))
    for path in args.input:
        for name, shape in load_source(path):
            if region and not isinstance(shape, tuple):
                cx = sum(p[0] for p in shape) / len(shape)
                cy = sum(p[1] for p in shape) / len(shape)
                if not (region[0] <= cx < region[2] and region[1] <= cy < region[3]):
                    continue
                shape = [(x - region[0], y - region[1]) for x, y in shape]
            shapes.append((name, shape))
    polys = [sh for _, sh in shapes if not isinstance(sh, tuple)]

    if auto_tile:
        t = detect_tile(polys, args.scale, yscale)
        if t:
            args.tile = t
            print(f"  auto tile = {t} map px (nearly every corner sits on that grid)")
        else:
            args.tile = 1
            print("  auto tile: no clean grid found, so the boxes follow the drawn shapes exactly (1 px)")
        if grid_unset:
            mp["grid"] = args.grid or (args.tile if args.tile >= 4 else 8)

    # sanity check: the smallest shapes are one tile (--tile map px), so their size / tile should equal the scale
    pitches, ypitches = [], []
    for shape in polys:
        if is_rect(shape):
            xs_, ys_ = [p[0] for p in shape], [p[1] for p in shape]
            if min(max(xs_) - min(xs_), max(ys_) - min(ys_)) > 2:
                pitches.append(max(xs_) - min(xs_))
                ypitches.append(max(ys_) - min(ys_))
    if len(pitches) >= 8 and args.tile >= 4:
        pitches.sort()
        guess = pitches[len(pitches) // 5] / args.tile                  # a low percentile: most places are one tile wide
        if abs(guess / args.scale - 1) > 0.12:
            print(f"  ! the shapes look like they were drawn at scale {guess:.2f}, but the scale in use is {args.scale:.2f}. "
                  f"Try --scale {guess:.3f}")

    boxes = {}
    for name, shape in shapes:
        name = clean_name(renames.get(name, name), args.prefix, args.prefix_pattern)
        if isinstance(shape, tuple):
            rects = [list(map(int, r)) for r in shape[1]]
        else:
            rects = (snapped_rect(shape, args.scale, args.tile, yscale) if is_rect(shape)
                     else cells_to_rects(polygon_to_cells(shape, args.scale, args.tile, yscale), args.tile))
        boxes.setdefault(name, []).extend(rects)
    if not boxes:
        sys.exit("No locations found in the input files (looked for <area> tags, JSON and CSV).")

    aliases = {}
    if args.aliases:
        with open(args.aliases, encoding="utf-8") as f:
            aliases = json.load(f)
    all_names = set()                                                   # every location name in locations.json, for "*" aliases
    if args.check:
        with open(args.check, encoding="utf-8") as f:
            for rows_by_n in json.load(f)["loc"].values():
                for rows in rows_by_n.values():
                    all_names.update(r[0] for r in rows)
    wild = [a for alts in aliases.values() for a in alts if "*" in a]
    if wild and not args.check:
        print('  ! some aliases use "*" but there is no --check locations.json to expand them against; they were skipped')
    for name, alts in list(aliases.items()):
        out = []
        for a in alts:
            if "*" in a:
                out += sorted(n for n in all_names if fnmatch.fnmatchcase(n.lower(), a.lower()))
            else:
                out.append(a)
        aliases[name] = out
    result = dict(boxes)
    made, elsewhere = set(), 0
    for name, alts in aliases.items():
        key = clean_name(name, args.prefix, args.prefix_pattern)
        if key not in boxes:
            elsewhere += 1                                              # one alias file serves every map; this one is for another map
            continue
        for alt in alts:
            if alt in made:                                             # the same extra name given by two places: it covers both
                result[alt] = result[alt] + [list(r) for r in boxes[key] if list(r) not in result[alt]]
            else:
                result[alt] = [list(r) for r in boxes[key]]
                made.add(alt)
    if elsewhere:
        print(f"  ({elsewhere} alias entries belong to other maps and were skipped)")
    # unprefixed twin for non-route names that got a prefix (e.g. "Victory Road" for "Hoenn Victory Road")
    if args.prefix:
        for name in list(boxes):
            if name.startswith(args.prefix + " ") and not re.match(r"^\S+ Route \d", name):
                result.setdefault(name[len(args.prefix) + 1:], [list(r) for r in boxes[name]])

    warns = [n for n, rs in result.items() for x, y, w, h in rs
             if mw and mh and (x < 0 or y < 0 or x + w > mw + args.tile or y + h > mh + args.tile)]
    if warns:
        print(f"  ! {len(set(warns))} location(s) fall outside the {mw}x{mh} map - is --scale right? e.g. {sorted(set(warns))[:3]}")

    areas = db.setdefault("areas", {})
    existing = {} if args.replace else areas.get(args.map, {})
    added = [n for n in result if n not in existing]
    updated = [n for n in result if n in existing and existing[n] != result[n]]
    merged = {**existing, **result}

    if args.check:
        with open(args.check, encoding="utf-8") as f:
            locs = json.load(f)["loc"]
        gks = [g for g, ids in db.get("games", {}).items() if args.map in ids]
        tables = [merged if mid == args.map else (db.get("areas", {}).get(mid) or {})
                  for g in gks for mid in db["games"][g]]
        have = set().union(*[set(t) for t in tables]) if tables else set()
        miss, names = {}, {}
        for g in gks:
            for rows in locs.get(g, {}).values():
                for r in rows:
                    if r[0] in have or place_key(r[0]) in have:
                        continue
                    k = place_key(r[0]); miss[k] = miss.get(k, 0) + 1; names.setdefault(k, set()).add(r[0])
        print(f"  check: {len(miss)} location name(s) in locations.json have no box on any map of {', '.join(gks) or 'this map'}"
              + (":" if miss else " - all covered"))
        for k, c in sorted(miss.items(), key=lambda t: -t[1]):
            sug = difflib.get_close_matches(k, have, n=1, cutoff=0.75)
            print(f"    {c:4d} rows  {k!r}" + (f"   (looks like '{sug[0]}')" if sug else ""))

    print(f'Map "{args.map}": {len(boxes)} locations read, {len(result)} names incl. aliases '
          f'({len(added)} new, {len(updated)} changed, {len(merged) - len(result)} kept from before)')
    multi = [n for n, r in boxes.items() if len(r) > 1]
    if multi:
        print(f"  multi-box shapes: {', '.join(sorted(multi))}")

    if args.preview:
        preview_html(mp, boxes, args.preview)
        print(f"  preview written to {args.preview} - open it in your browser to check the boxes against the picture")
    if args.dry_run:
        print("Dry run - nothing written.")
        return
    shutil.copyfile(args.data, args.data + ".bak")
    areas[args.map] = merged
    with open(args.data, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=1, ensure_ascii=False)
    print(f"Saved {args.data} (backup: {args.data}.bak)")


if __name__ == "__main__":
    main()