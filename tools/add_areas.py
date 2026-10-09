#!/usr/bin/env python3
"""
add_areas.py - import location boxes for ANY map into data/maps.json.

Run from the project folder (the one containing data/). Typical use:

  # HTML copied from the SimplyBLG page (anything containing <area ... coords=... title=...> tags)
  python3 add_areas.py --map hoenn-rse --input hoenn.html --prefix Hoenn

  # A later game, with different files / scale
  python3 add_areas.py --map sinnoh-dp --input sinnoh.html --scale 1.5

  # Map still a placeholder (w/h/grid = 0)? Give it its real size. Scale "auto" = canvas width on the page / map width
  python3 add_areas.py --map kanto-frlg --input kanto-frlg.html --prefix Kanto --size 192x144 --grid 8 --scale auto --region 0,0,388,291

  # A brand-new map in one go (name, flashing style, which games use it, picture saved to assets/maps/):
  python3 add_areas.py --map sevii-123-frlg --new --name "Sevii Islands 1, 2 & 3" --flash --games fire-red,leaf-green \\
          --input sevii-123.html --scale auto --region 0,291,388,582 --save-image

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
  * A backup (maps.json.bak) is written before saving. Nothing is written with --dry-run.
"""
import argparse, base64, csv, difflib, json, os, re, shutil, struct, sys
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
    for p in paths:
        if os.path.splitext(p)[1].lower() in (".json", ".csv"):
            continue
        with open(p, encoding="utf-8-sig") as f:
            m = re.search(r"<canvas[^>]*\swidth=\"(\d+)\"", f.read())
        if m:
            return int(m[1])
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


def snapped_rect(poly, scale, tile):
    """Axis-aligned box: round each edge to the grid (at least one tile)."""
    sn = lambda v: round(v / scale / tile) * tile
    x0, x1 = sn(min(p[0] for p in poly)), sn(max(p[0] for p in poly))
    y0, y1 = sn(min(p[1] for p in poly)), sn(max(p[1] for p in poly))
    return [[x0, y0, max(tile, x1 - x0), max(tile, y1 - y0)]]


def polygon_to_cells(poly, scale, tile):
    """Paint the polygon (source px) onto the tile grid; a cell is on if its centre is inside."""
    pts = [(x / scale, y / scale) for x, y in poly]
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
    ap.add_argument("--tile", type=int, default=8, help="grid size in map px (default 8)")
    ap.add_argument("--prefix", default="", help='region prefix for routes etc., e.g. "Hoenn"')
    ap.add_argument("--prefix-pattern", default=DEFAULT_PREFIX_PATTERN, help="regex for names that get the prefix")
    ap.add_argument("--size", metavar="WxH", help="map pixel size if it is missing / 0, e.g. 192x144 (default: read from the embedded picture)")
    ap.add_argument("--grid", type=int, help="set the map's grid if it is missing / 0 (defaults to --tile)")
    ap.add_argument("--region", metavar="x0,y0,x1,y1",
                    help="only import shapes inside this source-px rectangle and shift it to the origin "
                         "(for pages that stack several maps in one coordinate space)")
    ap.add_argument("--rename", help='JSON file: {"source name": "your name"} applied before prefixing; '
                                     "sources renamed to the same name are merged")
    ap.add_argument("--save-image", metavar="PNG", nargs="?", const="auto",
                    help="also save the map picture if the HTML embeds it. Bare --save-image = assets/maps/<map id>.png")
    ap.add_argument("--new", action="store_true",
                    help="create the map in maps.json if it isn't there (size from --size or from the embedded picture)")
    ap.add_argument("--name", help='display name / tab label, e.g. "Sevii Islands 1, 2 & 3"')
    ap.add_argument("--flash", action="store_true", help="use the flashing Gen 3 style for this map (maps.json \"flash\": true)")
    ap.add_argument("--games", help="comma-separated game keys that use this map, e.g. fire-red,leaf-green (added to maps.json \"games\")")
    ap.add_argument("--aliases", help="JSON file: {name: [extra names sharing the same boxes]}")
    ap.add_argument("--replace", action="store_true", help="remove the map's existing areas first")
    ap.add_argument("--create", metavar="WxH", help="like --new, with an explicit size, e.g. 192x144")
    ap.add_argument("--dry-run", action="store_true", help="show what would change; write nothing")
    args = ap.parse_args()

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
    if not wh and png_size(emb):
        wh = png_size(emb)
        print(f"  size {wh[0]}x{wh[1]} read from the embedded map picture")
    if args.map not in maps:
        close = difflib.get_close_matches(args.map, list(maps), n=3, cutoff=0.6)
        hint = f' Did you mean: {", ".join(close)}?' if close else ""
        if not (args.new or args.create):
            sys.exit(f'No map "{args.map}" in {args.data}.{hint}\nKnown maps: {", ".join(maps) or "none"}.\n'
                     f'(To add a new map on purpose, add --new)')
        if not wh:
            sys.exit(f'--new needs a size: add --size 192x144 (the pixel size of the map picture), or use an HTML page that embeds the picture.')
        maps[args.map] = {"name": args.name or args.map, "img": f"assets/maps/{args.map}.png", "w": wh[0], "h": wh[1],
                          "grid": args.grid or args.tile}
        print(f'  created map "{args.map}" ({wh[0]}x{wh[1]})')
    mp = maps[args.map]
    if not mp.get("w") or not mp.get("h"):
        if not wh:
            sys.exit(f'Map "{args.map}" has no size yet (w/h are 0). Add --size 192x144, the pixel size of its image.')
        mp["w"], mp["h"] = wh
        print(f'  set {args.map} size to {wh[0]}x{wh[1]}')
    elif wh and args.size and tuple(wh) != (mp["w"], mp["h"]):
        print(f'  ! --size ignored: map already has size {mp["w"]}x{mp["h"]}')
    if not mp.get("grid"):
        mp["grid"] = args.grid or args.tile
    if args.name:
        mp["name"] = args.name
    if args.flash:
        mp["flash"] = True
    mw, mh = mp["w"], mp["h"]
    for g in [x.strip() for x in (args.games or "").split(",") if x.strip()]:
        lst = db.setdefault("games", {}).setdefault(g, [])
        if args.map not in lst:
            lst.append(args.map)
            print(f"  added {args.map} to {g}")
    if emb and png_size(emb) and (mw, mh) != tuple(png_size(emb)):
        print(f"  ! the embedded picture is {png_size(emb)[0]}x{png_size(emb)[1]} but the map is {mw}x{mh}")

    if str(args.scale).lower() == "auto":
        cw = find_canvas_width(args.input)
        if not cw:
            sys.exit('--scale auto needs a <canvas width="..."> in an HTML input; pass a number instead.')
        args.scale = cw / mw
        print(f"  auto scale = {cw} / {mw} = {args.scale:.4f}")
    else:
        args.scale = float(args.scale)
    region = None
    if args.region:
        region = nums(args.region)
        if len(region) != 4:
            sys.exit("--region needs four numbers: x0,y0,x1,y1")
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
        else:
            print("  ! no embedded map picture in the input (the page only links to it). "
                  "Open the site's image URL in your browser and save it manually.")

    boxes = {}
    for path in args.input:
        for name, shape in load_source(path):
            if region and not isinstance(shape, tuple):
                cx = sum(p[0] for p in shape) / len(shape)
                cy = sum(p[1] for p in shape) / len(shape)
                if not (region[0] <= cx < region[2] and region[1] <= cy < region[3]):
                    continue
                shape = [(x - region[0], y - region[1]) for x, y in shape]
            name = clean_name(renames.get(name, name), args.prefix, args.prefix_pattern)
            if isinstance(shape, tuple):
                rects = [list(map(int, r)) for r in shape[1]]
            else:
                rects = (snapped_rect(shape, args.scale, args.tile) if is_rect(shape)
                         else cells_to_rects(polygon_to_cells(shape, args.scale, args.tile), args.tile))
            boxes.setdefault(name, []).extend(rects)
    if not boxes:
        sys.exit("No locations found in the input files (looked for <area> tags, JSON and CSV).")

    aliases = {}
    if args.aliases:
        with open(args.aliases, encoding="utf-8") as f:
            aliases = json.load(f)
    result = dict(boxes)
    for name, alts in aliases.items():
        key = clean_name(name, args.prefix, args.prefix_pattern)
        if key not in boxes:
            print(f'  ! alias target "{name}" has no boxes - skipped')
            continue
        for alt in alts:
            result[alt] = [list(r) for r in boxes[key]]
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

    print(f'Map "{args.map}": {len(boxes)} locations read, {len(result)} names incl. aliases '
          f'({len(added)} new, {len(updated)} changed, {len(merged) - len(result)} kept from before)')
    multi = [n for n, r in boxes.items() if len(r) > 1]
    if multi:
        print(f"  multi-box shapes: {', '.join(sorted(multi))}")

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