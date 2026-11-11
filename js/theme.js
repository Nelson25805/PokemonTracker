"use strict";
// Theme: colour palettes + light/dark mode. Loaded in <head> so the saved choice applies before first paint.
// Uses its own localStorage key, so the progress save format is untouched.
//   <html data-theme="ruby">  palette (absent = Classic green)    <html data-mode="dark">  "light" or "dark" (Auto follows the device)
// Theme list comes from data/games.config.json via Theme.setGroups(Config.themeGroups()).
// New game theme: add :root[data-theme=<key>] light + [data-mode=dark] blocks to css/style.css.
const Theme = (() => {
  const KEY = "pokedexTracker.theme";
  const MODES = ["auto", "light", "dark"];
  const ID_OK = /^[a-z][a-z0-9-]{0,31}$/;
  let GROUPS = [];
  const root = document.documentElement;
  const state = { theme: "classic", mode: "auto" };

  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && typeof r.theme === "string" && ID_OK.test(r.theme)) state.theme = r.theme;
    if (r && MODES.includes(r.mode)) state.mode = r.mode;
  } catch { }

  const dark = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : { matches: false };

  function apply() {
    if (state.theme === "classic") root.removeAttribute("data-theme"); else root.dataset.theme = state.theme;
    root.dataset.mode = state.mode === "auto" ? (dark.matches ? "dark" : "light") : state.mode;
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
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { }
  }

  function fillSelect() {
    const sel = document.getElementById("theme");
    if (!sel || !GROUPS.length) return;
    sel.innerHTML = GROUPS.map(([label, items]) =>
      `<optgroup label="${label}">${items.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</optgroup>`).join("");
    sel.value = state.theme;
  }

  function setGroups(groups) {
    GROUPS = groups;
    if (!GROUPS.some(g => g[1].some(t => t[0] === state.theme))) { state.theme = "classic"; save(); }
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

  apply();
  if (dark.addEventListener) dark.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", init);
  return { state, setGroups };
})();