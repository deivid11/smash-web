/* Smash Web offline shell: cache the app (play.html + JS/CSS/WASM) and the
 * source manifest on the first online visit, so later visits boot and play
 * from the download with no network. Original game ranges stay in the page's
 * identity-keyed asset caches (lib/hsd/asset-fetch.ts) and are only
 * re-downloaded when the manifest identity changes (server update).
 *
 * Hand-rolled on purpose: no build plugin, ships as-is from web/public/.
 * file:// shells (packaged APK fallback) cannot register service workers,
 * so this only runs on https origins (a deployed HTTPS host). */
const SHELL_CACHE = 'smash-shell-v1';
const MANIFEST_PATH = '/api/source';
const SOURCE_CACHE = 'smash-manifest';
const SOURCE_REQUEST = '/__smash_manifest__/current';

/** Asset URLs referenced by an app document (relative ./assets|wasm|custom). */
function shellAssets(html, base) {
  const urls = new Set([base]);
  const pattern = /(?:src|href)="(\.\/[^"]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      urls.add(new URL(match[1], base).toString());
    } catch (_) { /* ignore unresolvable refs */ }
  }
  return [...urls].slice(0, 120);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const page = await fetch('play.html', { cache: 'no-store' }).catch(() => null);
      if (!page || !page.ok) return;
      const html = await page.text();
      const urls = shellAssets(html, new URL('play.html', self.location.href).href);
      await cache.addAll(urls.map((url) => new Request(url, { cache: 'no-store' }))).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop older shell generations; per-disc asset caches and the persisted
      // manifest are identity-versioned elsewhere and survive shell updates.
      for (const name of await caches.keys()) {
        if (name.startsWith('smash-shell-') && name !== SHELL_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

async function networkFirstWithCache(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request, { cacheName: SHELL_CACHE });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl, { cacheName: SHELL_CACHE });
      if (fallback) return fallback;
    }
    throw _;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Source manifest: fresh when online (update check), persisted reply when not.
  if (url.pathname === MANIFEST_PATH) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const store = await caches.open(SOURCE_CACHE);
            await store.put(SOURCE_REQUEST, response.clone()).catch(() => {});
          }
          return response;
        } catch (_) {
          const store = await caches.open(SOURCE_CACHE).catch(() => null);
          const cached = store ? await store.match(SOURCE_REQUEST) : null;
          if (cached) return cached;
          throw _;
        }
      })(),
    );
    return;
  }

  // Asset ranges stay on the page-owned transport (identity-keyed Cache
  // Storage with byte-exact 206 replays); the worker never double-stores them.
  if (url.pathname.startsWith('/api/assets/')) return;

  // Gameplay WASM is URL-stable across builds (no content hash), so a
  // cache-first serve would pin stale physics against a new frontend.
  // Network-first like navigations: fresh when online, cached when offline.
  if (/\.wasm$/.test(url.pathname)) {
    event.respondWith(networkFirstWithCache(request, null));
    return;
  }

  // App shell files: serve instantly, refresh in the background when online.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithCache(request, new URL('play.html', self.location.href).href));
    return;
  }
  if (/\.(?:js|css|wasm|map|png|jpg|svg|html|json)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: SHELL_CACHE });
        const refresh = fetch(request)
          .then(async (response) => {
            if (response && response.ok) {
              const cache = await caches.open(SHELL_CACHE);
              await cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(refresh);
          return cached;
        }
        const fresh = await refresh;
        if (fresh) return fresh;
        throw new Error('Offline and not cached: ' + url.pathname);
      })(),
    );
  }
});
