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
  const crisp = (ctx, text, spec, color, align, shadow) =>
    spec[1] < FONTS[spec[0]].native - 1 ? scaledText(ctx, text, spec, color) : pixelText(ctx, text, spec, color, align, shadow);

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
    const badges = game.gen === 4 ? 0 : Math.min(Math.floor(caught / Math.floor(game.count / 8)), 8); // Gen 4 art has no badge variants
    const base = `assets/trainer-cards/${cfg.dir || game.sprites}/${cfg.gender ? st.gender + "/" : ""}`;
    // Request this badge count and every lower one at once; use the highest that exists
    // (Gen 4 only has Trainer_0, and Emerald Girl is missing Trainer_2).
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

  let api, tok = 0, cur = null, dip = null; // dip = the game the open diploma dialog belongs to

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
    $("#diploma").disabled = !(game.diploma && done);
    $("#hint").textContent = !game.diploma ? "No diploma artwork for this game yet."
      : done ? "Your Pokédex is complete!"
      : dexDone ? `Pokédex complete! ${left} required form${left === 1 ? "" : "s"} still missing (see Settings).`
      : "Complete the Pokédex to unlock your diploma.";
  }

  // ---- diploma dialog ----
  const dlg = () => $("#dip");
  const opts = () => document.querySelector("input[name=choice]:checked")?.value;
  async function redraw() {
    const choice = opts(); if (!choice || !dip) return;
    const printer = choice === "Printer";
    $("#timeRow").hidden = !printer;
    const c = await diploma(dip.game, { choice, name: $("#dname").value, hour: $("#hh").value, minute: $("#mm").value, missingMew: dip.missingMew });
    const v = $("#dip-canvas"); v.width = c.width; v.height = c.height; v.getContext("2d").drawImage(c, 0, 0); fit(v, 480);
  }
  function open() {
    dip = cur;
    const { choices } = dip.game.diploma;
    $("#choices").innerHTML = choices.map((c, i) => `<label><input type="radio" name="choice" value="${c}" ${i ? "" : "checked"}> ${c}</label>`).join("");
    $("#dname").value = api.get().name; $("#hh").value = $("#mm").value = "";
    dlg().showModal(); redraw();
  }
  function save() {
    const s = Number($("#scale").value), src = $("#dip-canvas"), out = document.createElement("canvas");
    out.width = src.width * s; out.height = src.height * s;
    const ctx = out.getContext("2d"); ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, out.width, out.height);
    out.toBlob(b => {
      const a = document.createElement("a"), safe = ($("#dname").value || "Trainer").replace(/[^\w-]+/g, "_");
      a.href = URL.createObjectURL(b); a.download = `${dip.game.name.replace(/ /g, "")}_Diploma_${safe}.png`; a.click(); URL.revokeObjectURL(a.href);
    }, "image/png");
  }

  function init(a) {
    api = a;
    document.querySelectorAll("input[name=gender]").forEach(r => r.addEventListener("change", () => api.set({ gender: r.value })));
    $("#diploma").addEventListener("click", open);
    $("#dclose").addEventListener("click", () => dlg().close());
    $("#dsave").addEventListener("click", save);
    $("#choices").addEventListener("change", redraw);
    ["#dname", "#hh", "#mm"].forEach(s => $(s).addEventListener("input", e => { if (s !== "#dname") e.target.value = e.target.value.replace(/\D/g, ""); redraw(); }));
  }
  // trainer / diploma are exported so test.html can render every game's artwork without the main page.
  return { init, update, pixelText, outlined, trainer, diploma };
})();