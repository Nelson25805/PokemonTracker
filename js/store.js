"use strict";
// State: the one place the tracker's data lives. No DOM and no I/O in here.
//
//   Store.get()                      current state (treat it as read-only; every update makes a new object)
//   Store.set({ name: "Ash" })       shallow-merge top-level keys; subscribers are told once per call
//   Store.replace(data)              swap in a whole state (import); missing fields get defaults
//   Store.toggle(kind, gameKey, n)   flip Pokémon n in state.caught / state.shiny for one game
//   Store.setList(kind, gameKey, ns) replace one game's whole caught/shiny list (bulk actions, undo)
//   Store.toggleForm(kind, gameKey, id)   flip one alternate form / gender variant (id like "201-b" or "25-f") in state.forms
//   Store.setFormList(kind, gameKey, ids) replace one game's whole forms list
//   Store.subscribe(fn)              fn(state, prev) runs after every change; returns an unsubscribe function
//   Store.migrate(data)              upgrade old saved/imported data to the current VERSION (pure; normalize calls it)
//   Store.isOutdated(raw) / isNewer(raw)   is this save older / newer than this build understands?
//   Store.VERSION                    the schema version this build writes
//   Store.sanitize(data, games, formsData)  strict check for imported data -> { state, dropped }; see below
//
// CHANGING THE SAVE FORMAT LATER (e.g. adding notes):
//   1. Raise VERSION by one.
//   2. Add MIGRATIONS[oldVersion] below: a pure function that turns an old save into the new shape.
//   3. Add the new field's default to blank().
//   Never edit or delete an old migration; saves from any past version run through every step in order.
//
// Because updates are immutable, a subscriber can tell what changed with a reference check
// (state.caught !== prev.caught) instead of re-rendering everything.
//
// Shape (kept identical to the old exports, so existing backup files still import):
//   { version, name, gender, caught: {gameKey: [n…]}, shiny: {gameKey: [n…]},
//     forms: { caught: {gameKey: [id…]}, shiny: {gameKey: [id…]} },        (version 2: forms/gender variants, ids from data/forms.json)
//     last: {game, shiny, dex, cardOpen, badges, require: {gender, alt}} }   (require = completion rules: form categories that must be caught for the dex to count as complete; no migration needed, old saves get the defaults)   (last.shiny = which list is being tracked; last.badges = show the corner badges)
const Store = (() => {
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const VERSION = 2;

  // MIGRATIONS[n] upgrades a version-n save into a version-(n+1) save. Each is a pure function
  // (don't mutate the input). The loop in migrate() stamps the new version number for you.
  // The next one will be MIGRATIONS[2]. Example, for per-Pokémon notes (also set VERSION = 3 and add `notes: {}` to blank()):
  //   2: s => ({ ...s, notes: {} }),
  const MIGRATIONS = {
    1: s => ({ ...s, forms: { caught: {}, shiny: {} } }),   // v2: alternate forms and gender variants are tracked separately from the main dex
  };

  // Saves written before versioning existed (or with a missing/garbled number) are treated as version 1.
  const versionOf = d => (isObj(d) && Number.isInteger(d.version) && d.version >= 1 ? d.version : 1);

  // Bring any older save up to VERSION, one step at a time. Newer-than-VERSION data is returned untouched
  // (an older copy of the site must not downgrade or damage it). A missing step is a bug in this file,
  // so it throws rather than guessing; the saved data in the browser is not touched.
  function migrate(data) {
    if (!isObj(data)) return data;
    let d = data, v = versionOf(d);
    while (v < VERSION) {
      const step = MIGRATIONS[v];
      if (!step) throw new Error(`No migration from save version ${v}`);
      d = { ...step(d), version: ++v };
    }
    return d;
  }

  const blank = () => ({ version: VERSION, name: "", gender: "Boy", caught: {}, shiny: {}, forms: { caught: {}, shiny: {} }, last: { game: "red", shiny: false, dex: "national", cardOpen: false, badges: true, require: { gender: false, alt: false } } });

  // Fill in anything missing from saved/imported data so the rest of the app can trust the shape.
  function normalize(data) {
    const b = blank(), d = isObj(data) ? migrate(data) : {}, f = isObj(d.forms) ? d.forms : {};
    return {
      ...b, ...d,
      caught: isObj(d.caught) ? d.caught : {},
      shiny: isObj(d.shiny) ? d.shiny : {},
      forms: { caught: isObj(f.caught) ? f.caught : {}, shiny: isObj(f.shiny) ? f.shiny : {} },
      last: { ...b.last, ...(isObj(d.last) ? d.last : {}) },
    };
  }

  // Strict clean-up for data from outside (imported files). `games` is the games.json list
  // ({ key, count, shiny }). Keeps only: known game keys, whole numbers from 1 to that game's count
  // (no duplicates, sorted), shiny lists only for games that have shiny sprites, a name of up to 10
  // printable characters, and gender Boy/Girl. Returns the cleaned state and how many entries it dropped.
  // Fields it doesn't know about pass through untouched. When you add a new saved field, add its check here.
  // Form ids sort by Pokédex number, then by name ("25-f" after "25").
  const cmpForm = (a, b) => (parseInt(a, 10) - parseInt(b, 10)) || (a < b ? -1 : a > b ? 1 : 0);

  // formsData is data/forms.json (or null if it didn't load; then ids are only checked for shape).
  function sanitize(data, games, formsData) {
    const d = normalize(data), byKey = new Map(games.map(g => [g.key, g]));
    let dropped = 0;
    const lists = (src, kind) => {
      const out = {};
      for (const key of Object.keys(src)) {
        const g = byKey.get(key), raw = src[key];
        if (!g || !Array.isArray(raw) || (kind === "shiny" && !g.shiny)) { dropped += Array.isArray(raw) ? raw.length : 1; continue; }
        const ok = new Set(raw.filter(n => Number.isInteger(n) && n >= 1 && n <= g.count));
        dropped += raw.length - ok.size;
        out[key] = [...ok].sort((a, b) => a - b);
      }
      return out;
    };
    const name = typeof d.name === "string" ? d.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 10) : "";
    if (name !== d.name) dropped++;
    const caught = lists(d.caught, "caught"), shiny = lists(d.shiny, "shiny");   // run these first: they update `dropped`
    // Forms: known game, shiny lists only for games with shiny sprites, ids that exist for that game in forms.json.
    const known = {};
    for (const sp of Object.values(formsData && isObj(formsData.species) ? formsData.species : {}))
      for (const f of sp.forms || []) for (const key of f.g || []) (known[key] = known[key] || new Set()).add(f.id);
    const formLists = (src, kind) => {
      const out = {};
      for (const key of Object.keys(src)) {
        const g = byKey.get(key), raw = src[key];
        if (!g || !Array.isArray(raw) || (kind === "shiny" && !g.shiny)) { dropped += Array.isArray(raw) ? raw.length : 1; continue; }
        const ok = new Set(raw.filter(id => typeof id === "string" && (formsData ? !!known[key] && known[key].has(id) : /^\d{1,3}-[a-z-]{1,24}$/.test(id))));
        dropped += raw.length - ok.size;
        out[key] = [...ok].sort(cmpForm);
      }
      return out;
    };
    const forms = { caught: formLists(d.forms.caught, "caught"), shiny: formLists(d.forms.shiny, "shiny") };
    const rq = isObj(d.last.require) ? d.last.require : {};
    const last = { ...d.last, require: { gender: rq.gender === true, alt: rq.alt === true } };
    return { dropped, state: { ...d, name, gender: d.gender === "Girl" ? "Girl" : "Boy", caught, shiny, forms, last } };
  }

  let state = blank();
  const subs = new Set();

  function commit(next) {
    const prev = state;
    state = next;
    for (const fn of [...subs]) fn(state, prev);
  }

  return {
    VERSION,
    migrate,
    isOutdated: raw => isObj(raw) && versionOf(raw) < VERSION,
    isNewer: raw => isObj(raw) && versionOf(raw) > VERSION,
    normalize,
    sanitize,
    init(raw) { state = normalize(raw); },           // load without notifying (nobody is subscribed yet)
    get: () => state,
    set(patch) {
      if (Object.keys(patch).every(k => state[k] === patch[k])) return; // nothing changed
      commit({ ...state, ...patch });
    },
    replace(next) { commit(normalize(next)); },
    toggle(kind, gameKey, n) {
      const list = new Set(state[kind][gameKey] || []);
      list.has(n) ? list.delete(n) : list.add(n);
      this.set({ [kind]: { ...state[kind], [gameKey]: [...list].sort((a, b) => a - b) } });
    },
    setList(kind, gameKey, ns) {
      this.set({ [kind]: { ...state[kind], [gameKey]: [...new Set(ns)].sort((a, b) => a - b) } });
    },
    toggleForm(kind, gameKey, id) {
      const list = new Set(state.forms[kind][gameKey] || []);
      list.has(id) ? list.delete(id) : list.add(id);
      this.setFormList(kind, gameKey, [...list]);
    },
    setFormList(kind, gameKey, ids) {
      this.set({ forms: { ...state.forms, [kind]: { ...state.forms[kind], [gameKey]: [...new Set(ids)].sort(cmpForm) } } });
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
})();