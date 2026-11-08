// Phase 1 service worker. It keeps only what's the same for everyone and never changes under its name: the build's
// hashed files (/_next/static/), the install icons, and the offline page. Pages, API answers, images people choose,
// and anything signed in always go to the network and are never stored, so a shared phone keeps no one's data here.
// When a page can't be reached at all, the offline page says so; it never suggests anything was saved.
"use strict";

const CACHE = "fit-static-v1";
const OFFLINE = "/offline.html";

/** The one rule for what may be stored: a same-origin GET of a public, immutable or static file. */
function cacheable(url, request) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;
  if (url.search) return false;
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === OFFLINE;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (cacheable(url, request)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
      return res;
    })));
    return;
  }
  // A page: always the network. Only if it can't be reached at all, the offline page, which holds no one's data.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
  }
  // Everything else, API calls and uploads among them, isn't touched: the browser sends it as usual.
});

// For the tests: the rule, without a worker.
if (typeof module !== "undefined") module.exports = { cacheable, CACHE, OFFLINE };
