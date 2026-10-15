"use strict";
// Config: the game list and every per-game setting, read from data/games.config.json (the one source of truth).
//
//   Config.load()          Promise of the games array (cached). Each game is the config entry plus:
//                            card      the named card layout merged with that game's own overrides (or undefined)
//                            diploma   the named diploma layout (or undefined)
//                            sources   keys of the games whose Pokémon can reach this game (itself first), for "where to find"
//   Config.themeGroups()   [[group label, [[id, name], ...]], ...] for the Theme dropdown (after load())
//   Config.build(cfg)      pure: raw config -> games array (exported for testing)
//
// Fonts are not per game, so they stay here.
// native = the pixel size each font was drawn for; other sizes are scaled from it.
// asc = the font's ascent / em-size (GDI+ anchors text by its top, canvas by its baseline).
const FONTS = {
  pkmn: { css: "PKMN",     asc: 1.0,    native: 8 },
  rs:   { css: "PokeRS",   asc: 0.8662, native: 15 },
  frlg: { css: "PokeFRLG", asc: 1.2998, native: 10 },
};

const Config = (() => {
  const PATH = "data/games.config.json";
  let raw = null, games = null, loading = null;

  // Which games can send Pokémon into each game, the game itself first:
  //   same generation (trading), then the generations listed in that generation's "transfer"
  //   (Gen 1 <-> 2 Time Capsule, Gen 3 -> 4 Pal Park). A game can set its own "sources" list to override.
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

  return { load, build, themeGroups };
})();
