// Een blok van de vooraf bewerkte graaf in het NPG1-formaat schrijven (lezen: public/onverhard/blokgraaf.js).
//
// Opbouw (little-endian): "NPG1", u32 lengte van de kop, kop (JSON, utf-8), opgevuld tot een veelvoud van 4,
// daarna de rijen hieronder, elk opgevuld tot een veelvoud van 4 bytes. Getallen die langs de graaf op elkaar
// lijken staan als verschil met de vorige (delta), zodat gzip ze goed inpakt.
//
//   knopen (n):    lat Int32 Δ (×1e7), lon Int32 Δ (×1e7), hoogte Int16 Δ (dm; 32767 = onbekend)
//   wegstukken (m): van Int32 (Δ t.o.v. naar van het vorige wegstuk), naar Int32 (Δ t.o.v. van),
//                  tag Uint16 (index in kop.tags), klasse Uint8 (eindoordeel 0..4 = kern.js KLASSEN),
//                  vlag Uint8 (1 afgesloten, 2 strand, 4 paadje, 8 in natuur (toegangskaart-gebied), 16 twijfel),
//                  op Uint8 en af Uint8 (dm, max 255), osm Int32 Δ (OSM-way-id, 0 = onbekend),
//                  rleAantal Uint8, extraAantal Uint16
//   oordeel per meetpunt (r runs): rleN Uint16, rleOordeel Uint16 (index in kop.oordelen)
//   tussenhoogtes (e): Int16 Δ (dm), om de 10 m vanaf "van", per wegstuk achter elkaar
//   rand (nr):     knoop Uint32, buren Uint8 (bit 0..7 = N, NO, O, ZO, Z, ZW, W, NW: blokken die de knoop ook hebben)
import zlib from 'node:zlib'

export const ONBEKEND_H = 32767

const pad4 = (n) => (4 - (n % 4)) % 4

function delta32(waarden) {
  const uit = new Int32Array(waarden.length)
  let vorige = 0
  for (let i = 0; i < waarden.length; i++) {
    uit[i] = (waarden[i] - vorige) | 0
    vorige = waarden[i]
  }
  return uit
}

/** Int16-delta met omslag (mod 2^16): de lezer telt op met dezelfde omslag. */
function delta16(waarden) {
  const uit = new Int16Array(waarden.length)
  let vorige = 0
  for (let i = 0; i < waarden.length; i++) {
    uit[i] = (waarden[i] - vorige) << 16 >> 16
    vorige = waarden[i]
  }
  return uit
}

/**
 * b: {blok, lat, lon (Int32 ×1e7), hoogte (dm of ONBEKEND_H), van, naar, tag, klasse, vlag, op, af, osm,
 *     rleN: [[...per wegstuk]], rleOordeel: [[...]], extra: [[dm...]], rand, buren, tags, oordelen, pois}
 * Geeft {ruw: Buffer, gz: Buffer}.
 */
export function schrijfBlok(b) {
  const n = b.lat.length
  const m = b.van.length
  const rleN = b.rleN.flat()
  const rleOordeel = b.rleOordeel.flat()
  // tussenhoogtes: per wegstuk een keten die begint bij de hoogte van 'van'
  const extra = []
  for (let s = 0; s < m; s++) {
    let vorige = b.hoogte[b.van[s]]
    for (const h of b.extra[s]) {
      extra.push((h - vorige) << 16 >> 16)
      vorige = h
    }
  }
  const vanD = new Int32Array(m)
  const naarD = new Int32Array(m)
  let vorigeNaar = 0
  for (let s = 0; s < m; s++) {
    vanD[s] = b.van[s] - vorigeNaar
    naarD[s] = b.naar[s] - b.van[s]
    vorigeNaar = b.naar[s]
  }
  const kop = {
    v: 1, blok: b.blok, n, m, r: rleN.length, e: extra.length, nr: b.rand.length,
    tags: b.tags, oordelen: b.oordelen, pois: b.pois,
  }
  const rijen = [
    delta32(b.lat), delta32(b.lon), delta16(b.hoogte),
    vanD, naarD, Uint16Array.from(b.tag), Uint8Array.from(b.klasse), Uint8Array.from(b.vlag),
    Uint8Array.from(b.op), Uint8Array.from(b.af), delta32(b.osm),
    Uint8Array.from(b.rleN.map((r) => r.length)), Uint16Array.from(b.extra.map((e) => e.length)),
    Uint16Array.from(rleN), Uint16Array.from(rleOordeel),
    Int16Array.from(extra),
    Uint32Array.from(b.rand), Uint8Array.from(b.buren),
  ]
  const kopBytes = Buffer.from(JSON.stringify(kop), 'utf8')
  const delen = [Buffer.from('NPG1'), Buffer.alloc(4), kopBytes, Buffer.alloc(pad4(kopBytes.length))]
  delen[1].writeUInt32LE(kopBytes.length)
  for (const r of rijen) {
    const buf = Buffer.from(r.buffer, r.byteOffset, r.byteLength)
    delen.push(buf, Buffer.alloc(pad4(buf.length)))
  }
  const ruw = Buffer.concat(delen)
  return { ruw, gz: zlib.gzipSync(ruw, { level: 9 }) }
}
