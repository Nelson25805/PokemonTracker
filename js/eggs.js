"use strict";
// Eggs: the HeartGold / SoulSilver secret passwords for the Mareep, Wooper and Slugma eggs.
//
//   Eggs.show(game, n)         call when the info dialog opens; fills #egg-box for those three Pokémon in HG / SS, hides it otherwise
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

  let data = null, loading = null, cur = null;      // cur = { game, n } while the dialog shows an egg
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
    st.textContent = `#egg-box{border:2px solid var(--line);background:var(--card);padding:8px 10px;margin:0 0 10px}
#egg-box[hidden]{display:none}
#egg-box h3{margin:0 0 4px;font:400 14px "PKMN",monospace}
#egg-box p{margin:0 0 8px;font-size:13px}
#egg-box .eggrow{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 8px}
#egg-box label{display:flex;align-items:center;gap:6px}
#egg-box input{width:7em}
#egg-box ol.eggwords{display:grid;grid-template-columns:repeat(auto-fit,minmax(11ch,1fr));gap:6px;list-style:none;margin:0;padding:0}
#egg-box ol.eggwords li{padding:5px 8px;border:2px solid var(--line);background:var(--hi);color:var(--on-hi);font-weight:700;overflow-wrap:anywhere}
#egg-box ol.eggwords li small{display:block;font-weight:400;font-size:11px;opacity:.8}
#egg-box .eggmsg{font-size:13px}
#egg-box .fine{font-size:12px;opacity:.8;margin:8px 0 0}`;
    document.head.append(st);
  }

  function result() {
    const out = $("#egg-out"), egg = EGGS[cur.n];
    const lang = data.langs[pref.lang] || Object.values(data.langs)[0];
    if (!/^\d+$/.test(pref.tid)) { out.innerHTML = `<p class="eggmsg">Enter your Trainer ID (the "ID No." on your Trainer Card) to see the four words.</p>`; return; }
    const tid = Number(pref.tid);
    if (tid > 65535) { out.innerHTML = `<p class="eggmsg">A Trainer ID is a number from 0 to 65535.</p>`; return; }
    const words = passwords(egg.id, tid, lang.words.length).map(i => lang.words[i]);
    out.innerHTML = `<ol class="eggwords">${words.map((w, i) => `<li><small>Word ${i + 1}</small>${esc(w)}</li>`).join("")}</ol>`;
  }

  async function show(game, n) {
    const box = $("#egg-box"); if (!box) return;
    const egg = EGGS[n];
    cur = egg && GAMES.has(game.key) ? { game, n } : null;
    if (!cur) { box.hidden = true; box.textContent = ""; return; }
    box.hidden = false; box.textContent = "Loading…";
    await load();
    if (!cur || cur.n !== n || !$("#egg-box")) return;                    // the dialog moved on while loading
    if (!data) { box.innerHTML = `<h3>${esc(egg.name)}</h3><p class="eggmsg">The password word list isn't installed. Add <code>data/egg-words.json</code>.</p>`; return; }
    if (!data.langs[pref.lang]) pref.lang = Object.keys(data.langs)[0];
    const langs = Object.entries(data.langs);
    box.innerHTML = `<h3>${esc(egg.name)} password</h3>` +
      `<p>In ${esc(game.name)}, tell the NPC in the Violet City Pokémon Center these four words, in this order, with Easy Chat. ` +
      `They are different for every save file, so they depend on your Trainer ID.</p>` +
      `<div class="eggrow"><label>Trainer ID <input id="egg-tid" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="e.g. 12345" value="${esc(pref.tid)}"></label>` +
      (langs.length > 1 ? `<label>Game language <select id="egg-lang">${langs.map(([k, l]) => `<option value="${k}"${k === pref.lang ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>` : "") +
      `</div><div id="egg-out" aria-live="polite"></div>` +
      `<p class="fine">Words are for the ${esc(langs.length > 1 ? "language you pick" : data.langs[pref.lang].name)} version of the game. Method from the DPPtHGSS Secret Password Tool.</p>`;
    $("#egg-tid").addEventListener("input", e => { pref.tid = e.target.value.replace(/\D/g, "").slice(0, 5); if (e.target.value !== pref.tid) e.target.value = pref.tid; save(); result(); });
    const sel = $("#egg-lang"); if (sel) sel.addEventListener("change", e => { pref.lang = e.target.value; save(); result(); });
    result();
  }

  return { show, passwords };
})();
