"use strict";
// Persist: everything that moves state in or out of the browser (named Persist because Storage is a built-in type).
//   load() / save(state)   localStorage read / write (silently skipped in private mode)
//   exportFile(state)      download a backup .json
//   readFile(file)         parse a backup, migrate it to the current version; throws if invalid (err.code "newer" if from a newer build)
//   backup(raw)            keep the first copy of an old-format save before migrating
const Persist = (() => {
  const KEY = "pokedexTracker.v1";
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);

  return {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
    },
    save(state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { }
    },
    exportFile(state) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: "application/json" }));
      a.download = "pokedex-progress.json"; a.click(); URL.revokeObjectURL(a.href);
    },
    backup(raw) {
      try {
        const k = `${KEY}.backup.v${Number.isInteger(raw?.version) ? raw.version : 1}`;
        if (localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify(raw));
      } catch { }
    },
    async readFile(file) {
      if (file.size > 2e6) throw new Error("too big");
      const raw = JSON.parse(await file.text());
      if (Store.isNewer(raw)) throw Object.assign(new Error("newer version"), { code: "newer" });
      const d = Store.migrate(raw);
      if (!isObj(d) || !isObj(d.caught) || !isObj(d.shiny)) throw new Error("bad shape");
      return d;
    },
  };
})();