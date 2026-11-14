// Vergelijkt de rondjes van de webapp met Komoot-routes in trailgebieden.
//
//   NODE_USE_ENV_PROXY=1 node tools/onverhard/benchmark_rondjes.mjs <map met komoot-gpx> [uitvoer.json] [gebied ...]
//
// Per gebied: een startpunt, een lengte en een Komoot-route (GPX) als referentie.
// Komoot wordt langs de officiële kaart gelegd (OpenStreetMap-tags hebben we
// voor Komoot niet), onze routes ook. Overlap = deel van onze route over
// dezelfde paden als Komoot.
import fs from 'node:fs'
import path from 'node:path'

const echt = globalThis.fetch
let nB = 0
let n403 = 0
globalThis.fetch = async (u, o) => {
  const r = await echt(u, o)
  if (String(u).includes('brouter.de')) {
    nB += 1
    if (r.status === 403) n403 += 1
  }
  return r
}
const { maakPlan, analyseerRoute, Bgt } = await import('../../public/onverhard/bronnen.js')
const K = await import('../../public/onverhard/kern.js')

const GEBIEDEN = {
  meijendel: { naam: 'Meijendel (Den Haag)', start: [52.13081, 4.35323], km: 15, gpx: 'k15.gpx' },
  rockanje: { naam: 'Voornes Duin (Rockanje)', start: [51.879447, 4.052784], km: 13, gpx: 'rockanje.gpx' },
  n70: { naam: 'N70, Berg en Dal', start: [51.81452, 5.940701], km: 15, gpx: '2897682117.gpx' },
  schoorl: { naam: 'Schoorlse Duinen', start: [52.706171, 4.691849], km: 14, gpx: 'e1027027754.gpx' },
  loonse: { naam: 'Loonse en Drunense Duinen', start: [51.656501, 5.082385], km: 11, gpx: 'e1837261631.gpx' },
  veluwezoom: { naam: 'Veluwezoom (Posbank)', start: [52.028607, 6.052066], km: 15, gpx: 'e1818667691.gpx' },
}

const [map, uitvoer = null, ...kies] = process.argv.slice(2)
const resultaten = []
for (const [sleutel, g] of Object.entries(GEBIEDEN)) {
  if (kies.length && !kies.includes(sleutel)) continue
  const gpx = fs.readFileSync(path.join(map, g.gpx), 'utf8')
  const coords = [...gpx.matchAll(/lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1]), null])
  const ka = await analyseerRoute({ coords, segs: [[0, coords.length - 1, '']], punten: [] }, new Bgt())
  nB = 0
  n403 = 0
  const t0 = Date.now()
  let p
  try {
    p = await maakPlan({ punten: [g.start], rondjeKm: g.km, alternatieven: 2 })
  } catch (fout) {
    console.log(`${g.naam}: FOUT ${fout.message}`)
    continue
  }
  const sec = Math.round((Date.now() - t0) / 1000)
  const rij = {
    gebied: g.naam, km: g.km, sec, brouter: nB, probeerLater: n403,
    komoot: { km: ka.lengte / 1000, zacht: K.zachtAandeel(ka, 'bgt'), dubbel: ka.dubbel },
    ons: p.opties.map((o) => ({
      naam: o.naam, km: o.km, zacht: K.zachtAandeel(o.analyse, 'bgt'), paadjes: o.paadjes, dubbel: o.dubbel,
      strand: o.strand, overlap: K.overlap(ka.xy, o.analyse.xy), lijn: o.traject.coords.map((c) => [c[1], c[0]]),
    })),
    komootLijn: coords.map((c) => [c[1], c[0]]),
    uitleg: p.uitleg,
  }
  resultaten.push(rij)
  const f = (x) => (100 * x).toFixed(0).padStart(3) + '%'
  console.log(`${g.naam.padEnd(28)} ${String(sec).padStart(4)} s ${String(nB).padStart(3)} BRouter | Komoot ${rij.komoot.km.toFixed(1)} km zacht ${f(rij.komoot.zacht)} dubbel ${f(rij.komoot.dubbel)}`)
  for (const o of rij.ons) console.log(`${''.padEnd(37)} | ${o.naam}: ${o.km.toFixed(1)} km zacht ${f(o.zacht)} paadjes ${f(o.paadjes)} dubbel ${f(o.dubbel)} strand ${Math.round(o.strand)} m overlap ${f(o.overlap)}`)
  if (uitvoer) fs.writeFileSync(uitvoer, JSON.stringify(resultaten))
}
