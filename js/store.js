"use strict";
// Store: the single place the tracker's data lives. No DOM, no I/O. Updates are immutable, so subscribers can detect
// changes with reference checks (state.caught !== prev.caught).
//   get / set(patch) / replace(data) / subscribe(fn(state, prev))
//   toggle(kind, gameKey, n) / setList(kind, gameKey, ns)          kind = "caught" | "shiny"
//   toggleForm(kind, gameKey, id) / setFormList(kind, gameKey, ids)   forms and gender variants (ids from data/forms.json)
//   migrate / isOutdated / isNewer / VERSION                          save-format upgrades
//   sanitize(data, games, formsData)                                  strict check for imported data -> { state, dropped }
// Shape: { version, name, gender, caught, shiny, forms: { caught, shiny },
//          last: { game, shiny, dex, cardOpen, badges, layout, require: { gender, alt } } }
// Changing the save format: raise VERSION, add MIGRATIONS[oldVersion] (pure, never edit old ones), add the default to blank(),
// and add its check to sanitize() if users can import it.
const Store = (() => {
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const VERSION = 2;

  const MIGRATIONS = {
    1: s => ({ ...s, forms: { caught: {}, shiny: {} } }),
  };

  const versionOf = d => (isObj(d) && Number.isInteger(d.version) && d.version >= 1 ? d.version : 1);

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

  const blank = () => ({ version: VERSION, name: "", gender: "Boy", caught: {}, shiny: {}, forms: { caught: {}, shiny: {} }, last: { game: "red", shiny: false, dex: "national", cardOpen: false, badges: true, layout: "grid", require: { gender: false, alt: false } } });

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

  const cmpForm = (a, b) => (parseInt(a, 10) - parseInt(b, 10)) || (a < b ? -1 : a > b ? 1 : 0);

  function sanitize(data, games, formsData) {
    const d = normalize(data), byKey = new Map(games.map(g => [g.key, g]));
    let dropped = 0;
    const lists = (src, kind) => {
      const out = {};
      for (const key of Object.keys(src)) {
        const g = byKey.get(key), raw = src[key];
        if (!g || !Array.isArray(raw) || (kind === "shiny" && !g.shiny)) { dropped += Array.isArray(raw) ? raw.length : 1; continue; }
        const ok = new Set(raw.filter(n => Number.isInteger(n) && n >= 1 && n <= g.count
          && !(kind === "shiny" && (g.shinyLocked || []).includes(n))));
        dropped += raw.length - ok.size;
        out[key] = [...ok].sort((a, b) => a - b);
      }
      return out;
    };
    const name = typeof d.name === "string" ? d.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 10) : "";
    if (name !== d.name) dropped++;
    const caught = lists(d.caught, "caught"), shiny = lists(d.shiny, "shiny");
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
    const last = { ...d.last, layout: d.last.layout === "pc" ? "pc" : "grid", require: { gender: rq.gender === true, alt: rq.alt === true } };
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
    init(raw) { state = normalize(raw); },
    get: () => state,
    set(patch) {
      if (Object.keys(patch).every(k => state[k] === patch[k])) return;
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