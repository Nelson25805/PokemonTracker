"use strict";
// Service worker: instant loading and offline use. Saved progress lives in localStorage, which this file never touches.
//   App files (HTML, CSS, JS, data/*.json)  stale-while-revalidate: served from cache, refreshed in the background.
//   Images and fonts (assets/*)             cache-first, cached once shown.   Everything else (other sites, test.html, tests/) is untouched.
// Bump ASSET_CACHE when replacing an existing image or font in place (same name). Bump SHELL_CACHE only to purge deleted / renamed files.
const SHELL_CACHE = "pokedex-shell-v2";
const ASSET_CACHE = "pokedex-assets-v2";

const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/style.css",
  "js/config.js", "js/cards.js", "js/store.js", "js/storage.js", "js/theme.js", "js/forms.js", "js/maps.js", "js/where.js", "js/eggs.js", "js/app.js",
  "data/games.config.json", "data/pokemon.json", "data/regional.json", "data/forms.json",
  "data/locations.json", "data/orre.json", "data/pokewalker.json", "data/items.json", "data/maps.json", "data/form-areas.json", "data/honey.json", "data/egg-words.json", "data/special-encounters.json",
  "icons/icon-192.png", "icons/icon-512.png",
];
const ASSETS = ["assets/fonts/pkmn-rbygsc.ttf", "assets/fonts/pokemon-rs.ttf", "assets/fonts/pokemon-frlg.ttf"];

const SCOPE = self.registration.scope;
const BASE = new URL(SCOPE).pathname;
const INDEX = new URL("index.html", SCOPE).href;

async function precache(name, urls) {
  const cache = await caches.open(name);
  await Promise.allSettled(urls.map(u => cache.add(new Request(u, { cache: "reload" }))));
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    await Promise.all([precache(SHELL_CACHE, SHELL), precache(ASSET_CACHE, ASSETS)]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith("pokedex-") && k !== SHELL_CACHE && k !== ASSET_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
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
    return Response.error();
  }
}

async function staleWhileRevalidate(e) {
  const req = e.request, cache = await caches.open(SHELL_CACHE), cached = await cache.match(req);
  const update = fetch(new Request(req, { cache: "no-cache" }))
    .then(res => { if (res.status === 200) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (cached) { e.waitUntil(update); return cached; }
  return (await update) || (req.mode === "navigate" && (await cache.match(INDEX))) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  const path = url.pathname.slice(BASE.length);
  if (/^(tests?(\/|\.html$)|map-editor\.html$)/.test(path)) return;
  e.respondWith(path.startsWith("assets/") ? cacheFirst(req) : staleWhileRevalidate(e));
});