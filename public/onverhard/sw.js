// Network-first: haal altijd de nieuwste versie op als er internet is, val
// terug op de cache als je offline bent. Plannen zelf heeft internet nodig
// (BRouter en PDOK); offline zie je alleen de app en je bewaarde punten.
const CACHE = 'onverhard-v45'
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'sheet.js',
  'teller.js',
  'gebieden.js',
  'meting.js',
  'datacache.js',
  'rekenen.js',
  'rekenwerker.js',
  'korrelkaart.js',
  'bronnen.js',
  'kern.js',
  'graaf.js',
  'osmtegels.js',
  'hoogte.js',
  'blokgraaf.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'vendor/maplibre-gl.js',
  'vendor/maplibre-gl.css',
  'vendor/leaflet-maplibre-gl.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'fonts/darker-grotesque-latin-variable.woff2',
  'fonts/karla-latin-variable.woff2',
  'fonts/overpass-mono-latin-variable.woff2',
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
      // alleen oude app-caches weg; de datacache (kaarttegels, BGT, AHN) blijft staan
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('onverhard-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  // Alleen de app zelf; kaarttegels, BRouter en PDOK gaan rechtstreeks.
  if (new URL(event.request.url).origin !== self.location.origin) return
  // de blokken van de vooraf bewerkte graaf: die bewaart de datacache al (onveranderlijk, versie in het pad)
  if (/\/graaf\/[^?]+\.npg\.gz$/.test(new URL(event.request.url).pathname)) return
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
