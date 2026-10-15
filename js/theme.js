"use strict";
// Theme: colour palettes + light/dark mode. Loaded in <head> so the saved choice is applied before the
// page paints (no flash). It keeps its own small localStorage key, so the progress save format
// (store.js) is untouched and no migration is needed.
//
//   <html data-theme="ruby">   a palette (absent = Classic green)
//   <html data-mode="dark">    "light" or "dark", always set. The Mode button cycles Auto / Light / Dark; Auto follows the device.
//
// The list of themes comes from data/games.config.json (one theme per game, named after its key, plus "extraThemes").
// app.js hands it over with Theme.setGroups(Config.themeGroups()) once the config has loaded.
// To add a theme for a new game: add the game to the config, then add one `:root[data-theme=<key>]{...}` light block
// and one `[data-mode=dark]` block to css/style.css (without them the game just uses the default colours).
const Theme = (() => {
  const KEY = "pokedexTracker.theme";
  const MODES = ["auto", "light", "dark"];
  const ID_OK = /^[a-z][a-z0-9-]{0,31}$/;
  let GROUPS = [];                                               // [[label, [[id, name], ...]], ...], set by setGroups
  const root = document.documentElement;
  const state = { theme: "classic", mode: "auto" };

  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && typeof r.theme === "string" && ID_OK.test(r.theme)) state.theme = r.theme;   // checked against the real list in setGroups
    if (r && MODES.includes(r.mode)) state.mode = r.mode;
  } catch { /* no saved theme, or storage blocked: use the defaults */ }

  const dark = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : { matches: false };

  function apply() {
    if (state.theme === "classic") root.removeAttribute("data-theme"); else root.dataset.theme = state.theme;
    // Auto resolves to the device's setting; every theme has a light and a dark palette.
    root.dataset.mode = state.mode === "auto" ? (dark.matches ? "dark" : "light") : state.mode;
    // Browser / installed-app title bar colour follows the palette.
    const c = getComputedStyle(root).getPropertyValue("--panel").trim();
    if (c) document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.removeAttribute("media"); m.content = c; });
    const sel = document.getElementById("theme"), btn = document.getElementById("mode");
    if (sel) sel.value = state.theme;
    if (btn) {
      btn.textContent = "Mode: " + state.mode[0].toUpperCase() + state.mode.slice(1);
      btn.title = "Switch between Auto (follows your device), Light and Dark";
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: not remembered */ }
  }

  function fillSelect() {
    const sel = document.getElementById("theme");
    if (!sel || !GROUPS.length) return;
    sel.innerHTML = GROUPS.map(([label, items]) =>
      `<optgroup label="${label}">${items.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</optgroup>`).join("");
    sel.value = state.theme;
  }

  // Called by app.js after data/games.config.json loads.
  function setGroups(groups) {
    GROUPS = groups;
    if (!GROUPS.some(g => g[1].some(t => t[0] === state.theme))) { state.theme = "classic"; save(); }   // saved theme was removed from the config
    fillSelect(); apply();
  }

  function init() {
    const sel = document.getElementById("theme"), btn = document.getElementById("mode");
    if (sel) sel.addEventListener("change", () => { state.theme = sel.value; save(); apply(); });
    if (btn) btn.addEventListener("click", () => {
      state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]; save(); apply();
    });
    fillSelect(); apply();
  }

  apply();                                                       // before first paint
  if (dark.addEventListener) dark.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", init);
  return { state, setGroups };
})();
