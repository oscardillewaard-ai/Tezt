// Tussenstation (Cloudflare Worker) voor Tarapp -> Intervals.icu.
//
// Alleen nodig als intervals.icu geen verbindingen rechtstreeks vanuit de
// browser toestaat (CORS). Tarapp meldt dat dan bij het koppelen. Dit script
// stuurt /api/v1/... door naar https://intervals.icu, voegt CORS-headers toe
// voor de Tarapp-site en bewaart niets: de API-sleutel gaat alleen door in de
// Authorization-header.
//
// Neerzetten: dash.cloudflare.com -> Workers & Pages -> Create -> Worker,
// plak dit script, Deploy. Vul daarna in Tarapp bij Meer -> Horloge ->
// Geavanceerd -> Tussenstation het adres van de worker in
// (bijv. https://tarapp-icu.<jouw-naam>.workers.dev).

const ALLOWED_ORIGIN = 'https://oscardillewaard-ai.github.io'

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/v1/')) return new Response('Not found', { status: 404, headers: CORS })
    const upstream = await fetch(`https://intervals.icu${url.pathname}${url.search}`, {
      method: request.method,
      headers: {
        Authorization: request.headers.get('Authorization') || '',
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
      },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
    })
    const res = new Response(upstream.body, upstream)
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v)
    return res
  },
}
