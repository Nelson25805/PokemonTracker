"use strict";
// Forms: alternate forms and gender differences (data/forms.json, built by build_forms.py).
// Pure helpers plus one HTML builder; no state of its own beyond the loaded data. No DOM access.
//
//   Forms.init(data)                          once, after data/forms.json loads (null if it didn't)
//   Forms.ready() / Forms.data()              was the file loaded / the raw data (for Store.sanitize)
//   Forms.forGame(game)                       Map: national number -> { base, forms: [{id,name,cat,g}] } for that game
//   Forms.counts(state, game, kind, inDex)    { have, total } over the visible dex (inDex: n => bool, or null for all)
//   Forms.speciesCounts(state, game, kind, n) same, for one species (the card chip)
//   Forms.catTotals(game, inDex)              { gender, alt } how many forms exist per category
//   Forms.missing(state, game, req, inDex)    how many REQUIRED forms the normal list still lacks (req = { gender, alt })
//   Forms.html(state, game, n)                the Forms tab for one species
// kind is "caught" (normal) or "shiny".
const Forms = (() => {
  let data = null;
  const cache = new Map();
  const CATS = [["gender", "Gender differences"], ["alt", "Alternate forms"]];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const have = (state, kind, key) => new Set(((state.forms || {})[kind] || {})[key] || []);

  function init(d) { data = d && typeof d === "object" && d.species ? d : null; cache.clear(); }

  function forGame(g) {
    if (!data) return new Map();
    let m = cache.get(g.key);
    if (m) return m;
    m = new Map();
    for (const [k, sp] of Object.entries(data.species)) {
      const n = Number(k);
      if (n > g.count) continue;
      const forms = (sp.forms || []).filter(f => (f.g || []).includes(g.key));
      if (forms.length) m.set(n, { base: sp.base, forms });
    }
    cache.set(g.key, m);
    return m;
  }

  function counts(state, g, kind, inDex) {
    const got = have(state, kind, g.key);
    let h = 0, t = 0;
    for (const [n, sp] of forGame(g)) {
      if (inDex && !inDex(n)) continue;
      for (const f of sp.forms) { t++; if (got.has(f.id)) h++; }
    }
    return { have: h, total: t };
  }

  function speciesCounts(state, g, kind, n) {
    const sp = forGame(g).get(n), got = have(state, kind, g.key);
    if (!sp) return { have: 0, total: 0 };
    return { have: sp.forms.filter(f => got.has(f.id)).length, total: sp.forms.length };
  }

  function catTotals(g, inDex) {
    const out = { gender: 0, alt: 0 };
    for (const [n, sp] of forGame(g)) {
      if (inDex && !inDex(n)) continue;
      for (const f of sp.forms) if (f.cat in out) out[f.cat]++;
    }
    return out;
  }

  function missing(state, g, req, inDex) {
    if (!req || (!req.gender && !req.alt)) return 0;
    const got = have(state, "caught", g.key);
    let left = 0;
    for (const [n, sp] of forGame(g)) {
      if (inDex && !inDex(n)) continue;
      for (const f of sp.forms) if (req[f.cat] && !got.has(f.id)) left++;
    }
    return left;
  }

  function html(state, g, n) {
    const sp = forGame(g).get(n);
    if (!sp) return "";
    const dir = `assets/sprites/${g.sprites}`;
    const fc = have(state, "caught", g.key), fs = have(state, "shiny", g.key);
    const mc = new Set(state.caught[g.key] || []), ms = new Set(state.shiny[g.key] || []);
    const row = (label, sub, id, src, ssrc, c, s) => {
      const pair = `<img alt="" loading="lazy" src="${src}">` + (g.shiny ? `<img alt="" loading="lazy" src="${ssrc}">` : "");
      const btn = (kind, glyph, word, on) =>
        `<button type="button" class="ftog" data-kind="${kind}" data-id="${esc(id)}" aria-pressed="${on}" aria-label="${word}: ${esc(label)}">${glyph} ${word}</button>`;
      return `<li class="frow"><span class="pair">${pair}</span><span class="fname">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>` +
        `<span class="ftogs">${btn("caught", "✓", "Normal", c)}${g.shiny ? btn("shiny", "★", "Shiny", s) : ""}</span></li>`;
    };
    let out = `<ul class="flist">${row(sp.base, "base form, same as the main grid", "", `${dir}/${n}.png`, `${dir}/shiny/${n}.png`, mc.has(n), ms.has(n))}</ul>`;
    for (const [cat, title] of CATS) {
      const list = sp.forms.filter(f => f.cat === cat);
      if (!list.length) continue;
      out += `<h3>${esc(title)}</h3><ul class="flist">` + list.map(f =>
        row(f.name, "", f.id, `${dir}/forms/${f.id}.png`, `${dir}/shiny/forms/${f.id}.png`, fc.has(f.id), fs.has(f.id))).join("") + "</ul>";
    }
    return out;
  }

  return { init, ready: () => !!data, data: () => data, forGame, counts, speciesCounts, catTotals, missing, html };
})();
