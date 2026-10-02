"use strict";
// Storage: everything that moves state in or out of the browser. No DOM, no app logic.
// (Named Persist because `Storage` is already a built-in browser type.)
//
//   Persist.load()            saved state from this browser, or null
//   Persist.save(state)       write state to this browser (silently skipped in private mode)
//   Persist.exportFile(state) download a backup .json
//   Persist.readFile(file)    parse a backup .json; throws if it isn't one
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
    async readFile(file) {
      const d = JSON.parse(await file.text());
      if (!isObj(d) || !isObj(d.caught) || !isObj(d.shiny)) throw new Error("bad shape");
      return d;
    },
  };
})();
