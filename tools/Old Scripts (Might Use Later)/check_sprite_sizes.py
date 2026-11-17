#!/usr/bin/env python3
"""
check_sprite_sizes.py - reports the real pixel size of the sprites in every sprite folder and suggests a "spriteSize"
for data/games.config.json (see "Sprites bigger than 80px" in css/style.css).

    python3 check_sprite_sizes.py

Run from the project folder. Reads only the PNG headers (fast, standard library only). Nothing is changed.

How to read the suggestions: cards show sprites at "spriteSize" px. Sharpest = a whole-number multiple of the real size
(1x, 2x...). The default of 80 is only clean for sprites that are 80px (or 40px) themselves; anything else is scaled by a
fraction, which drops or doubles pixels unevenly. Bigger numbers make bigger cards, so fewer fit on a row.
"""
import json, os, struct
from collections import Counter

cfg = json.load(open(os.path.join("data", "games.config.json"), encoding="utf-8"))
root = os.path.join("assets", "sprites")


def size(path):
    with open(path, "rb") as f:
        h = f.read(24)
    return struct.unpack(">II", h[16:24]) if h[:8] == b"\x89PNG\r\n\x1a\n" else None


folders = {}
for g in cfg["games"]:
    folders.setdefault(g["sprites"], []).append(g["key"])

for folder, keys in folders.items():
    d = os.path.join(root, folder)
    print(f"\n{folder}   (games: {', '.join(keys)})")
    if not os.path.isdir(d):
        print("  folder not found"); continue
    sizes = Counter()
    for fn in os.listdir(d):
        if fn.endswith(".png") and fn[:-4].isdigit():
            s = size(os.path.join(d, fn))
            if s: sizes[s] += 1
    if not sizes:
        print("  no sprites found"); continue
    for (w, h), n in sizes.most_common(4):
        print(f"  {w}x{h}: {n} sprite(s)")
    (w, h), _ = sizes.most_common(1)[0]
    if len(sizes) > 1:
        print("  note: sizes are mixed; the most common one is used below")
    m = max(w, h)
    if m % 80 == 0 or 80 % m == 0:
        print(f"  suggestion: leave at 80 (scales cleanly)")
    else:
        up = m
        while up < 80: up += m
        print(f"  suggestion: \"spriteSize\": {up} (shown at a whole multiple of {m}px: sharp, "
              f"{'bigger cards' if up > 80 else 'native size'})")
        print(f"  or leave at 80 (scaled x{80 / m:.2f}, a little uneven)")
    print(f"  games to edit: {', '.join(keys)}")
    fs = Counter()                                           # alternate-form and gender sprites (build_forms.py)
    fd = os.path.join(d, "forms")
    if os.path.isdir(fd):
        for fn in os.listdir(fd):
            if fn.endswith(".png"):
                z = size(os.path.join(fd, fn))
                if z: fs[z] += 1
    if fs:
        print("  form sprites: " + ", ".join(f"{w}x{h} ({n})" for (w, h), n in fs.most_common(4)))