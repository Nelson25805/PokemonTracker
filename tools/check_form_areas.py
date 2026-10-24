#!/usr/bin/env python3
"""Checks data/form-areas.json against data/forms.json and data/locations.json. Run from the project folder."""
import json, re
L = lambda f: json.load(open(f"data/{f}.json", encoding="utf-8"))
fa, forms, loc = L("form-areas"), L("forms"), L("locations")
bad = 0
def base(a):
    w = re.split(r"\s+towards\s+", a, flags=re.I)[0].split()
    while len(w) > 1 and re.fullmatch(r"b?\d+[fr]|north|south|east|west|northeast|northwest|southeast|southwest", w[-1], re.I): w.pop()
    return " ".join(w)
for i, r in enumerate(fa["rules"]):
    sp = forms["species"].get(str(r["n"])); why = []
    if not sp: why.append("species has no forms in forms.json")
    elif r["form"] != "base" and r["form"] not in [f["id"] for f in sp["forms"]]: why.append(f"unknown form {r['form']}")
    for g in r["g"]:
        names = {a[0] for a in loc["loc"].get(g, {}).get(str(r["n"]), [])}
        if r["area"] not in names and r["area"] not in {base(x) for x in names}: why.append(f"{g}: no encounter in '{r['area']}' (areas: {sorted(names)[:6]})")
    if why: bad += 1; print(f"rule {i}:", "; ".join(why))
print("OK" if not bad else f"{bad} rule(s) to look at")
