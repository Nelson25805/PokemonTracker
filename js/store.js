"use strict";
// State: the one place the tracker's data lives. No DOM and no I/O in here.
//
//   Store.get()                      current state (treat it as read-only; every update makes a new object)
//   Store.set({ name: "Ash" })       shallow-merge top-level keys; subscribers are told once per call
//   Store.replace(data)              swap in a whole state (import); missing fields get defaults
//   Store.toggle(kind, gameKey, n)   flip Pokémon n in state.caught / state.shiny for one game
//   Store.subscribe(fn)              fn(state, prev) runs after every change; returns an unsubscribe function
//
// Because updates are immutable, a subscriber can tell what changed with a reference check
// (state.caught !== prev.caught) instead of re-rendering everything.
//
// Shape (kept identical to the old exports, so existing backup files still import):
//   { version, name, gender, caught: {gameKey: [n…]}, shiny: {gameKey: [n…]}, last: {game, shiny} }
const Store = (() => {
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const blank = () => ({ version: 1, name: "", gender: "Boy", caught: {}, shiny: {}, last: { game: "red", shiny: false } });

  // Fill in anything missing from saved/imported data so the rest of the app can trust the shape.
  function normalize(data) {
    const b = blank(), d = isObj(data) ? data : {};
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
