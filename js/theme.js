"use strict";
// Theme: colour palettes + light/dark mode. Loaded in <head> so the saved choice is applied before the
// page paints (no flash). It keeps its own small localStorage key, so the progress save format
// (store.js) is untouched and no migration is needed.
//
//   <html data-theme="ruby">   a palette (absent = Classic green)
//   <html data-mode="dark">    "light" or "dark", always set. The Mode button cycles Auto / Light / Dark; Auto follows the device.
//
// To add a theme: add one line to GROUPS below and one `:root[data-theme=id]{...}` block in css/style.css.
const Theme = (() => {
  const KEY = "pokedexTracker.theme";
  const GROUPS = [
    ["Game Boy", [["classic", "Classic green"], ["pocket", "Pocket gray"], ["color", "Color purple"]]],
    ["Gen 1 · Kanto", [["red", "Red"], ["blue", "Blue"], ["yellow", "Yellow"]]],
    ["Gen 2 · Johto", [["gold", "Gold"], ["silver", "Silver"], ["crystal", "Crystal"]]],
    ["Gen 3 · Hoenn", [["ruby", "Ruby"], ["sapphire", "Sapphire"], ["emerald", "Emerald"], ["fire-red", "Fire Red"], ["leaf-green", "Leaf Green"]]],
    ["Gen 4 · Sinnoh", [["diamond", "Diamond"], ["pearl", "Pearl"], ["platinum", "Platinum"], ["heart-gold", "Heart Gold"], ["soul-silver", "Soul Silver"]]],
  ];
  const MODES = ["auto", "light", "dark"];
  const IDS = new Set(GROUPS.flatMap(g => g[1].map(t => t[0])));
  const root = document.documentElement;
  const state = { theme: "classic", mode: "auto" };

  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && IDS.has(r.theme)) state.theme = r.theme;
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

  function init() {
    const sel = document.getElementById("theme"), btn = document.getElementById("mode");
    if (sel) {
      sel.innerHTML = GROUPS.map(([label, items]) =>
        `<optgroup label="${label}">${items.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</optgroup>`).join("");
      sel.addEventListener("change", () => { state.theme = sel.value; save(); apply(); });
    }
    if (btn) btn.addEventListener("click", () => {
      state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]; save(); apply();
    });
    apply();
  }

  apply();                                                       // before first paint
  if (dark.addEventListener) dark.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", init);
  return { state };
})();