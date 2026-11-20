// Nopav.es is verhuisd naar https://oscardillewaard-ai.github.io/nopaves/.
// Deze service worker vervangt de oude: hij wist de oude app-caches (onverhard-*), meldt zichzelf af
// en laat open vensters opnieuw laden, zodat ze de doorverwijspagina krijgen.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('onverhard-')).map((k) => caches.delete(k)))
    await self.registration.unregister()
    const vensters = await self.clients.matchAll({ type: 'window' })
    for (const v of vensters) v.navigate(v.url).catch(() => {})
  })())
})
