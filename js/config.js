"use strict";
// Config: the game list and every per-game setting, loaded from data/games.config.json (the single source of truth).
//   Config.load()          Promise of the games array: each config entry plus its merged card layout, diploma layout,
//                          PC box layout (pc) and sources (games whose Pokémon can reach this game, itself first).
//   Config.themeGroups()   Theme dropdown groups; Config.gameGroups() Game dropdown groups (call after load()).
//   Config.build(cfg)      pure: raw config -> games array.
// FONTS: native = pixel size the font was drawn for (other sizes are scaled); asc = ascent / em-size.
const FONTS = {
  pkmn: { css: "PKMN",     asc: 1.0,    native: 8 },
  rs:   { css: "PokeRS",   asc: 0.8662, native: 15 },
  frlg: { css: "PokeFRLG", asc: 1.2998, native: 10 },
};

const Config = (() => {
  const PATH = "data/games.config.json";
  let raw = null, games = null, loading = null;

  function build(cfg) {
    const byGen = {};
    for (const g of cfg.games) (byGen[g.gen] = byGen[g.gen] || []).push(g.key);
    const sourcesOf = g => {
      if (Array.isArray(g.sources)) return g.sources;
      const extra = ((cfg.generations[g.gen] || {}).transfer || []).flatMap(n => byGen[n] || []);
      return [g.key, ...byGen[g.gen].filter(k => k !== g.key), ...extra];
    };
    return cfg.games.map(g => {
      const { card, diploma, ...rest } = g, out = { ...rest, sources: sourcesOf(g) };
      const pc = g.pc || (cfg.generations[g.gen] || {}).pc;
      if (pc) out.pc = pc;
      if (card) {
        const { layout, ...over } = card;
        if (!cfg.cardLayouts[layout]) throw new Error(`${g.key}: unknown card layout "${layout}"`);
        out.card = { ...cfg.cardLayouts[layout], ...over };
      }
      if (diploma) {
        if (!cfg.diplomaLayouts[diploma]) throw new Error(`${g.key}: unknown diploma layout "${diploma}"`);
        out.diploma = cfg.diplomaLayouts[diploma];
      }
      return out;
    });
  }

  function load() {
    return (loading = loading || fetch(PATH)
      .then(r => { if (!r.ok) throw new Error(`${PATH}: HTTP ${r.status}`); return r.json(); })
      .then(cfg => { raw = cfg; return (games = build(cfg)); })
      .catch(e => { loading = null; throw e; }));
  }

  function themeGroups() {
    const extra = ((raw && raw.extraThemes) || []).map(x => [x.label, x.items]);
    const gens = [...new Set(games.map(g => g.gen))].sort((a, b) => a - b);
    return [...extra, ...gens.map(n => [((raw.generations[n] || {}).label) || `Gen ${n}`, games.filter(g => g.gen === n).map(g => [g.key, g.name])])];
  }

  function gameGroups() {
    const gens = [...new Set(games.map(g => g.gen))].sort((a, b) => a - b);
    return gens.map(n => [((raw.generations[n] || {}).label) || `Gen ${n}`, games.filter(g => g.gen === n)]);
  }

  return { load, build, themeGroups, gameGroups };
})();