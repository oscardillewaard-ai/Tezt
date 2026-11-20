// Zuinig ophalen met een lokale schijfcache: elk adres één keer, een paar tegelijk, herhalen bij fouten.
// Gebruikt door bouw.mjs voor OpenFreeMap-tegels, BGT-tegels (PDOK) en AHN-blokken (PDOK).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export const CACHE = process.env.GRAAF_CACHE || path.join(process.env.HOME || '.', '.cache', 'nopaves-graaf')
export const teller = { net: 0, cache: 0, bytes: 0, fout: 0 }
const wacht = (ms) => new Promise((r) => setTimeout(r, ms))

/** Bytes van een adres (of null bij 204/404), uit de cache als die er is. maxDagen: ouder = opnieuw halen. */
export async function haal(url, bestand, { maxDagen = Infinity } = {}) {
  const pad = path.join(CACHE, bestand)
  if (fs.existsSync(pad)) {
    const oud = (Date.now() - fs.statSync(pad).mtimeMs) / 86400000
    if (oud <= maxDagen) {
      teller.cache++
      const b = fs.readFileSync(pad)
      return b.length === 0 ? null : new Uint8Array(b)
    }
  }
  if (fs.existsSync(pad + '.leeg')) { teller.cache++; return null }
  for (let poging = 0; poging < 5; poging++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'nopaves-graaf/1 (voorbewerking, eenmalig per week)' }, signal: AbortSignal.timeout(60000) })
      if (r.status === 204 || r.status === 404) {
        fs.mkdirSync(path.dirname(pad), { recursive: true })
        fs.writeFileSync(pad + '.leeg', '')
        teller.net++
        return null
      }
      if ([429, 500, 502, 503, 504].includes(r.status)) throw new Error(`HTTP ${r.status}`)
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${url}`), { blijvend: true })
      let b = new Uint8Array(await r.arrayBuffer())
      teller.bytes += b.length
      if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(zlib.gunzipSync(b))
      fs.mkdirSync(path.dirname(pad), { recursive: true })
      fs.writeFileSync(pad, b)
      teller.net++
      return b
    } catch (fout) {
      if (fout.blijvend || poging === 4) { teller.fout++; throw fout }
      await wacht(2000 * 2 ** poging)
    }
  }
}

/** Voer taken uit met hooguit 'n' tegelijk; voortgang elke 'elk' stuks. */
export async function tegelijk(items, n, fn, { naam = '', elk = 200 } = {}) {
  let i = 0
  let klaar = 0
  const uit = new Array(items.length)
  const werker = async () => {
    while (i < items.length) {
      const k = i++
      uit[k] = await fn(items[k], k)
      if (++klaar % elk === 0) console.log(`  ${naam} ${klaar}/${items.length} (net ${teller.net}, cache ${teller.cache}, ${(teller.bytes / 1e6).toFixed(0)} MB)`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, werker))
  return uit
}
