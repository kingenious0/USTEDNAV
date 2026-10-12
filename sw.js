/**
 * USTED NAV Service Worker — Offline Support
 * Caches app shell + tile images for offline use
 */

const CACHE_NAME  = 'ustednav-v1.3.8';
const TILE_CACHE  = 'ustednav-tiles-v1';

// App shell and Studio admin files to precache on install
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/map.html',
    '/about.html',
    '/guide.html',
    '/privacy/',
    '/directory/',
    '/admin/',
    '/admin/index.html',
    '/admin/app.js',
    '/admin/sync.js',
    '/admin/config.js',
    '/admin/seed_data.js',
    '/admin/seed_data.json',
    '/admin/manifest.webmanifest',
    '/admin/sw.js',
    './',
    './index.html',
    './map.html',
    './about.html',
    './guide.html',
    './privacy/',
    './directory/',
    './admin/',
    './admin/index.html',
    './admin/app.js',
    './admin/sync.js',
    './admin/config.js',
    './admin/seed_data.js',
    './admin/seed_data.json',
    './admin/manifest.webmanifest',
    './admin/sw.js',
    './config.js',
    '/config.js',
    './modules/telemetry.js',
    '/modules/telemetry.js',
    './modules/data-loader.js',
    '/modules/data-loader.js',
    './modules/search.js',
    '/modules/search.js',
    './modules/navi-bridge.js',
    '/modules/navi-bridge.js',
    './modules/map.js',
    '/modules/map.js',
    './logo.png',
    '/logo.png',
    './manifest.json',
    '/manifest.json',
    './icons/icon-192.png',
    '/icons/icon-192.png',
    './icons/icon-192-maskable.png',
    '/icons/icon-192-maskable.png',
    './icons/icon-512.png',
    '/icons/icon-512.png',
    './icons/icon-512-maskable.png',
    '/icons/icon-512-maskable.png',
    './screenshots/screenshot-mobile.png',
    '/screenshots/screenshot-mobile.png',
    './screenshots/screenshot-desktop.png',
    '/screenshots/screenshot-desktop.png',
    './data/buildings.json',
    '/data/buildings.json',
    './data/people.json',
    '/data/people.json',
    './data/campus.geojson',
    '/data/campus.geojson',
    './data/roads.geojson',
    '/data/roads.geojson',
    './js/cesium-viewer.js',
    '/js/cesium-viewer.js',
    './js/view-controller.js',
    '/js/view-controller.js',
    './js/routing/graph-schema.js',
    './js/routing/graph-validator.js',
    './js/routing/cost-model.js',
    './js/routing/spatial-snapper.js',
    './js/routing/a-star.js',
    './js/routing/maneuver-generator.js',
    './js/routing/graph-builder.js',
    './js/routing/routing-engine.js',
    './js/routing/routing-adapter.js',
    // Studio styling, Leaflet, Mapbox, FontAwesome, Fonts & CDNs used in Studio
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
    'https://api.mapbox.com/mapbox-gl-js/v3.1.2/mapbox-gl.js',
    'https://api.mapbox.com/mapbox-gl-js/v3.1.2/mapbox-gl.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

const APP_SHELL = PRECACHE_ASSETS;

// ── INSTALL: cache app shell safely with deduplication & skipWaiting ──
self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            // Deduplicate resolved URLs
            const resolvedUrls = Array.from(new Set(PRECACHE_ASSETS.map(url => {
                try {
                    return new URL(url, self.location.href).href;
                } catch(err) {
                    return url;
                }
            })));

            // Cache items individually so one non-critical failure doesn't abort whole install
            await Promise.all(
                resolvedUrls.map(url =>
                    cache.add(url).catch(err => {
                        console.warn('SW: Cache failed for asset:', url, err);
                    })
                )
            );

            // Explicitly ensure /admin/ and /admin are mirrored from /admin/index.html
            const adminHtmlUrl = new URL('/admin/index.html', self.location.href).href;
            const adminHtmlResp = await cache.match(adminHtmlUrl);
            if (adminHtmlResp) {
                const adminSlash = new URL('/admin/', self.location.href).href;
                const adminNoSlash = new URL('/admin', self.location.href).href;
                await cache.put(adminSlash, adminHtmlResp.clone());
                await cache.put(adminNoSlash, adminHtmlResp.clone());
            }

            // Explicitly ensure / and /index.html are mirrored from /map.html or /index.html
            const mapHtmlUrl = new URL('/map.html', self.location.href).href;
            const mapHtmlResp = await cache.match(mapHtmlUrl);
            if (mapHtmlResp) {
                const rootSlash = new URL('/', self.location.href).href;
                const indexUrl = new URL('/index.html', self.location.href).href;
                const rootMatch = await cache.match(rootSlash);
                if (!rootMatch) await cache.put(rootSlash, mapHtmlResp.clone());
                const idxMatch = await cache.match(indexUrl);
                if (!idxMatch) await cache.put(indexUrl, mapHtmlResp.clone());
            }
        })
    );
});

// ── ACTIVATE: clean up old caches & claim clients immediately ──
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys
                .filter(k => k !== CACHE_NAME && k !== TILE_CACHE)
                .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ── FETCH: Stale-While-Revalidate for HTML, JS, CSS, JSON & Assets ──
self.addEventListener('fetch', e => {
    // Only handle GET requests
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);
    if (!url.protocol.startsWith('http')) return;

    // Bypass Supabase API requests (handled directly by offline-first IndexedDB queue)
    if (url.hostname.includes('supabase.co')) return;

    // Bypass Cloud Navi backend API endpoints (/api/*, /health, /parse)
    if (url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname === '/parse') return;

    // Skip Mapbox events/telemetry
    if (url.hostname.includes('events.mapbox.com')) return;

    // Cache map tiles & Mapbox API with tile cache
    if (url.hostname.includes('tile.openstreetmap.org') ||
        url.hostname.includes('arcgisonline.com') ||
        url.hostname.includes('tiles.mapbox.com') ||
        url.hostname.includes('api.mapbox.com')) {
        e.respondWith(cacheTile(e.request));
        return;
    }

    // ── NAVIGATION ROUTING: Dedicated offline App Shell routing for standalone PWA & browser ──
    if (e.request.mode === 'navigate' || e.request.destination === 'document') {
        // Admin Studio navigation routing (/admin, /admin/, /admin/*)
        if (url.pathname.startsWith('/admin')) {
            e.respondWith(
                (async () => {
                    const cache = await caches.open(CACHE_NAME);
                    try {
                        const networkResponse = await fetch(e.request);
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(e.request, networkResponse.clone());
                            cache.put('/admin/', networkResponse.clone());
                            cache.put('/admin/index.html', networkResponse.clone());
                        }
                        return networkResponse;
                    } catch (netErr) {
                        // Offline navigation fallback: match any cached admin document
                        const adminMatch = (await cache.match(e.request, { ignoreSearch: true })) ||
                                           (await cache.match('/admin/index.html')) ||
                                           (await cache.match('/admin/')) ||
                                           (await cache.match('/admin')) ||
                                           (await cache.match('./admin/index.html')) ||
                                           (await cache.match('./admin/')) ||
                                           (await caches.match('/admin/index.html')) ||
                                           (await caches.match('/admin/')) ||
                                           (await caches.match(e.request));
                        if (adminMatch) {
                            return adminMatch;
                        }
                        return new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><title>CampusOS Studio - Offline</title><base href="/admin/"><link rel="manifest" href="/admin/manifest.webmanifest"></head><body style="background:#090d16;color:#e2e8f0;font-family:sans-serif;padding:2rem;text-align:center;"><h2>CampusOS Studio is Offline</h2><p>Please connect to the internet once to complete caching, then reload.</p><button onclick="location.reload()" style="background:#4f46e5;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;">Retry</button></body></html>', {
                            status: 200,
                            headers: { 'Content-Type': 'text/html; charset=utf-8' }
                        });
                    }
                })()
            );
            return;
        }

        // Main Campus navigation routing (/ or /index.html or /map.html)
        e.respondWith(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                try {
                    const networkResponse = await fetch(e.request);
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(e.request, networkResponse.clone());
                    }
                    return networkResponse;
                } catch (netErr) {
                    const mainMatch = (await cache.match(e.request, { ignoreSearch: true })) ||
                                      (await cache.match('/map.html')) ||
                                      (await cache.match('/index.html')) ||
                                      (await cache.match('/')) ||
                                      (await cache.match('./map.html')) ||
                                      (await cache.match('./index.html')) ||
                                      (await cache.match('./')) ||
                                      (await caches.match('/map.html')) ||
                                      (await caches.match('/index.html')) ||
                                      (await caches.match(e.request));
                    if (mainMatch) {
                        return mainMatch;
                    }
                    return new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><title>USTED Nav - Offline</title></head><body style="background:#090d16;color:#e2e8f0;font-family:sans-serif;padding:2rem;text-align:center;"><h2>USTED Nav is Offline</h2><p>Please connect to the internet once to load the map shell.</p><button onclick="location.reload()" style="background:#4f46e5;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;">Retry</button></body></html>', {
                        status: 200,
                        headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    });
                }
            })()
        );
        return;
    }

    // Network-First for dynamic JSON data endpoints (e.g. data/people.json, data/buildings.json, admin/seed_data.json)
    // Ensures cache busting for local fetches while preserving 100% offline fallback
    if (url.pathname.endsWith('.json') || url.pathname.includes('/data/')) {
        e.respondWith(
            fetch(e.request).then(networkResponse => {
                if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                    const cloned = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, cloned));
                }
                return networkResponse;
            }).catch(async () => {
                const cache = await caches.open(CACHE_NAME);
                const cached = (await cache.match(e.request, { ignoreSearch: true })) ||
                               (await cache.match(url.pathname)) ||
                               (await caches.match(e.request));
                if (cached) return cached;
                return new Response(JSON.stringify([]), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200
                });
            })
        );
        return;
    }

    // Stale-While-Revalidate strategy for app shell, data, styles, and scripts
    e.respondWith(
        caches.open(CACHE_NAME).then(async cache => {
            const cachedResponse = (await cache.match(e.request, { ignoreSearch: true })) ||
                                   (await cache.match(url.pathname)) ||
                                   (await caches.match(e.request));

            // Revalidate in background from network
            const networkFetch = fetch(e.request).then(networkResponse => {
                if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                    cache.put(e.request, networkResponse.clone());
                }
                return networkResponse;
            }).catch(() => null);

            // Return cached version immediately if available
            if (cachedResponse) {
                return cachedResponse;
            }

            // Otherwise wait for network response
            const netResp = await networkFetch;
            if (netResp) return netResp;

            return new Response('Offline: Content not available in cache.', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
            });
        })
    );
});

// Cache tile with stale-while-revalidate
async function cacheTile(request) {
    const cache  = await caches.open(TILE_CACHE);
    const cached = await cache.match(request);

    if (!navigator.onLine && cached) {
        return cached;
    }

    const networkFetch = fetch(request).then(resp => {
        if (resp && (resp.status === 200 || resp.type === 'opaque')) {
            cache.put(request, resp.clone());
        }
        return resp;
    }).catch(() => null);

    if (cached) return cached;
    const netResp = await networkFetch;
    if (netResp) return netResp;

    // Return empty 204 or transparent fallback if tile cannot be fetched while offline
    return new Response('', { status: 204, statusText: 'No Content (Offline)' });
}

// ── BACKGROUND SYNC ──
self.addEventListener('sync', event => {
    if (event.tag === 'sync-campus-data') {
        event.waitUntil(
            caches.open(CACHE_NAME).then(cache => cache.addAll([
                './data/buildings.json',
                './data/campus.geojson'
            ])).catch(() => {})
        );
    }
});

// ── PERIODIC BACKGROUND SYNC ──
self.addEventListener('periodicsync', event => {
    if (event.tag === 'update-campus-cache') {
        event.waitUntil(
            caches.open(CACHE_NAME).then(cache => cache.addAll([
                './data/buildings.json',
                './data/roads.geojson'
            ])).catch(() => {})
        );
    }
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
    const title = 'USTED Nav';
    const options = {
        body: event.data ? event.data.text() : 'Campus updates and room navigation are ready.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png'
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes('map.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/map.html');
            }
        })
    );
});
