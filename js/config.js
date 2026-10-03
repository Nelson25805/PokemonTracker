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
//   sources:  keys of the games whose Pokémon can reach this game (itself first); used by the "where to find" panel
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

  // Which games can send Pokémon into each game, the game itself first. The "where to find" panel
  // shows locations from all of them.
  //   Same generation:  trading.
  //   Gen 1 <-> Gen 2:  Time Capsule (going back to Gen 1 only works for Gen 1 species that know no Gen 2 moves).
  //   Gen 3 -> Gen 4:   Pal Park, one-way: Gen 4 games can't send Pokémon back to Gen 3.
  //   Gen 3 can't receive from Gen 1/2, and Gen 1/2 can't receive from Gen 3/4.
  const gen1 = ["red", "blue", "yellow"], gen2 = ["gold", "silver", "crystal"];
  const gen3 = ["ruby", "sapphire", "emerald", "fire-red", "leaf-green"];
  const gen4 = ["diamond", "pearl", "platinum", "heart-gold", "soul-silver"];
  const from = (key, ...groups) => [key, ...groups.flat().filter(k => k !== key)];

  return {
    red:           { card: { ...card.rby, dir: "Red" },  diploma: dip.rb,      sources: from("red", gen1, gen2) },   // Red/Blue cards live in per-game folders
    blue:          { card: { ...card.rby, dir: "Blue" }, diploma: dip.rb,      sources: from("blue", gen1, gen2) },
    yellow:        { card: card.rby,                     diploma: dip.yellow,  sources: from("yellow", gen1, gen2) },
    gold:          { card: card.gs,                      diploma: dip.gs,      sources: from("gold", gen2, gen1) },
    silver:        { card: card.gs,                      diploma: dip.gs,      sources: from("silver", gen2, gen1) },
    crystal:       { card: { ...card.gs, gender: true }, diploma: dip.crystal, sources: from("crystal", gen2, gen1) },
    ruby:          { card: card.rs,                      diploma: dip.rs,      sources: from("ruby", gen3) },
    sapphire:      { card: card.rs,                      diploma: dip.rs,      sources: from("sapphire", gen3) },
    emerald:       { card: card.emerald,                 diploma: dip.emerald, sources: from("emerald", gen3) },
    "fire-red":    { card: card.frlg,                    diploma: dip.frlg,    sources: from("fire-red", gen3) },
    "leaf-green":  { card: card.frlg,                    diploma: dip.frlg,    sources: from("leaf-green", gen3) },
    diamond:       { card: card.gen4, sources: from("diamond", gen4, gen3) },
    pearl:         { card: card.gen4, sources: from("pearl", gen4, gen3) },
    platinum:      { card: card.gen4, sources: from("platinum", gen4, gen3) },
    "heart-gold":  { card: card.gen4, sources: from("heart-gold", gen4, gen3) },
    "soul-silver": { card: card.gen4, sources: from("soul-silver", gen4, gen3) },
  };
})();

// Which regional Pokédex each game uses (keys match data/regional.json) and its display name.
// Built by build_regional.py. Red/Blue/Yellow's Kanto list equals the national list, so the Dex
// dropdown disables itself for them.
const REGIONAL = {
  red: { dex: "kanto", name: "Kanto" }, blue: { dex: "kanto", name: "Kanto" }, yellow: { dex: "kanto", name: "Kanto" },
  gold: { dex: "original-johto", name: "Johto" }, silver: { dex: "original-johto", name: "Johto" }, crystal: { dex: "original-johto", name: "Johto" },
  ruby: { dex: "hoenn", name: "Hoenn" }, sapphire: { dex: "hoenn", name: "Hoenn" }, emerald: { dex: "hoenn", name: "Hoenn" },
  "fire-red": { dex: "kanto", name: "Kanto" }, "leaf-green": { dex: "kanto", name: "Kanto" },
  diamond: { dex: "original-sinnoh", name: "Sinnoh" }, pearl: { dex: "original-sinnoh", name: "Sinnoh" },
  platinum: { dex: "extended-sinnoh", name: "Sinnoh" },
  "heart-gold": { dex: "updated-johto", name: "Johto" }, "soul-silver": { dex: "updated-johto", name: "Johto" },
};
