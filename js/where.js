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
// Honey trees (Diamond / Pearl / Platinum): data/honey.json (optional) lists what a slathered honey tree can attract and where
// the trees are. At load time its encounters are added to the location data as ONE "Honey Trees" row (the per-route
// "Honey tree" rows that PokéAPI has in locations.json are folded into it, so honey trees are listed in one place only),
// Maps.addHoney() puts the 21 trees on the map (one small flashing square each), and the row gets a short help text plus
// a list of every tree with a "Show on map" button each.
//
// Location data lives in data/locations.json (built by build_locations.py) and is fetched the first
// time the panel opens, so it costs nothing until someone asks.
const Where = (() => {
  const $ = s => document.querySelector(s);
  let games = [], mons = [], byKey = {}, data = null, loading = null, honey = null;
  let last = null, season = "all", tod = "all";                              // last = what the open dialog shows (for the season buttons); season = the chosen season filter ("all" or spring / summer / autumn / winter)

  const HONEY = "Honey Trees", HONEY_PRE = "Honey Tree: ";     // same names as in maps.js

  const METHODS = {
    walk: "Grass / cave / land", surf: "Surfing", "old-rod": "Old Rod", "good-rod": "Good Rod", "super-rod": "Super Rod",
    "rock-smash": "Rock Smash", headbutt: "Headbutt", gift: "Gift", "gift-egg": "Gift (Egg)", "only-one": "Static (one-time)",
    pokeflute: "Poké Flute", "bug-catching-contest": "Bug-Catching Contest", "roaming-grass": "Roaming (grass / land)", "roaming-water": "Roaming (surfing)",
    "honey-tree": "Honey tree",
  };
  const TIMES = ["morning", "day", "night"];

  // ---- seasons (Black / White / Black 2 / White 2) ----
  // In these games the season follows the calendar month on the DS clock and repeats every four months:
  // January = Spring, February = Summer, March = Autumn, April = Winter, May = Spring, and so on.
  // data/locations.json stores it as an encounter condition ("Spring" after rebuilding, or "Season spring" from the older build).
  const SEASONS = ["spring", "summer", "autumn", "winter"];
  const SEASON_GAMES = new Set(["black", "white", "black-2", "white-2"]);
  const SEASON_NAME = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
  const SEASON_MONTHS = { spring: "Jan · May · Sep", summer: "Feb · Jun · Oct", autumn: "Mar · Jul · Nov", winter: "Apr · Aug · Dec" };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // ---- time of day (Gold / Silver / Crystal / HeartGold / SoulSilver and Diamond / Pearl / Platinum) ----
  const TNAME = { morning: "Morning", day: "Day", night: "Night" };
  const TPHRASE = { morning: "in the morning", day: "during the day", night: "at night" };
  const TCOL = { morning: "#ffd23f", day: "#ff8a1f", night: "#3b4cc0" };
  const CLOCK_GS = { morning: "4:00–9:59 AM", day: "10:00 AM–5:59 PM", night: "6:00 PM–3:59 AM" };
  const CLOCK_DP = { morning: "4:00–9:59 AM", day: "10:00 AM–7:59 PM", night: "8:00 PM–3:59 AM" };
  const CLOCK_OF = { gold: CLOCK_GS, silver: CLOCK_GS, crystal: CLOCK_GS, "heart-gold": CLOCK_GS, "soul-silver": CLOCK_GS, diamond: CLOCK_DP, pearl: CLOCK_DP, platinum: CLOCK_DP };
  const timesIn = cond => TIMES.filter(t => String(cond || "").split(",").some(p => p.trim().toLowerCase() === t));   // [] = the row applies at every time of day
  function timeBar(clock) {
    const btn = (id, name, sub) => `<button type="button" class="sbtn" data-k="time" data-s="${id}" aria-pressed="${tod === id}">${name}${sub}</button>`;
    const buttons = btn("all", "All day", "") + TIMES.map(t => btn(t, TNAME[t], clock ? `<small>${clock[t]}</small>` : "")).join("");
    return `<div class="seasonwrap"><div class="seg seasonbar" role="group" aria-label="Time of day">${buttons}</div>` +
      `<p class="seasonnote">What appears here depends on the time of day on the game's own clock. The hours are shown on each button. Pick one to see only what appears then.</p></div>`;
  }
  const seasonWord = p => { const m = /^(?:season[\s-]+)?(spring|summer|autumn|winter)$/i.exec(String(p).trim()); return m ? m[1].toLowerCase() : null; };
  const seasonsIn = cond => [...new Set(String(cond || "").split(",").map(seasonWord).filter(Boolean))];   // [] = the row applies in every season
  function seasonBar() {
    const d = new Date(), now = SEASONS[d.getMonth() % 4];
    const btn = (id, name, sub) => `<button type="button" class="sbtn" data-k="season" data-s="${id}" aria-pressed="${season === id}">${name}${sub}</button>`;
    const buttons = btn("all", "All seasons", "") + SEASONS.map(s => btn(s, SEASON_NAME[s], `<small>${SEASON_MONTHS[s]}${s === now ? " · now" : ""}</small>`)).join("");
    return `<div class="seasonwrap"><div class="seg seasonbar" role="group" aria-label="Season">${buttons}</div>` +
      `<p class="seasonnote">The season follows the calendar month on the DS clock and repeats every four months (months are shown on each button). ` +
      `Pick a season to see only what appears then, with that season's rates. Today (${MONTHS[d.getMonth()]}) would be ${SEASON_NAME[now]}.</p></div>`;
  }
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
    "Prism Scale": 5,
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
      if (p.kind === "beauty" && src.gen >= 5) continue;                // Gen 5 has no contests, so no Beauty evolutions
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
    if (src.gen === 5 && n === 470) return { from: evo[0], opts: ["Level up next to the Moss Rock in Pinwheel Forest."], items: [] };
    if (src.gen === 5 && n === 471) return { from: evo[0], opts: ["Level up next to the Ice Rock in Twist Mountain."], items: [] };
    if (src.gen === 5 && (n === 462 || n === 476)) return { from: evo[0], opts: ["Level up in Chargestone Cave (the magnetic field there)."], items: [] };
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
    if (src.gen === 4 && game.gen === 5) return "Poké Transfer (one-way)";
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
  function lines(entries, sel = "all", tsel = "all", clock = null) {
    const areas = new Map();
    for (const [area0, method, lo, hi, chance, cond] of entries) {
      // PokéAPI files HeartGold / SoulSilver's Latias / Latios under Johto, but they roam Kanto (same fix as in maps.js)
      const area = area0 === "Roaming Johto" && /copycat/i.test(cond || "") ? "Roaming Kanto" : area0;
      // Split the condition text into time of day, season and everything else (Swarm, Poké Radar, ...).
      const parts = String(cond || "").split(",").map(x => x.trim()).filter(Boolean);
      const hit = TIMES.filter(t => parts.some(p => p.toLowerCase() === t));
      const sHit = parts.map(seasonWord).filter(Boolean);                  // seasons this row is limited to (none = all four)
      if (sel !== "all" && sHit.length && !sHit.includes(sel)) continue;   // a season is chosen and this row is for other seasons
      if (tsel !== "all" && hit.length && !hit.includes(tsel)) continue;   // a time of day is chosen and this row is for other times
      const seasons = sHit.length ? sHit : SEASONS;
      const times = hit.length ? hit : TIMES;                              // a row with no time condition applies all day
      const other = parts.filter(p => !TIMES.includes(p.toLowerCase()) && !seasonWord(p)).join(", ");
      if (!areas.has(area)) areas.set(area, { best: 0, times: new Set(), grid: new Map(), seasonal: false, timed: false });
      const a = areas.get(area);
      times.forEach(t => a.times.add(t));
      a.best = Math.max(a.best, chance || 0);
      if (sHit.length) a.seasonal = true;
      if (hit.length && hit.length < TIMES.length) a.timed = true;
      // one line per method + level range, with that method's rate in every season / time of day it exists
      const gk = [method, other, lo, hi].join("|");
      let g = a.grid.get(gk);
      if (!g) a.grid.set(gk, g = { method, other, lo, hi, per: {}, tper: {} });
      for (const x of seasons) g.per[x] = Math.min(100, (g.per[x] || 0) + (chance || 0));
      for (const t of times) g.tper[t] = Math.min(100, (g.tper[t] || 0) + (chance || 0));
    }
    const lvl = r => (r.lo ? (r.lo === r.hi ? `Lv ${r.lo}` : `Lv ${r.lo}–${r.hi}`) : "");
    const mclass = m => (/surf|rod/.test(m) ? "water" : /^(gift|only-one)/.test(m) ? "static" : "land");
    const tags = x => (x.other ? x.other.split(", ").map(c => `<span class="ctag">${esc(c)}</span>`).join("") : "");
    const best = x => Math.max(0, ...Object.values(x.per));
    const rate = c => (c && c < 100 ? `<span class="rate"><b>${c}%</b><i><u style="width:${c}%"></u></i></span>` : "");
    // The body of one location: a table with one column per season / time of day when the Pokémon changes with it
    // (so the columns can be compared at a glance), otherwise one tidy line per method.
    const body = a => {
      const g = [...a.grid.values()].sort((x, y) => best(y) - best(x));
      const table = (cols, key, cls, head) => `<table class="stable"><thead><tr><th><span class="vh">Method</span></th>${cols.map(x => `<th class="${cls}-${x}">${head(x)}</th>`).join("")}</tr></thead><tbody>` +
        g.map(x => `<tr><td><b class="mchip m-${mclass(x.method)}">${esc(label(x.method))}</b><small>${esc(lvl(x))}</small>${tags(x)}</td>` +
          cols.map(c => (c in x[key] ? `<td class="yes">${x[key][c] ? x[key][c] + "%" : "✓"}</td>` : `<td class="na">—</td>`)).join("") + `</tr>`).join("") + `</tbody></table>`;
      if (a.seasonal && sel === "all") return table(SEASONS, "per", "s", x => SEASON_NAME[x]);
      if (a.timed && tsel === "all") return table(TIMES, "tper", "t", x => TNAME[x] + (clock ? `<small>${clock[x]}</small>` : ""));
      return g.map(x => {
        const c = sel !== "all" ? x.per[sel] : tsel !== "all" ? x.tper[tsel] : best(x);
        return `<div class="mrow"><b class="mchip m-${mclass(x.method)}">${esc(label(x.method))}</b><span class="lv">${esc(lvl(x))}</span>${tags(x)}${rate(c)}</div>`;
      }).join("");
    };
    const rows = [...areas].map(([area, a]) => {
      const s = typeof Maps !== "undefined" ? Maps.segment(area) : { base: area, seg: "" };
      return { area, base: s.base, seg: s.seg, best: a.best, times: TIMES.filter(t => a.times.has(t)), html: body(a) };
    });
    const top = new Map();                                      // North / South of one route stay together, ranked by the better one
    rows.forEach(r => top.set(r.base, Math.max(top.get(r.base) || 0, r.best)));
    return rows.sort((x, y) => top.get(y.base) - top.get(x.base) || x.base.localeCompare(y.base, undefined, { numeric: true }) || x.seg.localeCompare(y.seg));
  }

  // Which segments (North, South, East...) exist for each place in a game, from the location data itself.
  const segCache = {};
  function segIndex(key) {
    if (segCache[key]) return segCache[key];
    const m = new Map();
    for (const rows of Object.values((data && data.loc[key]) || {})) for (const r of rows) {
      const s = Maps.segment(r[0]); if (!s.seg) continue;
      if (!m.has(s.base)) m.set(s.base, new Set());
      m.get(s.base).add(s.seg);
    }
    return (segCache[key] = m);
  }
  // Location name + segment badge ("North only", "not in South") + form badges ("East Sea").
  function nameHtml(l, keys, mine, n) {
    let out = esc(l.seg ? l.base : l.area);
    if (l.seg) {
      const all = new Set(); keys.forEach(k => (segIndex(k).get(l.base) || []).forEach(s => all.add(s)));
      const have = mine[l.base], rest = [...all].filter(s => !have.has(s)), only = rest.length > 0;
      const drawn = Maps.exact(keys, l.area);
      out += ` <mark class="segtag${drawn ? "" : " approx"}" title="${drawn ? "Only this part of the route." : "This part isn't drawn on the map yet, so Show on map outlines the whole route."}">${esc(l.seg)}${only ? " only" : ""}</mark>`;
      if (only) out += `<small class="segnote">not in ${esc(rest.join(" / "))}</small>`;
    }
    const forms = typeof Forms !== "undefined" ? Forms.areasFor(n, keys, l.area, l.base) : [];
    return out + forms.map(f => ` <mark class="formtag" data-form="${esc(f.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}" title="Form found here">${esc(f)}</mark>`).join("");
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

  // ---- honey trees ----
  // Builds ONE "Honey Trees" row per Pokémon a honey tree can attract, in the same shape as the rows of locations.json:
  // [area, method, lo, hi, chance, cond]. Done once, when the data loads.
  //  1. PokéAPI lists a honey-tree row for every route a tree stands on ("Honey tree group c" on Route 205, 206, ...), which
  //     put 20-odd near-identical rows (and 37 flashing places) on the map. Those rows are removed for the honey games.
  //  2. The rows from honey.json are added instead (exact rates, 21 exact trees).
  //  3. A Pokémon PokéAPI knows about but honey.json doesn't (yet) still gets a single "Honey Trees" row, so nothing is lost.
  function mergeHoney(d, h) {
    if (!d || !h || !Array.isArray(h.encounters)) return;
    d.loc = d.loc || {};
    const isHoney = r => r && r[1] === "honey-tree" && r[0] !== HONEY;
    const covered = new Set();                                           // "game|n" pairs honey.json describes itself
    for (const e of h.encounters) for (const g of e.g || []) covered.add(g + "|" + e.n);
    for (const g of h.games || []) {
      const byMon = d.loc[g]; if (!byMon) continue;
      for (const n of Object.keys(byMon)) {
        const rows = byMon[n], old = rows.filter(isHoney);
        if (!old.length) continue;
        byMon[n] = rows.filter(r => !isHoney(r));
        if (!covered.has(g + "|" + n)) {                                 // keep one row, with the widest level range seen
          const lo = Math.min(...old.map(r => r[2] || 99)), hi = Math.max(...old.map(r => r[3] || 0));
          byMon[n].push([HONEY, "honey-tree", lo === 99 ? 0 : lo, hi, 0, ""]);
        }
      }
    }
    for (const e of h.encounters) for (const g of e.g || []) {
      const byMon = (d.loc[g] = d.loc[g] || {});
      (byMon[e.n] = byMon[e.n] || []).push([HONEY, "honey-tree", e.lo || 0, e.hi || 0, e.chance || 0, ""]);
    }
  }
  // The help under a "Honey Trees" row: how honey trees work, a note for this Pokémon, and every tree with its own button.
  function honeyHtml(keys, n) {
    if (!honey || !Array.isArray(honey.spots)) return "";
    const spots = honey.spots.filter(s => typeof Maps !== "undefined" && Maps.locate(keys, HONEY_PRE + s.name).length);
    const note = honey.notes && honey.notes[n] ? `<p>${esc(honey.notes[n])}</p>` : "";
    const list = spots.map((s, i) => `<li><strong>${i + 1}. ${esc(s.name)}</strong><span>${esc(s.desc || "")}</span>` +
      `<button type="button" class="locbtn" data-area="${esc(HONEY_PRE + s.name)}" data-keys="${esc(keys.join(","))}" data-times="" aria-pressed="false" aria-label="Outline the ${esc(s.name)} honey tree on the map">Show on map</button></li>`).join("");
    return `<div class="honeyinfo">${honey.intro ? `<p>${esc(honey.intro)}</p>` : ""}${note}` +
      (list ? `<details class="honeydet" open><summary>All ${spots.length} honey trees</summary><ul>${list}</ul></details>` : "") + `</div>`;
  }

  const nameOf = n => (mons.find(m => m.n === n) || { name: `#${n}` }).name;

  function render(game, n, groups) {
    if (!groups.length) {
      const map = typeof Maps !== "undefined" ? Maps.html([game.key], [], nameOf(n)) : "";   // still show the map, with "AREA UNKNOWN"
      return map + `<p>No wild, gift or one-time encounters are recorded for ${esc(nameOf(n))} in ${esc(game.name)} or the games that link to it.
        It may be an evolution, a breeding result, an event Pokémon, or a trade. Check the full page below.</p>`;
    }
    // Season filter: only for Black / White / Black 2 / White 2, and only when this Pokémon has season-dependent rows
    const seasonal = groups.some(g => g.games.some(x => SEASON_GAMES.has(x.key)) && g.entries.some(e => seasonsIn(e[5]).length));
    const sel = seasonal ? season : "all";
    // Time-of-day filter: only for games with a clock, and only when this Pokémon has time-dependent rows
    const clockOf = g => g.games.map(x => CLOCK_OF[x.key]).find(Boolean) || null;
    const timed = groups.some(g => clockOf(g) && g.entries.some(e => timesIn(e[5]).length));
    const tsel = timed ? tod : "all";
    const keep = e => {
      if (sel !== "all") { const s = seasonsIn(e[5]); if (s.length && !s.includes(sel)) return false; }
      if (tsel !== "all") { const t = timesIn(e[5]); if (t.length && !t.includes(tsel)) return false; }
      return true;
    };
    return (seasonal ? seasonBar() : "") + (timed ? timeBar(groups.map(clockOf).find(Boolean)) : "") + groups.map(g => {
      const entries = sel === "all" && tsel === "all" ? g.entries : g.entries.filter(keep);
      const keys = g.games.map(x => x.key);
      const ls = lines(entries, sel, tsel, clockOf(g)), mine = {};
      ls.forEach(l => { if (l.seg) (mine[l.base] = mine[l.base] || new Set()).add(l.seg); });
      const rows = ls.map(l => {
        // "Show on map" button: only when this location has a box on one of the maps shown for this group
        const ok = typeof Maps !== "undefined" && Maps.locate(keys, l.area).length;
        const btn = ok ? `<button type="button" class="locbtn" data-area="${esc(l.area)}" data-keys="${esc(keys.join(","))}" data-times="${l.times.join(" ")}" aria-pressed="false" aria-label="Outline ${esc(l.area)} on the map">Show on map</button>` : "";
        const extra = l.area === HONEY && honey ? honeyHtml(keys, n) : "";
        return `<li><strong>${nameHtml(l, keys, mine, n)}</strong><span class="wide">${l.html}</span>${btn}${extra}</li>`;
      });
      if (!entries.length && (sel !== "all" || tsel !== "all")) rows.push(`<li><span>Not found here ${sel !== "all" ? "in " + SEASON_NAME[sel] : TPHRASE[tsel]}.</span></li>`);
      if (g.evolve) rows.unshift(...evoRows(g.evolve));
      const open = g.games.some(x => x.key === game.key) || rows.length <= 6;
      const sub = g.vias.length ? `<small>reaches ${esc(game.name)} by ${esc(g.vias.join(" / "))}</small>` : "";
      const maps = typeof Maps !== "undefined" && (entries.length || !g.entries.length) ? Maps.html(g.games.map(x => x.key), entries, nameOf(n)) : "";   // region map with the locations marked
      return `<details${open ? " open" : ""}><summary>${esc(g.games.map(x => x.name).join(", "))} ${sub}</summary>${maps}${roamNote(g)}<ul>${rows.join("")}</ul></details>`;
    }).join("");
  }

  function load() {
    if (data) return Promise.resolve(data);
    const get = f => fetch(`data/${f}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    return (loading = loading || Promise.all([get("locations"), get("items"), get("maps"), get("honey")])
      .then(([d, items, maps, hon]) => {
        loading = null;
        if (typeof Maps !== "undefined") {
          Maps.init(maps);                                                         // maps.json is optional too
          if (hon) Maps.addHoney(hon);                                             // honey.json is optional: puts the trees on the map
        }
        if (d && hon) { mergeHoney(d, hon); honey = hon; }
        return (data = d && { ...d, items });
      }));   // items.json and honey.json are optional; a failed load can be retried next time
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
      ? (last = { game, n, groups: plan(game, n, byKey, d) }, render(game, n, last.groups))
      : `<p>Location data isn't installed yet. Run <code>python3 build_locations.py</code> once to create <code>data/locations.json</code>.</p>`;
  }

  function init(deps) {
    games = deps.games; mons = deps.mons;
    byKey = Object.fromEntries(games.map(g => [g.key, g]));
    $("#where-close").addEventListener("click", () => $("#where").close());
    $("#where-x").addEventListener("click", () => $("#where").close());

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
          hl.innerHTML = Maps.outline(bx, W, H);                                // boxes and shapes (circles, triangles, diagonal strips)
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

    // Season buttons (Black / White / Black 2 / White 2): redraw the list for the chosen season, keeping the scroll position.
    if (!document.getElementById("where-season-css")) {
      const st = document.createElement("style"); st.id = "where-season-css";
      st.textContent = `#where .seasonwrap{margin:0 0 10px}
#where .seasonbar{flex-wrap:wrap;gap:6px}
#where .seasonbar button{display:flex;flex-direction:column;align-items:center;gap:1px;padding:4px 10px;font-size:13px;line-height:1.2;border-right-width:2px}
#where .seasonbar button small{font-size:11px;opacity:.85;white-space:nowrap}
#where .seasonbar .sbtn[data-s=spring]{border-bottom:5px solid #6cbf5a}
#where .seasonbar .sbtn[data-s=summer]{border-bottom:5px solid #f2c230}
#where .seasonbar .sbtn[data-s=autumn]{border-bottom:5px solid #e07b2a}
#where .seasonbar .sbtn[data-s=winter]{border-bottom:5px solid #6aaee8}
#where .seasonnote{margin:6px 0 0;font-size:12px;opacity:.85}
#where li span.wide{order:3;flex:1 1 100%}
#where li:has(span.wide) .locbtn{order:2}
#where .stable{width:100%;border-collapse:collapse;font-size:12px;margin:2px 0 4px;table-layout:fixed}
#where .stable th,#where .stable td{border:1px solid var(--mid);padding:3px 4px;text-align:center}
#where .stable th:first-child,#where .stable td:first-child{width:38%;text-align:left}
#where .stable th{font-weight:600;border-bottom-width:4px}
#where .stable .vh{position:absolute;left:-9999px}
#where .stable th.s-spring{border-bottom-color:#6cbf5a}
#where .stable th.s-summer{border-bottom-color:#f2c230}
#where .stable th.s-autumn{border-bottom-color:#e07b2a}
#where .stable th.s-winter{border-bottom-color:#6aaee8}
#where .stable td small{display:block;font-weight:400;opacity:.85}
#where .stable td.yes{background:var(--hi);color:var(--on-hi);font-weight:700}
#where .stable td.na{opacity:.35}
#where .seasonbar .sbtn[data-k=time][data-s=morning]{border-bottom:5px solid #ffd23f}
#where .seasonbar .sbtn[data-k=time][data-s=day]{border-bottom:5px solid #ff8a1f}
#where .seasonbar .sbtn[data-k=time][data-s=night]{border-bottom:5px solid #3b4cc0}
#where .stable th.t-morning{border-bottom-color:#ffd23f}
#where .stable th.t-day{border-bottom-color:#ff8a1f}
#where .stable th.t-night{border-bottom-color:#3b4cc0}
#where .stable th small{display:block;font-weight:400;font-size:10px;opacity:.85;line-height:1.2}
#where .stable td .mchip{display:inline-block;margin-bottom:2px}
#where .stable td .ctag{margin-left:4px}
#where li:has(span.wide){padding:8px 0;row-gap:6px}
#where li:has(span.wide)>strong{font-size:14px}
#where .mrow{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:3px 0}
#where .mrow+.mrow{border-top:1px dotted var(--mid)}
#where .mchip{font-size:11px;font-weight:600;padding:1px 7px;border:2px solid var(--line);background:var(--card);white-space:nowrap}
#where .mchip.m-land{background:#e3f1cf;border-color:#6a9a3a;color:#1d3a0c}
#where .mchip.m-water{background:#d9ebfa;border-color:#4f8fc4;color:#0c2e4d}
#where .mchip.m-static{background:#ebe1fa;border-color:#8a63c9;color:#2a1250}
#where .mrow .lv{font-size:13px}
#where .ctag{display:inline-block;font-size:11px;padding:0 6px;border:1px dashed var(--line);white-space:nowrap}
#where .rate{margin-left:auto;display:inline-flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:60px}
#where .rate b{font-size:12px;font-weight:700;line-height:1.1}
#where .rate i{display:block;width:60px;height:5px;border:1px solid var(--line);background:var(--card)}
#where .rate u{display:block;height:100%;background:var(--ink)}`;
      document.head.append(st);
    }
    wb.addEventListener("click", e => {
      const sb = e.target.closest && e.target.closest(".sbtn"); if (!sb || !last) return;
      if (sb.dataset.k === "time") tod = sb.dataset.s; else season = sb.dataset.s;
      const sc = $("#where .dbody"), top = sc ? sc.scrollTop : 0;
      const dets = [...wb.querySelectorAll("details")].map(d => d.open);          // which games / lists you had open or folded
      const pinned = wb.querySelector(".locbtn[aria-pressed=true]");
      const pin = pinned && { area: pinned.dataset.area, keys: pinned.dataset.keys };   // the "Show on map" outline that was on
      wb.innerHTML = render(last.game, last.n, last.groups);
      wb.querySelectorAll("details").forEach((d, i) => { if (i < dets.length) d.open = dets[i]; });
      if (pin) { const b = [...wb.querySelectorAll(".locbtn")].find(x => x.dataset.area === pin.area && x.dataset.keys === pin.keys); if (b) showPin(b, true); }
      if (sc) sc.scrollTop = top;
    });

    // "Show on map" buttons: outline one location on its map. Only one outline can be on at a time (in the whole dialog).
    const clearPins = () => {
      wb.querySelectorAll(".amappin").forEach(p => { p.textContent = ""; });
      wb.querySelectorAll(".locbtn").forEach(b => { b.setAttribute("aria-pressed", "false"); b.textContent = "Show on map"; });
    };
    const showPin = (btn, quiet) => {
      const det = btn.closest("details:not(.honeydet)"); if (det) det.open = true;   // the honey tree list is a details inside the game's details
      const scope = det || wb, q = id => CSS.escape(id);
      const hit = Maps.locate(btn.dataset.keys.split(","), btn.dataset.area)
        .find(h => scope.querySelector(`figure.amap[data-map="${q(h.id)}"]`));
      if (!hit) return;                                                        // map picture failed to load
      const figs = [...scope.querySelectorAll(`figure.amap[data-map="${q(hit.id)}"]`)];
      const tab = scope.querySelector(`.amaptab[data-map="${q(hit.id)}"]`);    // several maps: switch to the right tab
      if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
      const times = btn.dataset.times ? btn.dataset.times.split(" ") : [];
      const tree = btn.dataset.area.startsWith(Maps.honeyPrefix) || btn.dataset.area === Maps.honeyAll, g = tree ? 2 : 0;   // a honey tree: red outline a little outside the icon
      const boxes = Maps.pin(hit.boxes, hit.w, hit.h, g, tree);
      for (const f of figs) {
        // time of day: only when the entry applies to some times and not others, and the filter doesn't already match
        if (times.length && times.length < 3 && f.querySelector(".tfilter")) {
          const cur = f.dataset.time;
          if (cur === "all" ? times.length === 1 : !times.includes(cur)) {
            const tb = f.querySelector(`.tbtn[data-t="${times[0]}"]`); if (tb) tb.click();
          }
        }
        const pin = f.querySelector(".amappin"); if (pin) pin.innerHTML = boxes;
      }
      btn.setAttribute("aria-pressed", "true"); btn.textContent = "Hide outline";
      const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!quiet) figs[0].scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    };
    wb.addEventListener("click", e => {
      const btn = e.target.closest && e.target.closest(".locbtn"); if (!btn) return;
      const was = btn.getAttribute("aria-pressed") === "true";
      clearPins();                                                             // never two outlines at once
      if (!was) showPin(btn);
    });
  }

  return { init, open, plan, render };
})();