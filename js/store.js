"use strict";
// State: the one place the tracker's data lives. No DOM and no I/O in here.
//
//   Store.get()                      current state (treat it as read-only; every update makes a new object)
//   Store.set({ name: "Ash" })       shallow-merge top-level keys; subscribers are told once per call
//   Store.replace(data)              swap in a whole state (import); missing fields get defaults
//   Store.toggle(kind, gameKey, n)   flip Pokémon n in state.caught / state.shiny for one game
//   Store.subscribe(fn)              fn(state, prev) runs after every change; returns an unsubscribe function
//   Store.migrate(data)              upgrade old saved/imported data to the current VERSION (pure; normalize calls it)
//   Store.isOutdated(raw) / isNewer(raw)   is this save older / newer than this build understands?
//   Store.VERSION                    the schema version this build writes
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
//   { version, name, gender, caught: {gameKey: [n…]}, shiny: {gameKey: [n…]}, last: {game, shiny} }
const Store = (() => {
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const VERSION = 1;

  // MIGRATIONS[n] upgrades a version-n save into a version-(n+1) save. Each is a pure function
  // (don't mutate the input). The loop in migrate() stamps the new version number for you.
  // Example, for when you add per-Pokémon notes (also set VERSION = 2 and add `notes: {}` to blank()):
  //   1: s => ({ ...s, notes: {} }),
  const MIGRATIONS = {
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

  const blank = () => ({ version: VERSION, name: "", gender: "Boy", caught: {}, shiny: {}, last: { game: "red", shiny: false, dex: "national" } });

  // Fill in anything missing from saved/imported data so the rest of the app can trust the shape.
  function normalize(data) {
    const b = blank(), d = isObj(data) ? migrate(data) : {};
    return {
      ...b, ...d,
      caught: isObj(d.caught) ? d.caught : {},
      shiny: isObj(d.shiny) ? d.shiny : {},
      last: { ...b.last, ...(isObj(d.last) ? d.last : {}) },
    };
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
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
})();