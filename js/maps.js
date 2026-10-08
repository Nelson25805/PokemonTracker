"use strict";
// Maps: the region map shown in the "Where to find" panel, with the Pokémon's locations marked on it
// (like the Pokédex "Area" screen in the games). Pure: no DOM access except one <style> tag added on init,
// otherwise it only builds an HTML string.
//
//   Maps.init(data)              once, with data/maps.json (null if it isn't installed: no maps are shown)
//   Maps.html(gameKeys, entries) HTML for every map that has at least one marked location
//                                entries = the [area, method, ...] rows from data/locations.json
//                                With NO entries (Mew, evolution-only, event Pokémon) it shows the first map with an
//                                "AREA UNKNOWN" banner instead, like the in-game Pokédex.
//   Maps.placeKey(area)          "Kanto Route 2 South towards Viridian City" -> "Kanto Route 2"
//   Maps.at(mapId, fx, fy, found) the places under a point; where.js shows them in the hover tooltip
//
// Two marker styles:
//   * map has "icon" (Red/Blue/Yellow): the game's blinking sprite on EVERY tile of every location.
//   * map has "icon" AND "single": true (Gold/Silver/Crystal): the game's sprite ONCE per location, on the middle tile of its
//     biggest box. (With no "icon" at all, a built-in bug drawing is used instead.)
//     Hovering any tile of a location (see where.js) outlines the whole location and names it; if the Pokémon lives there
//     and the map has "times": true, the tooltip also says when (Morning / Day / Night, or All day).
//     maps.json "mark" = icon size in image pixels (default: the map's grid size).
//   Title: maps.json "title" { text, x, y, size } writes "{NAME}'S NEST" over the image (Red/Blue/Yellow, whose art has an empty
//   top row). With "bar": true it is drawn in a light header strip ABOVE the map instead (Gold/Silver/Crystal), like the games.
//
// Time of day: the last column of each entry row holds conditions such as "Morning" or "Night" (rows without one count as
// all day). Maps with at least one location that is only there at some times get All / Morning / Day / Night buttons
// that hide the icons that don't apply.
//
// data/maps.json (made with map-editor.html):
//   { "version": 1,
//     "maps":  { "<mapId>": { "name": "Kanto", "img": "assets/maps/kanto-rby.png", "w": 160, "h": 144, "grid": 8,
//                             "icon": "assets/maps/nest-rby.png",                       optional: see above
//                             "single": true, "mark": 8, "times": true,                 optional: one icon per location; icon size; show times in the tooltip
//                             "unknown": { "img": "...", "x": 8, "y": 56, "w": 136, "h": 32 } } },   optional: the AREA UNKNOWN banner art
//     "games": { "<game key>": ["<mapId>", ...] },                   a game can have several maps
//     "areas": { "<mapId>": { "<place>": [[x, y, w, h], ...] } } }   boxes in image pixels
// A place is the location name without floors, compass words or "towards ...", so "Mt. Moon 1F" and "Mt. Moon 2F"
// share one entry. An exact area name in "areas" wins over its place name. Places with identical boxes (spelling aliases)
// count as one location.
const Maps = (() => {
  let data = null;
  const FLOOR = /^b?\d+f$/i;
  const WORDS = new Set(["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
    "ne", "nw", "se", "sw", "area", "entrance", "exterior", "outside"]);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TIMES = ["morning", "day", "night"];
  const TCOL = { morning: "#ffd23f", day: "#ff8a1f", night: "#3b4cc0" };
  const TLABEL = { morning: "Morning", day: "Day", night: "Night" };
  const timeText = set => (set.size >= TIMES.length ? "All day" : TIMES.filter(t => set.has(t)).map(t => TLABEL[t]).join(" / "));

  // The built-in bug marker: 8x8 pixels, drawn as an SVG so no image file is needed.
  const BUG = (() => {
    const rows = [".#....#.", "..#..#..", "...##...", ".######.", "#.####.#", "#.####.#", "..#..#..", ".#....#."];
    let r = "";
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
    return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges" fill="#d01818">${r}</svg>`);
  })();

  const CSS = `
.amap .one,.amap .bug{background-repeat:no-repeat;background-size:100% 100%}
.amap .bug{filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff)}
.amap .amapwrap{container-type:inline-size}
.amap .amapbar{text-align:center;white-space:nowrap;overflow:hidden;line-height:1;font-family:"PKMN",monospace;color:#181010;background:#f8f8f8;border:2px solid var(--line);border-bottom:0;padding:1.4cqw 0}
.amap[data-time=morning] i:not([data-t~=morning]),.amap[data-time=day] i:not([data-t~=day]),.amap[data-time=night] i:not([data-t~=night]){display:none}
.amap .tfilter{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px;font-size:12px}
.amap .tfilter button{padding:2px 8px;font-size:12px;display:inline-flex;align-items:center;gap:4px}
.amap .tfilter button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.amap .tfilter .sw{display:inline-block;width:10px;height:10px;border:1px solid #000}
.amap .tnote{flex:1 1 100%;opacity:.85}`;

  function placeKey(area) {
    const w = String(area).split(/\s+towards\s+/i)[0].trim().split(/\s+/);
    while (w.length > 1 && (FLOOR.test(w[w.length - 1]) || WORDS.has(w[w.length - 1].toLowerCase()))) w.pop();
    return w.join(" ");
  }

  function init(d) {
    data = d && typeof d === "object" && d.maps && d.games ? d : null;
    if (typeof document !== "undefined" && !document.getElementById("maps-time-css")) {   // styles for the bug icon and time buttons
      const s = document.createElement("style"); s.id = "maps-time-css"; s.textContent = CSS; document.head.append(s);
    }
  }

  // Which times of day does one entry row apply to? A row with no time condition applies to all three.
  function rowTimes(cond) {
    const c = String(cond || "").toLowerCase(), t = TIMES.filter(x => c.includes(x));
    return t.length ? t : TIMES;
  }

  function html(keys, entries, name = "") {
    if (!data) return "";
    const areas = [...new Set(entries.map(e => e[0]))], done = new Set(), out = [], none = !areas.length;
    // times per area name: the union over all of that area's rows
    const areaTimes = new Map();
    for (const e of entries) {
      const set = areaTimes.get(e[0]) || new Set();
      for (const t of rowTimes(e[5])) set.add(t);
      areaTimes.set(e[0], set);
    }
    // for the hover tooltip: every area name (and its place name) with its times, e.g. { n: "Johto Route 36", t: "day night" }
    const found = areas.flatMap(a => { const t = TIMES.filter(x => areaTimes.get(a).has(x)).join(" "); return [{ n: a, t }, { n: placeKey(a), t }]; });
    const pc = v => (v * 100).toFixed(3) + "%";
    // The in-game "PIKACHU's NEST" heading, if the map defines one (maps.json "title"): { text, x, y, size } in image pixels.
    // {NAME} = upper case name, {name} = as written.
    const title = m => {
      const t = m.title;
      if (!t || !t.text || !name || t.bar) return "";
      const txt = String(t.text).replace("{NAME}", name.toUpperCase()).replace("{name}", name);
      return `<div class="amaptitle" style="left:${pc((t.x || 0) / m.w)};top:${pc((t.y || 0) / m.h)};font-size:${((t.size || 8) / m.w * 100).toFixed(3)}cqw">${esc(txt)}</div>`;
    };
    // The "HOOTHOOT'S NEST" strip above the map (maps.json title.bar). Outside .amapimg, so hover positions stay exact.
    const bar = m => {
      const t = m.title;
      if (!t || !t.text || !name || !t.bar) return "";
      const txt = String(t.text).replace("{NAME}", name.toUpperCase()).replace("{name}", name);
      return `<div class="amapbar" style="font-size:${((t.size || 8) / m.w * 100).toFixed(3)}cqw">${esc(txt)}</div>`;
    };
    const wrap = (m, id, inner, cap, f = [], extra = "") =>
      `<figure class="amap" data-map="${esc(id)}" data-w="${m.w}" data-h="${m.h}" data-time="all" data-found="${esc(JSON.stringify(f))}"><div class="amapwrap">${bar(m)}<div class="amapimg"><img alt="${esc(m.name)} map" src="${esc(m.img)}" ` +
      `onerror="this.closest('figure').remove()">${inner}<div class="amaphl"></div>${title(m)}<div class="amaptip" hidden></div></div></div><figcaption>${cap}</figcaption>${extra}</figure>`;
    // All / Morning / Day / Night buttons (inline handler: this file never touches the DOM after init).
    const filter = () =>
      `<div class="tfilter" role="group" aria-label="Time of day">` +
      [["all", "All times", ""], ...TIMES.map(t => [t, TLABEL[t], TCOL[t]])].map(([t, label, col]) =>
        `<button type="button" class="tbtn" data-t="${t}" aria-pressed="${t === "all"}" ` +
        `onclick="var f=this.closest('figure');f.dataset.time=this.dataset.t;f.querySelectorAll('.tbtn').forEach(function(b){b.setAttribute('aria-pressed',b===this)},this)">` +
        `${col ? `<span class="sw" style="background:${col}"></span>` : ""}${label}</button>`).join("") +
      `<span class="tnote">Hover a location to see when the Pokémon is there. The buttons show only the locations that apply at one time of day.</span></div>`;

    for (const key of keys) for (const id of data.games[key] || []) {
      if (done.has(id)) continue;
      done.add(id);
      const m = data.maps[id];
      if (!m || !m.w || !m.h) continue;                                 // not set up yet
      if (none) {                                                       // nowhere to show: the in-game "AREA UNKNOWN" box
        const u = m.unknown, banner = u && u.img
          ? `<img class="unk" alt="Area unknown" src="${esc(u.img)}" style="left:${pc(u.x / m.w)};top:${pc(u.y / m.h)};width:${pc(u.w / m.w)}">`
          : `<div class="unk txt">AREA UNKNOWN</div>`;
        return wrap(m, id, banner, `${esc(m.name)}: area unknown`);       // only the first map; one banner is enough
      }
      const table = (data.areas || {})[id] || {};

      if (m.icon && !m.single) {                                        // style 1: the game's sprite on every tile
        const seen = new Set(), places = new Set();
        for (const a of areas) {
          const boxes = table[a] || table[placeKey(a)];
          if (!boxes || !boxes.length) continue;
          places.add(placeKey(a));
          for (const b of boxes) seen.add(JSON.stringify(b));
        }
        if (!seen.size) continue;                                       // nothing of this Pokémon on this map
        const g = m.grid || 8;
        const marks = [...seen].map(s => JSON.parse(s)).map(([x, y, w, h]) => {
          const pos = `left:${pc(x / m.w)};top:${pc(y / m.h)};width:${pc(w / m.w)};height:${pc(h / m.h)}`;
          return `<i class="nest" style="${pos};background-image:url(${esc(m.icon)});background-size:${pc(g / w)} ${pc(g / h)}"></i>`;
        }).join("");
        out.push(wrap(m, id, marks, `${esc(m.name)}: ${places.size} location${places.size === 1 ? "" : "s"} marked`, found));
        continue;
      }

      // style 2: one icon per location (the game's sprite if the map has "icon", else the built-in bug). Places with
      // identical boxes (aliases) are one location.
      const sprite = m.icon ? esc(m.icon) : BUG;
      const groups = new Map();
      for (const a of areas) {
        const boxes = table[a] || table[placeKey(a)];
        if (!boxes || !boxes.length) continue;
        const sig = JSON.stringify([...boxes].sort()), gr = groups.get(sig) || { boxes, times: new Set() };
        for (const t of areaTimes.get(a)) gr.times.add(t);
        groups.set(sig, gr);
      }
      if (!groups.size) continue;
      const ms = m.mark || m.grid || 8;
      let timed = false;
      const marks = [...groups.values()].map(gr => {
        const part = gr.times.size < TIMES.length; timed = timed || part;
        const big = gr.boxes.reduce((p, b) => (b[2] * b[3] > p[2] * p[3] ? b : p));      // biggest box of the location
        const cw = Math.min(ms, big[2]), ch = Math.min(ms, big[3]);
        const cols = Math.max(1, Math.floor(big[2] / cw)), rows = Math.max(1, Math.floor(big[3] / ch));
        const x = big[0] + Math.floor((cols - 1) / 2) * cw, y = big[1] + Math.floor((rows - 1) / 2) * ch;   // middle tile
        const pos = `left:${pc(x / m.w)};top:${pc(y / m.h)};width:${pc(cw / m.w)};height:${pc(ch / m.h)}`;
        return `<i class="nest ${m.icon ? "one" : "bug"}" data-t="${TIMES.filter(t => gr.times.has(t)).join(" ")}" style="${pos};background-image:url(${sprite})"></i>`;
      }).join("");
      out.push(wrap(m, id, marks, `${esc(m.name)}: ${groups.size} location${groups.size === 1 ? "" : "s"} marked`, found, timed ? filter() : ""));
    }
    return out.join("");
  }

  // "Pokémon Tower" / "Pokemon Tower", "Diglett's Cave" / "Diglett S Cave" and "Kanto Victory Road" / "Victory Road"
  // are separate keys in maps.json that mean the same place, so compare them in a normalised form.
  const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/^kanto/, "").replace(/[^a-z0-9]/g, "");

  // Which locations cover the point (fx, fy) (0..1 across the map image)? -> [{ name, here, when, boxes }]
  // `found` = what Maps.html put in data-found: { n: area name, t: "day night" } (plain strings count as all day).
  // `here` = the Pokémon is found there; `when` = "Morning / Night" or "All day" (only when the map has "times": true).
  // `boxes` = every tile of the location, so the caller can outline all of it. Aliases with the same boxes are merged.
  function at(id, fx, fy, found = []) {
    const m = data && data.maps[id];
    if (!m || !m.w || !m.h) return [];
    const x = fx * m.w, y = fy * m.h, byName = new Map();
    for (const f of found) {
      const k = norm(typeof f === "string" ? f : f.n), set = byName.get(k) || new Set();
      const t = typeof f === "string" || !f.t ? TIMES : f.t.split(" ");
      t.forEach(v => set.add(v)); byName.set(k, set);
    }
    const merged = new Map();                                            // box signature -> one location
    for (const [p, all] of Object.entries((data.areas || {})[id] || {})) {
      if (!all.some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh)) continue;
      const sig = JSON.stringify([...all].sort()), k = norm(p);
      if (!merged.has(sig)) merged.set(sig, { names: [], boxes: all, here: false, times: new Set() });
      const g = merged.get(sig);
      g.names.push(p);
      if (byName.has(k)) { g.here = true; byName.get(k).forEach(t => g.times.add(t)); }
    }
    return [...merged.values()].map(g => ({
      name: g.names.find(s => /['é]/.test(s)) || g.names[0],        // prefer the spelling with the apostrophe / é
      here: g.here,
      when: g.here && m.times ? timeText(g.times) : "",
      boxes: g.boxes,
    }));
  }

  return { init, html, placeKey, at };
})();