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

  // data/form-areas.json: which form shows up in which area (and segment). rules: [{ n, g: [game keys], area, form: "base" | form id }]
  let fa = [];
  const setAreas = d => { fa = d && Array.isArray(d.rules) ? d.rules : []; };
  const formName = (n, id) => {
    const sp = data && data.species[n]; if (!sp) return id;
    if (id === "base") return sp.base;
    const f = (sp.forms || []).find(x => x.id === id); return f ? f.name : id;
  };
  // Form names that apply to Pokémon n in this area for these games (used by the "Where to find" list).
  const areasFor = (n, keys, area, base) => [...new Set(fa.filter(r => r.n === n && r.g.some(k => keys.includes(k)) && (r.area === area || r.area === base)).map(r => formName(n, r.form)))];
  const areaHtml = a => {
    const s = typeof Maps !== "undefined" ? Maps.segment(a) : { base: a, seg: "" };
    return esc(s.base) + (s.seg ? ` <mark class="segtag">${esc(s.seg)}</mark>` : "");
  };

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

  // Once a form sprite has loaded, show it at a WHOLE multiple of its real size (the multiple closest to the target size in
  // the list's --fs), so pixels stay even whatever size the file is: 64px at a 100px target -> 128px (2x), 80px -> 80px (1x).
  function fit(img) {
    const n = img.naturalWidth, list = img.closest(".flist"), t = list ? parseFloat(list.style.getPropertyValue("--fs")) : 0;
    if (!n || !t) return;
    const s = n * Math.max(1, Math.round(t / n)) + "px";
    img.style.width = s; img.style.height = s;
  }

  function html(state, g, n) {
    const sp = forGame(g).get(n);
    if (!sp) return "";
    const dir = `assets/sprites/${g.sprites}`;
    const ul = `<ul class="flist" style="--fs:${g.spriteSize || 80}px">`;   // form sprites are shown at the game's native sprite size (config "spriteSize")
    const fc = have(state, "caught", g.key), fs = have(state, "shiny", g.key);
    const mc = new Set(state.caught[g.key] || []), ms = new Set(state.shiny[g.key] || []);
    const whereOf = fid => { const r = fa.filter(x => x.n === n && x.form === fid && x.g.includes(g.key)); return r.length ? `<small class="fwhere">Found in: ${r.map(x => areaHtml(x.area)).join(", ")}</small>` : ""; };
    const row = (label, sub, id, src, ssrc, c, s, wh = "") => {
      const pair = `<img alt="" loading="lazy" src="${src}" onload="Forms.fit(this)">` + (g.shiny ? `<img alt="" loading="lazy" src="${ssrc}" onload="Forms.fit(this)">` : "");
      const btn = (kind, glyph, word, on) =>
        `<button type="button" class="ftog" data-kind="${kind}" data-id="${esc(id)}" aria-pressed="${on}" aria-label="${word}: ${esc(label)}">${glyph} ${word}</button>`;
      return `<li class="frow"><span class="pair">${pair}</span><span class="fname">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}${wh}</span>` +
        `<span class="ftogs">${btn("caught", "✓", "Normal", c)}${g.shiny ? btn("shiny", "★", "Shiny", s) : ""}</span></li>`;
    };
    let out = `${ul}${row(sp.base, "base form, same as the main grid", "", `${dir}/${n}.png`, `${dir}/shiny/${n}.png`, mc.has(n), ms.has(n), whereOf("base"))}</ul>`;
    for (const [cat, title] of CATS) {
      const list = sp.forms.filter(f => f.cat === cat);
      if (!list.length) continue;
      out += `<h3>${esc(title)}</h3>${ul}` + list.map(f =>
        row(f.name, "", f.id, `${dir}/forms/${f.id}.png`, `${dir}/shiny/forms/${f.id}.png`, fc.has(f.id), fs.has(f.id), whereOf(f.id))).join("") + "</ul>";
    }
    return out;
  }

  return { fit, init, setAreas, areasFor, ready: () => !!data, data: () => data, forGame, counts, speciesCounts, catTotals, missing, html };
})();