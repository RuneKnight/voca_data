const CACHE_NAME = 'langhub-pro-v3';
const SHELL_ASSETS = [
  './',
  './index.html',
  './assets/app.css',
  './manifest.json',
  './icon.svg',
  './data/profiles.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function notifyClientsDataUpdated(pathname) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    client.postMessage({ type: 'DATA_UPDATED', pathname });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate for JSON data files + notify clients when content actually changes
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const prevTextPromise = cached ? cached.clone().text().catch(() => null) : Promise.resolve(null);

        const networkPromise = fetch(request)
          .then(async (resp) => {
            if (resp && resp.ok) {
              const respForCache = resp.clone();
              const respForCompare = resp.clone();
              await cache.put(request, respForCache);

              if (cached) {
                const [prevText, nextText] = await Promise.all([
                  prevTextPromise,
                  respForCompare.text().catch(() => null),
                ]);
                if (prevText !== null && nextText !== null && prevText !== nextText) {
                  await notifyClientsDataUpdated(url.pathname);
                }
              }
            }
            return resp;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }
        return (await networkPromise) || new Response('[]', { status: 503 });
      })
    );
    return;
  }

  // Network-first with cache fallback for HTML/CSS/shell assets so updates arrive promptly
  event.respondWith(
    fetch(request)
      .then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(request))
  );
});
