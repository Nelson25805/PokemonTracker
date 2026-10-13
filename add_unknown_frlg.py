#!/usr/bin/env python3
"""Adds (or updates) the "AREA UNKNOWN" banner for FireRed / LeafGreen in data/maps.json.

Run from your project folder:   python3 add_unknown_frlg.py
(or give the path:              python3 add_unknown_frlg.py path/to/maps.json)

It sets the "unknown" entry of the "kanto-frlg" map, which FireRed and LeafGreen both use, and touches nothing else.
Safe to run again: if the entry is already correct it says so, and if an older version of it is there (the first version
of this script covered the whole map) it is replaced.
"""
import json, re, sys

NEW = {"img": "assets/maps/area-unknown-frlg.png", "x": 5, "y": 56, "w": 181, "h": 33}   # the banner only, in 192 x 144 map pixels

path = sys.argv[1] if len(sys.argv) > 1 else "data/maps.json"
text = open(path, encoding="utf-8", newline="").read()          # newline="" keeps the file's line endings as they are
nl = "\r\n" if "\r\n" in text else "\n"

before = json.loads(text)
fr = before["maps"].get("kanto-frlg")
if fr is None:
    sys.exit('No "kanto-frlg" map found in ' + path + ", nothing changed.")
if fr.get("unknown") == NEW:
    sys.exit('"kanto-frlg" already has the right "unknown" entry, nothing changed.')

block = '"unknown": {{{n}    "img": "{img}",{n}    "x": {x},{n}    "y": {y},{n}    "w": {w},{n}    "h": {h}{n}   }}'.format(n=nl, **NEW)

start = text.index('"kanto-frlg": {')
if "unknown" in fr:                                              # replace the existing entry (it has no nested braces)
    m = re.compile(r'"unknown":\s*\{[^{}]*\}').search(text, start)
    patched = text[:m.start()] + block + text[m.end():]
else:                                                            # add it after "flash": true
    end = text.index('"flash": true', start) + len('"flash": true')
    patched = text[:end] + "," + nl + "   " + block + text[end:]

after = json.loads(patched)                                      # make sure the result is still valid before saving
assert after["maps"]["kanto-frlg"]["unknown"] == NEW
assert {k: v for k, v in after["maps"]["kanto-frlg"].items() if k != "unknown"} == {k: v for k, v in fr.items() if k != "unknown"}
assert after["areas"] == before["areas"] and after["games"] == before["games"]
assert {k: v for k, v in after["maps"].items() if k != "kanto-frlg"} == {k: v for k, v in before["maps"].items() if k != "kanto-frlg"}

open(path, "w", encoding="utf-8", newline="").write(patched)
print('Done: "unknown" for "kanto-frlg" is set in ' + path)
