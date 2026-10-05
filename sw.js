"use strict";
// Service worker: makes the tracker load instantly and work offline.
//
//   App files (HTML, CSS, JS, data/*.json)  stale-while-revalidate: served from the cache at once, then
//                                           refreshed in the background, so a new release arrives on the next load.
//   Images and fonts (assets/*)             cache-first: fetched once, then never again. Sprites are only cached
//                                           after they've been shown (there are thousands), so a game works offline
//                                           once you've scrolled through it online.
//   Everything else (other sites, test.html, tests/) is left alone.
//
// Saved progress is in localStorage, which this file never touches.
//
// WHEN TO CHANGE THE CACHE NAMES (bump the number):
//   ASSET_CACHE: when you replace an existing image or font IN PLACE (same file name). Assets are cache-first, so
//                otherwise users keep the old picture forever. New files with new names don't need a bump.
//   SHELL_CACHE: only to purge it, e.g. after deleting or renaming files. Ordinary edits update themselves.
const SHELL_CACHE = "pokedex-shell-v1";
const ASSET_CACHE = "pokedex-assets-v1";

// Downloaded when the worker installs. Paths are relative to this file. A missing file is skipped, not fatal.
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/style.css",
  "js/config.js", "js/cards.js", "js/store.js", "js/storage.js", "js/theme.js", "js/forms.js", "js/where.js", "js/app.js",
  "data/games.json", "data/pokemon.json", "data/regional.json", "data/forms.json",
  "data/locations.json",              // so "where to find" works offline; remove this line if the file gets too big
  "icons/icon-192.png", "icons/icon-512.png",
];
const ASSETS = ["assets/fonts/pkmn-rbygsc.ttf", "assets/fonts/pokemon-rs.ttf", "assets/fonts/pokemon-frlg.ttf"];

const SCOPE = self.registration.scope;                    // e.g. https://name.github.io/pokedex/
const BASE = new URL(SCOPE).pathname;
const INDEX = new URL("index.html", SCOPE).href;

async function precache(name, urls) {
  const cache = await caches.open(name);
  // cache:"reload" skips the browser's HTTP cache so a new install never stores a stale copy
  await Promise.allSettled(urls.map(u => cache.add(new Request(u, { cache: "reload" }))));
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    await Promise.all([precache(SHELL_CACHE, SHELL), precache(ASSET_CACHE, ASSETS)]);
    await self.skipWaiting();                             // don't wait for every tab to close
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith("pokedex-") && k !== SHELL_CACHE && k !== ASSET_CACHE) await caches.delete(k);
    }
    await self.clients.claim();                           // start serving the page that registered us
  })());
});

async function cacheFirst(req) {
  const cache = await caches.open(ASSET_CACHE), hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.status === 200) cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();                              // offline and never cached: the <img> just stays empty
  }
}

async function staleWhileRevalidate(e) {
  const req = e.request, cache = await caches.open(SHELL_CACHE), cached = await cache.match(req);
  const update = fetch(new Request(req, { cache: "no-cache" }))   // revalidate with the server (cheap 304 when unchanged)
    .then(res => { if (res.status === 200) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (cached) { e.waitUntil(update); return cached; }
  return (await update) || (req.mode === "navigate" && (await cache.match(INDEX))) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  const path = url.pathname.slice(BASE.length);
  if (/^tests?(\/|\.html$)/.test(path)) return;           // the render-check page and its baselines must always be fresh
  e.respondWith(path.startsWith("assets/") ? cacheFirst(req) : staleWhileRevalidate(e));
});