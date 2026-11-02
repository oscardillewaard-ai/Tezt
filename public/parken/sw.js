// Network-first: haal altijd de nieuwste versie op als er internet is, val
// terug op de cache als je offline bent (bijv. midden in een park zonder bereik).
const CACHE = 'parken-v1'
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'parks.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  // Alleen de app zelf; kaarttegels van OpenStreetMap laat de browser zelf
  // cachen (hun gebruiksregels vragen om geen bulkopslag).
  if (new URL(event.request.url).origin !== self.location.origin) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      try {
        // no-cache: altijd bij de server navragen of er iets nieuws is (GitHub
        // Pages laat de browser anders tot 10 minuten een oude kopie gebruiken).
        const res = await fetch(event.request, { cache: 'no-cache' })
        if (res.ok) cache.put(event.request, res.clone())
        return res
      } catch {
        const cached = await cache.match(event.request, { ignoreSearch: true })
        return cached || Response.error()
      }
    })(),
  )
})
