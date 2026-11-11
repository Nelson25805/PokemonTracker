"use strict";
// Forms: alternate forms and gender differences (data/forms.json). Pure helpers plus one HTML builder; no DOM access.
//   init(data) / ready() / data()          load state          setAreas(formAreas)   data/form-areas.json (which form lives where)
//   forGame(game)                          Map: national number -> { base, forms } for that game
//   counts / speciesCounts / catTotals     progress numbers (kind is "caught" or "shiny")
//   missing(state, game, req, inDex)       required forms the normal list still lacks (completion rules)
//   html(state, game, n)                   the Forms tab for one species
//   areasFor / byMethod / bySeason / notesFor   form info for the "Where to find" list
//   fit(img)                               show a form sprite at a whole multiple of its real size
const Forms = (() => {
  let data = null;
  const cache = new Map();
  const CATS = [["gender", "Gender differences"], ["alt", "Alternate forms"]];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const have = (state, kind, key) => new Set(((state.forms || {})[kind] || {})[key] || []);

  let fa = [];
  let fnotes = [];
  const setAreas = d => { fa = d && Array.isArray(d.rules) ? d.rules : []; fnotes = d && Array.isArray(d.notes) ? d.notes : []; };
  const merge = list => { const m = new Map(); for (const [name, g] of list) { const e = m.get(name) || { name, g: [] }; g.forEach(k => { if (!e.g.includes(k)) e.g.push(k); }); m.set(name, e); } return [...m.values()]; };
  const hit = (r, keys) => r.g.filter(k => keys.includes(k));
  const byMethod = (n, keys, method) => merge(fa.filter(r => r.n === n && r.methods && r.methods.includes(method)).map(r => [formName(n, r.form), hit(r, keys)]).filter(x => x[1].length));
  const bySeason = (n, keys, season) => merge(fa.filter(r => r.n === n && r.season === season).map(r => [formName(n, r.form), hit(r, keys)]).filter(x => x[1].length));
  const notesFor = (n, keys) => fnotes.filter(x => x.n === n && x.g.some(k => keys.includes(k))).map(x => x.text);
  const formName = (n, id) => {
    const sp = data && data.species[n]; if (!sp) return id;
    if (id === "base") return sp.base;
    const f = (sp.forms || []).find(x => x.id === id); return f ? f.name : id;
  };
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
    const ul = `<ul class="flist" style="--fs:${g.spriteSize || 80}px">`;
    const fc = have(state, "caught", g.key), fs = have(state, "shiny", g.key);
    const mc = new Set(state.caught[g.key] || []), ms = new Set(state.shiny[g.key] || []);
    const whereOf = fid => { const r = fa.filter(x => x.n === n && x.form === fid && x.g.includes(g.key)); const places = r.filter(x => x.area), other = r.filter(x => !x.area && x.label);
      return (places.length ? `<small class="fwhere">Found in: ${places.map(x => areaHtml(x.area)).join(", ")}</small>` : "") +
        (other.length ? `<small class="fwhere">${other.map(x => esc(x.label)).join(" · ")}</small>` : ""); };
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

  return { fit, init, setAreas, areasFor, byMethod, bySeason, notesFor, ready: () => !!data, data: () => data, forGame, counts, speciesCounts, catTotals, missing, html };
})();