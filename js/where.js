"use strict";
// "Where to find": a dialog listing where a Pokémon can be found, limited to the games that can
// send Pokémon to the one you're tracking (see `sources` in config.js).
//
//   Where.init({ games, mons })   once, after the game and Pokémon lists load
//   Where.open(game, n)           show Pokémon #n for the currently selected game
//   Where.plan(game, n, byKey, data)   pure: works out what to show (exported for testing)
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
      const evo = d.evo[n];
      const evolve = evo && evo[0] <= src.count ? evo : null;    // pre-evolution must exist in that game too
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
      if (g.evolve) rows.unshift(`<li class="evo"><strong>Evolve ${esc(nameOf(g.evolve[0]))}</strong><span>${esc(g.evolve[1])}</span></li>`);
      const open = g.games.some(x => x.key === game.key) || rows.length <= 6;
      const sub = g.vias.length ? `<small>reaches ${esc(game.name)} by ${esc(g.vias.join(" / "))}</small>` : "";
      return `<details${open ? " open" : ""}><summary>${esc(g.games.map(x => x.name).join(", "))} ${sub}</summary><ul>${rows.join("")}</ul></details>`;
    }).join("");
  }

  function load() {
    if (data) return Promise.resolve(data);
    return (loading = loading || fetch("data/locations.json")
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => { loading = null; return (data = d); }));   // a failed load can be retried next time
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

  return { init, open, plan };
})();
