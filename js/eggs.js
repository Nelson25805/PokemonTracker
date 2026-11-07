"use strict";
// Eggs: the HeartGold / SoulSilver secret passwords for the Mareep, Wooper and Slugma eggs.
//
//   Eggs.applies(gameKey, n)   is Pokémon n one of the three egg Pokémon, and gameKey Heart Gold / Soul Silver?
//   Eggs.load()                Promise: loads data/egg-words.json (where.js waits for it before drawing)
//   Eggs.row(n, names)         HTML of the "Secret code for ... Egg" row that where.js adds to the Heart Gold / Soul Silver group
//   Eggs.passwords(reward, tid, size)   pure: -> four word indices (exported for testing)
//
// How it works: the NPC in the Violet City Pokémon Center checks four Easy Chat words. The words that unlock a reward depend on
// the save's Trainer ID. This file runs the game's check BACKWARDS: it builds the four bytes the check wants
// (reward id + magic number 6, the Trainer ID, a checksum), undoes the game's scrambling, and turns the result into positions in
// the password word list. The word list is data/egg-words.json (one list per game language; the order matters, so it is the
// game's own order). Only languages present in that file are offered.
//
// The Trainer ID and language are remembered in this browser under their own key (like the theme), not in the progress save.
const Eggs = (() => {
  const $ = s => document.querySelector(s);
  const KEY = "pokedexTracker.eggs";
  const GAMES = new Set(["heart-gold", "soul-silver"]);
  // national number -> reward number used by the game (HG / SS rewards 0-7 are wallpapers and gifts, 8-10 are the eggs)
  const EGGS = { 179: { id: 8, name: "Mareep Egg" }, 194: { id: 9, name: "Wooper Egg" }, 218: { id: 10, name: "Slugma Egg" } };
  const MAGIC = 6;                       // high nybble of the first byte in Platinum / HeartGold / SoulSilver
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let data = null, loading = null;
  const pref = { tid: "", lang: "en" };
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && /^\d{1,5}$/.test(r.tid || "")) pref.tid = r.tid;
    if (r && /^[a-z]{2}$/.test(r.lang || "")) pref.lang = r.lang;
  } catch { /* nothing saved, or storage blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* private mode */ } };

  // ---- the maths ----
  const rotl32 = (v, n) => ((v << n) | (v >>> (32 - n))) >>> 0;
  const rotl24 = (v, n) => { n %= 24; return n ? (((v << n) | (v >>> (24 - n))) & 0xFFFFFF) : v; };

  // reward number + Trainer ID -> four positions in the word list (list length = size)
  function passwords(reward, tid, size) {
    // what the check wants to end up with
    const f0 = (MAGIC << 4) | reward, f1 = tid >> 8, f2 = tid & 255, f3 = ((f0 + f1) * f2) & 255;
    // undo, in reverse order: (d) first byte XOR-ed into the 2nd and 3rd
    let a = f0, b = f1 ^ f0, c = f2 ^ f0;
    // (c) 24-bit rotate right by the low nybble of the 4th byte
    const v = rotl24((a << 16) | (b << 8) | c, f3 & 15);
    // (b) high nybble of the 4th byte XOR-ed into both nybbles of the first three bytes
    const m = (f3 >> 4) * 17;
    a = ((v >> 16) & 255) ^ m; b = ((v >> 8) & 255) ^ m; c = (v & 255) ^ m;
    // (a) 32-bit rotate right by 5
    const w = rotl32(((a << 24) | (b << 16) | (c << 8) | f3) >>> 0, 5);
    const bytes = [w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255];
    // bytes -> list positions: the first is itself, the others are steps forward (wrapping round the list)
    const idx = [bytes[0]];
    for (let i = 1; i < 4; i++) idx.push((idx[i - 1] + bytes[i]) % size);
    return idx;
  }

  // ---- data + page ----
  function load() {
    return (loading = loading || fetch("data/egg-words.json").then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => { loading = null; return (data = d && d.langs ? d : null); }));
  }

  if (!document.getElementById("eggs-css")) {
    const st = document.createElement("style"); st.id = "eggs-css";
    st.textContent = `#where .egg-note{margin:0 0 8px;font-size:13px}
#where .eggrow{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 8px}
#where .eggrow label{display:flex;align-items:center;gap:6px}
#where .eggrow input{width:7em}
#where ol.eggwords{display:grid;grid-template-columns:repeat(auto-fit,minmax(11ch,1fr));gap:6px;list-style:none;margin:0;padding:0}
#where ol.eggwords li{display:flex;flex-direction:column;align-items:stretch;gap:2px;padding:5px 8px;border:2px solid var(--line);background:var(--hi);color:var(--on-hi)}
#where ol.eggwords li small{display:block;font-size:11px;opacity:.8}
#where ol.eggwords li b{display:block;overflow-wrap:anywhere}
#where .eggmsg{font-size:13px}`;
    document.head.append(st);
  }

  const langOf = () => (data && (data.langs[pref.lang] || Object.values(data.langs)[0])) || null;

  function words(n) {
    const lang = langOf();
    if (!lang) return `<p class="eggmsg">The password word list isn't installed. Add <code>data/egg-words.json</code>.</p>`;
    if (!/^\d+$/.test(pref.tid)) return `<p class="eggmsg">Enter your Trainer ID (the "ID No." on your Trainer Card) to see the four words.</p>`;
    const tid = Number(pref.tid);
    if (tid > 65535) return `<p class="eggmsg">A Trainer ID is a number from 0 to 65535.</p>`;
    const w = passwords(EGGS[n].id, tid, lang.words.length).map(i => lang.words[i]);
    return `<ol class="eggwords" lang="${esc(Object.keys(data.langs).find(k => data.langs[k] === lang))}">${w.map((x, i) => `<li><small>Word ${i + 1}</small><b>${esc(x)}</b></li>`).join("")}</ol>`;
  }

  // the row for the "Where to find" list: names = the Heart Gold / Soul Silver game names of this group
  function row(n, names) {
    const egg = EGGS[n], langs = data ? Object.entries(data.langs) : [];
    return `<li class="evo egg"><strong>Secret code for ${esc(egg.name)}</strong><span class="wide">` +
      `<p class="egg-note">In ${esc(names.join(" / "))}, tell the NPC in the Violet City Pokémon Center these four words, in this order, with Easy Chat. ` +
      `They are different for every save file, so they depend on your Trainer ID and the game's language.</p>` +
      `<div class="eggrow"><label>Trainer ID <input class="egg-tid" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="e.g. 12345" value="${esc(pref.tid)}"></label>` +
      (langs.length > 1 ? `<label>Game language <select class="egg-lang">${langs.map(([k, l]) => `<option value="${k}"${langOf() === l ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>` : "") +
      `</div><div class="egg-out" data-n="${n}" aria-live="polite">${words(n)}</div></span></li>`;
  }

  // The dialog can hold several egg rows and is redrawn by the season / time buttons, so listen on the document and update every row.
  const refresh = () => document.querySelectorAll("#where .egg-out").forEach(o => { o.innerHTML = words(Number(o.dataset.n)); });
  document.addEventListener("input", e => {
    if (!e.target.classList || !e.target.classList.contains("egg-tid")) return;
    pref.tid = e.target.value.replace(/\D/g, "").slice(0, 5); if (e.target.value !== pref.tid) e.target.value = pref.tid;
    document.querySelectorAll("#where .egg-tid").forEach(i => { if (i !== e.target) i.value = pref.tid; });
    save(); refresh();
  });
  document.addEventListener("change", e => {
    if (!e.target.classList || !e.target.classList.contains("egg-lang")) return;
    pref.lang = e.target.value;
    document.querySelectorAll("#where .egg-lang").forEach(i => { i.value = pref.lang; });
    save(); refresh();
  });

  return { applies: (key, n) => !!EGGS[n] && GAMES.has(key), load, row, passwords };
})();