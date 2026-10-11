/* ==========================================================================
   Service worker — offline support + instant repeat visits.

   Strategy
   - install : pre-cache the app shell (always bypassing the HTTP cache) and every
               font file referenced by fonts.css (if the fonts were added).
   - fetch   : same-origin GET -> "stale-while-revalidate": answer from the cache
               immediately, refresh the cache in the background. Navigations fall
               back to the cached index.html when the network is down.
   - Third-party requests (Google Fonts) are NOT intercepted, so nothing opaque is
     stored and no storage quota is wasted.

   Release checklist: bump VERSION below whenever you deploy a new set of files.
   ========================================================================== */

const VERSION = 'v2.0.0';
const CACHE = 'age-dashboard-' + VERSION;

const SHELL = [
    './',
    'index.html',
    'style.css',
    'i18n.js',
    'effects.js',
    'share-card.js',
    'script.js',
    'manifest.webmanifest',
    'favicon.svg',
    'icon-192.png',
    'icon-512.png',
    'maskable-512.png',
    'apple-touch-icon.png',
    'fonts.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        const fresh = (url) => new Request(url, { cache: 'reload' });

        // Shell files must all succeed, otherwise the install is aborted and retried later
        await cache.addAll(SHELL.map(fresh));

        // Optional: font files declared in fonts.css (empty until the fonts are added)
        try {
            const css = await (await cache.match('fonts.css')).text();
            const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
                .map((m) => new URL(m[1], new URL('fonts.css', self.registration.scope)).href)
                .filter((u) => u.startsWith(self.registration.scope));
            await Promise.allSettled(urls.map((u) => cache.add(fresh(u))));
        } catch (_) { /* fonts are optional */ }

        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n.startsWith('age-dashboard-') && n !== CACHE).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;           // never touch third-party requests

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req, { ignoreSearch: true });

        const refresh = fetch(req).then((res) => {
            if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
            return res;
        });

        if (cached) {
            event.waitUntil(refresh.catch(() => {}));            // update in the background
            return cached;
        }
        try {
            return await refresh;
        } catch (err) {
            if (req.mode === 'navigate') {
                const shell = await cache.match('index.html');
                if (shell) return shell;
            }
            throw err;
        }
    })());
});
