"use strict";
// Cards: trainer card and diploma rendering on canvas, plus the diploma dialog.
//   init(api) / update(game, got, state, extra)   draw the card and unlock the diploma button (extra.left = required forms still missing)
//   trainer / diploma / pixelText / outlined / dsText / dsLayout / setMons   exported so test.html can render every game's art
// Text is placed glyph by glyph on whole pixels so pixel fonts stay crisp (pixelText, gridText, scaledText, tinyText).
// The HG / SS Leaf Crown certificate draws its own text line with the built-in DS pixel font (DSFONT) and the partner's sprite;
// layout numbers live in diplomaLayouts.leaf in data/games.config.json.
const Cards = (() => {
  const $ = s => document.querySelector(s);
  const imgs = new Map();
  const img = src => {
    if (!imgs.has(src)) imgs.set(src, new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }));
    return imgs.get(src);
  };
  const loadFonts = () => Promise.all(Object.values(FONTS).map(f => document.fonts.load(`16px "${f.css}"`)));

  function fit(c, target) {
    const s = Math.floor(target / c.width);
    c.style.width = (s >= 1 ? c.width * s : target) + "px";
    c.classList.toggle("px", s >= 1);
  }

  function pixelText(ctx, text, [fk, size, x, y], color = [0, 0, 0], align = "left", shadow = null) {
    if (!text) return;
    const f = FONTS[fk], font = `${size}px "${f.css}"`;
    const t = document.createElement("canvas"), c = t.getContext("2d", { willReadFrequently: true });
    c.font = font;
    const glyphs = []; let cum = 0;
    for (const ch of text) {
      glyphs.push([ch, Math.round(cum)]);
      const w = c.measureText(ch).width;
      cum += fk === "pkmn" ? Math.round(w) : w;
    }
    const w = Math.ceil(cum);
    t.width = w + 8; t.height = Math.ceil(size * (f.asc + 0.7)) + 8;
    c.font = font; c.fillStyle = "#000"; c.textBaseline = "alphabetic";
    const base = 4 + Math.round(f.asc * size);
    for (const [ch, gx] of glyphs) c.fillText(ch, 4 + gx, base);
    const W = t.width, H = t.height, d = c.getImageData(0, 0, W, H), p = d.data, on = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) on[i] = p[i * 4 + 3] >= 128 ? 1 : 0;
    p.fill(0);
    const put = (px, py, col) => { if (px < W && py < H) { const i = (py * W + px) * 4; p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = 255; } };
    if (shadow) for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (on[py * W + px]) { put(px + 1, py, shadow); put(px, py + 1, shadow); put(px + 1, py + 1, shadow); }
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (on[py * W + px]) put(px, py, color);
    c.putImageData(d, 0, 0);
    ctx.drawImage(t, Math.round(align === "right" ? x - w : x) - 4, Math.round(y) - 4);
  }

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
  function gridText(ctx, text, [fk, size, x, y], color = [0, 0, 0]) {
    if (!text) return;
    const f = FONTS[fk], n = f.native, k = size / n, font = `${n}px "${f.css}"`;
    const t = document.createElement("canvas"), c = t.getContext("2d", { willReadFrequently: true });
    c.font = font;
    const glyphs = []; let cum = 0;
    for (const ch of text) { glyphs.push([ch, cum]); cum += Math.round(c.measureText(ch).width); }
    t.width = cum + 8; t.height = Math.ceil(n * (f.asc + 0.7)) + 8;
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
    spec[0] === "pkmn" && spec[1] >= FONTS.pkmn.native * 2 ? gridText(ctx, text, spec, color)
    : spec[1] < FONTS[spec[0]].native - 1 ? scaledText(ctx, text, spec, color) : pixelText(ctx, text, spec, color, align, shadow);

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
    const badges = Math.min(Math.floor(caught / Math.floor(game.count / 8)), 8);
    const base = `assets/trainer-cards/${cfg.dir || game.sprites}/${cfg.gender ? st.gender + "/" : ""}`;
    const tries = await Promise.allSettled(Array.from({ length: badges + 1 }, (_, i) => img(`${base}Trainer_${badges - i}.png`)));
    const im = tries.find(r => r.status === "fulfilled")?.value;
    if (!im) return null;
    const [c, ctx] = canvasFor(im);
    const { name, prog: pr, color: tc, shadow: sh } = cfg, txt = `${caught} / ${game.count}`;
    crisp(ctx, st.name, name, tc, "left", sh);
    if (pr[0] === "tiny") tinyText(ctx, txt, pr[2], pr[3]);
    else if (game.gen === 1) outlined(ctx, txt, pr);
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

  async function leafDiploma(game, o) {
    const d = game.diploma, dir = `assets/diplomas/${d.dir}`;
    const sprite = o.mon ? img(`${dir}/${d.sprites}${o.shiny ? "/shiny" : ""}/${o.mon.n}.png`) : null;
    if (sprite) sprite.catch(() => {});
    const [c, ctx] = canvasFor(await img(`${dir}/${o.gender === "Girl" ? d.girl : d.guy}`));
    ctx.fillStyle = d.paper; ctx.fillRect(...d.clear);
    const name = String(o.name || "").trim() || "Trainer", nick = String(o.nick || "").trim();
    const mon = nick || (o.mon ? String(o.mon.name).toUpperCase() : "");
    const text = mon ? `${name} and ${mon}` : name, [cx, top] = d.line;
    dsText(ctx, text, Math.round(cx - dsLayout(text).width / 2), top);
    if (sprite) {
      const [sx, sy, size] = d.spot, im = await sprite;
      ctx.imageSmoothingEnabled = im.naturalWidth !== size;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(im, sx, sy, size, size);
    }
    return c;
  }

  let api, tok = 0, cur = null, dip = null, mons = [];

  async function update(game, got, st, extra = {}) {
    const my = ++tok; $("#card").style.opacity = 0.5;
    await loadFonts();
    const c = await trainer(game, got.size, st);
    if (my !== tok) return;
    const host = $("#card"); host.style.opacity = 1; host.hidden = !c;
    if (c) { host.width = c.width; host.height = c.height; host.getContext("2d").drawImage(c, 0, 0); fit(host, 540); }
    const gendered = !!game.card?.gender;
    document.querySelectorAll("input[name=gender]").forEach(r => { r.disabled = !gendered; r.checked = gendered && r.value === st.gender; });
    const missingMew = game.key === "yellow" && got.size === game.count - 1 && !got.has(151);
    const dexDone = got.size === game.count || missingMew, left = extra.left || 0, done = dexDone && !left;
    cur = { game, missingMew };
    const always = !!(game.diploma && game.diploma.always);
    $("#diploma").disabled = !(game.diploma && (done || always));
    $("#hint").textContent = !game.diploma ? "No diploma artwork for this game yet."
      : always ? "You can make this diploma at any time."
      : done ? "Your Pokédex is complete!"
      : dexDone ? `Pokédex complete! ${left} required form${left === 1 ? "" : "s"} still missing (see Settings).`
      : "Complete the Pokédex to unlock your diploma.";
  }

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
    $("#choices").closest(".row").hidden = choices.length < 2;
    $("#leafRow").hidden = !leaf;
    if (leaf) {
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
    $("#lmon").addEventListener("change", () => { $("#lnick").value = ""; redraw(); });
    $("#lnick").addEventListener("input", redraw);
    ["#dname", "#hh", "#mm"].forEach(s => $(s).addEventListener("input", e => { if (s !== "#dname") e.target.value = e.target.value.replace(/\D/g, ""); redraw(); }));
  }
  return { init, update, pixelText, outlined, trainer, diploma, dsText, dsLayout, setMons: list => { mons = list; } };
})();