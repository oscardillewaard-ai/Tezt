// Network-first: haal altijd de nieuwste versie op als er internet is, val
// terug op de cache als je offline bent (bijv. in de gym zonder bereik).
const CACHE = 'sportagenda-v40'
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'themes.css',
  'app.js',
  'plan5k.js',
  'icons.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
]

// Voeding (en de scanner met zijn .wasm) wordt pas opgehaald als iemand Voeding
// opent; dan vraagt de pagina om deze bestanden ook voor offline te bewaren.
const VOEDING = [
  'voeding/ui.js',
  'voeding/kern.js',
  'voeding/opslag.js',
  'voeding/sync.js',
  'voeding/basis.js',
  'voeding/nevo.js',
  'voeding/backup.js',
  'voeding/scanner.js',
  'voeding/ocr.js',
  'voeding/voeding.css',
  'voeding/vendor/barcode-detector.js',
  'voeding/vendor/zxing_reader.wasm',
]

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'voeding-precache') return
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(VOEDING.map((u) => c.match(u).then((hit) => hit || c.add(new Request(u, { cache: 'reload' }))))))
      .catch(() => {}),
  )
})

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
  // Alleen de app zelf; verzoeken naar andere sites (zoals de Intervals.icu-API,
  // met persoonlijke gegevens) niet onderscheppen en zeker niet opslaan.
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
