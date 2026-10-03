"use strict";
// View: reads from Store, draws the page, and turns DOM events into Store updates.
// It never touches localStorage or files (Persist does) and keeps no state of its own,
// only the static game and Pokémon lists it loads once.
(async function main() {
  const $ = s => document.querySelector(s);
  let games = [], mons = [], monByN = new Map(), regional = null, cardEls = []; // cardEls: the grid's buttons, built once per game

  const saved = Persist.load();
  if (Store.isOutdated(saved)) Persist.backup(saved);   // keep the old-format save once, then Store.init migrates it
  Store.init(saved);
  Cards.init(Store);

  try {
    [games, mons] = await Promise.all([fetch("data/games.json"), fetch("data/pokemon.json")].map(p => p.then(r => r.json())));
  } catch {
    $("#grid").textContent = "Couldn't load data. If you opened index.html directly, serve the folder instead (python3 -m http.server).";
    return;
  }
  // The per-game card/diploma layout and link-up sources live in config.js (GAME_CFG); attach them to each game.
  games = games.map(g => ({ ...g, ...GAME_CFG[g.key], region: REGIONAL[g.key] }));
  monByN = new Map(mons.map(m => [m.n, m]));
  // Regional Pokédex lists (built by build_regional.py). Optional: without the file the Dex dropdown stays disabled.
  regional = await fetch("data/regional.json").then(r => (r.ok ? r.json() : null)).then(d => d && d.dex).catch(() => null);
  Where.init({ games, mons });

  // ---- selectors: everything the view needs is derived from state ----
  const gameOf = s => games.find(g => g.key === s.last.game) || games[0];
  const shinyOn = (s, g = gameOf(s)) => !!(s.last.shiny && g.shiny);
  const listKey = (s, g = gameOf(s)) => (shinyOn(s, g) ? "shiny" : "caught");
  const caughtSet = (s, g = gameOf(s)) => new Set(s[listKey(s, g)][g.key] || []);

  // Regional lists are arrays of national numbers in regional order. A game only offers the regional
  // view when its list actually differs from the national one (so Red/Blue/Yellow don't).
  const regList = g => (regional && g.region && regional[g.region.dex]) || null;
  const hasRegional = g => { const l = regList(g); return !!l && !(l.length === g.count && l.every((n, i) => n === i + 1)); };
  const dexList = (s, g = gameOf(s)) => (s.last.dex === "regional" && hasRegional(g) ? regList(g) : null);
  const dexTotal = (s, g = gameOf(s)) => (dexList(s, g) ? dexList(s, g).length : g.count);
  const viewCaught = (s, g = gameOf(s)) => {
    const all = caughtSet(s, g), list = dexList(s, g);
    return list ? new Set(list.filter(n => all.has(n))) : all;
  };
  const viewGame = (s, g = gameOf(s)) => ({ ...g, count: dexTotal(s, g) }); // trainer card + diploma see the visible dex

  // ---- renderers: each draws one part of the page from a state snapshot ----
  function renderControls(s) {
    const g = gameOf(s), reg = hasRegional(g);
    $("#game").value = g.key;
    $("#shiny").disabled = !g.shiny;
    $("#shiny").checked = shinyOn(s, g);
    $("#dex").disabled = !reg;
    $("#dex").options[1].textContent = reg ? `Regional (${g.region.name})` : "Regional";
    $("#dex").value = reg && s.last.dex === "regional" ? "regional" : "national";
    if ($("#trainer").value !== s.name) $("#trainer").value = s.name; // don't rewrite while typing
  }

  // The grid is built once per game: every card, with the sprite folder baked in. After that nothing
  // rewrites it: search toggles `hidden`, caught marks toggle a class, and the shiny view swaps each
  // sprite's src. Typing or tapping never rebuilds the DOM, so sprites don't reload and scroll
  // position and focus stay put.
  const spriteDir = (s, g = gameOf(s)) => g.sprites + (shinyOn(s, g) ? "/shiny" : "");
  const spriteSrc = (dir, n) => `assets/sprites/${dir}/${n}.png`;

  function renderGrid(s) {
    const g = gameOf(s), got = caughtSet(s, g), dir = spriteDir(s, g), list = dexList(s, g);
    const rows = (list ? list.map((n, i) => [monByN.get(n), i + 1]) : mons.slice(0, g.count).map(m => [m, m.n])).filter(([m]) => m);
    $("#grid").innerHTML = rows
      .map(([m, pos]) => `<div class="cell"><button class="card${got.has(m.n) ? " on" : ""}" data-n="${m.n}" data-pos="${pos}" data-name="${m.name.toLowerCase()}" aria-pressed="${got.has(m.n)}" aria-keyshortcuts="I">
        <img loading="lazy" decoding="async" alt="" src="${spriteSrc(dir, m.n)}">
        <span class="n">#${String(pos).padStart(3, "0")}</span><span class="nm">${m.name}</span></button>
        <button class="where" tabindex="-1" data-n="${m.n}" aria-label="Where to find ${m.name}" title="Where to find (or press I on a card)">?</button></div>`).join("");
    cardEls = [...document.querySelectorAll("#grid .card")];
    applyFilter(); // keep any search text applied after a game switch
  }

  // Search text is view-only (not saved): hide the cards that don't match.
  function applyFilter() {
    const q = $("#search").value.trim().toLowerCase();
    for (const el of cardEls) el.parentElement.hidden = !!q && !(el.dataset.name.includes(q) || el.dataset.n.includes(q) || el.dataset.pos.includes(q));
  }

  // Same game, other sprite folder (shiny toggled): point each existing card at its new sprite.
  function renderSprites(s) {
    const dir = spriteDir(s);
    for (const el of cardEls) el.firstElementChild.src = spriteSrc(dir, el.dataset.n);
  }

  // Caught-state changed: update which cards are lit.
  function renderMarks(s) {
    const got = caughtSet(s);
    for (const el of cardEls) {
      const on = got.has(Number(el.dataset.n));
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on);
    }
  }

  function renderProgress(s) {
    const n = viewCaught(s).size, total = dexTotal(s);
    $("#count").textContent = `${n} / ${total}`;
    $("#fill").style.width = `${(n / total) * 100}%`;
  }

  const renderTrainer = s => Cards.update(viewGame(s), viewCaught(s), s);

  const renderAll = s => { renderControls(s); renderGrid(s); renderProgress(s); renderTrainer(s); };

  // ---- reactions: work out what changed and redraw only that ----
  const changed = (s, p, ...keys) => keys.some(k => s[k] !== p[k]);
  function onChange(s, p) {
    if (changed(s, p, "last", "name")) renderControls(s);
    if (s.last.game !== p.last.game || s.last.dex !== p.last.dex) renderGrid(s); // different game or dex: build its cards
    else {
      if (s.last.shiny !== p.last.shiny) renderSprites(s);                 // same cards, other sprite folder
      if (changed(s, p, "last", "caught", "shiny")) renderMarks(s);        // which cards are lit
    }
    if (changed(s, p, "last", "caught", "shiny")) renderProgress(s);
    if (changed(s, p, "last", "caught", "shiny", "name", "gender")) renderTrainer(s);
  }

  // ---- actions: DOM events -> Store updates (the only place the view writes state) ----
  function selectGame(key) {
    const s = Store.get(), g = games.find(x => x.key === key) || games[0];
    Store.set({ last: { ...s.last, game: g.key, shiny: shinyOn(s, g) } }); // games without shiny sprites turn the toggle off
  }

  $("#game").addEventListener("change", e => selectGame(e.target.value));
  $("#shiny").addEventListener("change", e => Store.set({ last: { ...Store.get().last, shiny: e.target.checked } }));
  $("#dex").addEventListener("change", e => Store.set({ last: { ...Store.get().last, dex: e.target.value } }));
  $("#search").addEventListener("input", applyFilter);                     // search text is view-only, not saved
  $("#trainer").addEventListener("input", e => Store.set({ name: e.target.value }));

  $("#grid").addEventListener("click", e => {
    const s = Store.get(), where = e.target.closest(".where");
    if (where) return Where.open(gameOf(s), Number(where.dataset.n));
    const card = e.target.closest(".card"); if (!card) return;
    Store.toggle(listKey(s), gameOf(s).key, Number(card.dataset.n));
  });
  // The "?" buttons are skipped by Tab (493 extra stops), so keyboard users press I on a card instead.
  $("#grid").addEventListener("keydown", e => {
    if (e.key.toLowerCase() !== "i" || e.ctrlKey || e.metaKey || e.altKey) return;
    const card = e.target.closest(".card"); if (!card) return;
    e.preventDefault();
    Where.open(gameOf(Store.get()), Number(card.dataset.n));
  });

  $("#export").addEventListener("click", () => Persist.exportFile(Store.get()));
  $("#import").addEventListener("click", () => $("#file").click());
  $("#file").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    let data;
    try { data = await Persist.readFile(f); } catch (err) {
      alert(err.code === "newer" ? "That backup was made by a newer version of the tracker. Update this page first, then import it."
                                 : "That file doesn't look like a Pokédex Tracker export.");
      return;
    }
    const { state: clean, dropped } = Store.sanitize(data, games);   // known games, whole numbers within each game's range
    const note = dropped ? `${dropped} invalid entr${dropped === 1 ? "y" : "ies"} in the file will be skipped.\n\n` : "";
    if (!confirm(note + "Replace the progress saved in this browser with the imported file?")) return;
    // Keep the game you're looking at; start on the normal (non-shiny) list.
    Store.replace({ ...clean, last: { game: gameOf(Store.get()).key, shiny: false, dex: Store.get().last.dex } });
  });

  // ---- start up ----
  $("#game").innerHTML = games.map(g => `<option value="${g.key}">${g.name}</option>`).join("");
  Store.subscribe(Persist.save);            // saving is just another subscriber, so no handler calls save()
  selectGame(gameOf(Store.get()).key);      // correct a saved game key that no longer exists
  Store.subscribe(onChange);
  renderAll(Store.get());
})();