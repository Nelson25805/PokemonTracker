"use strict";
// Maps: the region map shown in the "Where to find" panel, with the Pokémon's locations marked on it
// (like the Pokédex "Area" screen in the games). Pure: no DOM access except one <style> tag added on init,
// otherwise it only builds an HTML string.
//
//   Maps.init(data)              once, with data/maps.json (null if it isn't installed: no maps are shown)
//   Maps.addHoney(honey)         once, with data/honey.json (optional): registers every honey tree as a place on the map (see "Honey trees")
//   Maps.html(gameKeys, entries) HTML for every map that has at least one marked location
//                                entries = the [area, method, ...] rows from data/locations.json
//                                With NO entries (Mew, evolution-only, event Pokémon) it shows the first map with an
//                                "AREA UNKNOWN" banner instead, like the in-game Pokédex.
//   Maps.placeKey(area)          "Kanto Route 2 South towards Viridian City" -> "Kanto Route 2"
//   Maps.at(mapId, fx, fy, found) the places under a point ({name, here, roam, when, boxes}); where.js shows them in the hover tooltip
//   Maps.locate(keys, area)      the maps of those games that have boxes for a location -> [{ id, boxes, w, h }] (for the "Show on map" buttons)
//   Maps.drop(img)               called by a map picture that fails to load: removes that map (and its tab)
//
// Several maps for one game (FireRed / LeafGreen: Kanto + three Sevii Islands maps; HeartGold / SoulSilver: Johto + Kanto):
// when a Pokémon is marked on two or more DIFFERENT maps, they are shown with a row of tabs (map name + how many locations
// are marked on it) and one map at a time. A Pokémon that is only on one map gets just that map, with no tabs.
// Give every map of a game its own "name" in maps.json: it is the tab label.
//
// Two marker styles:
//   * map has "icon" (Red/Blue/Yellow): the game's blinking sprite on EVERY tile of every location.
//   * map has "icon" AND "single": true (Gold/Silver/Crystal): the game's sprite ONCE per location, on the middle tile of its
//     biggest box. (With no "icon" at all, a built-in bug drawing is used instead.)
//     Hovering any tile of a location (see where.js) outlines the whole location and names it; if the Pokémon lives there
//     and the map has "times": true, the tooltip also says when (Morning / Day / Night, or All day).
//     maps.json "mark" = icon size in image pixels (default: the map's grid size).
//   Title: maps.json "title" { text, x, y, size } writes "{NAME}'S NEST" over the image (Red/Blue/Yellow, whose art has an empty
//   top row). With "bar": true it is drawn like the Gold/Silver/Crystal Pokédex screen instead: pale text on a black strip above
//   the map, in the game's thin pixel font (drawn as SVG, so it is crisp at any size).
//   "frame": true adds the games' grey bevelled border around the map. "labels": [{ text, side: "left"|"right" }] puts
//   region name plates ("JOHTO", "KANTO") in the bottom corners, in the games' bold pixel font.
//
// Flashing area map (Hoenn, FireRed / LeafGreen and Sinnoh, maps.json "flash": true): the Gen 3 Pokédex "Area" screen. Instead of an icon,
// every box of a location FLASHES (see the .fl rules in style.css). Locations are split in two kinds by name (Maps.kindOf):
//   land    routes, towns, cities and villages   (name contains Route / Town / City / Village; plus the Sevii "One Island" ...
//           "Seven Island" towns, Cinnabar Island, Indigo Plateau and Three Isle Port; and every honey tree)
//   special everything else: caves, woods, towers, buildings, islands...
// Ruby / Sapphire: routes and towns flash red; then they stop and the special locations flash red twice; repeat.
// Emerald:         routes and towns flash yellowish -> orange -> red; the special locations then flash a whitish red twice; repeat.
// Fire Red / Leaf Green use the Ruby / Sapphire look.
// The same map image serves all three Hoenn games (the figure gets data-flash="rs" or "emerald"; a group that contains both
// kinds of game shows one map for each). If the Pokémon is only on one kind, that kind just flashes on its own.
//
// Honey trees (Diamond / Pearl / Platinum, data/honey.json): the trees have no boxes of their own in maps.json, so Maps.addHoney()
// builds them at start-up from honey.json: each tree "Honey Tree: <name>" gets the boxes of the route / place it stands on (or its own
// "boxes"), and one extra place "Honey Trees" holds the boxes of all of them. A Pokémon with a honey tree row (area "Honey Trees")
// therefore flashes every route that has a tree, like any other route, and hovering a flashing route says
// "Honey Tree: Route 205 · found here". The "Show on map" button of an individual tree outlines just that tree's route.
//
// Roaming Pokémon (Gen 2 onwards: Raikou / Entei / Suicune, Latios / Latias, Mesprit / Cresselia ...): they have no fixed spot, so
// their rows ("Roaming Johto", method roaming-grass / roaming-water) have no boxes of their own. Instead every ROUTE of the region
// they roam is shaded on the map (a slow bluish pulse, any map style) with a one-line legend underneath, and hovering a route says
// "could be roaming here". The region comes from the row's name ("Roaming Johto" -> routes starting "Johto "). Sevii Islands and
// other maps with no routes show nothing. Only data/maps.json "areas" is used, so no new data files are needed.
//
// Sinnoh (Diamond / Pearl / Platinum) uses the same flashing style as Ruby / Sapphire and has a clock: see "Time of day" below.
//
// Time of day: the last column of each entry row holds conditions such as "Morning" or "Night" (rows without one count as
// all day). Maps with at least one location that is only there at some times get All / Morning / Day / Night buttons
// that hide the icons that don't apply. On EVERY map that has them (Gold / Silver / Crystal, Sinnoh, any later game) the map picture is also tinted: warm for Morning, darker
// and bluer for Night, untouched for Day. Put "times": true on the map in maps.json so the hover tooltip says when, too.
//
// data/maps.json (made with map-editor.html, or tools/add_areas.py):
//   { "version": 1,
//     "maps":  { "<mapId>": { "name": "Kanto", "img": "assets/maps/kanto-rby.png", "w": 160, "h": 144, "grid": 8,
//                             "icon": "assets/maps/nest-rby.png",                       optional: see above
//                             "single": true, "mark": 8, "times": true,                 optional: one icon per location; icon size; show times in the tooltip
//                             "title": {...}, "frame": true, "labels": [...],           optional: see above
//                             "unknown": { "img": "...", "x": 8, "y": 56, "w": 136, "h": 32 } } },   optional: the AREA UNKNOWN banner art
//     "games": { "<game key>": ["<mapId>", ...] },                   a game can have several maps
//     "areas": { "<mapId>": { "<place>": [[x, y, w, h], ...] } } }   boxes in image pixels
// Two games with the same places but a different look (Red / Blue and Yellow use different colours): give the second one its own
// map (own picture, own "unknown" banner) with "areasOf": "<the map whose boxes it uses>", so the boxes are kept in one place only.
// "variant" ("Yellow", "Red / Blue") then names each picture in its caption when one list shows both.
// A place is the location name without floors, compass words or "towards ...", so "Mt. Moon 1F" and "Mt. Moon 2F"
// share one entry. An exact area name in "areas" wins over its place name. Places with identical boxes (spelling aliases)
// count as one location.
const Maps = (() => {
  let data = null;
  const FLOOR = /^b?\d+[fr]$/i;       // floors (1F, B2F) and rooms (1R, as in Meteor Falls 1F 1R)
  const WORDS = new Set(["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
    "ne", "nw", "se", "sw", "area", "entrance", "exterior", "outside"]);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // A map's boxes: its own, or those of the map it shares them with (maps.json "areasOf"). famOf = the id those boxes are filed under.
  const famOf = id => { const m = data && data.maps[id]; return (m && m.areasOf) || id; };
  const tableOf = id => ((data && data.areas) || {})[famOf(id)] || {};

  // ---- honey trees (data/honey.json, see the header comment) ----
  const HONEY_PREFIX = "Honey Tree: ";      // one place per tree: "Honey Tree: Route 205"
  const HONEY_ALL = "Honey Trees";          // one place holding every tree: the row a Pokémon's honey tree encounters use
  let honeyNames = [];                       // the "Honey Tree: ..." places that were registered

  function addHoney(h) {
    honeyNames = [];
    if (!data || !h || !Array.isArray(h.spots) || !h.map || !data.maps[h.map]) return;
    data.areas = data.areas || {};
    const fam = famOf(h.map), table = (data.areas[fam] = data.areas[fam] || {});
    const all = [], seen = new Set();
    for (const s of h.spots) {
      const src = Array.isArray(s.boxes) && s.boxes.length ? s.boxes : (table[s.area] || table[placeKey(s.area || "")]);
      if (!src || !src.length) continue;                               // a tree whose place isn't drawn on the map is skipped
      const name = HONEY_PREFIX + s.name, boxes = src.map(b => b.slice());
      table[name] = boxes;
      honeyNames.push(name);
      for (const b of boxes) { const sig = JSON.stringify(b); if (!seen.has(sig)) { seen.add(sig); all.push(b.slice()); } }
    }
    if (all.length) table[HONEY_ALL] = all;
  }

  // ---- shapes ----
  // A "box" in maps.json is [x, y, w, h] (a rectangle, as always) or a shape:
  //   ["e", x, y, w, h]                a circle / oval drawn inside that box
  //   ["p", x1, y1, x2, y2, x3, y3...] a polygon: triangles, diagonal strips for routes, any outline (in image pixels)
  // Every helper below accepts either kind. Rectangles behave exactly as before.
  const P = v => (v * 100).toFixed(3) + "%";
  const isShape = b => typeof b[0] === "string";
  const verts = b => {                                                  // corner points: [[x, y], ...]
    if (!isShape(b)) { const [x, y, w, h] = b; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
    if (b[0] === "e") { const [, x, y, w, h] = b; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
    const out = []; for (let i = 1; i + 1 < b.length; i += 2) out.push([b[i], b[i + 1]]); return out;
  };
  const bbox = b => {                                                   // the rectangle around a box / shape
    if (!isShape(b)) return b;
    if (b[0] === "e") return b.slice(1, 5);
    const v = verts(b), xs = v.map(p => p[0]), ys = v.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
    return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
  };
  const area = b => { const r = bbox(b); return r[2] * r[3]; };
  function inBox(b, x, y, pad = 0) {                                    // is the point inside the box / shape?
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
  // CSS for an element that covers a box / shape: its bounding rectangle, clipped to the shape.
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
  // Outlines (hover and "Show on map"): rectangles stay <i> tags, shapes become one SVG (a white line under a coloured one).
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

  // Unova (Black / White) flashing, maps.json "fx": "unova": measured from a screen recording of the game's Pokédex Area screen.
  // Routes and bridges: a red strip fades in over the orange line (thicker than the line, like the game). Towns and cities: the
  // orange ring fades to red. Caves, buildings and other places (the green dots): a pink-red disc a little bigger than the dot
  // fades in. All of them use the same ~1.07 s pulse (see .amap[data-fx=unova] in style.css). Each marker follows its own shape:
  // a circle for a circle, a strip for a diagonal route, never a square. Returns one SVG (drawn in image pixels).
  function uxMarks(sets, m) {
    const f = v => +v.toFixed(2);
    let out = "";
    for (const k of ["land", "special"]) for (const { b } of sets[k]) {
      const [x, y, w, h] = bbox(b), cx = x + w / 2, cy = y + h / 2;
      const circle = isShape(b) ? b[0] === "e" : true;                    // a plain box that is nearly square is a circle location too
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
  // In-game clock ranges for each period, shown on the Morning / Day / Night buttons. Keyed by map id; a map in maps.json can
  // override with its own "clock": { "morning": "...", "day": "...", "night": "..." }. Gen 2 and HeartGold / SoulSilver share
  // the same hours; Diamond / Pearl / Platinum (map "sinnoh-dp") have a longer day.
  const CLOCK_GS = { morning: "4:00–9:59 AM", day: "10:00 AM–5:59 PM", night: "6:00 PM–3:59 AM" };
  const CLOCKS = {
    "johto-kanto-gsc": CLOCK_GS,
    "johto-kanto-hgss": CLOCK_GS,
    "sinnoh-dp": { morning: "4:00–9:59 AM", day: "10:00 AM–7:59 PM", night: "8:00 PM–3:59 AM" },
  };
  const clockOf = (id, m) => (m && m.clock) || CLOCKS[id] || null;
  const timeText = set => (set.size >= TIMES.length ? "All day" : TIMES.filter(t => set.has(t)).map(t => TLABEL[t]).join(" / "));

  // The built-in bug marker: 8x8 pixels, drawn as an SVG so no image file is needed.
  const BUG = (() => {
    const rows = [".#....#.", "..#..#..", "...##...", ".######.", "#.####.#", "#.####.#", "..#..#..", ".#....#."];
    let r = "";
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
    return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges" fill="#d01818">${r}</svg>`);
  })();


  // ---- honey tree icon (Diamond / Pearl / Platinum) ----
  // A 9x9 pixel replica of the golden honey tree from the games, drawn as an SVG so no image file is needed.
  // Drawn one pixel larger than the tree's 7x7 box on every side, so it reads clearly on the map.
  const HONEYICON = (() => {
    const pal = { D: "#3b2506", M: "#e08a10", L: "#ffd23a", T: "#5a3416" };   // dark outline + bright amber: stands out from the map's olive / orange
    const rows = ["..DDDDD..", ".DLLLLMD.", "DLLLLMMMD", "DLLLMMMMD", "DLLMMMMMD", "DMMMMMMDD", ".DMMMMDD.", "..DTTTD..", "..TT.TT.."];
    let r = "";
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (pal[c]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[c]}"/>`; }));
    return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges">${r}</svg>`);
  })();
  // One icon per honey tree on this map's table. They carry data-t for all three times so the Morning / Day / Night buttons never hide them.
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

  // ---- the games' pixel fonts, drawn as SVG paths (crisp at any size, no font file needed) ----
  // THIN: the Pokédex title font. 7x7 glyphs on an 8px pitch (copied from the Gold/Silver/Crystal "NEST" screen).
  // BOLD: the region-name font. 6 rows tall; each glyph is as wide as its rows, plus 1px gap (T has none).
  // A character that isn't in a table is skipped. Add glyphs here if a Pokémon name needs one.
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
  // rows of "#"/"." -> one SVG path of 1x1 pixel runs, drawn with its top-left at (x, y)
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
  const boldText = (txt, x, y) => {                                     // -> [path, width of the text without its last gap]
    let d = "", end = x;
    for (const ch of String(txt).toUpperCase()) {
      const g = BOLD[ch]; if (!g) { x += 4; end = x; continue; }
      d += runs(g, x, y); end = x + g[0].length; x = end + (ch === "T" ? 0 : 1);
    }
    return [d, end - 0];
  };
  const CUT = [5, 3, 2, 1, 1, 0, 0, 0];                                 // the plate's rounded corner, row by row (8 rows)
  // A region name plate ("JOHTO") for one bottom corner: pale plate, black bold text, rounded corner towards the map.
  const labelSvg = (m, l) => {
    const left = l.side !== "right", pad = left ? 2 : 8;                // 2px on the frame side, 8px on the map side
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
/* any map whose locations depend on the clock (Gold / Silver / Crystal, Sinnoh, and later games): the picture is tinted to the chosen time of day */
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
/* "Show on map" for a honey tree: no fill, just a red outline around the tree itself */
.amap .amappin i.tree{background:transparent;box-shadow:0 0 0 1px #fff,inset 0 0 0 1px #fff;outline:2px solid #d01818}
#where li .locbtn{margin-left:auto;padding:2px 8px;font-size:12px;white-space:nowrap}
#where li .locbtn[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.amap .roamsw{flex:none;width:14px;height:14px;margin-top:1px;background:rgba(70,150,255,.5);border:1px solid #fff;outline:1px solid #000}
.amapimg .honeyicon{position:absolute;z-index:1;pointer-events:none;background-repeat:no-repeat;background-size:100% 100%;image-rendering:pixelated;filter:drop-shadow(1px 0 0 #fff) drop-shadow(-1px 0 0 #fff) drop-shadow(0 1px 0 #fff) drop-shadow(0 -1px 0 #fff)}
/* honey tree list under the "Honey Trees" row (js/where.js) */
#where .honeyinfo{flex:1 1 100%;font-size:13px;line-height:1.4}
#where .honeyinfo p{margin:4px 0}
#where .honeyinfo details.honeydet{margin:6px 0 2px}
#where .honeyinfo ul{padding:0 4px 4px}
#where .honeyinfo li{align-items:center}
#where .honeyinfo li strong{flex:0 0 min(100%,20ch)}
#where .honeyinfo li span{flex:1 1 20ch}
/* "Show on map" outline of a circle / triangle / diagonal strip (drawn as SVG): same red pulse as the box outlines */
.amap .amappin svg{animation:pinPulse 1.2s ease-in-out infinite}
.amap .amappin .w{stroke:#fff;stroke-width:4px}
.amap .amappin .b{stroke:#d01818;stroke-width:2px;fill:rgba(255,40,40,.3)}
@media (prefers-reduced-motion:reduce){.amap .amappin svg{animation:none}}`;

  // Flashing maps: is this place a route / town (land) or a unique location (special)?
  const LAND = new RegExp("\\b(route|town|city|village)\\b|\\b(one|two|three|four|five|six|seven) island\\b" +
    "|\\bcinnabar island\\b|\\bindigo plateau\\b|\\bthree isle port\\b", "i");
  // Honey trees always flash like routes (the whole route pulses), even the ones that stand in a forest or a factory.
  const kindOf = place => (String(place).startsWith(HONEY_PREFIX) || place === HONEY_ALL || LAND.test(String(place)) ? "land" : "special");

  function placeKey(area) {
    const w = String(area).split(/\s+towards\s+/i)[0].trim().split(/\s+/);
    while (w.length > 1 && (FLOOR.test(w[w.length - 1]) || WORDS.has(w[w.length - 1].toLowerCase()))) w.pop();
    return w.join(" ");
  }

  // Segments: "Sinnoh Route 212 North" -> { base: "Sinnoh Route 212", seg: "North" } (compass words kept, floors / "towards" dropped)
  const COMPASS = new Set(["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"]);
  function segment(area) {
    const parts = String(area).split(/\s+towards\s+/i), w = parts[0].trim().split(/\s+/), seg = [];
    while (w.length > 1 && FLOOR.test(w[w.length - 1])) w.pop();
    while (w.length > 1 && COMPASS.has(w[w.length - 1].toLowerCase())) seg.unshift(w.pop());
    const to = parts[1] ? "towards " + parts[1].trim() : "";           // "Route 205 South towards Floaroma Town"
    return { base: placeKey(w.join(" ")), seg: [seg.join(" "), to].filter(Boolean).join(" ") };
  }
  // Is this exact area name (e.g. "Sinnoh Route 212 North") drawn on any map of these games? false = only its parent route is.
  function exact(keys, area) {
    if (!data) return true;
    for (const key of keys) for (const id of data.games[key] || []) if (tableOf(id)[area]) return true;
    return false;
  }

  function init(d) {
    data = d && typeof d === "object" && d.maps && d.games ? d : null;
    if (typeof document !== "undefined" && !document.getElementById("maps-time-css")) {   // styles for the bug icon, time buttons and map tabs
      const s = document.createElement("style"); s.id = "maps-time-css"; s.textContent = CSS; document.head.append(s);
    }
  }

  // Which times of day does one entry row apply to? A row with no time condition applies to all three.
  function rowTimes(cond) {
    const c = String(cond || "").toLowerCase(), t = TIMES.filter(x => c.includes(x));
    return t.length ? t : TIMES;
  }

  // A map picture failed to load (inline onerror): remove that map, and its tab if there are tabs. If the map that was on
  // show goes, the first remaining one is shown instead; with only one map left the tab row goes too.
  function drop(img) {
    const fig = img && img.closest && img.closest("figure");
    if (!fig) return;
    const box = fig.closest(".amaps"), id = fig.dataset.map;
    fig.remove();
    if (!box) return;
    const tabs = [...box.querySelectorAll(".amaptab")].filter(t => {
      if (box.querySelector(`figure.amap[data-map="${t.dataset.map}"]`)) return true;   // its map is still there
      t.remove(); return false;
    });
    if (!tabs.length) { box.remove(); return; }
    const on = tabs.find(t => t.getAttribute("aria-selected") === "true") || tabs[0];
    tabs.forEach(t => t.setAttribute("aria-selected", String(t === on)));
    box.querySelectorAll("figure.amap").forEach(f => { f.hidden = f.dataset.map !== on.dataset.map; });
    if (tabs.length < 2) { const strip = box.querySelector(".amaptabs"); if (strip) strip.remove(); }
  }

  function html(keys, entries, name = "") {
    if (!data) return "";
    const areas = [...new Set(entries.map(e => e[0]))], done = new Set(), out = [], none = !areas.length;
    const meta = [];                                                    // one { id, name, n } per figure in `out`, for the tabs
    const emit = (id, m, n, markup, roamOnly = false) => { out.push(markup); meta.push({ id, name: m.name, n, roamOnly }); };
    // times per area name: the union over all of that area's rows
    const areaTimes = new Map();
    for (const e of entries) {
      const set = areaTimes.get(e[0]) || new Set();
      for (const t of rowTimes(e[5])) set.add(t);
      areaTimes.set(e[0], set);
    }
    // for the hover tooltip: every area name (and its place name) with its times, e.g. { n: "Johto Route 36", t: "day night" }
    const found = areas.flatMap(a => { const t = TIMES.filter(x => areaTimes.get(a).has(x)).join(" "); return [{ n: a, t }, { n: placeKey(a), t }]; });
    // honey trees: the tooltip should say "found here" on every route that has a tree (they all share the times of the "Honey Trees" row)
    const honeyHere = areas.includes(HONEY_ALL);
    if (honeyHere) { const t = TIMES.filter(x => areaTimes.get(HONEY_ALL).has(x)).join(" "); honeyNames.forEach(n => found.push({ n, t })); }
    const pc = v => (v * 100).toFixed(3) + "%";
    // The in-game "PIKACHU's NEST" heading, if the map defines one (maps.json "title"): { text, x, y, size } in image pixels.
    // {NAME} = upper case name, {name} = as written.
    const title = m => {
      const t = m.title;
      if (!t || !t.text || !name || t.bar) return "";
      const txt = String(t.text).replace("{NAME}", name.toUpperCase()).replace("{name}", name);
      return `<div class="amaptitle" style="left:${pc((t.x || 0) / m.w)};top:${pc((t.y || 0) / m.h)};font-size:${((t.size || 8) / m.w * 100).toFixed(3)}cqw">${esc(txt)}</div>`;
    };
    // The "HOOTHOOT'S NEST" strip above the map (maps.json title.bar): pale pixel text on black, like the games.
    // It is outside .amapimg, so hover positions stay exact. Its viewBox is in the same "image pixels" as the map.
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
    // All / Morning / Day / Night buttons (inline handler: this file never touches the DOM after init).
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

    // Roaming: which regions do the roaming rows name, and which routes of a map belong to them?
    const regions = [...new Set(entries.filter(e => /^roaming/.test(e[1])).map(e =>
      // PokéAPI files HeartGold / SoulSilver's Latias / Latios under Johto, but they roam Kanto (they start at Vermilion's Fan Club).
      (/copycat/i.test(e[5]) ? "Kanto" : String(e[0]).replace(/^Roaming\s+/i, "").trim())))];
    // caption: "3 locations marked", "roams the shaded routes", or both
    const capOf = (n, rm) => (n ? `${n} location${n === 1 ? "" : "s"} marked` : "") + (n && rm ? " + " : "") + (rm ? "roams the shaded routes" : "");
    const roamFor = (table, m) => {                                     // -> { marks, names, note } or null
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

    const inGroup = {};                                                 // which maps of one family this list shows (Red / Blue + Yellow)
    for (const k of keys) for (const id of data.games[k] || []) (inGroup[famOf(id)] = inGroup[famOf(id)] || new Set()).add(id);
    const tag = (id, m) => (m.variant && inGroup[famOf(id)] && inGroup[famOf(id)].size > 1 ? ` (${esc(m.variant)})` : "");
    const mixed = keys.includes("emerald") && keys.some(k => k !== "emerald");   // Emerald and Ruby/Sapphire in one group
    for (const key of keys) for (const id of data.games[key] || []) {
      const m = data.maps[id];
      if (!m || !m.w || !m.h) continue;                                 // not set up yet
      const fstyle = m.flash ? (key === "emerald" ? "emerald" : "rs") : "";   // flashing maps look different in Emerald
      if (done.has(id + "|" + fstyle)) continue;
      done.add(id + "|" + fstyle);
      if (none) {                                                       // nowhere to show: the in-game "AREA UNKNOWN" box
        const u = m.unknown, banner = u && u.img
          ? `<img class="unk" alt="Area unknown" src="${esc(u.img)}" style="left:${pc(u.x / m.w)};top:${pc(u.y / m.h)};width:${pc(u.w / m.w)}">`
          : `<div class="unk txt">AREA UNKNOWN</div>`;
        return wrap(m, id, banner, `${esc(m.name)}: area unknown`);       // only the first map; one banner is enough
      }
      const table = tableOf(id);

      if (m.flash) {                                                    // style 3: the locations themselves flash (Hoenn, FireRed / LeafGreen)
        const seen = new Map(), sets = { land: [], special: [] }, names = new Set();   // seen: kind + box -> { b, times }
        for (const a of areas) {
          const boxes = table[a] || table[placeKey(a)];
          if (!boxes || !boxes.length) continue;
          const kind = kindOf(placeKey(a));
          if (a === HONEY_ALL) honeyNames.forEach(h => names.add(h)); else names.add(placeKey(a));   // honey trees count one by one
          for (const b of boxes) {
            const sig = kind + JSON.stringify(b);
            let o = seen.get(sig);
            if (!o) { seen.set(sig, o = { b, times: new Set() }); sets[kind].push(o); }
            for (const t of areaTimes.get(a)) o.times.add(t);               // a box shared by two places is there whenever either is
          }
        }
        const rm = roamFor(table, m);
        if (!seen.size && !rm) continue;                                // nothing of this Pokémon on this map
        // Morning / Day / Night: with a clock in the game (Sinnoh), boxes that only apply at some times get data-t,
        // the figure gets the time buttons, and the picture is tinted to the chosen time (see data-timed in the CSS).
        let timed = false;
        let marks = (rm ? rm.marks : "") + (m.fx === "unova" ? uxMarks(sets, m) : ["land", "special"].flatMap(k => sets[k].map(({ b, times }) => {
          if (times.size < TIMES.length) timed = true;
          return `<i class="fl ${k}" data-t="${TIMES.filter(t => times.has(t)).join(" ")}" style="${boxStyle(b, m)}"></i>`;
        })).join(""));
        if (honeyHere) marks += honeyIcons(table, m);                  // the tree icons sit on top of the flashing boxes
        const mix = sets.land.length && sets.special.length ? "both" : sets.special.length ? "special" : "land";
        const who = mixed ? (fstyle === "emerald" ? " (Emerald)" : " (Ruby / Sapphire)") : "";
        emit(id, m, names.size, wrap(m, id, marks, `${esc(m.name)}${who}: ${capOf(names.size, rm)}`, rm ? found.concat(rm.found) : found,
          (timed ? filter(m, id) : "") + (rm ? rm.note : ""), ` data-flash="${fstyle}" data-mix="${mix}"${m.fx ? ` data-fx="${esc(m.fx)}"` : ""}${timed ? " data-timed" : ""}`), !names.size);
        continue;
      }

      if (m.icon && !m.single) {                                        // style 1: the game's sprite on every tile
        const seen = new Set(), places = new Set();
        for (const a of areas) {
          const boxes = table[a] || table[placeKey(a)];
          if (!boxes || !boxes.length) continue;
          places.add(placeKey(a));
          for (const b of boxes) seen.add(JSON.stringify(b));
        }
        const rm = roamFor(table, m);
        if (!seen.size && !rm) continue;                                // nothing of this Pokémon on this map
        const g = m.grid || 8;
        const marks = (rm ? rm.marks : "") + [...seen].map(s => bbox(JSON.parse(s))).map(([x, y, w, h]) => {
          const pos = `left:${pc(x / m.w)};top:${pc(y / m.h)};width:${pc(w / m.w)};height:${pc(h / m.h)}`;
          return `<i class="nest" style="${pos};background-image:url(${esc(m.icon)});background-size:${pc(g / w)} ${pc(g / h)}"></i>`;
        }).join("");
        emit(id, m, places.size, wrap(m, id, marks, `${esc(m.name)}${tag(id, m)}: ${capOf(places.size, rm)}`, rm ? found.concat(rm.found) : found, rm ? rm.note : ""), !places.size);
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
      const rm = roamFor(table, m);
      if (!groups.size && !rm) continue;
      const ms = m.mark || m.grid || 8;
      let timed = false;
      const marks = (rm ? rm.marks : "") + [...groups.values()].map(gr => {
        const part = gr.times.size < TIMES.length; timed = timed || part;
        const big = bbox(gr.boxes.reduce((p, b) => (area(b) > area(p) ? b : p)));      // biggest box of the location
        const cw = Math.min(ms, big[2]), ch = Math.min(ms, big[3]);
        const cols = Math.max(1, Math.floor(big[2] / cw)), rows = Math.max(1, Math.floor(big[3] / ch));
        const x = big[0] + Math.floor((cols - 1) / 2) * cw, y = big[1] + Math.floor((rows - 1) / 2) * ch;   // middle tile
        const pos = `left:${pc(x / m.w)};top:${pc(y / m.h)};width:${pc(cw / m.w)};height:${pc(ch / m.h)}`;
        return `<i class="nest ${m.icon ? "one" : "bug"}" data-t="${TIMES.filter(t => gr.times.has(t)).join(" ")}" style="${pos};background-image:url(${sprite})"></i>`;
      }).join("");
      emit(id, m, groups.size, wrap(m, id, marks, `${esc(m.name)}${tag(id, m)}: ${capOf(groups.size, rm)}`, rm ? found.concat(rm.found) : found,
        (timed ? filter(m, id) : "") + (rm ? rm.note : ""), timed ? " data-timed" : ""), !groups.size);
    }

    // Two or more different maps (Kanto + Sevii Islands ...): a tab for each, one map shown at a time. (The same map twice, as
    // with Hoenn's Ruby / Sapphire + Emerald, is not a tab: both versions stay on show so they can be compared.)
    const ids = [...new Set(meta.map(x => x.id))];
    if (new Set(ids.map(famOf)).size < 2) return out.join("");          // one place shown twice (Red / Blue + Yellow, Ruby / Sapphire + Emerald): both pictures stay on show, no tabs
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

  // "Pokémon Tower" / "Pokemon Tower", "Diglett's Cave" / "Diglett S Cave" and "Kanto Victory Road" / "Victory Road"
  // are separate keys in maps.json that mean the same place, so compare them in a normalised form.
  const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/^kanto/, "").replace(/[^a-z0-9]/g, "");

  // Which locations cover the point (fx, fy) (0..1 across the map image)? -> [{ name, here, when, boxes }]
  // `found` = what Maps.html put in data-found: { n: area name, t: "day night" } (plain strings count as all day).
  // `roam` = a roaming Pokémon could be there (shaded route);
  // `here` = the Pokémon is found there; `when` = "Morning / Night" or "All day" (only when the map has "times": true).
  // `boxes` = every tile of the location, so the caller can outline all of it. Aliases with the same boxes are merged.
  // The combined "Honey Trees" place is skipped here: each tree is its own place, so the tooltip names the tree.
  function at(id, fx, fy, found = []) {
    const m = data && data.maps[id];
    if (!m || !m.w || !m.h) return [];
    const x = fx * m.w, y = fy * m.h, byName = new Map();
    const roamKeys = new Set();                                          // routes a roaming Pokémon can be on (found entries with r: 1)
    for (const f of found) {
      if (f && f.r) { roamKeys.add(norm(f.n)); continue; }
      const k = norm(typeof f === "string" ? f : f.n), set = byName.get(k) || new Set();
      const t = typeof f === "string" || !f.t ? TIMES : f.t.split(" ");
      t.forEach(v => set.add(v)); byName.set(k, set);
    }
    const merged = new Map();                                            // box signature -> one location
    for (const [p, all] of Object.entries(tableOf(id))) {
      if (p === HONEY_ALL) continue;
      if (!all.some(b => inBox(b, x, y))) continue;
      const sig = JSON.stringify([...all].sort()), k = norm(p);
      if (!merged.has(sig)) merged.set(sig, { names: [], boxes: all, here: false, times: new Set() });
      const g = merged.get(sig);
      g.names.push(p);
      if (roamKeys.has(k)) g.roam = true;
      if (byName.has(k)) { g.here = true; byName.get(k).forEach(t => g.times.add(t)); }
    }
    return [...merged.values()].map(g => ({
      name: g.names.find(s => s.startsWith(HONEY_PREFIX) && byName.has(norm(s)))   // a honey tree this Pokémon uses: name the tree
        || g.names.find(s => !s.startsWith(HONEY_PREFIX) && /['é]/.test(s))       // prefer the spelling with the apostrophe / é
        || g.names.find(s => !s.startsWith(HONEY_PREFIX)) || g.names[0],
      here: g.here,
      roam: !!g.roam && !g.here,                                         // a roamer could be here (and it isn't a fixed spot)
      when: g.here && m.times ? timeText(g.times) : "",
      boxes: g.boxes,
    }));
  }

  // Which maps (of the given games) have boxes for this location? -> [{ id, boxes, w, h }] (used by the "Show on map" buttons in where.js)
  function locate(keys, area) {
    if (!data) return [];
    const out = [], seen = new Set();
    for (const key of keys) for (const id of data.games[key] || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const m = data.maps[id];
      if (!m || !m.w || !m.h) continue;
      const t = tableOf(id), b = t[area] || t[placeKey(area)];
      if (b && b.length) out.push({ id, boxes: b, w: m.w, h: m.h });
    }
    return out;
  }

  return { init, addHoney, html, placeKey, segment, exact, kindOf, at, drop, locate, bbox, isShape, verts, inBox, move, outline, pin, honeyPrefix: HONEY_PREFIX, honeyIcon: HONEYICON, honeyAll: HONEY_ALL };
})();