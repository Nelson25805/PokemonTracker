"use strict";
// Storage: everything that moves state in or out of the browser. No DOM, no app logic.
// (Named Persist because `Storage` is already a built-in browser type.)
//
//   Persist.load()            saved state from this browser, or null
//   Persist.save(state)       write state to this browser (silently skipped in private mode)
//   Persist.exportFile(state) download a backup .json
//   Persist.readFile(file)    parse a backup .json and migrate it to the current version;
//                             throws if it isn't one (err.code === "newer" if made by a newer build)
//   Persist.backup(raw)       keep a copy of an old-format save before it is migrated
//
// A cloud-sync backend would be another object with the same shape; wiring it up is one line:
//   Store.subscribe(state => Cloud.push(state))
const Persist = (() => {
  const KEY = "pokedexTracker.v1";
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);

  return {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
    },
    save(state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: progress not saved */ }
    },
    exportFile(state) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: "application/json" }));
      a.download = "pokedex-progress.json"; a.click(); URL.revokeObjectURL(a.href);
    },
    backup(raw) {
      try {
        const k = `${KEY}.backup.v${Number.isInteger(raw?.version) ? raw.version : 1}`;
        if (localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify(raw)); // keep the first copy only
      } catch { /* storage unavailable: skip */ }
    },
    async readFile(file) {
      if (file.size > 2e6) throw new Error("too big");                 // a real export is well under 100 KB
      const raw = JSON.parse(await file.text());
      if (Store.isNewer(raw)) throw Object.assign(new Error("newer version"), { code: "newer" });
      const d = Store.migrate(raw);                                     // check the shape after upgrading, so it is the current one
      if (!isObj(d) || !isObj(d.caught) || !isObj(d.shiny)) throw new Error("bad shape");
      return d;
    },
  };
})();