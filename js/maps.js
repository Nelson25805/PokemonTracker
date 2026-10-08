"use strict";
// Maps: the region map shown in the "Where to find" panel, with the Pokémon's locations marked on it
// (like the Pokédex "Area" screen in the games). Pure: no DOM access, it only builds an HTML string.
//
//   Maps.init(data)              once, with data/maps.json (null if it isn't installed: no maps are shown)
//   Maps.html(gameKeys, entries) HTML for every map that has at least one marked location
//                                entries = the [area, method, ...] rows from data/locations.json
//                                With NO entries (Mew, evolution-only, event Pokémon) it shows the first map with an
//                                "AREA UNKNOWN" banner instead, like the in-game Pokédex.
//   Maps.placeKey(area)          "Kanto Route 2 South towards Viridian City" -> "Kanto Route 2"
//
// data/maps.json (made with map-editor.html):
//   { "version": 1,
//     "maps":  { "<mapId>": { "name": "Kanto", "img": "assets/maps/kanto-rby.png", "w": 160, "h": 144, "grid": 8,
//                             "icon": "assets/maps/nest-rby.png",                       optional: blinking marker sprite, one per grid tile
//                                                                                       (without it a blinking red box is used)
//                             "unknown": { "img": "...", "x": 8, "y": 56, "w": 136, "h": 32 } } },   optional: the AREA UNKNOWN banner art
//     "games": { "<game key>": ["<mapId>", ...] },                   a game can have several maps (Johto + Kanto)
//     "areas": { "<mapId>": { "<place>": [[x, y, w, h], ...] } } }   boxes in image pixels
// A place is the location name without floors, compass words or "towards ...", so "Mt. Moon 1F" and "Mt. Moon 2F"
// share one entry. An exact area name in "areas" wins over its place name.
const Maps = (() => {
  let data = null;
  const FLOOR = /^b?\d+f$/i;
  const WORDS = new Set(["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
    "ne", "nw", "se", "sw", "area", "entrance", "exterior", "outside"]);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function placeKey(area) {
    const w = String(area).split(/\s+towards\s+/i)[0].trim().split(/\s+/);
    while (w.length > 1 && (FLOOR.test(w[w.length - 1]) || WORDS.has(w[w.length - 1].toLowerCase()))) w.pop();
    return w.join(" ");
  }

  function init(d) { data = d && typeof d === "object" && d.maps && d.games ? d : null; }

  function html(keys, entries, name = "") {
    if (!data) return "";
    const areas = [...new Set(entries.map(e => e[0]))], done = new Set(), out = [], none = !areas.length;
    const pc = v => (v * 100).toFixed(3) + "%";
    // The in-game "PIKACHU's NEST" heading, if the map defines one (maps.json "title"): { text, x, y, size } in image pixels.
    // {NAME} = upper case name, {name} = as written.
    const title = m => {
      const t = m.title;
      if (!t || !t.text || !name) return "";
      const txt = String(t.text).replace("{NAME}", name.toUpperCase()).replace("{name}", name);
      return `<div class="amaptitle" style="left:${pc((t.x || 0) / m.w)};top:${pc((t.y || 0) / m.h)};font-size:${((t.size || 8) / m.w * 100).toFixed(3)}cqw">${esc(txt)}</div>`;
    };
    const wrap = (m, id, inner, cap, found = []) =>
      `<figure class="amap" data-map="${esc(id)}" data-w="${m.w}" data-h="${m.h}" data-found="${esc(JSON.stringify(found))}"><div class="amapimg"><img alt="${esc(m.name)} map" src="${esc(m.img)}" ` +
      `onerror="this.closest('figure').remove()">${inner}<div class="amaphl"></div>${title(m)}<div class="amaptip" hidden></div></div><figcaption>${cap}</figcaption></figure>`;
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
      const table = (data.areas || {})[id] || {}, seen = new Set(), places = new Set();
      for (const a of areas) {
        const boxes = table[a] || table[placeKey(a)];
        if (!boxes || !boxes.length) continue;
        places.add(placeKey(a));
        for (const b of boxes) seen.add(JSON.stringify(b));
      }
      if (!seen.size) continue;                                         // nothing of this Pokémon on this map
      const g = m.grid || 8;
      const marks = [...seen].map(s => JSON.parse(s)).map(([x, y, w, h]) => {
        const pos = `left:${pc(x / m.w)};top:${pc(y / m.h)};width:${pc(w / m.w)};height:${pc(h / m.h)}`;
        return m.icon   // the game's blinking sprite, one per tile of the box
          ? `<i class="nest" style="${pos};background-image:url(${esc(m.icon)});background-size:${pc(g / w)} ${pc(g / h)}"></i>`
          : `<i class="mk" style="${pos}"></i>`;
      }).join("");
      out.push(wrap(m, id, marks, `${esc(m.name)}: ${places.size} location${places.size === 1 ? "" : "s"} marked`,
        areas.flatMap(a => [a, placeKey(a)])));
    }
    return out.join("");
  }

  // "Pokémon Tower" / "Pokemon Tower", "Diglett's Cave" / "Diglett S Cave" and "Kanto Victory Road" / "Victory Road"
  // are separate keys in maps.json that mean the same place, so compare them in a normalised form.
  const norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/^kanto/, "").replace(/[^a-z0-9]/g, "");

  // Which places cover the point (fx, fy) (0..1 across the map image)? -> [{ name, here }]
  // `found` = area names this Pokémon is found in; `here` marks those.
  function at(id, fx, fy, found = []) {
    const m = data && data.maps[id];
    if (!m || !m.w || !m.h) return [];
    const x = fx * m.w, y = fy * m.h, groups = new Map(), mine = new Set(found.map(norm));
    for (const [p, all] of Object.entries((data.areas || {})[id] || {})) {
      if (!all.some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh)) continue;
      const k = norm(p);
      if (!groups.has(k)) groups.set(k, { names: [], boxes: new Map() });
      const g = groups.get(k);
      g.names.push(p);
      for (const b of all) g.boxes.set(JSON.stringify(b), b);       // every tile of the place, aliases merged
    }
    return [...groups].map(([k, { names, boxes }]) => ({
      name: names.find(s => /['\u00e9]/.test(s)) || names[0],   // prefer the spelling with the apostrophe / é
      here: mine.has(k),
      boxes: [...boxes.values()],
    }));
  }

  return { init, html, placeKey, at };
})();