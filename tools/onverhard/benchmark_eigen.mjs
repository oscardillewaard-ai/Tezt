// Vergelijk de eigen routeplanner (OpenStreetMap via Overpass, zelf rekenen)
// met Komoot-rondjes in trailrungebieden. Zelfde gebieden als benchmark_rondjes.mjs.
//
//   NODE_USE_ENV_PROXY=1 node tools/onverhard/benchmark_eigen.mjs <map met komoot-gpx> [uitvoer.json] [gebied ...]
//
// De Overpass-antwoorden worden in de map bewaard (overpass_<gebied>.json).
import fs from 'node:fs'
import path from 'node:path'

const K = await import('../../public/onverhard/kern.js')
const G = await import('../../public/onverhard/graaf.js')
const { analyseerRoute, Bgt } = await import('../../public/onverhard/bronnen.js')

const GEBIEDEN = {
  meijendel: { naam: 'Meijendel (Den Haag)', start: [52.13081, 4.35323], km: 15, gpx: 'k15.gpx' },
  rockanje: { naam: 'Voornes Duin (Rockanje)', start: [51.879447, 4.052784], km: 13, gpx: 'rockanje.gpx' },
  n70: { naam: 'N70, Berg en Dal', start: [51.81452, 5.940701], km: 15, gpx: '2897682117.gpx' },
  schoorl: { naam: 'Schoorlse Duinen', start: [52.706171, 4.691849], km: 14, gpx: 'e1027027754.gpx' },
  loonse: { naam: 'Loonse en Drunense Duinen', start: [51.656501, 5.082385], km: 11, gpx: 'e1837261631.gpx' },
  veluwezoom: { naam: 'Veluwezoom (Posbank)', start: [52.028607, 6.052066], km: 15, gpx: 'e1818667691.gpx' },
}
const SERVERS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']

const [map, uitvoer, ...keuze] = process.argv.slice(2)
const wacht = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(sleutel, [lat, lon], straal) {
  const bestand = path.join(map, `overpass_${sleutel}.json`)
  if (fs.existsSync(bestand)) return JSON.parse(fs.readFileSync(bestand, 'utf8'))
  const vraag = G.overpassVraag(lat, lon, straal)
  for (let poging = 0; poging < 10; poging++) {
    const url = SERVERS[poging % SERVERS.length]
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: vraag }), headers: { 'User-Agent': 'onverhard-planner/1.0' }, signal: AbortSignal.timeout(90000) })
      if (r.ok) {
        const tekst = await r.text()
        fs.writeFileSync(bestand, tekst)
        return JSON.parse(tekst)
      }
      console.log(`  overpass ${url.split('/')[2]}: HTTP ${r.status}`)
    } catch (fout) {
      console.log(`  overpass ${url.split('/')[2]}: ${fout.message}`)
    }
    await wacht(15000)
  }
  throw new Error('Overpass gaf geen antwoord')
}

const resultaten = []
for (const [sleutel, g] of Object.entries(GEBIEDEN)) {
  if (keuze.length && !keuze.includes(sleutel)) continue
  const gpx = fs.readFileSync(path.join(map, g.gpx), 'utf8')
  const coords = [...gpx.matchAll(/lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1]), null])
  const bgt = new Bgt()
  const ka = await analyseerRoute({ coords, segs: [[0, coords.length - 1, '']], punten: [] }, bgt)
  const t0 = Date.now()
  const data = await overpass(sleutel, g.start, 0.38 * g.km * 1000)
  const t1 = Date.now()
  const graaf = G.bouwGraaf(data.elements, { trail: true, strandMijden: true })
  const [sx, sy] = K.naarRd(g.start[1], g.start[0])
  const s = G.dichtsteKnoop(graaf, sx, sy)
  const z = G.zoekRondjes(graaf, s.knoop, g.km * 1000)
  const t2 = Date.now()
  const ons = []
  for (const r of z.rondjes.slice(0, 4)) {
    const tr = G.maakTraject(graaf, r.knopen, r.segs, [g.start])
    const an = await analyseerRoute(tr, bgt)
    const zacht = K.zachtAandeel(an, 'eind')
    const paadjes = K.paadjesAandeel(an)
    const strand = K.strandMeter(an)
    const af = Math.abs(an.lengte - g.km * 1000) / (g.km * 1000)
    const waarde = zacht + 0.5 * paadjes - 1.5 * an.dubbel - 4 * (strand / an.lengte) - 3 * Math.max(0, af - 0.1)
    ons.push({ km: an.lengte / 1000, zacht: K.zachtAandeel(an, 'bgt'), paadjes, dubbel: an.dubbel, strand, waarde, overlap: K.overlap(ka.xy, an.xy), lijn: tr.coords.map((c) => [c[1], c[0]]) })
  }
  ons.sort((a, b) => b.waarde - a.waarde)
  const t3 = Date.now()
  const rij = {
    gebied: g.naam, km: g.km, mb: (JSON.stringify(data).length / 1e6), knopen: graaf.n,
    sec: { overpass: (t1 - t0) / 1000, rekenen: (t2 - t1) / 1000, bgt: (t3 - t2) / 1000 },
    komoot: { km: ka.lengte / 1000, zacht: K.zachtAandeel(ka, 'bgt'), dubbel: ka.dubbel },
    ons, komootLijn: coords.map((c) => [c[1], c[0]]),
  }
  resultaten.push(rij)
  const f = (x) => (100 * x).toFixed(0).padStart(3) + '%'
  console.log(`${g.naam.padEnd(28)} ${rij.mb.toFixed(1)} MB ${graaf.n} knopen, rekenen ${rij.sec.rekenen.toFixed(1)} s, BGT ${rij.sec.bgt.toFixed(0)} s | Komoot ${rij.komoot.km.toFixed(1)} km zacht ${f(rij.komoot.zacht)} dubbel ${f(rij.komoot.dubbel)}`)
  for (const [i, o] of ons.entries()) console.log(`${''.padEnd(37)} | ${'ABCD'[i]}: ${o.km.toFixed(1)} km zacht ${f(o.zacht)} paadjes ${f(o.paadjes)} dubbel ${f(o.dubbel)} strand ${Math.round(o.strand)} m overlap ${f(o.overlap)}`)
  if (uitvoer) fs.writeFileSync(uitvoer, JSON.stringify(resultaten))
}
