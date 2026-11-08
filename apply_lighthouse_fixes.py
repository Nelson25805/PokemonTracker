#!/usr/bin/env python3
"""Apply the Lighthouse fixes to the Pokedex Tracker.

Run from the repo root (the folder that contains index.html, css/ and js/):

    python apply_lighthouse_fixes.py          # apply
    python apply_lighthouse_fixes.py --check  # only report what would change

Every edit must match exactly once. If anything does not, NOTHING is written.
Running it twice is safe: edits that are already in place are skipped.
Line endings (LF or CRLF) are preserved.
"""
import sys
from pathlib import Path

DESC = ("Track your living Pokédex in the Pokémon games, Gen 1 to Gen 5: shinies, forms, "
        "where to find each Pokémon, trainer cards and diplomas. Works offline.")

DEFER_JS = ["config", "cards", "store", "storage", "forms", "maps", "eggs", "where", "app"]  # theme.js stays blocking on purpose

# (file, old, new, why). "old" is a single-line snippet that appears once in the file.
EDITS = [
    # --- SEO: meta description -------------------------------------------------------------
    ("index.html",
     "<title>Pokédex Tracker</title>",
     f'<title>Pokédex Tracker</title>\n<meta name="description" content="{DESC}">',
     "meta-description"),
] + [
    # --- Performance: don't block first paint on the app scripts (order is preserved by defer)
    ("index.html", f'<script src="js/{n}.js"></script>', f'<script defer src="js/{n}.js"></script>', "render-blocking")
    for n in DEFER_JS
] + [
    # --- Accessibility: contrast of the number/name text on cards you have not ticked yet ---
    ("css/style.css",
     "opacity:.5;filter:grayscale(1)}",
     "opacity:.75;filter:grayscale(1)}",
     "color-contrast (unticked cards, all themes need >= .7)"),
    # --- Layout shift: keep the footer below the fold until the grid is drawn --------------
    ("css/style.css",
     ".card:focus-visible,button:focus-visible",
     "#grid:empty{min-height:100vh} /* before the cards are drawn: keeps the footer off screen so it does not jump (layout shift) */\n.card:focus-visible,button:focus-visible",
     "layout shift (empty grid)"),
    # --- Layout shift: reserve the 'Showing X of Y' line ------------------------------------
    ("css/style.css",
     "#shown{font-size:13px;opacity:.85;margin-left:auto}",
     "#shown{font-size:13px;opacity:.85;margin-left:auto;min-height:1.4em}",
     "layout shift ('Showing' line)"),
    # --- Accessibility: accessible name must contain the visible text ('0/1') ---------------
    ("js/app.js",
     "`Forms of ${monByN.get(n).name}: ${have} of ${total} (${what})`",
     "`${have}/${total} forms of ${monByN.get(n).name} (${what})`",
     "label-content-name-mismatch (form chips)"),
]


def main():
    check_only = "--check" in sys.argv
    root = Path.cwd()
    texts, problems, plan = {}, [], []
    for rel, old, new, why in EDITS:
        p = root / rel
        if rel not in texts:
            if not p.is_file():
                problems.append(f"missing file: {rel}")
                texts[rel] = None
                continue
            texts[rel] = p.read_bytes().decode("utf-8")
        t = texts[rel]
        if t is None:
            continue
        crlf = "\r\n" in t
        n_new = new.replace("\n", "\r\n") if crlf else new
        if n_new in t:                                   # check the new text first: some "new" strings contain the old one
            plan.append((rel, why, "already applied"))
            continue
        c = t.count(old)
        if c != 1:
            problems.append(f"{rel}: expected 1 match for [{why}], found {c}: {old[:60]!r}")
            continue
        texts[rel] = t.replace(old, n_new)
        plan.append((rel, why, "will change" if check_only else "changed"))
    if problems:
        print("Nothing was written because of these problems:")
        for m in problems:
            print("  -", m)
        print("\n(Has the file changed since these edits were written? Compare the quoted line with your copy.)")
        sys.exit(1)
    for rel, why, st in plan:
        print(f"  {st:15} {rel:14} {why}")
    if check_only:
        return
    for rel, t in texts.items():
        if t is not None and (root / rel).read_bytes().decode("utf-8") != t:
            (root / rel).write_bytes(t.encode("utf-8"))
    print("\nDone. Re-run Lighthouse on the deployed site after you push.")


if __name__ == "__main__":
    main()
