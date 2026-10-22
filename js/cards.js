"use strict";
const Cards = (() => {
  const $ = s => document.querySelector(s);
  const imgs = new Map();
  const img = src => {
    if (!imgs.has(src)) imgs.set(src, new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }));
    return imgs.get(src);
  };
  const loadFonts = () => Promise.all(Object.values(FONTS).map(f => document.fonts.load(`16px "${f.css}"`)));

  // Show a canvas at a whole-number pixel scale so pixel art stays sharp.
  function fit(c, target) {
    const s = Math.floor(target / c.width);
    c.style.width = (s >= 1 ? c.width * s : target) + "px";
    c.classList.toggle("px", s >= 1);
  }

  // Hard-edged text (like GDI+ SingleBitPerPixel), anchored by its top-left corner.
  // Every glyph is placed on a whole pixel. The Gen 1/2 font advances by ~4.09px per letter, so
  // drawing it as one string drifts off the pixel grid and cuts up the 5th-7th letters.
  function pixelText(ctx, text, [fk, size, x, y], color = [0, 0, 0], align = "left", shadow = null) {
    if (!text) return;
    const f = FONTS[fk], font = `${size}px "${f.css}"`;
    const t = document.createElement("canvas"), c = t.getContext("2d", { willReadFrequently: true });
    c.font = font;
    const glyphs = []; let cum = 0;
    for (const ch of text) {
      glyphs.push([ch, Math.round(cum)]);
      const w = c.measureText(ch).width;
      cum += fk === "pkmn" ? Math.round(w) : w; // the 8px font has whole-pixel advances
    }
    const w = Math.ceil(cum);
    t.width = w + 8; t.height = Math.ceil(size * (f.asc + 0.7)) + 8; // resizing resets the context
    c.font = font; c.fillStyle = "#000"; c.textBaseline = "alphabetic";
    const base = 4 + Math.round(f.asc * size);
    for (const [ch, gx] of glyphs) c.fillText(ch, 4 + gx, base);
    const W = t.width, H = t.height, d = c.getImageData(0, 0, W, H), p = d.data, on = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) on[i] = p[i * 4 + 3] >= 128 ? 1 : 0;
    p.fill(0);
    const put = (px, py, col) => { if (px < W && py < H) { const i = (py * W + px) * 4; p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = 255; } };
    // GBA text has a light shadow on the right, bottom and bottom-right of every glyph pixel
    if (shadow) for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (on[py * W + px]) { put(px + 1, py, shadow); put(px, py + 1, shadow); put(px + 1, py + 1, shadow); }
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (on[py * W + px]) put(px, py, color);
    c.putImageData(d, 0, 0);
    ctx.drawImage(t, Math.round(align === "right" ? x - w : x) - 4, Math.round(y) - 4);
  }

  // Text smaller than a font's native grid: draw it crisp at the native size, then scale it down
  // smoothly and boost the contrast so thin strokes stay readable.
  function scaledText(ctx, text, [fk, size, x, y], color = [0, 0, 0]) {
    const n = FONTS[fk].native, k = size / n, src = document.createElement("canvas");
    src.width = text.length * n * 2 + 16; src.height = n * 3 + 8;
    pixelText(src.getContext("2d"), text, [fk, n, 4, 4], color);
    const out = document.createElement("canvas"); out.width = Math.ceil(src.width * k); out.height = Math.ceil(src.height * k);
    const o = out.getContext("2d", { willReadFrequently: true });
    o.imageSmoothingEnabled = true; o.imageSmoothingQuality = "high"; o.drawImage(src, 0, 0, out.width, out.height);
    const d = o.getImageData(0, 0, out.width, out.height), q = d.data;
    for (let i = 3; i < q.length; i += 4) q[i] = Math.min(255, q[i] * 1.35);
    o.putImageData(d, 0, 0);
    ctx.drawImage(out, Math.round(x - 4 * k), Math.round(y - 4 * k));
  }
  // Names: at or above native size draw crisp as-is; below it, scale down from native.
  // Big pixel text (Gen 1 trainer card names: an 8px font drawn at 70px, so one font pixel = 8.75 canvas pixels).
  // pixelText() draws the glyphs at the big size and thresholds them, and because 8.75 isn't a whole number some font
  // pixels come out 8px wide and others 9px, which leaves thin gaps in letters. Here the glyphs are drawn at the font's
  // NATIVE size (always crisp), and every lit font pixel is then filled as one rectangle whose edges are rounded from the
  // same grid, so neighbouring pixels always touch and every letter stays solid. Anchored by the top-left corner.
  function gridText(ctx, text, [fk, size, x, y], color = [0, 0, 0]) {
    if (!text) return;
    const f = FONTS[fk], n = f.native, k = size / n, font = `${n}px "${f.css}"`;
    const t = document.createElement("canvas"), c = t.getContext("2d", { willReadFrequently: true });
    c.font = font;
    const glyphs = []; let cum = 0;
    for (const ch of text) { glyphs.push([ch, cum]); cum += Math.round(c.measureText(ch).width); }
    t.width = cum + 8; t.height = Math.ceil(n * (f.asc + 0.7)) + 8;       // resizing resets the context
    c.font = font; c.fillStyle = "#000"; c.textBaseline = "alphabetic";
    const base = 4 + Math.round(f.asc * n);
    for (const [ch, gx] of glyphs) c.fillText(ch, 4 + gx, base);
    const W = t.width, H = t.height, p = c.getImageData(0, 0, W, H).data;
    ctx.fillStyle = `rgb(${color.join(",")})`;
    const X = v => Math.round(x + (v - 4) * k), Y = v => Math.round(y + (v - 4) * k);
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++)
      if (p[(py * W + px) * 4 + 3] >= 128) ctx.fillRect(X(px), Y(py), X(px + 1) - X(px), Y(py + 1) - Y(py));
  }
  const crisp = (ctx, text, spec, color, align, shadow) =>
    spec[0] === "pkmn" && spec[1] >= FONTS.pkmn.native * 2 ? gridText(ctx, text, spec, color)   // big Gen 1 names
    : spec[1] < FONTS[spec[0]].native - 1 ? scaledText(ctx, text, spec, color) : pixelText(ctx, text, spec, color, align, shadow);

  // Hand-drawn 5x7 digits for the Gen 2 card. The game font's digits are 7px wide, which doesn't fit
  // "251 / 251" beside the sprite, and scaling it down makes it fuzzy. Whole pixels stay sharp.
  const TINY = {
    0: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    3: [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
    4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    6: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  };
  function tinyText(ctx, text, x, y) {
    ctx.fillStyle = "#000";
    for (const ch of text) {
      if (ch === " ") { x += 2; continue; }
      (TINY[ch] || []).forEach((row, ry) => { for (let rx = 0; rx < 5; rx++) if (row[rx] === "#") ctx.fillRect(x + rx, y + ry, 1, 1); });
      x += 6;
    }
  }

  // Smooth black text with a 2px white outline (the trainer card's "X / Y").
  function outlined(ctx, text, [fk, size, x, y], lw = 2) {
    const f = FONTS[fk];
    ctx.font = `${size}px "${f.css}"`; ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round"; ctx.lineWidth = lw; ctx.strokeStyle = "#fff"; ctx.fillStyle = "#000";
    if (lw) ctx.strokeText(text, x, y + f.asc * size);
    ctx.fillText(text, x, y + f.asc * size);
  }

  const canvasFor = im => {
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const ctx = c.getContext("2d"); ctx.imageSmoothingEnabled = false; ctx.drawImage(im, 0, 0);
    return [c, ctx];
  };

  async function trainer(game, caught, st) {
    const cfg = game.card; if (!cfg) return null;
    const badges = Math.min(Math.floor(caught / Math.floor(game.count / 8)), 8); // 0-8, one step per 1/8 of the dex
    const base = `assets/trainer-cards/${cfg.dir || game.sprites}/${cfg.gender ? st.gender + "/" : ""}`;
    // Request this badge count and every lower one at once; use the highest that exists
    // (Emerald Girl is missing Trainer_2; any game with fewer variants falls back to the highest one it has).
    const tries = await Promise.allSettled(Array.from({ length: badges + 1 }, (_, i) => img(`${base}Trainer_${badges - i}.png`)));
    const im = tries.find(r => r.status === "fulfilled")?.value;
    if (!im) return null;
    const [c, ctx] = canvasFor(im);
    const { name, prog: pr, color: tc, shadow: sh } = cfg, txt = `${caught} / ${game.count}`; // tc/sh: in-game text color + shadow (Gen 3)
    crisp(ctx, st.name, name, tc, "left", sh);
    if (pr[0] === "tiny") tinyText(ctx, txt, pr[2], pr[3]);                     // Gen 2: built-in 5x7 digits
    else if (game.gen === 1) outlined(ctx, txt, pr);                              // big Gen 1 cards: smooth + outline
    else if (pr[1] >= FONTS[pr[0]].native - 1) pixelText(ctx, txt, pr, tc, pr[4] || "left", sh);
    else scaledText(ctx, txt, pr);
    return c;
  }

  async function diploma(game, o) {
    if (game.diploma.type === "leaf") return leafDiploma(game, o);
    const { dir, prefix, name: n, time } = game.diploma;
    const key = game.key === "yellow" && o.choice === "Printer" && o.missingMew ? "PrinterMissingMew" : o.choice;
    const [c, ctx] = canvasFor(await img(`assets/diplomas/${dir}/${prefix}-${key}.png`));
    crisp(ctx, o.name, n.slice(0, 4), n[4]);
    if (key.startsWith("Printer")) {
      const [hx, mx, y] = time, pad = v => String(v || "").padStart(2, "0");
      pixelText(ctx, pad(o.hour), ["pkmn", 8, hx, y], [0, 0, 0], "right");
      pixelText(ctx, pad(o.minute), ["pkmn", 8, mx, y]);
    }
    return c;
  }

  // ---- Leaf Crown certificate (HeartGold / SoulSilver) ----
  // The certificate art (Boy and Girl versions) already has the trainer sprite and the paragraph baked in. We add:
  //   * one centred line of text, "<trainer> and <POKÉMON>", in the game's pixel font (drawn from the table below);
  //   * the partner's walking sprite, standing to the right of the trainer.
  // The art also has a baked-in "and", so the text row is first painted over with the paper colour and the whole line
  // is redrawn; that way the "and" moves with the names. All numbers (rows to wipe, line position, sprite spot, colours)
  // live in "diplomaLayouts.leaf" in data/games.config.json.
  //
  // DSFONT: one glyph per character, [first row, "row|row|..."] where "#" is ink. Rows are counted from the top of a
  // capital letter (capitals and digits are 9 rows tall; lowercase starts at row 3; g, j, p, q, y hang below row 8).
  // Glyphs are 1px apart and a space is 4px wide, as in the artwork. The letters that appear in the certificate
  // (a b c d e g h i k l m n o r s t u w y, F H I L N O P S T Y , .) were copied pixel for pixel from the master picture;
  // the others were drawn to match them. A character that isn't listed is drawn as "?".
  const DSFONT = {
    "A": [0, ".###.|#...#|#...#|#...#|#####|#...#|#...#|#...#|#...#"], "B": [0, "####.|#...#|#...#|#...#|####.|#...#|#...#|#...#|####."], "C": [0, ".###.|#...#|#....|#....|#....|#....|#....|#...#|.###."],
    "D": [0, "####.|#...#|#...#|#...#|#...#|#...#|#...#|#...#|####."], "E": [0, "#####|#....|#....|#....|####.|#....|#....|#....|#####"], "F": [0, "#####|#....|#....|#....|####.|#....|#....|#....|#...."],
    "G": [0, ".###.|#...#|#....|#....|#.###|#...#|#...#|#...#|.###."], "H": [0, "#...#|#...#|#...#|#...#|#####|#...#|#...#|#...#|#...#"], "I": [0, ".###.|..#..|..#..|..#..|..#..|..#..|..#..|..#..|.###."],
    "J": [0, "..###|....#|....#|....#|....#|....#|....#|#...#|.###."], "K": [0, "#...#|#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#|#...#"], "L": [0, "#....|#....|#....|#....|#....|#....|#....|#....|#####"],
    "M": [0, "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#|#...#|#...#"], "N": [0, "#...#|#...#|##..#|##..#|#.#.#|#..##|#..##|#...#|#...#"], "O": [0, ".###.|#...#|#...#|#...#|#...#|#...#|#...#|#...#|.###."],
    "P": [0, "####.|#...#|#...#|#...#|####.|#....|#....|#....|#...."], "Q": [0, ".###.|#...#|#...#|#...#|#...#|#...#|#.#.#|#..##|.####"], "R": [0, "####.|#...#|#...#|#...#|####.|#.#..|#..#.|#...#|#...#"],
    "S": [0, ".###.|#...#|#....|#....|.###.|....#|....#|#...#|.###."], "T": [0, "#####|..#..|..#..|..#..|..#..|..#..|..#..|..#..|..#.."], "U": [0, "#...#|#...#|#...#|#...#|#...#|#...#|#...#|#...#|.###."],
    "V": [0, "#...#|#...#|#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#.."], "W": [0, "#...#|#...#|#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#."], "X": [0, "#...#|#...#|.#.#.|.#.#.|..#..|.#.#.|.#.#.|#...#|#...#"],
    "Y": [0, "#...#|#...#|#...#|.#.#.|.#.#.|..#..|..#..|..#..|..#.."], "Z": [0, "#####|....#|....#|...#.|..#..|.#...|#....|#....|#####"], "a": [3, ".###.|....#|.####|#...#|#...#|.####"],
    "b": [0, "#....|#....|#....|####.|#...#|#...#|#...#|#...#|####."], "c": [3, ".###.|#...#|#....|#....|#...#|.###."], "d": [0, "....#|....#|....#|.####|#...#|#...#|#...#|#...#|.####"],
    "e": [3, ".###.|#...#|#...#|#####|#....|.####"], "f": [0, "..##|.#..|.#..|####|.#..|.#..|.#..|.#..|.#.."], "g": [3, ".####|#...#|#...#|#...#|.####|....#|....#|.###."],
    "h": [0, "#....|#....|#....|####.|#...#|#...#|#...#|#...#|#...#"], "i": [1, "#.|..|#.|#.|#.|#.|#.|#."], "j": [1, ".#.|...|.#.|.#.|.#.|.#.|.#.|.#.|.#.|#.."],
    "k": [0, "#....|#....|#....|#...#|#..#.|###..|#.#..|#..#.|#...#"], "l": [0, "##.|.#.|.#.|.#.|.#.|.#.|.#.|.#.|.#."], "m": [3, "####.|#.#.#|#.#.#|#.#.#|#.#.#|#.#.#"],
    "n": [3, "#.##.|##..#|#...#|#...#|#...#|#...#"], "o": [3, ".###.|#...#|#...#|#...#|#...#|.###."], "p": [3, "####.|#...#|#...#|#...#|#...#|####.|#....|#...."],
    "q": [3, ".####|#...#|#...#|#...#|#...#|.####|....#|....#"], "r": [3, "#.##.|##..#|#....|#....|#....|#...."], "s": [3, ".####|#....|.###.|....#|#...#|.###."],
    "t": [2, ".#..|####|.#..|.#..|.#..|.#..|..##"], "u": [3, "#...#|#...#|#...#|#...#|#...#|.####"], "v": [3, "#...#|#...#|#...#|#...#|.#.#.|..#.."],
    "w": [3, "#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#."], "x": [3, "#...#|#...#|.#.#.|..#..|.#.#.|#...#"], "y": [3, "#...#|#...#|#...#|#...#|.####|....#|....#|.###."],
    "z": [3, "#####|....#|...#.|..#..|.#...|#####"], "0": [0, ".###.|#...#|#...#|#..##|#.#.#|##..#|#...#|#...#|.###."], "1": [0, "..#..|.##..|..#..|..#..|..#..|..#..|..#..|..#..|.###."],
    "2": [0, ".###.|#...#|....#|....#|...#.|..#..|.#...|#....|#####"], "3": [0, ".###.|#...#|....#|....#|..##.|....#|....#|#...#|.###."], "4": [0, "...#.|..##.|.#.#.|#..#.|#..#.|#####|...#.|...#.|...#."],
    "5": [0, "#####|#....|#....|####.|....#|....#|....#|#...#|.###."], "6": [0, ".###.|#...#|#....|#....|####.|#...#|#...#|#...#|.###."], "7": [0, "#####|....#|....#|...#.|...#.|..#..|..#..|..#..|..#.."],
    "8": [0, ".###.|#...#|#...#|#...#|.###.|#...#|#...#|#...#|.###."], "9": [0, ".###.|#...#|#...#|#...#|.####|....#|....#|#...#|.###."], "'": [0, "#.|#.|#."],
    ".": [7, ".##.|.##."], ",": [7, ".##.|.##.|..#.|.#.."], "-": [5, "###"],
    "?": [0, ".###.|#...#|....#|...#.|..#..|..#..|.....|..#..|..#.."], "!": [0, "#.|#.|#.|#.|#.|#.|..|..|#."], ":": [3, "#.|..|..|..|..|#."],
    "♀": [1, ".###.|#...#|#...#|#...#|.###.|..#..|.###.|..#.."], "♂": [1, "..####|....##|...#.#|.###..|#...#.|#...#.|#...#.|.###.."],
  };
  const DS_INK = "#585850", DS_SHADOW = "#a8b8b8";
  const dsGlyph = ch => DSFONT[ch] || DSFONT["?"];

  // Where each glyph of `text` goes (x from the left of the line) and how wide the whole line is.
  function dsLayout(text) {
    const glyphs = []; let pen = 0;
    for (const ch of text) {
      if (ch === " ") { pen += 4; continue; }
      const [top, rows] = dsGlyph(ch), r = rows.split("|");
      glyphs.push({ top, rows: r, x: pen });
      pen += r[0].length + 1;
    }
    return { glyphs, width: Math.max(0, pen - 1) };
  }

  // Draw a line with its top-left corner at (x, y): a light shadow to the right, below and below-right of every
  // ink pixel (like the games), then the ink on top so a shadow never covers a neighbouring letter.
  function dsText(ctx, text, x, y) {
    const { glyphs } = dsLayout(text);
    for (const [color, offs] of [[DS_SHADOW, [[1, 0], [0, 1], [1, 1]]], [DS_INK, [[0, 0]]]]) {
      ctx.fillStyle = color;
      for (const g of glyphs) g.rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) if (row[rx] === "#")
          for (const [dx, dy] of offs) ctx.fillRect(x + g.x + rx + dx, y + g.top + ry + dy, 1, 1);
      });
    }
  }

  // o = { gender: "Boy" | "Girl", name, mon: { n, name }, nick (optional nickname), shiny }
  async function leafDiploma(game, o) {
    const d = game.diploma, dir = `assets/diplomas/${d.dir}`;
    const sprite = o.mon ? img(`${dir}/${d.sprites}${o.shiny ? "/shiny" : ""}/${o.mon.n}.png`) : null;
    if (sprite) sprite.catch(() => {});                                 // a missing sprite is reported below, not as an unhandled rejection
    const [c, ctx] = canvasFor(await img(`${dir}/${o.gender === "Girl" ? d.girl : d.guy}`));
    ctx.fillStyle = d.paper; ctx.fillRect(...d.clear);                  // wipe the baked-in "and" row
    const name = String(o.name || "").trim() || "Trainer", nick = String(o.nick || "").trim();
    const mon = nick || (o.mon ? String(o.mon.name).toUpperCase() : "");   // a nickname is shown as typed, like in the game
    const text = mon ? `${name} and ${mon}` : name, [cx, top] = d.line;
    dsText(ctx, text, Math.round(cx - dsLayout(text).width / 2), top);
    if (sprite) {
      const [sx, sy, size] = d.spot, im = await sprite;
      ctx.imageSmoothingEnabled = im.naturalWidth !== size;             // 64px sprites (Lugia, Kyogre...) are halved smoothly to fit the 32px spot
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(im, sx, sy, size, size);
    }
    return c;
  }

  let api, tok = 0, cur = null, dip = null, mons = []; // dip = the game the open diploma dialog belongs to; mons = Pokémon list for the Leaf Crown picker

  // extra.left = required forms still missing (completion rules); the diploma stays locked until it is 0.
  async function update(game, got, st, extra = {}) {
    const my = ++tok; $("#card").style.opacity = 0.5; // dim the old card while the new one loads
    await loadFonts();
    const c = await trainer(game, got.size, st);
    if (my !== tok) return; // a newer update is already running
    const host = $("#card"); host.style.opacity = 1;
    if (c) { host.width = c.width; host.height = c.height; host.getContext("2d").drawImage(c, 0, 0); fit(host, 540); }
    const gendered = !!game.card?.gender;
    document.querySelectorAll("input[name=gender]").forEach(r => { r.disabled = !gendered; r.checked = gendered && r.value === st.gender; });
    const missingMew = game.key === "yellow" && got.size === game.count - 1 && !got.has(151);
    const dexDone = got.size === game.count || missingMew, left = extra.left || 0, done = dexDone && !left;
    cur = { game, missingMew };
    const always = !!(game.diploma && game.diploma.always);              // e.g. the Leaf Crown: not tied to a complete Pokédex
    $("#diploma").disabled = !(game.diploma && (done || always));
    $("#hint").textContent = !game.diploma ? "No diploma artwork for this game yet."
      : always ? "You can make this diploma at any time."
      : done ? "Your Pokédex is complete!"
      : dexDone ? `Pokédex complete! ${left} required form${left === 1 ? "" : "s"} still missing (see Settings).`
      : "Complete the Pokédex to unlock your diploma.";
  }

  // ---- diploma dialog ----
  const dlg = () => $("#dip");
  const opts = () => document.querySelector("input[name=choice]:checked")?.value;
  async function redraw() {
    const choice = opts(); if (!choice || !dip) return;
    const printer = choice === "Printer", leaf = dip.game.diploma.type === "leaf";
    $("#timeRow").hidden = !printer;
    const o = { choice, name: $("#dname").value, hour: $("#hh").value, minute: $("#mm").value, missingMew: dip.missingMew };
    if (leaf) Object.assign(o, { gender: api.get().gender, mon: mons.find(m => m.n === Number($("#lmon").value)), nick: $("#lnick").value, shiny: $("#lshiny").checked });
    const c = await diploma(dip.game, o);
    const v = $("#dip-canvas"); v.width = c.width; v.height = c.height; v.getContext("2d").drawImage(c, 0, 0); fit(v, v.width > 200 ? 512 : 480);
  }
  function open() {
    dip = cur;
    const { choices } = dip.game.diploma, leaf = dip.game.diploma.type === "leaf";
    $("#choices").innerHTML = choices.map((c, i) => `<label><input type="radio" name="choice" value="${c}" ${i ? "" : "checked"}> ${c}</label>`).join("");
    $("#choices").closest(".row").hidden = choices.length < 2;           // nothing to choose between
    $("#leafRow").hidden = !leaf;
    if (leaf) {                                                          // Leaf Crown: pick the partner Pokémon
      $("#lmon").innerHTML = mons.filter(m => m.n <= dip.game.count).map(m => `<option value="${m.n}">#${String(m.n).padStart(3, "0")} ${m.name}</option>`).join("");
      $("#lmon").value = dip.game.diploma.defaultMon; $("#lshiny").checked = false; $("#lnick").value = "";
    }
    $("#dname").value = api.get().name; $("#hh").value = $("#mm").value = "";
    dlg().showModal(); redraw();
  }
  function save() {
    const s = Number($("#scale").value), src = $("#dip-canvas"), out = document.createElement("canvas");
    out.width = src.width * s; out.height = src.height * s;
    const ctx = out.getContext("2d"); ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, out.width, out.height);
    out.toBlob(b => {
      const a = document.createElement("a"), safe = ($("#dname").value || "Trainer").replace(/[^\w-]+/g, "_");
      const partner = ($("#lnick").value.trim() || (mons.find(m => m.n === Number($("#lmon").value)) || {}).name || "Pokemon");
      a.href = URL.createObjectURL(b);
      a.download = dip.game.diploma.type === "leaf" ? `${dip.game.name.replace(/ /g, "")}_LeafCrown_${safe}_${partner.replace(/[^\w-]+/g, "_")}.png` : `${dip.game.name.replace(/ /g, "")}_Diploma_${safe}.png`;
      a.click(); URL.revokeObjectURL(a.href);
    }, "image/png");
  }

  function init(a) {
    api = a;
    document.querySelectorAll("input[name=gender]").forEach(r => r.addEventListener("change", () => api.set({ gender: r.value })));
    $("#diploma").addEventListener("click", open);
    $("#dclose").addEventListener("click", () => dlg().close());
    $("#dsave").addEventListener("click", save);
    $("#choices").addEventListener("change", redraw);
    ["#lmon", "#lshiny"].forEach(s => $(s).addEventListener("change", redraw));
    $("#lmon").addEventListener("change", () => { $("#lnick").value = ""; redraw(); });   // a nickname belongs to one Pokémon: clear it when the Pokémon changes
    $("#lnick").addEventListener("input", redraw);
    ["#dname", "#hh", "#mm"].forEach(s => $(s).addEventListener("input", e => { if (s !== "#dname") e.target.value = e.target.value.replace(/\D/g, ""); redraw(); }));
  }
  // trainer / diploma are exported so test.html can render every game's artwork without the main page.
  return { init, update, pixelText, outlined, trainer, diploma, dsText, dsLayout, setMons: list => { mons = list; } };
})();