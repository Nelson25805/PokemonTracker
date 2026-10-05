"use strict";
// View: reads from Store, draws the page, and turns DOM events into Store updates.
// It never touches localStorage or files (Persist does) and keeps no state of its own,
// only the static game and Pokémon lists it loads once.
(async function main() {
  const $ = s => document.querySelector(s);
  let games = [], mons = [], monByN = new Map(), regional = null, cardEls = [], badgeEls = [], chipEls = []; // cardEls: the grid's buttons, built once per game; badgeEls: the matching ★/✓ badges (games with shiny sprites only)
  // View-only state (not saved, like the search box): the Show filter, select mode, and the last bulk action for Undo.
  const view = { filter: "all", select: false, range: false, selected: new Set(), anchor: null, undo: null };

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
  Forms.init(await fetch("data/forms.json").then(r => (r.ok ? r.json() : null)).catch(() => null));   // optional: without it there are no chips
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
  // viewOf: the visible dex of one list ("caught" or "shiny"). viewCaught is the list being tracked right now;
  // the trainer card and diploma always use the normal list, whatever you are tracking.
  const viewOf = (s, kind, g = gameOf(s)) => {
    const all = new Set(s[kind][g.key] || []), list = dexList(s, g);
    return list ? new Set(list.filter(n => all.has(n))) : all;
  };
  const viewCaught = (s, g = gameOf(s)) => viewOf(s, listKey(s, g), g);
  const otherKey = (s, g = gameOf(s)) => (listKey(s, g) === "shiny" ? "caught" : "shiny"); // the list you are not tracking
  const viewGame = (s, g = gameOf(s)) => ({ ...g, count: dexTotal(s, g) }); // trainer card + diploma see the visible dex
  // Completion rules (Settings): which form categories must be caught (normal list) before the Pokédex counts as complete.
  const reqOf = s => ({ gender: !!(s.last.require && s.last.require.gender), alt: !!(s.last.require && s.last.require.alt) });
  const inDexOf = (s, g = gameOf(s)) => { const l = dexList(s, g); if (!l) return null; const set = new Set(l); return n => set.has(n); };
  const formsLeft = (s, g = gameOf(s)) => Forms.missing(s, g, reqOf(s), inDexOf(s, g));

  // ---- renderers: each draws one part of the page from a state snapshot ----
  function renderControls(s) {
    const g = gameOf(s), reg = hasRegional(g);
    $("#game").value = g.key;
    document.querySelectorAll("#track button").forEach(b => {          // Tracking: Normal / Shiny
      b.setAttribute("aria-pressed", (b.dataset.track === "shiny") === shinyOn(s, g));
      if (b.dataset.track === "shiny") b.disabled = !g.shiny;
    });
    $("#badges").checked = s.last.badges !== false;
    const rq = reqOf(s), tot = Forms.catTotals(g, inDexOf(s, g)), pl = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
    $("#req-gender").checked = rq.gender; $("#req-alt").checked = rq.alt;
    $("#req-hint").textContent = !Forms.ready() ? "Forms data isn't installed yet. Run python3 build_forms.py once."
      : tot.gender + tot.alt ? `In ${g.name}: ${pl(tot.gender, "gender difference")} and ${pl(tot.alt, "alternate form")}.` : `${g.name} has no extra forms.`;
    $("#dex").disabled = !reg;
    $("#dex").options[1].textContent = reg ? `Regional (${g.region.name})` : "Regional";
    $("#dex").value = reg && s.last.dex === "regional" ? "regional" : "national";
    if ($("#trainer").value !== s.name) $("#trainer").value = s.name; // don't rewrite while typing
    $("#gname").textContent = g.name + (shinyOn(s, g) ? " ★" : "") + (dexList(s, g) ? ` · ${g.region.name}` : ""); // shown on phones, where the Options panel is closed
    $("#trainerbox").open = !!s.last.cardOpen;
  }

  // The grid is built once per game: every card, with the sprite folder baked in. After that nothing
  // rewrites it: search toggles `hidden`, caught marks toggle a class, and the shiny view swaps each
  // sprite's src. Typing or tapping never rebuilds the DOM, so sprites don't reload and scroll
  // position and focus stay put.
  const spriteDir = (s, g = gameOf(s)) => g.sprites + (shinyOn(s, g) ? "/shiny" : "");
  const spriteSrc = (dir, n) => `assets/sprites/${dir}/${n}.png`;

  function renderGrid(s) {
    const g = gameOf(s), got = caughtSet(s, g), dir = spriteDir(s, g), list = dexList(s, g), fm = Forms.forGame(g);
    const rows = (list ? list.map((n, i) => [monByN.get(n), i + 1]) : mons.slice(0, g.count).map(m => [m, m.n])).filter(([m]) => m);
    $("#grid").innerHTML = rows
      .map(([m, pos]) => `<div class="cell"><button class="card${got.has(m.n) ? " on" : ""}${fm.has(m.n) ? " hasform" : ""}" data-n="${m.n}" data-pos="${pos}" data-name="${m.name.toLowerCase()}" aria-pressed="${got.has(m.n)}" aria-keyshortcuts="${["I", g.shiny && "S", fm.has(m.n) && "F"].filter(Boolean).join(" ")}">
        <img loading="lazy" decoding="async" alt="" src="${spriteSrc(dir, m.n)}">
        <span class="n">#${String(pos).padStart(3, "0")}</span><span class="nm">${m.name}</span></button>
        <button class="where" tabindex="-1" data-n="${m.n}" aria-label="Where to find ${m.name}" title="Where to find (or press I on a card)">?</button>${g.shiny ? `<button class="other" tabindex="-1" data-n="${m.n}"></button>` : ""}${fm.has(m.n) ? `<button class="chip" tabindex="-1" data-n="${m.n}"></button>` : ""}</div>`).join("");
    cardEls = [...document.querySelectorAll("#grid .card")];
    badgeEls = [...document.querySelectorAll("#grid .other")];     // same order as cardEls (empty when the game has no shiny sprites)
    chipEls = [...document.querySelectorAll("#grid .chip")];
    paintBadges(s); paintChips(s);
    view.selected.clear(); view.anchor = null; // a new set of cards: nothing is selected yet
    applyFilter(); // keep any search text and Show filter applied after a game switch
  }

  // Search text and the Show filter are view-only (not saved): hide the cards that don't match both.
  // Cards that get hidden are also dropped from the selection, so bulk actions only ever touch what you can see.
  const isShown = el => !el.parentElement.hidden;
  function applyFilter() {
    const q = $("#search").value.trim().toLowerCase(), got = caughtSet(Store.get());
    for (const el of cardEls) {
      const n = Number(el.dataset.n);
      const textOk = !q || el.dataset.name.includes(q) || el.dataset.n.includes(q) || el.dataset.pos.includes(q);
      const stateOk = view.filter === "all" || (view.filter === "caught") === got.has(n);
      el.parentElement.hidden = !(textOk && stateOk);
      if (!(textOk && stateOk)) view.selected.delete(n);
    }
    paintSelection();
  }

  // The small corner badge on every card shows the list you are NOT tracking (★ shiny while tracking normal,
  // ✓ normal while tracking shiny). Lit = owned. Clicking it (or pressing S on a card) toggles that list.
  function paintBadges(s) {
    const g = gameOf(s), other = otherKey(s, g), has = new Set(s[other][g.key] || []), show = s.last.badges !== false;
    const glyph = other === "shiny" ? "★" : "✓", what = other === "shiny" ? "Shiny" : "Normal";
    $("#grid").classList.toggle("has-badges", g.shiny && show);       // makes room under the name
    badgeEls.forEach((b, i) => {
      const n = Number(cardEls[i].dataset.n), on = has.has(n);
      b.hidden = !show; b.textContent = glyph; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
      b.setAttribute("aria-label", `${what}: ${monByN.get(n).name}`);
      b.title = `${what} ${on ? "owned" : "not owned"}. Click to ${on ? "unmark" : "mark"} (or press S on the card)`;
    });
  }

  // The form chip ("2/28") on cards whose species has forms in this game: progress on the list being tracked.
  function paintChips(s) {
    if (!chipEls.length) return;
    const g = gameOf(s), kind = listKey(s, g), what = kind === "shiny" ? "shiny" : "normal";
    for (const c of chipEls) {
      const n = Number(c.dataset.n), { have, total } = Forms.speciesCounts(s, g, kind, n);
      c.textContent = `${have}/${total}`; c.classList.toggle("done", have === total);
      c.setAttribute("aria-label", `Forms of ${monByN.get(n).name}: ${have} of ${total} (${what})`);
      c.title = `Forms: ${have} of ${total} (${what}). Click to see them (or press F on the card)`;
    }
  }

  // Same game, other sprite folder (shiny toggled): point each existing card at its new sprite.
  function renderSprites(s) {
    const dir = spriteDir(s);
    for (const el of cardEls) el.firstElementChild.src = spriteSrc(dir, el.dataset.n);
  }

  // Caught-state changed: update which cards are lit.
  function renderMarks(s) {
    const got = caughtSet(s);
    for (const el of cardEls) el.classList.toggle("on", got.has(Number(el.dataset.n)));
    paintBadges(s); paintChips(s);
    applyFilter(); // Missing / Caught views change when a mark does (this also refreshes aria-pressed and the toolbar)
  }

  // Selection highlight + aria-pressed (which means "selected" in select mode, "caught" otherwise) + toolbar.
  function paintSelection() {
    const got = caughtSet(Store.get());
    for (const el of cardEls) {
      const n = Number(el.dataset.n), sel = view.selected.has(n);
      el.classList.toggle("sel", sel);
      el.setAttribute("aria-pressed", view.select ? sel : got.has(n));
    }
    renderTools();
  }

  const sameList = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
  function renderTools() {
    const s = Store.get(), g = gameOf(s), shown = cardEls.filter(isShown).length, u = view.undo;
    $("#shown").textContent = `Showing ${shown} of ${cardEls.length}`;
    $("#markvis").disabled = !shown;
    $("#clearall").disabled = !viewCaught(s, g).size;
    $("#undo").disabled = !(u && sameList(s[u.kind][u.key] || [], u.after)); // only while nothing else has changed the list
    $("#undo").title = u ? `Undo: ${u.label}` : "";
    $("#selcount").textContent = `${view.selected.size} selected`;
    for (const id of ["#selmark", "#selunmark", "#selnone"]) $(id).disabled = !view.selected.size;
    $("#selall").disabled = !shown;
    $("#selrange").disabled = view.anchor === null;
    $("#selrange").setAttribute("aria-pressed", view.range);
    // Tell people how to select more than one at a time (Shift isn't available on touch screens).
    const touch = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
    $("#selhint").textContent = view.range ? "Now tap the last Pokémon of the range."
      : !view.selected.size ? (touch ? "Tap Pokémon to pick them." : "Click Pokémon to pick them.")
      : touch ? "Tap Range, then another Pokémon, to pick everything in between."
      : "Shift+click another Pokémon (or press Range) to pick everything in between.";
  }

  function renderProgress(s) {
    const g = gameOf(s), n = viewCaught(s).size, total = dexTotal(s), normal = viewOf(s, "caught").size;
    $("#count").textContent = `${n} / ${total}`;
    $("#fill").style.width = `${(n / total) * 100}%`;
    const left = formsLeft(s, g);                                      // required forms still missing (0 unless a completion rule is on)
    $("#tsum").textContent = `${normal} / ${total}` + (normal === total && left ? ` · ${left} required form${left === 1 ? "" : "s"} left`
      : normal === total && g.diploma ? " · Diploma ready!" : "");
    const c2 = $("#count2");                                           // the other list's progress, for games with shiny sprites
    c2.hidden = !g.shiny;
    if (g.shiny) {
      const k = otherKey(s, g), m = viewOf(s, k).size;
      c2.textContent = `${k === "shiny" ? "★" : "✓"} ${m} / ${total}`;
      c2.title = `${k === "shiny" ? "Shiny" : "Normal"} progress`;
    }
    const c3 = $("#count3"), kind = listKey(s, g), fc = Forms.counts(s, g, kind, inDexOf(s, g));   // forms: its own counter
    c3.hidden = !fc.total;
    c3.textContent = `${kind === "shiny" ? "★ " : ""}Forms ${fc.have} / ${fc.total}`;
    c3.title = "Forms progress. It only counts toward completion if you turn on a completion rule in Settings.";
  }

  const renderTrainer = s => Cards.update(viewGame(s), viewOf(s, "caught"), s, { left: formsLeft(s) }); // always the normal dex, even while tracking shiny

  const renderAll = s => { renderControls(s); renderGrid(s); renderProgress(s); renderTrainer(s); };

  // ---- reactions: work out what changed and redraw only that ----
  const changed = (s, p, ...keys) => keys.some(k => s[k] !== p[k]);
  function onChange(s, p) {
    if (changed(s, p, "last", "name")) renderControls(s);
    if (s.last.game !== p.last.game || s.last.dex !== p.last.dex) renderGrid(s); // different game or dex: build its cards
    else {
      if (s.last.shiny !== p.last.shiny) renderSprites(s);                 // same cards, other sprite folder
      if (changed(s, p, "last", "caught", "shiny")) renderMarks(s);        // which cards are lit
      else if (changed(s, p, "forms")) paintChips(s);                      // form chips
    }
    if (changed(s, p, "last", "caught", "shiny", "forms")) renderProgress(s);
    if (s.last.game !== p.last.game || s.last.dex !== p.last.dex || s.last.require !== p.last.require
        || changed(s, p, "caught", "name", "gender", "forms")) renderTrainer(s);
  }

  // ---- actions: DOM events -> Store updates (the only place the view writes state) ----
  function selectGame(key) {
    const s = Store.get(), g = games.find(x => x.key === key) || games[0];
    Store.set({ last: { ...s.last, game: g.key, shiny: shinyOn(s, g) } }); // games without shiny sprites turn the toggle off
  }

  // Narrow screens keep game / dex / shiny / trainer behind an Options button so the sticky header stays short.
  const setOptions = open => { $("#top").classList.toggle("open", open); $("#optbtn").setAttribute("aria-expanded", open); $("#optbtn").textContent = open ? "Close" : "Options"; };
  $("#optbtn").addEventListener("click", () => setOptions(!$("#top").classList.contains("open")));
  $("#trainerbox").addEventListener("toggle", e => {                      // remember whether the trainer card is open
    const last = Store.get().last;
    if (!!last.cardOpen !== e.target.open) Store.set({ last: { ...last, cardOpen: e.target.open } });
  });

  $("#game").addEventListener("change", e => { selectGame(e.target.value); setOptions(false); });
  $("#track").addEventListener("click", e => {                            // Tracking: which list taps, filters and bulk actions use
    const b = e.target.closest("button[data-track]"); if (!b || b.disabled) return;
    Store.set({ last: { ...Store.get().last, shiny: b.dataset.track === "shiny" } });
  });
  $("#badges").addEventListener("change", e => Store.set({ last: { ...Store.get().last, badges: e.target.checked } }));
  // Completion rules: off by default. When on, those forms must be caught (normal list) before the Pokédex counts as complete.
  const setReq = key => e => { const s = Store.get(); Store.set({ last: { ...s.last, require: { ...reqOf(s), [key]: e.target.checked } } }); };
  $("#req-gender").addEventListener("change", setReq("gender"));
  $("#req-alt").addEventListener("change", setReq("alt"));
  $("#setbtn").addEventListener("click", () => $("#settings").showModal());
  $("#setclose").addEventListener("click", () => $("#settings").close());
  $("#dex").addEventListener("change", e => Store.set({ last: { ...Store.get().last, dex: e.target.value } }));
  $("#search").addEventListener("input", applyFilter);                     // search text is view-only, not saved
  $("#trainer").addEventListener("input", e => Store.set({ name: e.target.value }));

  $("#grid").addEventListener("click", e => {
    const s = Store.get(), where = e.target.closest(".where");
    if (where) return openInfo(Number(where.dataset.n), "where");
    const chip = e.target.closest(".chip");                            // form chip: open the Forms tab
    if (chip) { if (!view.select) openInfo(Number(chip.dataset.n), "forms"); return; }
    const other = e.target.closest(".other");                          // corner badge: toggle the list you are not tracking
    if (other) { if (!view.select) Store.toggle(otherKey(s), gameOf(s).key, Number(other.dataset.n)); return; }
    const card = e.target.closest(".card"); if (!card) return;
    if (view.select) return pick(card, e.shiftKey);
    Store.toggle(listKey(s), gameOf(s).key, Number(card.dataset.n));
  });
  // The "?" and badge buttons are skipped by Tab (hundreds of extra stops), so keyboard users press I (where to find)
  // or S (toggle the shiny/normal badge) on a card instead.
  $("#grid").addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if ((k !== "i" && k !== "s" && k !== "f") || e.ctrlKey || e.metaKey || e.altKey) return;
    const card = e.target.closest(".card"); if (!card) return;
    e.preventDefault();
    const s = Store.get(), g = gameOf(s), n = Number(card.dataset.n);
    if (k === "i") openInfo(n, "where");
    else if (k === "f") { if (card.classList.contains("hasform") && !view.select) openInfo(n, "forms"); }
    else if (g.shiny && !view.select) Store.toggle(otherKey(s, g), g.key, n);
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
    const { state: clean, dropped } = Store.sanitize(data, games, Forms.data());   // known games, whole numbers within each game's range
    const note = dropped ? `${dropped} invalid entr${dropped === 1 ? "y" : "ies"} in the file will be skipped.\n\n` : "";
    if (!confirm(note + "Replace the progress saved in this browser with the imported file?")) return;
    // Keep the game you're looking at; start on the normal (non-shiny) list.
    Store.replace({ ...clean, last: { ...Store.get().last, game: gameOf(Store.get()).key, shiny: false } });
  });

  // ---- the info dialog: "Where to find" and "Forms" tabs for one Pokémon ----
  let info = null;                                                     // { n, game, hasForms, tab } while a card's dialog is open
  function setTab(t) {
    if (!info) return;
    if (t === "forms" && !info.hasForms) t = "where";
    info.tab = t;
    $("#tab-where").hidden = t !== "where"; $("#tab-forms").hidden = t !== "forms"; $("#where-link").hidden = t !== "where";
    document.querySelectorAll("#wtabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tab === t));
  }
  function openInfo(n, tab) {
    const s = Store.get(), g = gameOf(s), rq = reqOf(s);
    info = { n, game: g.key, hasForms: Forms.forGame(g).has(n), tab };
    $("#wtabs").hidden = !info.hasForms;
    Where.open(g, n);                                                  // fills the Where tab and shows the dialog
    if (info.hasForms) {
      const need = [rq.gender && "gender differences", rq.alt && "alternate forms"].filter(Boolean);
      $("#forms-note").textContent = need.length ? `Required for completion (Settings): ${need.join(" and ")}.`
        : "Forms are tracked separately. They don't change your progress bar or diploma (you can change that in Settings).";
      $("#forms-body").innerHTML = Forms.html(s, g, n);
    }
    setTab(tab);
  }
  $("#wtabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab); });
  $("#forms-body").addEventListener("click", e => {                    // a toggle in the Forms tab (the base-form row uses the main lists)
    const b = e.target.closest(".ftog"); if (!b || !info) return;
    const key = info.game, kind = b.dataset.kind, id = b.dataset.id;
    if (id) Store.toggleForm(kind, key, id); else Store.toggle(kind, key, info.n);
    const s = Store.get();
    b.setAttribute("aria-pressed", id ? (s.forms[kind][key] || []).includes(id) : (s[kind][key] || []).includes(info.n));
  });

  // ---- filters and bulk actions ----
  const shownNs = () => cardEls.filter(isShown).map(el => Number(el.dataset.n));

  // Add or remove many Pokémon in one update (so one save, one redraw), and remember how to undo it.
  function applyBulk(ns, on, label) {
    const s = Store.get(), kind = listKey(s), key = gameOf(s).key, before = s[kind][key] || [];
    const after = new Set(before);
    for (const n of ns) on ? after.add(n) : after.delete(n);
    if (after.size === before.length) return;                          // nothing would change
    const sorted = [...after].sort((a, b) => a - b);
    view.undo = { kind, key, before, after: sorted, label: `${label} (${Math.abs(after.size - before.length)})` };
    Store.setList(kind, key, sorted);
    renderTools();
  }

  $("#filter").addEventListener("click", e => {
    const b = e.target.closest("button[data-filter]"); if (!b) return;
    view.filter = b.dataset.filter;
    document.querySelectorAll("#filter button").forEach(x => x.setAttribute("aria-pressed", x === b));
    applyFilter();
  });

  $("#markvis").addEventListener("click", () => applyBulk(shownNs(), true, "mark all visible"));
  $("#clearall").addEventListener("click", () => {
    const s = Store.get(), g = gameOf(s), n = viewCaught(s, g).size; if (!n) return;
    const list = dexList(s, g), dex = list ? `Regional (${g.region.name})` : "National";
    if (!confirm(`Clear all ${n} caught Pokémon in ${g.name}${shinyOn(s, g) ? " (shiny)" : ""}, ${dex} Pokédex?\n\nYou can press Undo right afterwards.`)) return;
    applyBulk(list || Array.from({ length: g.count }, (_, i) => i + 1), false, "clear all");
  });
  $("#undo").addEventListener("click", () => {
    const u = view.undo; if (!u) return;
    view.undo = null; Store.setList(u.kind, u.key, u.before); renderTools();
  });

  // Select mode: clicks pick cards instead of marking them; Shift+click picks a range of the visible cards.
  function setSelect(on) {
    view.select = on; view.anchor = null; view.range = false; if (!on) view.selected.clear();
    document.body.classList.toggle("selecting", on);
    $("#selbar").hidden = !on;
    $("#select").setAttribute("aria-pressed", on);
    paintSelection();
  }
  function pick(card, range) {
    range = range || view.range; view.range = false;                  // the Range button works like holding Shift, once
    const n = Number(card.dataset.n), vis = cardEls.filter(isShown);
    const a = vis.findIndex(el => Number(el.dataset.n) === view.anchor), b = vis.indexOf(card);
    if (range && a >= 0 && b >= 0) {
      for (const el of vis.slice(Math.min(a, b), Math.max(a, b) + 1)) view.selected.add(Number(el.dataset.n));
    } else view.selected.has(n) ? view.selected.delete(n) : view.selected.add(n);
    view.anchor = n;
    paintSelection();
  }
  const finishSelection = (on, label) => { applyBulk([...view.selected], on, label); view.selected.clear(); view.anchor = null; view.range = false; paintSelection(); };
  $("#select").addEventListener("click", () => setSelect(!view.select));
  $("#seldone").addEventListener("click", () => setSelect(false));
  $("#selmark").addEventListener("click", () => finishSelection(true, "mark selected"));
  $("#selunmark").addEventListener("click", () => finishSelection(false, "unmark selected"));
  $("#selall").addEventListener("click", () => { shownNs().forEach(n => view.selected.add(n)); paintSelection(); });
  $("#selnone").addEventListener("click", () => { view.selected.clear(); view.anchor = null; view.range = false; paintSelection(); });
  $("#selrange").addEventListener("click", () => { if (view.anchor !== null) { view.range = !view.range; paintSelection(); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && view.select && !document.querySelector("dialog[open]")) setSelect(false); });

  // ---- start up ----
  $("#game").innerHTML = games.map(g => `<option value="${g.key}">${g.name}</option>`).join("");
  Store.subscribe(Persist.save);            // saving is just another subscriber, so no handler calls save()
  selectGame(gameOf(Store.get()).key);      // correct a saved game key that no longer exists
  Store.subscribe(onChange);
  renderAll(Store.get());
})();