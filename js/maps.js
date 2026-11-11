"use strict";
// Maps: the region map in the "Where to find" panel with a Pokémon's locations marked (like the in-game Pokédex Area screen).
// Builds HTML strings only; no DOM access except one <style> tag added on init.
//   init(data)  addHoney(honey)  html(gameKeys, entries, name, blank)  at(mapId, fx, fy, found)  locate(keys, area)  drop(img)
//   placeKey / segment / parentOf / exact / kindOf / label / fixLoc, and shape helpers (bbox, inBox, move, outline, pin...)
// Marker styles: sprite on every tile (Red / Blue / Yellow), one sprite per location (Gold / Silver / Crystal, or a built-in bug),
// and flashing locations (Hoenn, FireRed / LeafGreen, Sinnoh, HeartGold / SoulSilver, Unova; maps.json "flash", "fx").
// Several maps per game show as tabs. Time-of-day buttons and tinting, roaming routes, honey trees (honey.json) and
// no-data "AREA UNKNOWN" banners are supported.
// data/maps.json: maps { name, img, w, h, grid, icon, single, mark, times, title, frame, labels, unknown, flash, fx, areasOf, variant },
// games { key: [mapIds] }, areas { mapId: { place: [boxes] } } and inside { mapId: { child: parent } }.
// A box is [x, y, w, h] (image pixels), ["e", x, y, w, h] (oval) or ["p", x1, y1, x2, y2, ...] (polygon).
const Maps = (() => {
  let data = null;
  const FLOOR = /^b?\d+[fr]$/i;
  const WORDS = new Set(["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
    "ne", "nw", "se", "sw", "area", "entrance", "exterior", "outside"]);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const famOf = id => { const m = data && data.maps[id]; return (m && m.areasOf) || id; };
  const tableOf = id => ((data && data.areas) || {})[famOf(id)] || {};
  const insideOf = id => ((data && data.inside) || {})[famOf(id)] || {};
  const parentIn = (id, area) => { const t = insideOf(id); return t[area] || t[placeKey(area)] || ""; };
  function boxesFor(id, table, area) {
    for (let a = area, i = 0; a && i < 5; a = parentIn(id, a), i++) {
      const b = table[a] || table[placeKey(a)];
      if (b && b.length) return b;
    }
    return null;
  }
  function parentOf(area) {
    if (!data || !data.inside) return "";
    for (const id of Object.keys(data.maps)) { const p = parentIn(id, area); if (p) return p; }
    return "";
  }

  const HONEY_PREFIX = "Honey Tree: ";
  const HONEY_ALL = "Honey Trees";
  let honeyNames = [];

  function addHoney(h) {
    honeyNames = [];
    if (!data || !h || !Array.isArray(h.spots) || !h.map || !data.maps[h.map]) return;
    data.areas = data.areas || {};
    const fam = famOf(h.map), table = (data.areas[fam] = data.areas[fam] || {});
    const all = [], seen = new Set();
    for (const s of h.spots) {
      const src = Array.isArray(s.boxes) && s.boxes.length ? s.boxes : (table[s.area] || table[placeKey(s.area || "")]);
      if (!src || !src.length) continue;
      const name = HONEY_PREFIX + s.name, boxes = src.map(b => b.slice());
      table[name] = boxes;
      honeyNames.push(name);
      for (const b of boxes) { const sig = JSON.stringify(b); if (!seen.has(sig)) { seen.add(sig); all.push(b.slice()); } }
    }
    if (all.length) table[HONEY_ALL] = all;
  }

  const P = v => (v * 100).toFixed(3) + "%";
  const isShape = b => typeof b[0] === "string";
  const verts = b => {
    if (!isShape(b)) { const [x, y, w, h] = b; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
    if (b[0] === "e") { const [, x, y, w, h] = b; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
    const out = []; for (let i = 1; i + 1 < b.length; i += 2) out.push([b[i], b[i + 1]]); return out;
  };
  const bbox = b => {
    if (!isShape(b)) return b;
    if (b[0] === "e") return b.slice(1, 5);
    const v = verts(b), xs = v.map(p => p[0]), ys = v.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
    return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
  };
  const area = b => { const r = bbox(b); return r[2] * r[3]; };
  function inBox(b, x, y, pad = 0) {
    if (!isShape(b)) { const [bx, by, bw, bh] = b; return x >= bx - pad && x < bx + bw + pad && y >= by - pad && y < by + bh + pad; }
    if (b[0] === "e") {
      const rx = b[3] / 2 + pad, ry = b[4] / 2 + pad; if (!(rx > 0 && ry > 0)) return false;
      const dx = (x - (b[1] + b[3] / 2)) / rx, dy = (y - (b[2] + b[4] / 2)) / ry; return dx * dx + dy * dy <= 1;
    }
    const v = verts(b); let hit = false;
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
      const [xi, yi] = v[i], [xj, yj] = v[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }
  const r1 = v => Math.round(v * 10) / 10;
  const move = (b, dx, dy) => !isShape(b) ? [b[0] + dx, b[1] + dy, b[2], b[3]]
    : b[0] === "e" ? ["e", r1(b[1] + dx), r1(b[2] + dy), b[3], b[4]]
    : ["p", ...b.slice(1).map((v, i) => r1(v + (i % 2 ? dy : dx)))];
  function boxStyle(b, m) {
    const [x, y, w, h] = bbox(b);
    let s = `left:${P(x / m.w)};top:${P(y / m.h)};width:${P(w / m.w)};height:${P(h / m.h)}`;
    if (isShape(b)) {
      if (b[0] === "e") s += ";border-radius:50%";
      else {
        const bw = Math.max(w, 1e-3), bh = Math.max(h, 1e-3);
        s += ";clip-path:polygon(" + verts(b).map(([vx, vy]) => `${((vx - x) / bw * 100).toFixed(3)}% ${((vy - y) / bh * 100).toFixed(3)}%`).join(",") + ")";
      }
    }
    return s;
  }
  const svgShape = b => {
    const at = b[0] === "e" ? `ellipse cx="${b[1] + b[3] / 2}" cy="${b[2] + b[4] / 2}" rx="${b[3] / 2}" ry="${b[4] / 2}"`
      : `polygon points="${verts(b).map(v => v.join(",")).join(" ")}"`;
    return `<${at.split(" ")[0]} class="w" ${at.slice(at.indexOf(" ") + 1)}/><${at.split(" ")[0]} class="b" ${at.slice(at.indexOf(" ") + 1)}/>`;
  };
  function layer(boxes, W, H, pad = 0, tree = false) {
    let out = "", svg = "";
    for (const b of boxes) {
      if (isShape(b)) { svg += svgShape(b); continue; }
      const [x, y, w, h] = b;
      out += `<i${tree ? ' class="tree"' : ""} style="left:${P((x - pad) / W)};top:${P((y - pad) / H)};width:${P((w + 2 * pad) / W)};height:${P((h + 2 * pad) / H)}"></i>`;
    }
    return out + (svg ? `<svg class="amapsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg>` : "");
  }
  const outline = (boxes, W, H) => layer(boxes, W, H);
  const pin = (boxes, W, H, pad = 0, tree = false) => layer(boxes, W, H, pad, tree);

  function uxMarks(sets, m) {
    const f = v => +v.toFixed(2);
    let out = "";
    for (const k of ["land", "special"]) for (const { b } of sets[k]) {
      const [x, y, w, h] = bbox(b), cx = x + w / 2, cy = y + h / 2;
      const circle = isShape(b) ? b[0] === "e" : true;
      const squarish = w <= 16 && h <= 16 && w / h > 0.6 && w / h < 1.67;
      if (circle && squarish && k === "special") out += `<ellipse class="ux spot" cx="${f(cx)}" cy="${f(cy)}" rx="${f(w / 2 * 1.25)}" ry="${f(h / 2 * 1.25)}" fill="url(#uxdisc)"/>`;
      else if (circle && squarish) out += `<ellipse class="ux town" cx="${f(cx)}" cy="${f(cy)}" rx="${f(w / 2 - 0.9)}" ry="${f(h / 2 - 0.9)}"/>`;
      else out += `<polygon class="ux route" points="${verts(b).map(v => v.join(",")).join(" ")}"/>`;
    }
    return `<svg class="uxsvg" viewBox="0 0 ${m.w} ${m.h}" preserveAspectRatio="none"><defs><radialGradient id="uxdisc"><stop offset="0.7" stop-color="#e25073"/>` +
      `<stop offset="1" stop-color="#e25073" stop-opacity="0"/></radialGradient></defs>${out}</svg>`;
  }

  const TIMES = ["morning", "day", "night"];
  const TCOL = { morning: "#ffd23f", day: "#ff8a1f", night: "#3b4cc0" };
  const TLABEL = { morning: "Morning", day: "Day", night: "Night" };
  const CLOCK_GS = { morning: "4:00–9:59 AM", day: "10:00 AM–5:59 PM", night: "6:00 PM–3:59 AM" };
  const CLOCKS = {
    "johto-kanto-gsc": CLOCK_GS,
    "johto-kanto-hgss": CLOCK_GS,
    "sinnoh-dp": { morning: "4:00–9:59 AM", day: "10:00 AM–7:59 PM", night: "8:00 PM–3:59 AM" },
  };
  const clockOf = (id, m) => (m && m.clock) || CLOCKS[id] || null;
  const timeText = set => (set.size >= TIMES.length ? "All day" : TIMES.filter(t => set.has(t)).map(t => TLABEL[t]).join(" / "));

  const BUG = (() => {
    const rows = [".#....#.", "..#..#..", "...##...", ".######.", "#.####.#", "#.####.#", "..#..#..", ".#....#."];
    let r = "";
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
    return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges" fill="#d01818">${r}</svg>`);
  })();

  const HONEYICON = (() => {
    const pal = { D: "#3b2506", M: "#e08a10", L: "#ffd23a", T: "#5a3416" };
    const rows = ["..DDDDD..", ".DLLLLMD.", "DLLLLMMMD", "DLLLMMMMD", "DLLMMMMMD", "DMMMMMMDD", ".DMMMMDD.", "..DTTTD..", "..TT.TT.."];
    let r = "";
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (pal[c]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[c]}"/>`; }));
    return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges">${r}</svg>`);
  })();
  function honeyIcons(table, m) {
    const p = v => (v * 100).toFixed(3) + "%", seen = new Set();
    let out = "";
    for (const n of honeyNames) for (const hb of (table[n] || [])) {
      const [x, y, w, h] = bbox(hb);
      const sig = x + "," + y + "," + w + "," + h; if (seen.has(sig)) continue; seen.add(sig);
      out += `<i class="honeyicon" data-t="morning day night" style="left:${p((x - 1) / m.w)};top:${p((y - 1) / m.h)};width:${p((w + 2) / m.w)};height:${p((h + 2) / m.h)};background-image:url(${HONEYICON})"></i>`;
    }
    return out;
  }

  const THIN = {
    A: ["..###..", ".#...#.", "#.....#", "#.....#", "#######", "#.....#", "#.....#"],
    B: ["######.", "#.....#", "#.....#", "######.", "#.....#", "#.....#", "######."],
    C: ["..####.", ".#....#", "#......", "#......", "#......", ".#....#", "..####."],
    D: ["#####..", "#....#.", "#.....#", "#.....#", "#.....#", "#....#.", "#####.."],
    E: ["#######", "#......", "#......", "######.", "#......", "#......", "#######"],
    F: ["#######", "#......", "#......", "######.", "#......", "#......", "#......"],
    G: ["..####.", ".#....#", "#......", "#..####", "#.....#", ".#....#", "..####."],
    H: ["#.....#", "#.....#", "#.....#", "#######", "#.....#", "#.....#", "#.....#"],
    I: [".#####.", "...#...", "...#...", "...#...", "...#...", "...#...", ".#####."],
    J: ["....###", ".....#.", ".....#.", ".....#.", ".....#.", "#....#.", ".####.."],
    K: ["#....#.", "#...#..", "#..#...", "###....", "#..#...", "#...#..", "#....#."],
    L: ["#......", "#......", "#......", "#......", "#......", "#......", "#######"],
    M: ["#.....#", "##...##", "#.#.#.#", "#..#..#", "#.....#", "#.....#", "#.....#"],
    N: ["#.....#", "##....#", "#.#...#", "#..#..#", "#...#.#", "#....##", "#.....#"],
    O: ["..###..", ".#...#.", "#.....#", "#.....#", "#.....#", ".#...#.", "..###.."],
    P: ["######.", "#.....#", "#.....#", "######.", "#......", "#......", "#......"],
    Q: ["..###..", ".#...#.", "#.....#", "#.....#", "#...#.#", ".#...#.", "..###.#"],
    R: ["######.", "#.....#", "#.....#", "######.", "#..#...", "#...#..", "#....##"],
    S: [".####..", "#....#.", "#......", ".#####.", "......#", "#.....#", ".#####."],
    T: ["#######", "...#...", "...#...", "...#...", "...#...", "...#...", "...#..."],
    U: ["#.....#", "#.....#", "#.....#", "#.....#", "#.....#", "#.....#", ".#####."],
    V: ["#.....#", "#.....#", "#.....#", ".#...#.", ".#...#.", "..#.#..", "...#..."],
    W: ["#.....#", "#.....#", "#.....#", "#..#..#", "#.#.#.#", "##...##", "#.....#"],
    X: ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"],
    Y: ["#.....#", ".#...#.", "..#.#..", "...#...", "...#...", "...#...", "...#..."],
    Z: ["#######", ".....#.", "....#..", "...#...", "..#....", ".#.....", "#######"],
    0: ["..###..", ".#...#.", "#....##", "#..#..#", "##....#", ".#...#.", "..###.."],
    1: ["...#...", "..##...", "...#...", "...#...", "...#...", "...#...", ".#####."],
    2: [".#####.", "#.....#", "......#", "...##..", "..#....", ".#.....", "#######"],
    3: [".#####.", "#.....#", "......#", "..####.", "......#", "#.....#", ".#####."],
    4: ["....##.", "...#.#.", "..#..#.", ".#...#.", "#######", ".....#.", ".....#."],
    5: ["#######", "#......", "######.", "......#", "......#", "#.....#", ".#####."],
    6: ["..####.", ".#.....", "#......", "######.", "#.....#", "#.....#", ".#####."],
    7: ["#######", "......#", ".....#.", "....#..", "...#...", "..#....", "..#...."],
    8: [".#####.", "#.....#", "#.....#", ".#####.", "#.....#", "#.....#", ".#####."],
    9: [".#####.", "#.....#", "#.....#", ".######", "......#", ".....#.", ".####.."],
    "'": ["...##..", "...##..", "....#..", "...#...", ".......", ".......", "......."],
    ".": [".......", ".......", ".......", ".......", ".......", "..##...", "..##..."],
    "-": [".......", ".......", ".......", ".#####.", ".......", ".......", "......."],
    "♀": ["..###..", ".#...#.", ".#...#.", "..###..", "...#...", "..###..", "...#..."],
    "♂": ["....###", ".....##", "..###.#", ".#...#.", ".#...#.", ".#...#.", "..###.."],
  };
  const BOLD = {
    A: [".###.", "#####", "#..##", "#..##", "#####", "#..##"],
    E: ["#####", "##...", "####.", "##...", "##...", "#####"],
    H: ["#..##", "#..##", "#..##", "#####", "#..##", "#..##"],
    I: ["#####", ".##..", ".##..", ".##..", ".##..", "#####"],
    J: ["..####", "...##.", "...##.", "...##.", "#..##.", ".###.."],
    K: ["##.##", "##.##", "####.", "###..", "####.", "##.##"],
    N: ["#..##", "#..##", "##.##", "#.###", "#..##", "#..##"],
    O: [".###.", "#..##", "#..##", "#..##", "#..##", ".###."],
    S: [".####", "##...", ".###.", "...##", "...##", "####."],
    T: ["######", "..##..", "..##..", "..##..", "..##..", "..##.."],
  };
  const runs = (rows, x, y) => {
    let d = "";
    rows.forEach((row, r) => { const re = /#+/g; let k; while ((k = re.exec(row))) d += `M${x + k.index} ${y + r}h${k[0].length}v1h-${k[0].length}z`; });
    return d;
  };
  const thinText = (txt, x, y) => {
    let d = "";
    for (const ch of String(txt).toUpperCase()) { if (THIN[ch]) d += runs(THIN[ch], x, y); x += 8; }
    return d;
  };
  const boldText = (txt, x, y) => {
    let d = "", end = x;
    for (const ch of String(txt).toUpperCase()) {
      const g = BOLD[ch]; if (!g) { x += 4; end = x; continue; }
      d += runs(g, x, y); end = x + g[0].length; x = end + (ch === "T" ? 0 : 1);
    }
    return [d, end - 0];
  };
  const CUT = [5, 3, 2, 1, 1, 0, 0, 0];
  const labelSvg = (m, l) => {
    const left = l.side !== "right", pad = left ? 2 : 8;
    const [text, end] = boldText(l.text, pad, 1), w = end + (left ? 8 : 2);
    let plate = "";
    for (let r = 0; r < 8; r++) { const a = left ? 0 : CUT[r], b = left ? w - CUT[r] : w; plate += `M${a} ${r}h${b - a}v1h-${b - a}z`; }
    return `<svg class="amaplabel" role="img" aria-label="${esc(l.text)}" shape-rendering="crispEdges" viewBox="0 0 ${w} 8" ` +
      `style="${left ? "left" : "right"}:0;width:${(w / m.w * 100).toFixed(3)}%"><path fill="#e0f8a0" d="${plate}"/><path fill="#000" d="${text}"/></svg>`;
  };

  const CSS = `
.amap .one,.amap .bug{background-repeat:no-repeat;background-size:100% 100%}
.amap .bug{filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff)}
.amap .amapwrap{container-type:inline-size}
.amap .amapbar{display:block;width:100%;height:auto;image-rendering:pixelated}
.amap .amapwrap.framed{background:#000}
.amap .amapwrap.framed .amapframe{padding:calc(var(--u) * 8)}
.amap .amapwrap.framed .amapimg{border:0;box-shadow:0 0 0 calc(var(--u) * 2) #000,0 0 0 calc(var(--u) * 4) #686868,0 0 0 calc(var(--u) * 6) #a8a8a8}
.amap .amaplabel{position:absolute;bottom:0;display:block;height:auto;pointer-events:none;image-rendering:pixelated}
.amap[data-time=morning] .amapimg>i:not(.roam):not([data-t~=morning]),.amap[data-time=day] .amapimg>i:not(.roam):not([data-t~=day]),.amap[data-time=night] .amapimg>i:not(.roam):not([data-t~=night]){display:none}

.amap[data-timed] .amapimg img{transition:filter .4s}
.amap[data-timed][data-time=morning] .amapimg img{filter:sepia(.28) saturate(1.2) brightness(1.07) hue-rotate(-8deg)}
.amap[data-timed][data-time=night] .amapimg img{filter:brightness(.55) saturate(.8) hue-rotate(12deg) contrast(1.05)}
.amap .tfilter{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px;font-size:12px}
.amap .tfilter button{padding:2px 8px;font-size:12px;display:inline-flex;align-items:center;gap:4px}
.amap .tfilter button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.amap .tfilter .trange{font-size:10px;opacity:.85;white-space:nowrap}
.amap .tfilter .sw{display:inline-block;width:10px;height:10px;border:1px solid #000}
.amap .tnote{flex:1 1 100%;opacity:.85}
.amaps figure[hidden]{display:none}
.amaptabs{display:flex;flex-wrap:wrap;padding:6px 8px 0}
.amaptab{padding:4px 10px;font-size:13px;border-right-width:0}
.amaptab:last-child{border-right-width:2px}
.amaptab[aria-selected=true]{background:var(--ink);color:var(--bg)}
.amaptab .cnt{margin-left:5px;font-size:11px;opacity:.75}
.amap i.roam{position:absolute;pointer-events:none;background:rgba(50,140,255,.48);box-shadow:inset 0 0 0 1px rgba(255,255,255,.7);animation:roamPulse 2.6s ease-in-out infinite}
@keyframes roamPulse{0%,100%{opacity:.35}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.amap i.roam{animation:none;opacity:.75}}
.amap .roamnote{display:flex;gap:8px;align-items:flex-start;margin:6px 0 0;font-size:12px;line-height:1.4}
.roamhow{font-size:13px;line-height:1.45;border-left:4px solid rgba(70,150,255,.85);padding:2px 0 2px 8px}
.amap .amappin{position:absolute;inset:0;z-index:1;pointer-events:none}
.amap .amappin i{position:absolute;box-sizing:border-box;background:rgba(255,40,40,.3);outline:2px solid #d01818;box-shadow:0 0 0 1px #fff,inset 0 0 0 1px #fff;animation:pinPulse 1.2s ease-in-out infinite}
@keyframes pinPulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.amap .amappin i{animation:none}}

.amap .amappin i.tree{background:transparent;box-shadow:0 0 0 1px #fff,inset 0 0 0 1px #fff;outline:2px solid #d01818}
#where li .locbtn{margin-left:auto;padding:2px 8px;font-size:12px;white-space:nowrap}
#where li .locbtn[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.amap .roamsw{flex:none;width:14px;height:14px;margin-top:1px;background:rgba(70,150,255,.5);border:1px solid #fff;outline:1px solid #000}
.amapimg .honeyicon{position:absolute;z-index:1;pointer-events:none;background-repeat:no-repeat;background-size:100% 100%;image-rendering:pixelated;filter:drop-shadow(1px 0 0 #fff) drop-shadow(-1px 0 0 #fff) drop-shadow(0 1px 0 #fff) drop-shadow(0 -1px 0 #fff)}

#where .honeyinfo{flex:1 1 100%;font-size:13px;line-height:1.4}
#where .honeyinfo p{margin:4px 0}
#where .honeyinfo details.honeydet{margin:6px 0 2px}
#where .honeyinfo ul{padding:0 4px 4px}
#where .honeyinfo li{align-items:center}
#where .honeyinfo li strong{flex:0 0 min(100%,20ch)}
#where .honeyinfo li span{flex:1 1 20ch}

.amap .amappin svg{animation:pinPulse 1.2s ease-in-out infinite}
.amap .amappin .w{stroke:#fff;stroke-width:4px}
.amap .amappin .b{stroke:#d01818;stroke-width:2px;fill:rgba(255,40,40,.3)}
@media (prefers-reduced-motion:reduce){.amap .amappin svg{animation:none}}

.amap .amaptip{white-space:normal;width:max-content;max-width:min(230px,70cqw)}
.amaptip small{opacity:.8}

#where li.inside{margin-left:14px;padding-left:8px;border-left:4px solid var(--mid)}
#where .insidetag{display:inline-block;padding:0 6px;margin-left:4px;font:600 11px/1.6 system-ui,sans-serif;border:2px dashed var(--line);background:var(--card);color:var(--ink);vertical-align:middle;white-space:nowrap}`;

  const LAND = new RegExp("\\b(route|town|city|village)\\b|\\b(one|two|three|four|five|six|seven) island\\b" +
    "|\\bcinnabar island\\b|\\bindigo plateau\\b|\\bthree isle port\\b", "i");
  const kindOf = place => (String(place).startsWith(HONEY_PREFIX) || place === HONEY_ALL || LAND.test(String(place)) ? "land" : "special");

  function placeKey(area) {
    const w = String(area).split(/\s+towards\s+/i)[0].trim().split(/\s+/);
    while (w.length > 1 && (FLOOR.test(w[w.length - 1]) || WORDS.has(w[w.length - 1].toLowerCase()))) w.pop();
    return w.join(" ");
  }

  const COMPASS = new Set(["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"]);
  function segment(area) {
    const parts = String(area).split(/\s+towards\s+/i), w = parts[0].trim().split(/\s+/), seg = [];
    while (w.length > 1 && FLOOR.test(w[w.length - 1])) w.pop();
    while (w.length > 1 && COMPASS.has(w[w.length - 1].toLowerCase())) seg.unshift(w.pop());
    const to = parts[1] ? "towards " + parts[1].trim() : "";
    return { base: placeKey(w.join(" ")), seg: [seg.join(" "), to].filter(Boolean).join(" ") };
  }
  function exact(keys, area) {
    if (!data) return true;
    for (const key of keys) for (const id of data.games[key] || []) if (tableOf(id)[area]) return true;
    return false;
  }

  function init(d) {
    data = d && typeof d === "object" && d.maps && d.games ? d : null;
    if (typeof document !== "undefined" && !document.getElementById("maps-time-css")) {
      const s = document.createElement("style"); s.id = "maps-time-css"; s.textContent = CSS; document.head.append(s);
    }
  }

  function rowTimes(cond) {
    const c = String(cond || "").toLowerCase(), t = TIMES.filter(x => c.includes(x));
    return t.length ? t : TIMES;
  }

  function drop(img) {
    const fig = img && img.closest && img.closest("figure");
    if (!fig) return;
    const box = fig.closest(".amaps"), id = fig.dataset.map;
    fig.remove();
    if (!box) return;
    const tabs = [...box.querySelectorAll(".amaptab")].filter(t => {
      if (box.querySelector(`figure.amap[data-map="${t.dataset.map}"]`)) return true;
      t.remove(); return false;
    });
    if (!tabs.length) { box.remove(); return; }
    const on = tabs.find(t => t.getAttribute("aria-selected") === "true") || tabs[0];
    tabs.forEach(t => t.setAttribute("aria-selected", String(t === on)));
    box.querySelectorAll("figure.amap").forEach(f => { f.hidden = f.dataset.map !== on.dataset.map; });
    if (tabs.length < 2) { const strip = box.querySelector(".amaptabs"); if (strip) strip.remove(); }
  }

  function html(keys, entries, name = "", blank = "") {
    if (!data) return "";
    const areas = [...new Set(entries.map(e => e[0]))], done = new Set(), out = [], none = !areas.length && !blank;
    const meta = [];
    const emit = (id, m, n, markup, roamOnly = false) => { out.push(markup); meta.push({ id, name: m.name, n, roamOnly }); };
    const areaTimes = new Map();
    for (const e of entries) {
      const set = areaTimes.get(e[0]) || new Set();
      for (const t of rowTimes(e[5])) set.add(t);
      areaTimes.set(e[0], set);
    }
    const found = areas.flatMap(a => { const t = TIMES.filter(x => areaTimes.get(a).has(x)).join(" "); return [{ n: a, t }, { n: placeKey(a), t }]; });
    const honeyHere = areas.includes(HONEY_ALL);
    if (honeyHere) { const t = TIMES.filter(x => areaTimes.get(HONEY_ALL).has(x)).join(" "); honeyNames.forEach(n => found.push({ n, t })); }
    const pc = v => (v * 100).toFixed(3) + "%";
    const title = m => {
      const t = m.title;
      if (!t || !t.text || !name || t.bar) return "";
      const txt = String(t.text).replace("{NAME}", name.toUpperCase()).replace("{name}", name);
      return `<div class="amaptitle" style="left:${pc((t.x || 0) / m.w)};top:${pc((t.y || 0) / m.h)};font-size:${((t.size || 8) / m.w * 100).toFixed(3)}cqw">${esc(txt)}</div>`;
    };
    const bar = m => {
      const t = m.title;
      if (!t || !t.text || !name || !t.bar) return "";
      const txt = String(t.text).replace("{NAME}", name.toUpperCase()).replace("{name}", name), W = m.frame ? m.w + 16 : m.w, H = 14;
      return `<svg class="amapbar" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" role="img" aria-label="${esc(txt)}">` +
        `<rect width="${W}" height="${H}" fill="#000"/><path fill="${esc(t.color || "#e0f8a0")}" d="${thinText(txt, 16, 4)}"/></svg>`;
    };
    const wrap = (m, id, inner, cap, f = [], extra = "", attrs = "") =>
      `<figure class="amap"${attrs} data-map="${esc(id)}" data-w="${m.w}" data-h="${m.h}" data-time="all" data-found="${esc(JSON.stringify(f))}">` +
      `<div class="amapwrap${m.frame ? " framed" : ""}"${m.frame ? ` style="--u:${(100 / (m.w + 16)).toFixed(4)}cqw"` : ""}>${bar(m)}<div class="amapframe"><div class="amapimg">` +
      `<img alt="${esc(m.name)} map" src="${esc(m.img)}" onerror="Maps.drop(this)">${inner}<div class="amaphl"></div><div class="amappin"></div>${title(m)}` +
      `${(m.labels || []).map(l => labelSvg(m, l)).join("")}<div class="amaptip" hidden></div></div></div></div><figcaption>${cap}</figcaption>${extra}</figure>`;
    const filter = (m, id) => {
      const clock = clockOf(id, m) || {};
      return `<div class="tfilter" role="group" aria-label="Time of day">` +
      [["all", "All times", ""], ...TIMES.map(t => [t, TLABEL[t], TCOL[t]])].map(([t, label, col]) =>
        `<button type="button" class="tbtn" data-t="${t}" aria-pressed="${t === "all"}" ` +
        `onclick="var f=this.closest('figure');f.dataset.time=this.dataset.t;f.querySelectorAll('.tbtn').forEach(function(b){b.setAttribute('aria-pressed',b===this)},this)">` +
        `${col ? `<span class="sw" style="background:${col}"></span>` : ""}${label}${clock[t] ? `<small class="trange">${esc(clock[t])}</small>` : ""}</button>`).join("") +
      `<span class="tnote">Hover a location to see when the Pokémon is there. The buttons show only the locations that apply at one time of day.` +
      `${clock.morning ? " The hours are the game's own clock." : ""}</span></div>`;
    };

    const regions = [...new Set(entries.filter(e => /^roaming/.test(e[1])).map(e =>
      (/copycat/i.test(e[5]) ? "Kanto" : String(e[0]).replace(/^Roaming\s+/i, "").trim())))];
    const capOf = (n, rm) => (n ? `${n} location${n === 1 ? "" : "s"} marked` : "") + (n && rm ? " + " : "") + (rm ? "roams the shaded routes" : "");
    const roamFor = (table, m) => {
      if (!regions.length) return null;
      const seen = new Set(), names = [];
      let marks = "";
      for (const [p, boxes] of Object.entries(table)) {
        if (!/\broute\b/i.test(p) || !regions.some(r => p.toLowerCase().startsWith(r.toLowerCase() + " "))) continue;
        names.push(p);
        for (const b of boxes) {
          const sig = JSON.stringify(b); if (seen.has(sig)) continue; seen.add(sig);
          marks += `<i class="roam" style="${boxStyle(b, m)}"></i>`;
        }
      }
      if (!names.length) return null;
      const who = name ? esc(name) : "This Pokémon";
      return { marks, found: names.map(n => ({ n, t: "", r: 1 })),
        note: `<p class="roamnote"><span class="roamsw"></span><span><b>Roaming.</b> ${who} has no fixed spot: it can be on any shaded route, ` +
          `and it moves around as you play. Hover a route to check it.</span></p>` };
    };

    const inGroup = {};
    for (const k of keys) for (const id of data.games[k] || []) (inGroup[famOf(id)] = inGroup[famOf(id)] || new Set()).add(id);
    const tag = (id, m) => (m.variant && inGroup[famOf(id)] && inGroup[famOf(id)].size > 1 ? ` (${esc(m.variant)})` : "");
    const mixed = keys.includes("emerald") && keys.some(k => k !== "emerald");
    for (const key of keys) for (const id of data.games[key] || []) {
      const m = data.maps[id];
      if (!m || !m.w || !m.h) continue;
      const fstyle = m.flash ? (key === "emerald" ? "emerald" : "rs") : "";
      if (done.has(id + "|" + fstyle)) continue;
      done.add(id + "|" + fstyle);
      if (none) {
        const u = m.unknown, banner = u && u.img
          ? `<img class="unk" alt="Area unknown" src="${esc(u.img)}" style="left:${pc(u.x / m.w)};top:${pc(u.y / m.h)};width:${pc(u.w / m.w)}">`
          : `<div class="unk txt">AREA UNKNOWN</div>`;
        return wrap(m, id, banner, `${esc(m.name)}: area unknown`);
      }
      const table = tableOf(id);
      if (blank) {
        emit(id, m, 0, wrap(m, id, "", `${esc(m.name)}: ${esc(blank)}`, [], "", m.flash ? ` data-flash="${fstyle}"` : ""), false);
        continue;
      }

      if (m.flash) {
        const seen = new Map(), sets = { land: [], special: [] }, names = new Set();
        for (const a of areas) {
          const boxes = boxesFor(id, table, a);
          if (!boxes || !boxes.length) continue;
          const kind = kindOf(placeKey(a));
          if (a === HONEY_ALL) honeyNames.forEach(h => names.add(h)); else names.add(placeKey(a));
          for (const b of boxes) {
            const sig = kind + JSON.stringify(b);
            let o = seen.get(sig);
            if (!o) { seen.set(sig, o = { b, times: new Set() }); sets[kind].push(o); }
            for (const t of areaTimes.get(a)) o.times.add(t);
          }
        }
        const rm = roamFor(table, m);
        if (!seen.size && !rm) continue;
        let timed = false;
        let marks = (rm ? rm.marks : "") + (m.fx === "unova" ? uxMarks(sets, m) : ["land", "special"].flatMap(k => sets[k].map(({ b, times }) => {
          if (times.size < TIMES.length) timed = true;
          return `<i class="fl ${k}" data-t="${TIMES.filter(t => times.has(t)).join(" ")}" style="${boxStyle(b, m)}"></i>`;
        })).join(""));
        if (honeyHere) marks += honeyIcons(table, m);
        const mix = sets.land.length && sets.special.length ? "both" : sets.special.length ? "special" : "land";
        const who = mixed ? (fstyle === "emerald" ? " (Emerald)" : " (Ruby / Sapphire)") : "";
        emit(id, m, names.size, wrap(m, id, marks, `${esc(m.name)}${who}: ${capOf(names.size, rm)}`, rm ? found.concat(rm.found) : found,
          (timed ? filter(m, id) : "") + (rm ? rm.note : ""), ` data-flash="${fstyle}" data-mix="${mix}"${m.fx ? ` data-fx="${esc(m.fx)}"` : ""}${timed ? " data-timed" : ""}`), !names.size);
        continue;
      }

      if (m.icon && !m.single) {
        const seen = new Set(), places = new Set();
        for (const a of areas) {
          const boxes = boxesFor(id, table, a);
          if (!boxes || !boxes.length) continue;
          places.add(placeKey(a));
          for (const b of boxes) seen.add(JSON.stringify(b));
        }
        const rm = roamFor(table, m);
        if (!seen.size && !rm) continue;
        const g = m.grid || 8;
        const marks = (rm ? rm.marks : "") + [...seen].map(s => bbox(JSON.parse(s))).map(([x, y, w, h]) => {
          const pos = `left:${pc(x / m.w)};top:${pc(y / m.h)};width:${pc(w / m.w)};height:${pc(h / m.h)}`;
          return `<i class="nest" style="${pos};background-image:url(${esc(m.icon)});background-size:${pc(g / w)} ${pc(g / h)}"></i>`;
        }).join("");
        emit(id, m, places.size, wrap(m, id, marks, `${esc(m.name)}${tag(id, m)}: ${capOf(places.size, rm)}`, rm ? found.concat(rm.found) : found, rm ? rm.note : ""), !places.size);
        continue;
      }

      const sprite = m.icon ? esc(m.icon) : BUG;
      const groups = new Map();
      for (const a of areas) {
        const boxes = boxesFor(id, table, a);
        if (!boxes || !boxes.length) continue;
        const sig = JSON.stringify([...boxes].sort()), gr = groups.get(sig) || { boxes, times: new Set() };
        for (const t of areaTimes.get(a)) gr.times.add(t);
        groups.set(sig, gr);
      }
      const rm = roamFor(table, m);
      if (!groups.size && !rm) continue;
      const ms = m.mark || m.grid || 8;
      let timed = false;
      const marks = (rm ? rm.marks : "") + [...groups.values()].map(gr => {
        const part = gr.times.size < TIMES.length; timed = timed || part;
        const big = bbox(gr.boxes.reduce((p, b) => (area(b) > area(p) ? b : p)));
        const cw = Math.min(ms, big[2]), ch = Math.min(ms, big[3]);
        const cols = Math.max(1, Math.floor(big[2] / cw)), rows = Math.max(1, Math.floor(big[3] / ch));
        const x = big[0] + Math.floor((cols - 1) / 2) * cw, y = big[1] + Math.floor((rows - 1) / 2) * ch;
        const pos = `left:${pc(x / m.w)};top:${pc(y / m.h)};width:${pc(cw / m.w)};height:${pc(ch / m.h)}`;
        return `<i class="nest ${m.icon ? "one" : "bug"}" data-t="${TIMES.filter(t => gr.times.has(t)).join(" ")}" style="${pos};background-image:url(${sprite})"></i>`;
      }).join("");
      emit(id, m, groups.size, wrap(m, id, marks, `${esc(m.name)}${tag(id, m)}: ${capOf(groups.size, rm)}`, rm ? found.concat(rm.found) : found,
        (timed ? filter(m, id) : "") + (rm ? rm.note : ""), timed ? " data-timed" : ""), !groups.size);
    }

    const ids = [...new Set(meta.map(x => x.id))];
    if (new Set(ids.map(famOf)).size < 2) return out.join("");
    const first = ids[0];
    const pick = "var w=this.closest('.amaps'),id=this.dataset.map;" +
      "w.querySelectorAll('.amaptab').forEach(function(b){b.setAttribute('aria-selected',b===this)},this);" +
      "w.querySelectorAll('figure.amap').forEach(function(f){f.hidden=f.dataset.map!==id})";
    const tabs = ids.map(id => {
      const x = meta.filter(y => y.id === id);
      return `<button type="button" class="amaptab" role="tab" data-map="${esc(id)}" aria-selected="${id === first}" onclick="${pick}">` +
        `${esc(x[0].name)}<span class="cnt">${x.every(y => y.roamOnly) ? "roams" : Math.max(...x.map(y => y.n))}</span></button>`;
    }).join("");
    const figs = out.map((h, i) => (meta[i].id === first ? h : h.replace('<figure class="amap"', '<figure class="amap" hidden')));
    return `<div class="amaps"><div class="amaptabs" role="tablist" aria-label="Maps">${tabs}</div>${figs.join("")}</div>`;
  }

  const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/^kanto/, "").replace(/[^a-z0-9]/g, "");

  const wordsOf = s => String(s).split(/\s+/);
  const commonWords = (p, q) => { const x = wordsOf(p), y = wordsOf(q); let i = 0; while (i < x.length && i < y.length && x[i].toLowerCase() === y[i].toLowerCase()) i++; return i; };
  function label(names) {
    const list = names.filter(Boolean);
    if (!list.length) return "";
    if (list.length > 1) {
      const c = list.reduce((n, s) => Math.min(n, commonWords(list[0], s)), 99);
      if (c >= 2 || (c >= 1 && list.some(s => wordsOf(s).length === c))) return wordsOf(list[0]).slice(0, c).join(" ");
    }
    return list.find(s => /['é]/.test(s)) || list[0];
  }

  function at(id, fx, fy, found = []) {
    const m = data && data.maps[id];
    if (!m || !m.w || !m.h) return [];
    const x = fx * m.w, y = fy * m.h, byName = new Map();
    const roamKeys = new Set();
    const via = new Map(), own = tableOf(id);
    for (const f of found) {
      if (f && f.r) { roamKeys.add(norm(f.n)); continue; }
      const nm = typeof f === "string" ? f : f.n, k = norm(nm), set = byName.get(k) || new Set();
      const t = typeof f === "string" || !f.t ? TIMES : f.t.split(" ");
      t.forEach(v => set.add(v)); byName.set(k, set);
      if (own[nm] || own[placeKey(nm)]) continue;
      for (let p = parentIn(id, nm), hops = 0; p && hops < 4; p = parentIn(id, p), hops++) {
        const pk = norm(p), ps = byName.get(pk) || new Set();
        t.forEach(v => ps.add(v)); byName.set(pk, ps);
        if (nm === placeKey(nm)) { const l = via.get(pk) || new Set(); l.add(nm); via.set(pk, l); }
      }
    }
    const merged = new Map();
    for (const [p, all] of Object.entries(tableOf(id))) {
      if (p === HONEY_ALL) continue;
      if (!all.some(b => inBox(b, x, y))) continue;
      const sig = JSON.stringify([...all].sort()), k = norm(p);
      if (!merged.has(sig)) merged.set(sig, { names: [], boxes: all, here: false, times: new Set(), via: new Set() });
      const g = merged.get(sig);
      g.names.push(p);
      if (roamKeys.has(k)) g.roam = true;
      if (byName.has(k)) { g.here = true; byName.get(k).forEach(t => g.times.add(t)); }
      if (via.has(k)) via.get(k).forEach(x => g.via.add(x));
    }
    const items = [...merged.values()].map(g => ({
      name: g.names.find(s => s.startsWith(HONEY_PREFIX) && byName.has(norm(s)))
        || label(g.names.filter(s => !s.startsWith(HONEY_PREFIX))) || g.names[0],
      here: g.here, roam: !!g.roam, times: new Set(g.times), boxes: g.boxes.slice(), via: new Set(g.via),
      inside: g.names.map(n => parentIn(id, n)).find(Boolean) || "",
      count: 1,
    }));
    const out = [];
    for (const it of items) {
      const o = out.find(x => { const c = commonWords(x.name, it.name); return c >= 3 || (c >= 1 && (c === wordsOf(x.name).length || c === wordsOf(it.name).length)); });
      if (!o) { out.push(it); continue; }
      o.name = wordsOf(o.name).slice(0, commonWords(o.name, it.name)).join(" ");
      o.here = o.here || it.here; o.roam = o.roam || it.roam; o.count++;
      it.times.forEach(t => o.times.add(t)); it.via.forEach(v => o.via.add(v));
      o.boxes.push(...it.boxes.filter(b => !o.boxes.some(x => JSON.stringify(x) === JSON.stringify(b))));
      o.inside = o.inside || it.inside;
    }
    return out.map(o => ({
      name: o.name, here: o.here, roam: o.roam && !o.here,
      when: o.here && m.times ? timeText(o.times) : "", boxes: o.boxes, inside: o.inside, via: [...o.via], count: o.count,
    })).sort((x, y) => (y.here ? 1 : 0) - (x.here ? 1 : 0));
  }

  function locate(keys, area) {
    if (!data) return [];
    const out = [], seen = new Set();
    for (const key of keys) for (const id of data.games[key] || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const m = data.maps[id];
      if (!m || !m.w || !m.h) continue;
      const t = tableOf(id), b = boxesFor(id, t, area);
      if (b && b.length) out.push({ id, boxes: b, w: m.w, h: m.h });
    }
    return out;
  }

  const VR_NUM = { gold: 1, silver: 1, crystal: 1, "heart-gold": 1, "soul-silver": 1, red: 2, blue: 2, yellow: 2, "fire-red": 2, "leaf-green": 2 };
  function fixLoc(d) {
    if (!d || !d.loc) return d;
    for (const [g, num] of Object.entries(VR_NUM)) {
      const byMon = d.loc[g]; if (!byMon) continue;
      const re = new RegExp("^(Kanto Victory Road) " + num + "(?=\\s|$)");
      for (const rows of Object.values(byMon)) for (const r of rows) if (typeof r[0] === "string") r[0] = r[0].replace(re, "$1");
    }
    return d;
  }

  return { init, addHoney, fixLoc, html, placeKey, parentOf, label, segment, exact, kindOf, at, drop, locate, bbox, isShape, verts, inBox, move, outline, pin, honeyPrefix: HONEY_PREFIX, honeyIcon: HONEYICON, honeyAll: HONEY_ALL };
})();