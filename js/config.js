"use strict";
// Per-game trainer card + diploma layout. Ported from PlayerNameDisplayManager, ProgressDisplayManager,
// DiplomaNameDisplayManager, DiplomaTimeDisplayManager and AssetManager.
// All positions are pixels from the image's top-left.
// native = the pixel size each font was drawn for; other sizes are scaled from it.
// asc = the font's ascent / em-size (GDI+ anchors text by its top, canvas by its baseline).
const FONTS = {
  pkmn: { css: "PKMN",     asc: 1.0,    native: 8 },
  rs:   { css: "PokeRS",   asc: 0.8662, native: 15 },
  frlg: { css: "PokeFRLG", asc: 1.2998, native: 10 },
};

// One entry per game, keyed by the same `key` used in games.json (which build_data.py regenerates,
// so layout lives here instead). app.js merges each entry into its game object, so the rest of the
// code reads game.card and game.diploma.
//
//   card:     { gender, name, prog, dir?, color?, shadow? }
//       gender  false if the card art has no Boy/Girl variants
//       name    [font, size, x, y]                       where the trainer name goes
//       prog    [font, size, x, y, "right"?]             where "X / Y" goes; font "tiny" = built-in 5x7 digits
//       dir     trainer-cards folder, if not the game's sprite set
//       color   in-game text color (Gen 3);  shadow: drop shadow on right/bottom/bottom-right (Gen 3)
//   diploma:  { dir, prefix, choices, name, time? }      omit the whole key if there's no artwork yet
//       choices the two artwork variants offered in the dialog
//       name    [font, size, x, y, color?]
//       time    [hourRightEdgeX, minuteLeftX, y], only for "Printer" diplomas, drawn in pkmn size 8
const GAME_CFG = (() => {
  const SHADOW = [208, 208, 200], RED = [224, 8, 8];
  const GB = ["GB", "SGB"], PR = ["Regular", "Printer"], RN = ["Regional", "National"];

  // Layouts shared by games that use the same artwork. A game can spread one and override a field.
  const card = {
    rby:     { gender: false, name: ["pkmn", 70, 517, 167], prog: ["pkmn", 53, 665, 350] },
    gs:      { gender: false, name: ["pkmn", 8, 47, 15],    prog: ["tiny", 0, 70, 33] },
    // Gen 3 matches the in-game cards (measured from screenshots): the name shares the baseline of the
    // card's own "NAME" label, in the same font. Ruby/Sapphire/Emerald use the RS font, FRLG the FRLG font.
    // Progress is right-aligned in the same value column the in-game MONEY / TIME numbers use.
    rs:      { gender: true, name: ["rs", 15, 56, 44], prog: ["rs", 15, 128, 68, "right"], color: [72, 72, 72], shadow: SHADOW },
    emerald: { gender: true, name: ["rs", 15, 54, 44], prog: ["rs", 15, 136, 68, "right"], color: [96, 96, 96], shadow: SHADOW },
    frlg:    { gender: true, name: ["frlg", 10, 63, 36], prog: ["frlg", 10, 145, 64, "right"], color: [96, 96, 96], shadow: SHADOW },
    gen4:    { gender: true, name: ["rs", 15, 59, 45],  prog: ["rs", 15, 85, 67] },
  };
  // Sapphire/Leaf Green share artwork with Ruby/Fire Red, so they reuse those placements.
  // (The C# values for Sapphire, Emerald and Leaf Green were unfinished placeholders.)
  const dip = {
    rb:      { dir: "Gen1/Red-Blue",         prefix: "Red-Blue",          choices: GB, name: ["pkmn", 8, 78, 31] },
    yellow:  { dir: "Gen1/Yellow",           prefix: "Yellow",            choices: PR, name: ["pkmn", 8, 78, 31], time: [122, 127, 263] },
    gs:      { dir: "Gen2/Gold-Silver",      prefix: "Gold-Silver",       choices: PR, name: ["pkmn", 8, 70, 39], time: [130, 135, 263] },
    crystal: { dir: "Gen2/Crystal",          prefix: "Crystal",           choices: PR, name: ["pkmn", 8, 70, 39], time: [130, 135, 263] },
    rs:      { dir: "Gen3/Ruby-Sapphire",    prefix: "Ruby-Sapphire",     choices: RN, name: ["rs", 17, 99, 14, RED] },
    emerald: { dir: "Gen3/Emerald",          prefix: "Emerald",           choices: RN, name: ["frlg", 10, 88, 18] },
    frlg:    { dir: "Gen3/FireRed-LeafGreen", prefix: "FireRed-LeafGreen", choices: RN, name: ["frlg", 10, 140, 18] },
  };

  return {
    red:           { card: { ...card.rby, dir: "Red" },  diploma: dip.rb },   // Red/Blue cards live in per-game folders
    blue:          { card: { ...card.rby, dir: "Blue" }, diploma: dip.rb },
    yellow:        { card: card.rby,                     diploma: dip.yellow },
    gold:          { card: card.gs,                      diploma: dip.gs },
    silver:        { card: card.gs,                      diploma: dip.gs },
    crystal:       { card: { ...card.gs, gender: true }, diploma: dip.crystal },
    ruby:          { card: card.rs,                      diploma: dip.rs },
    sapphire:      { card: card.rs,                      diploma: dip.rs },
    emerald:       { card: card.emerald,                 diploma: dip.emerald },
    "fire-red":    { card: card.frlg,                    diploma: dip.frlg },
    "leaf-green":  { card: card.frlg,                    diploma: dip.frlg },
    diamond:       { card: card.gen4 },
    pearl:         { card: card.gen4 },
    platinum:      { card: card.gen4 },
    "heart-gold":  { card: card.gen4 },
    "soul-silver": { card: card.gen4 },
  };
})();
