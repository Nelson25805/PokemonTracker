"use strict";
// View: reads from Store, draws the page, and turns DOM events into Store updates.
// It never touches localStorage or files (Persist does) and keeps no state of its own,
// only the static game and Pokémon lists it loads once.
(async function main() {
  const $ = s => document.querySelector(s);
  let games = [], mons = [], cardEls = []; // cardEls: the grid's buttons, built once per game

  Store.init(Persist.load());
  Cards.init(Store);

  try {
    [games, mons] = await Promise.all([fetch("data/games.json"), fetch("data/pokemon.json")].map(p => p.then(r => r.json())));
  } catch {
    $("#grid").textContent = "Couldn't load data. If you opened index.html directly, serve the folder instead (python3 -m http.server).";
    return;
  }
  // The per-game card and diploma layout lives in config.js (GAME_CFG); attach it to each game.
  games = games.map(g => ({ ...g, ...GAME_CFG[g.key] }));

  // ---- selectors: everything the view needs is derived from state ----
  const gameOf = s => games.find(g => g.key === s.last.game) || games[0];
  const shinyOn = (s, g = gameOf(s)) => !!(s.last.shiny && g.shiny);
  const listKey = (s, g = gameOf(s)) => (shinyOn(s, g) ? "shiny" : "caught");
  const caughtSet = (s, g = gameOf(s)) => new Set(s[listKey(s, g)][g.key] || []);

  // ---- renderers: each draws one part of the page from a state snapshot ----
  function renderControls(s) {
    const g = gameOf(s);
    $("#game").value = g.key;
    $("#shiny").disabled = !g.shiny;
    $("#shiny").checked = shinyOn(s, g);
    if ($("#trainer").value !== s.name) $("#trainer").value = s.name; // don't rewrite while typing
  }

  // The grid is built once per game: every card, with the sprite folder baked in. After that nothing
  // rewrites it: search toggles `hidden`, caught marks toggle a class, and the shiny view swaps each
  // sprite's src. Typing or tapping never rebuilds the DOM, so sprites don't reload and scroll
  // position and focus stay put.
  const spriteDir = (s, g = gameOf(s)) => g.sprites + (shinyOn(s, g) ? "/shiny" : "");
  const spriteSrc = (dir, n) => `assets/sprites/${dir}/${n}.png`;

  function renderGrid(s) {
    const g = gameOf(s), got = caughtSet(s, g), dir = spriteDir(s, g);
    $("#grid").innerHTML = mons.slice(0, g.count)
      .map(m => `<button class="card${got.has(m.n) ? " on" : ""}" data-n="${m.n}" data-name="${m.name.toLowerCase()}" aria-pressed="${got.has(m.n)}">
        <img loading="lazy" alt="" src="${spriteSrc(dir, m.n)}">
        <span class="n">#${String(m.n).padStart(3, "0")}</span><span class="nm">${m.name}</span></button>`).join("");
    cardEls = [...document.querySelectorAll("#grid .card")];
    applyFilter(); // keep any search text applied after a game switch
  }

  // Search text is view-only (not saved): hide the cards that don't match.
  function applyFilter() {
    const q = $("#search").value.trim().toLowerCase();
    for (const el of cardEls) el.hidden = !!q && !(el.dataset.name.includes(q) || el.dataset.n.includes(q));
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
    const g = gameOf(s), n = caughtSet(s, g).size;
    $("#count").textContent = `${n} / ${g.count}`;
    $("#fill").style.width = `${(n / g.count) * 100}%`;
  }

  const renderTrainer = s => Cards.update(gameOf(s), caughtSet(s), s);

  const renderAll = s => { renderControls(s); renderGrid(s); renderProgress(s); renderTrainer(s); };

  // ---- reactions: work out what changed and redraw only that ----
  const changed = (s, p, ...keys) => keys.some(k => s[k] !== p[k]);
  function onChange(s, p) {
    if (changed(s, p, "last", "name")) renderControls(s);
    if (s.last.game !== p.last.game) renderGrid(s);                        // different game: build its cards
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
    Store.set({ last: { game: g.key, shiny: shinyOn(s, g) } }); // games without shiny sprites turn the toggle off
  }

  $("#game").addEventListener("change", e => selectGame(e.target.value));
  $("#shiny").addEventListener("change", e => Store.set({ last: { ...Store.get().last, shiny: e.target.checked } }));
  $("#search").addEventListener("input", applyFilter);                     // search text is view-only, not saved
  $("#trainer").addEventListener("input", e => Store.set({ name: e.target.value }));

  $("#grid").addEventListener("click", e => {
    const card = e.target.closest(".card"); if (!card) return;
    const s = Store.get();
    Store.toggle(listKey(s), gameOf(s).key, Number(card.dataset.n));
  });

  $("#export").addEventListener("click", () => Persist.exportFile(Store.get()));
  $("#import").addEventListener("click", () => $("#file").click());
  $("#file").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    let data;
    try { data = await Persist.readFile(f); } catch { alert("That file doesn't look like a Pokédex Tracker export."); return; }
    if (!confirm("Replace the progress saved in this browser with the imported file?")) return;
    // Keep the game you're looking at; start on the normal (non-shiny) list.
    Store.replace({ ...data, last: { game: gameOf(Store.get()).key, shiny: false } });
  });

  // ---- start up ----
  $("#game").innerHTML = games.map(g => `<option value="${g.key}">${g.name}</option>`).join("");
  Store.subscribe(Persist.save);            // saving is just another subscriber, so no handler calls save()
  selectGame(gameOf(Store.get()).key);      // correct a saved game key that no longer exists
  Store.subscribe(onChange);
  renderAll(Store.get());
})();
