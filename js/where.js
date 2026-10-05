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
    pokeflute: "Poké Flute", "bug-catching-contest": "Bug-Catching Contest", "roaming-grass": "Roaming", "roaming-water": "Roaming (water)",
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

  // "Route 2 — Grass 3–5, 10%" lines, one per location.
  function lines(entries) {
    const areas = new Map();
    for (const [area, method, lo, hi, chance, cond] of entries) {
      const bits = [label(method), cond, lo ? (lo === hi ? `Lv ${lo}` : `Lv ${lo}–${hi}`) : "", chance && chance < 100 ? `${chance}%` : ""].filter(Boolean);
      if (!areas.has(area)) areas.set(area, []);
      areas.get(area).push(bits.join(" · "));
    }
    return [...areas].map(([area, how]) => ({ area, how: how.join("; ") }));
  }

  const nameOf = n => (mons.find(m => m.n === n) || { name: `#${n}` }).name;

  function render(game, n, groups) {
    if (!groups.length) {
      return `<p>No wild, gift or one-time encounters are recorded for ${esc(nameOf(n))} in ${esc(game.name)} or the games that link to it.
        It may be an evolution, a breeding result, an event Pokémon, or a trade. Check the full page below.</p>`;
    }
    return groups.map(g => {
      const rows = lines(g.entries).map(l => `<li><strong>${esc(l.area)}</strong><span>${esc(l.how)}</span></li>`);
      if (g.evolve) rows.unshift(...evoRows(g.evolve));
      const open = g.games.some(x => x.key === game.key) || rows.length <= 6;
      const sub = g.vias.length ? `<small>reaches ${esc(game.name)} by ${esc(g.vias.join(" / "))}</small>` : "";
      return `<details${open ? " open" : ""}><summary>${esc(g.games.map(x => x.name).join(", "))} ${sub}</summary><ul>${rows.join("")}</ul></details>`;
    }).join("");
  }

  function load() {
    if (data) return Promise.resolve(data);
    const get = f => fetch(`data/${f}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    return (loading = loading || Promise.all([get("locations"), get("items")])
      .then(([d, items]) => { loading = null; return (data = d && { ...d, items }); }));   // items.json is optional; a failed load can be retried next time
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
  }

  return { init, open, plan, render };
})();