// Network-first: haal altijd de nieuwste versie op als er internet is, val
// terug op de cache als je offline bent. Plannen zelf heeft internet nodig
// (BRouter en PDOK); offline zie je alleen de app en je bewaarde punten.
const CACHE = 'onverhard-v32'
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'bronnen.js',
  'kern.js',
  'graaf.js',
  'osmtegels.js',
  'hoogte.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'thema/trail.svg',
  'thema/contours.svg',
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
  // Alleen de app zelf; kaarttegels, BRouter en PDOK gaan rechtstreeks.
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
