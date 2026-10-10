"use strict";
// "Where to find": a dialog listing where a Pokémon can be found, limited to the games that can
// send Pokémon to the one you're tracking (see `sources` in config.js).
//
//   Where.init({ games, mons })   once, after the game and Pokémon lists load
//   Where.open(game, n)           show Pokémon #n for the currently selected game
//   Where.plan(game, n, byKey, data)   pure: works out what to show (exported for testing)
//
// Evolution help: the "Evolve X" row explains how to evolve in plain words (stone, trade, friendship, level, place),
// leaves out methods that don't exist in the games being shown, and lists where to get any item it needs
// (data/items.json, optional; items it doesn't know link to Bulbapedia).
//
// Location data lives in data/locations.json (built by build_locations.py) and is fetched the first
// time the panel opens, so it costs nothing until someone asks.
const Where = (() => {
  const $ = s => document.querySelector(s);
  let games = [], mons = [], byKey = {}, data = null, loading = null;

  const METHODS = {
    walk: "Grass / cave / land", surf: "Surfing", "old-rod": "Old Rod", "good-rod": "Good Rod", "super-rod": "Super Rod",
    "rock-smash": "Rock Smash", headbutt: "Headbutt", gift: "Gift", "gift-egg": "Gift (Egg)", "only-one": "Static (one-time)",
    pokeflute: "Poké Flute", "bug-catching-contest": "Bug-Catching Contest", "roaming-grass": "Roaming (grass / land)", "roaming-water": "Roaming (surfing)",
  };
  const prettify = s => s.replace(/-/g, " ").replace(/^./, c => c.toUpperCase());
  const label = m => METHODS[m] || prettify(m);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = n => String(n).padStart(3, "0");

  // ---- evolution blurbs ----
  // Generation each evolution item first appeared in. An item missing from this list can't be used in Gen 1-4, so an
  // option that needs it is dropped (PokéAPI also lists later methods, e.g. Ice Stone or a Thunder Stone for Magnezone).
  const ITEM_GEN = {
    "Fire Stone": 1, "Water Stone": 1, "Thunder Stone": 1, "Leaf Stone": 1, "Moon Stone": 1,
    "Sun Stone": 2, "King's Rock": 2, "Metal Coat": 2, "Dragon Scale": 2, "Up-Grade": 2,
    "Deep Sea Tooth": 3, "Deep Sea Scale": 3,
    "Shiny Stone": 4, "Dusk Stone": 4, "Dawn Stone": 4, "Oval Stone": 4, "Razor Claw": 4, "Razor Fang": 4,
    "Protector": 4, "Electirizer": 4, "Magmarizer": 4, "Reaper Cloth": 4, "Dubious Disc": 4,
  };
  const STONE_LATER = new Set([462, 470, 476]);   // Magnezone, Leafeon, Probopass: stone methods only arrived in Gen 8
  const COND = { daytime: "during the day", night: "at night", female: "female only", male: "male only" };
  const art = w => (/^[AEIOU]/i.test(w) ? "an " : "a ") + w;

  // "Level up holding Razor Claw (night)" -> { kind, item, conds }
  function parse(opt) {
    const conds = [], main = opt.replace(/\s*\(([^)]*)\)/g, (_, c) => { conds.push(c); return ""; }).trim();
    let m;
    if ((m = /^Use (.+)$/.exec(main))) return { kind: "item", item: m[1], conds };
    if ((m = /^Trade holding (.+?)(?: for .+)?$/.exec(main))) return { kind: "tradeitem", item: m[1], conds };
    if ((m = /^Trade for (.+)$/.exec(main))) return { kind: "tradefor", who: m[1], conds };
    if (main === "Trade") return { kind: "trade", conds };
    if ((m = /^Level (\d+)$/.exec(main))) return { kind: "level", lv: m[1], conds };
    if (main === "High friendship") return { kind: "friend", conds };
    if (main === "High Beauty") return { kind: "beauty", conds };
    if (main === "Shed") return { kind: "shed", conds };
    if ((m = /^Level up holding (.+)$/.exec(main))) return { kind: "hold", item: m[1], conds };
    if ((m = /^Level up knowing (.+)$/.exec(main))) return { kind: "move", what: m[1], conds };
    if ((m = /^Level up at (.+)$/.exec(main))) return { kind: "place", where: m[1], conds };
    if ((m = /^Level up with (.+) in the party$/.exec(main))) return { kind: "party", who: m[1], conds };
    if (main === "Level up") return { kind: "up", conds };
    return { kind: "raw", text: main, conds };
  }

  function say(p, from, game) {
    const c = p.conds.map(x => COND[x] || x), tail = c.length ? ` (${c.join(", ")})` : "";
    switch (p.kind) {
      case "item": return `Use ${art(p.item)} on ${from}${tail}.`;
      case "trade": return `Trade ${from} to another player's game${tail}. It evolves as soon as the trade finishes.`;
      case "tradeitem": return `Trade ${from} while it holds ${art(p.item)}${tail}. It evolves as soon as the trade finishes.`;
      case "tradefor": return `Trade ${from} for ${p.who}${tail}.`;
      case "level": return `Level ${from} up to Lv ${p.lv}${tail}.`;
      case "friend": return `Level up with high friendship${tail}. Keep it in your party, level it up often, and avoid letting it faint.`;
      case "beauty": return `Raise its Beauty condition very high with ${game.gen === 3 ? "Pokéblocks" : "Poffins"}, then level up${tail}.`;
      case "shed": return `Appears when Nincada evolves into Ninjask, if you have an empty party slot and a Poké Ball in your bag.`;
      case "hold": return `Level up while it holds ${art(p.item)}${tail}.`;
      case "move": return `Level up while it knows ${p.what}${tail}.`;
      case "place": return `Level up at ${p.where}${tail}.`;
      case "party": return `Level up with ${p.who} in your party${tail}.`;
      case "up": return `Level up${tail}.`;
      default: return p.text + tail;
    }
  }

  const itemLines = (items, name, key) => {
    const it = items && items.items && items.items[name];
    const t = it ? (it.where || []).filter(w => (w.g || []).includes(key)).flatMap(w => w.t || []) : [];
    return t.length ? t : null;
  };

  // How `n` evolves in `src`: null if its pre-evolution isn't in that game or no method works there.
  function evolution(n, evo, src, items) {
    if (!evo || evo[0] > src.count) return null;
    const from = nameOf(evo[0]), opts = [], need = [];
    for (const raw of String(evo[1]).split(" or ")) {
      const p = parse(raw);
      if (p.item && !(ITEM_GEN[p.item] <= src.gen)) continue;          // item doesn't exist yet in this generation
      if (p.kind === "item" && STONE_LATER.has(n)) continue;           // stone method added in Gen 8
      const text = say(p, from, src);
      if (!opts.includes(text)) opts.push(text);
      if (p.item && !need.includes(p.item)) need.push(p.item);
    }
    const hgss = src.key === "heart-gold" || src.key === "soul-silver";
    if (hgss && n === 470) return { from: evo[0], opts: ["Level up next to the Moss Rock in Ilex Forest."], items: [] };
    if (hgss && n === 471) return { from: evo[0], opts: ["Level up next to the Ice Rock in the Ice Path."], items: [] };
    if (hgss && (n === 462 || n === 476)) return { from: evo[0], opts: ["Level up at a special magnetic spot. It isn't the same place as in the Sinnoh games, so check Bulbapedia for the exact location."], items: [] };
    if (!opts.length) return null;
    return { from: evo[0], opts, items: need.map(name => ({ name, lines: itemLines(items, name, src.key) })) };
  }

  const wiki = name => `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(name.replace(/ /g, "_"))}`;
  function evoRows(e) {
    const rows = [`<li class="evo"><strong>Evolve ${esc(nameOf(e.from))}</strong><span>${e.opts.map(esc).join("<br>or: ")}</span></li>`];
    for (const it of e.items) {
      const body = it.lines ? it.lines.map(esc).join("<br>")
        : `Not recorded here yet. <a href="${wiki(it.name)}" target="_blank" rel="noopener">See Bulbapedia ↗</a>`;
      rows.push(`<li class="evo"><strong>Get ${esc(it.name)}</strong><span>${body}</span></li>`);
    }
    return rows;
  }

  // How a Pokémon from `src` gets into `game`.
  function via(src, game) {
    if (src.key === game.key) return "";
    if (src.gen === game.gen) return "trade";
    if (src.gen <= 2 && game.gen <= 2) return game.gen === 1 ? "Time Capsule (Gen 1 Pokémon with no Gen 2 moves)" : "Time Capsule";
    if (src.gen === 3 && game.gen === 4) return "Pal Park (one-way)";
    return "";
  }

  // One group per distinct set of results, so Red and Blue (same spots) share a section.
  function plan(game, n, keyed, d) {
    const groups = [];
    if (n > game.count) return groups;                           // not in this game's own Pokédex, so it can't be tracked here
    for (const key of game.sources || [game.key]) {
      const src = keyed[key];
      if (!src || n > src.count) continue;                       // that game doesn't have this Pokémon
      const entries = (d.loc[key] || {})[n] || [];
      const evolve = evolution(n, d.evo[n], src, d.items);       // null if the pre-evolution or every method is missing in that game
      if (!entries.length && !evolve) continue;
      const sig = JSON.stringify([entries, evolve]);
      let g = groups.find(x => x.sig === sig);
      if (!g) groups.push(g = { sig, games: [], vias: [], entries, evolve });
      g.games.push(src);
      const v = via(src, game);
      if (v && !g.vias.includes(v)) g.vias.push(v);
    }
    return groups;
  }

  // "Route 2 — Grass 3–5, 10%" lines, one per location, best odds first.
  // `chance` is the encounter rate within that area (several slots of one method are already added up in
  // build_locations.py). An area is ranked by its best method; entries with no recorded rate (0) go last.
  // Within an area the methods are sorted the same way, and ties fall back to the area name.
  function lines(entries) {
    const areas = new Map();
    for (const [area0, method, lo, hi, chance, cond] of entries) {
      // PokéAPI files HeartGold / SoulSilver's Latias / Latios under Johto, but they roam Kanto (same fix as in maps.js)
      const area = area0 === "Roaming Johto" && /copycat/i.test(cond || "") ? "Roaming Kanto" : area0;
      const bits = [label(method), cond, lo ? (lo === hi ? `Lv ${lo}` : `Lv ${lo}–${hi}`) : "", chance && chance < 100 ? `${chance}%` : ""].filter(Boolean);
      if (!areas.has(area)) areas.set(area, { rows: [], best: 0 });
      const a = areas.get(area);
      a.rows.push({ text: bits.join(" · "), chance: chance || 0 });
      a.best = Math.max(a.best, chance || 0);
    }
    return [...areas]
      .map(([area, a]) => ({ area, best: a.best, how: a.rows.sort((x, y) => y.chance - x.chance).map(r => r.text).join("; ") }))
      .sort((x, y) => y.best - x.best || x.area.localeCompare(y.area, undefined, { numeric: true }));
  }

  // "How roaming works": shown under the map for a Pokémon with roaming rows (Gen 2 onwards). Roamers have no fixed spot, so
  // the map shades every route they can be on and this explains the rest. Facts are per generation (Bulbapedia, "Roaming Pokémon").
  const ROAM = {
    2: ["It wanders between routes and can move every time you change map, so it is rarely where you last saw it.",
        "On the route it is on, about 1 wild encounter in 10 is the roamer.",
        "It flees the first chance it gets. Trap it (Mean Look, Wrap...) or put it to sleep or freeze it. Its HP stays as you left it, so damage carries over, but its status and PP reset each time it flees.",
        "Once you have seen it, the Pokédex shows the route it is on right now.",
        "Defeat it and it is gone for good, so save before you throw a ball."],
    3: ["It wanders between routes while you play. Whenever a wild encounter happens in tall grass or on water on its route, there is a 1 in 4 chance it is the roamer.",
        "Each turn it tries to flee instead of attacking, unless you trap it (Mean Look, Arena Trap, Magnet Pull, Shadow Tag).",
        "Status problems carry over to the next meeting. Once you have seen it, the Pokédex tracks the route it is on.",
        "Do not use Roar or Whirlwind on it in Emerald, FireRed or LeafGreen (original releases): it counts as defeated and vanishes for good."],
    4: ["It wanders between routes while you play. Check the Pokétch Marking Map (Diamond / Pearl / Platinum) or the Pokégear map card (HeartGold / SoulSilver) to see which route it is on.",
        "Each turn it tries to flee unless you trap it. In HeartGold / SoulSilver, Raikou and Entei flee on the very first turn (Latias and Latios do not), so use a trapping move that acts first.",
        "Platinum and HeartGold / SoulSilver let a defeated roamer come back later (after the Hall of Fame / the Champion battle), but you may have to trigger the roaming again."],
  };
  function roamNote(g) {
    if (!g.entries.some(e => /^roaming/.test(e[1]))) return "";
    const gens = [...new Set(g.games.map(x => x.gen))].filter(x => ROAM[x]).sort();
    if (!gens.length) return "";
    const body = gens.map(x => `${gens.length > 1 ? `<strong>Gen ${x}:</strong> ` : ""}${ROAM[x].map(esc).join("<br>")}`).join("<br><br>");
    return `<p class="roamhow"><strong>How roaming works</strong><br>${body}</p>`;
  }

  const nameOf = n => (mons.find(m => m.n === n) || { name: `#${n}` }).name;

  function render(game, n, groups) {
    if (!groups.length) {
      const map = typeof Maps !== "undefined" ? Maps.html([game.key], [], nameOf(n)) : "";   // still show the map, with "AREA UNKNOWN"
      return map + `<p>No wild, gift or one-time encounters are recorded for ${esc(nameOf(n))} in ${esc(game.name)} or the games that link to it.
        It may be an evolution, a breeding result, an event Pokémon, or a trade. Check the full page below.</p>`;
    }
    return groups.map(g => {
      const rows = lines(g.entries).map(l => `<li><strong>${esc(l.area)}</strong><span>${esc(l.how)}</span></li>`);
      if (g.evolve) rows.unshift(...evoRows(g.evolve));
      const open = g.games.some(x => x.key === game.key) || rows.length <= 6;
      const sub = g.vias.length ? `<small>reaches ${esc(game.name)} by ${esc(g.vias.join(" / "))}</small>` : "";
      const maps = typeof Maps !== "undefined" ? Maps.html(g.games.map(x => x.key), g.entries, nameOf(n)) : "";   // region map with the locations marked
      return `<details${open ? " open" : ""}><summary>${esc(g.games.map(x => x.name).join(", "))} ${sub}</summary>${maps}${roamNote(g)}<ul>${rows.join("")}</ul></details>`;
    }).join("");
  }

  function load() {
    if (data) return Promise.resolve(data);
    const get = f => fetch(`data/${f}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    return (loading = loading || Promise.all([get("locations"), get("items"), get("maps")])
      .then(([d, items, maps]) => {
        loading = null;
        if (typeof Maps !== "undefined") Maps.init(maps);                                  // maps.json is optional too
        return (data = d && { ...d, items });
      }));   // items.json is optional; a failed load can be retried next time
  }

  async function open(game, n) {
    const dlg = $("#where"), body = $("#where-body");
    $("#where-title").textContent = `#${pad(n)} ${nameOf(n)}`;
    const others = (game.sources || []).filter(k => k !== game.key && byKey[k]).map(k => byKey[k].name);
    $("#where-note").textContent = others.length
      ? `Showing ${game.name} and the games that can send Pokémon to it: ${others.join(", ")}.`
      : `Showing ${game.name}.`;
    $("#where-link").href = `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(nameOf(n).replace(/ /g, "_"))}_(Pokémon)#Game_locations`;
    body.textContent = "Loading…";
    if (!dlg.open) dlg.showModal();
    const d = await load();
    body.innerHTML = d
      ? render(game, n, plan(game, n, byKey, d))
      : `<p>Location data isn't installed yet. Run <code>python3 build_locations.py</code> once to create <code>data/locations.json</code>.</p>`;
  }

  function init(deps) {
    games = deps.games; mons = deps.mons;
    byKey = Object.fromEntries(games.map(g => [g.key, g]));
    $("#where-close").addEventListener("click", () => $("#where").close());

    // Map hover / tap: show which locations sit under the pointer (Maps.at in maps.js).
    const hideTips = () => {
      document.querySelectorAll("#where .amaptip").forEach(t => { t.hidden = true; });
      document.querySelectorAll("#where .amaphl").forEach(l => { l.textContent = ""; l.dataset.k = ""; });
    };
    const pc = v => (v * 100).toFixed(3) + "%";
    const hover = e => {
      const box = e.target.closest && e.target.closest(".amapimg");
      document.querySelectorAll("#where .amaptip").forEach(t => { if (!box || t.parentElement !== box) t.hidden = true; });
      document.querySelectorAll("#where .amaphl").forEach(l => { if (!box || l.parentElement !== box) { l.textContent = ""; l.dataset.k = ""; } });
      if (!box || typeof Maps === "undefined") return;
      const fig = box.closest("figure"), tip = box.querySelector(".amaptip"), hl = box.querySelector(".amaphl"), r = box.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      let found = [];
      try { found = JSON.parse(fig.dataset.found || "[]"); } catch { /* ignore */ }
      const hits = Maps.at(fig.dataset.map, fx, fy, found);
      if (!hits.length || !tip) { if (tip) tip.hidden = true; if (hl) { hl.textContent = ""; hl.dataset.k = ""; } return; }
      if (hl) {                                                                 // outline every tile of the hovered place(s)
        const bx = hits.flatMap(x => x.boxes), key = JSON.stringify(bx);
        if (hl.dataset.k !== key) {
          const W = Number(fig.dataset.w), H = Number(fig.dataset.h);
          hl.dataset.k = key;
          hl.innerHTML = bx.map(([x, y, w, h]) => `<i style="left:${pc(x / W)};top:${pc(y / H)};width:${pc(w / W)};height:${pc(h / H)}"></i>`).join("");
        }
      }
      // name; if a roamer could be on that route: "could be roaming here"; if the Pokémon is found there: "found here", plus the time of day on maps that have one (Gold / Silver / Crystal)
      tip.innerHTML = hits.map(h => h.here ? `<b>${esc(h.name)}</b> · found here${h.when ? ` · ${esc(h.when)}` : ""}`
        : h.roam ? `<b>${esc(h.name)}</b> · could be roaming here` : esc(h.name)).join("<br>");
      tip.style.left = fx * 100 + "%"; tip.style.top = fy * 100 + "%";
      const h = fx < 0.3 ? "0" : fx > 0.7 ? "-100%" : "-50%";                  // keep the tooltip inside the map
      tip.style.transform = fy < 0.25 ? `translate(${h}, 16px)` : `translate(${h}, calc(-100% - 8px))`;
      tip.hidden = false;
    };
    const wb = $("#where-body");
    wb.addEventListener("pointermove", hover);
    wb.addEventListener("pointerdown", hover);                                  // touch: tap a tile
    wb.addEventListener("pointerleave", hideTips);
  }

  return { init, open, plan, render };
})();