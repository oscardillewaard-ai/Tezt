// Onverhard: de drie bronnen (BRouter, BGT en luchtfoto van PDOK) en de
// planner die ze combineert. Alles draait in de browser; er is geen eigen
// server. De antwoorden blijven in het geheugen zolang de pagina open is.

import * as K from './kern.js'

const BROUTER_URL = 'https://brouter.de/brouter'
const BGT_BRON = 'de officiële kaart (PDOK)'
const LOCATIESERVER = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free'
const TEGEL_URL = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/tiles/NetherlandsRDNewQuad/12/'
const LUCHTFOTO_WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0'

/** Een externe bron (BRouter of PDOK) gaf een fout. */
export class BronFout extends Error {
  constructor(bron, melding) {
    super(`${bron}: ${melding}`)
    this.bron = bron
    this.melding = melding
  }
}

const wacht = (ms, signal) =>
  new Promise((klaar, mis) => {
    const t = setTimeout(klaar, ms)
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        mis(signal.reason || new DOMException('Afgebroken', 'AbortError'))
      }, { once: true })
    }
  })

const afgebroken = (fout) => fout && fout.name === 'AbortError'

const TIJDSLIMIET_MS = 90000

/**
 * Haal een antwoord helemaal binnen, met een tijdslimiet: een server die niet
 * meer reageert mag de app niet eindeloos laten wachten. Stopt de gebruiker
 * (opties.signal), dan stopt dit ook.
 */
async function haalBinnen(url, opties) {
  const c = new AbortController()
  const klok = setTimeout(() => c.abort(new DOMException('Geen antwoord binnen de tijd', 'TimeoutError')), TIJDSLIMIET_MS)
  const gebruiker = opties.signal
  const stop = () => c.abort(gebruiker.reason)
  if (gebruiker) {
    if (gebruiker.aborted) stop()
    else gebruiker.addEventListener('abort', stop, { once: true })
  }
  try {
    const r = await fetch(url, { ...opties, signal: c.signal })
    const inhoud = await r.arrayBuffer()
    return new Response(inhoud, { status: r.status, statusText: r.statusText, headers: r.headers })
  } finally {
    clearTimeout(klok)
    if (gebruiker) gebruiker.removeEventListener('abort', stop)
  }
}

/** Doe een verzoek; herhaal bij netwerkfouten, geen antwoord en 'probeer later'-antwoorden. */
async function vraag(bron, url, opties = {}, pogingen = 4) {
  const wachttijden = [2000, 6000, 15000]
  let laatste = 'onbekende fout'
  for (let poging = 0; poging < pogingen; poging++) {
    try {
      const r = await haalBinnen(url, opties)
      if ([429, 502, 503, 504].includes(r.status)) {
        laatste = `HTTP ${r.status}`
      } else if (r.status === 403) {
        const tekst = await r.clone().text()
        if (!tekst.toLowerCase().includes('retry later')) return r
        laatste = `HTTP 403: ${tekst.trim().slice(0, 100)}`
      } else {
        return r
      }
    } catch (fout) {
      if (opties.signal && opties.signal.aborted) throw fout // de gebruiker stopte
      laatste = fout.name === 'TimeoutError' ? 'geen antwoord binnen 90 seconden' : `netwerkfout (${fout.message})`
    }
    if (poging < pogingen - 1) await wacht(wachttijden[Math.min(poging, 2)], opties.signal)
  }
  throw new BronFout(bron, `${laatste} (na ${pogingen} pogingen)`)
}

// ---------- BRouter ----------
const PROFIEL_GELDIG_MS = 2 * 3600 * 1000
const routeCache = new Map()
const profielCache = new Map()
let brouterRij = Promise.resolve() // de publieke server begrenst het tempo: 1 verzoek per seconde
let brouterLaatst = 0

function brouterBeurt(signal) {
  const beurt = brouterRij.then(async () => {
    const nog = 1000 - (Date.now() - brouterLaatst)
    if (nog > 0) await wacht(nog, signal)
    brouterLaatst = Date.now()
  })
  brouterRij = beurt.catch(() => {})
  return beurt
}

export class BRouter {
  constructor(law = 1, signal = undefined, { trail = false, strandMijden = false } = {}) {
    this.law = law
    this.signal = signal
    this.trail = trail
    this.strandMijden = strandMijden
    this.profiel = K.maakProfiel(law, { trail })
    this.verzoeken = 0
  }

  /** Upload het profiel (of hergebruik het id; dat blijft maar kort geldig). */
  async profielId(vernieuw = false) {
    const bewaard = profielCache.get(this.profiel)
    if (!vernieuw && bewaard && Date.now() - bewaard.tijd < PROFIEL_GELDIG_MS) return bewaard.id
    await brouterBeurt(this.signal)
    this.verzoeken += 1
    const r = await vraag('BRouter', BROUTER_URL + '/profile', {
      method: 'POST',
      body: this.profiel,
      headers: { 'Content-Type': 'text/plain' },
      signal: this.signal,
    })
    const tekst = await r.text()
    if (!r.ok) throw new BronFout('BRouter', `profiel uploaden mislukt: HTTP ${r.status} ${tekst.trim().slice(0, 200)}`)
    let antwoord
    try {
      antwoord = JSON.parse(tekst)
    } catch {
      throw new BronFout('BRouter', `onleesbaar antwoord op profiel-upload: ${tekst.trim().slice(0, 200)}`)
    }
    if (antwoord.error) throw new BronFout('BRouter', `profiel geweigerd: ${antwoord.error}`)
    if (!antwoord.profileid) throw new BronFout('BRouter', 'geen profileid ontvangen')
    profielCache.set(this.profiel, { id: antwoord.profileid, tijd: Date.now() })
    return antwoord.profileid
  }

  /** Routekosten van een geanalyseerde route volgens dit profiel (laag = beter). */
  kosten(an) {
    return K.routeKosten(an, this.law, this.trail, this.strandMijden ? 3 : 0)
  }

  /**
   * Route langs punten [[lat, lon], ...]. Let op: BRouter wil lon voor lat.
   * 'nogos' zijn cirkels die de route moet mijden: ['lon,lat,straal', ...].
   */
  async route(punten, alternatief = 0, nogos = []) {
    const lonlats = punten.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|')
    const sleutel = `${this.profiel}|${lonlats}|${alternatief}|${nogos.join('|')}`
    if (routeCache.has(sleutel)) return routeCache.get(sleutel)
    for (const poging of [0, 1]) {
      const pid = await this.profielId(poging === 1)
      await brouterBeurt(this.signal)
      this.verzoeken += 1
      let url = `${BROUTER_URL}?lonlats=${encodeURIComponent(lonlats)}&profile=${pid}&alternativeidx=${alternatief}&format=geojson`
      if (nogos.length) url += `&nogos=${encodeURIComponent(nogos.join('|'))}`
      const r = await vraag('BRouter', url, { signal: this.signal })
      const tekst = (await r.text()).trim()
      if (r.ok && tekst.startsWith('{')) {
        let traject
        try {
          traject = K.leesBrouterRoute(JSON.parse(tekst).features[0])
        } catch (fout) {
          throw new BronFout('BRouter', `onverwacht antwoord (${fout.message})`)
        }
        routeCache.set(sleutel, traject)
        return traject
      }
      // Een verlopen profiel-id geeft HTTP 500 zonder tekst: 1x opnieuw uploaden.
      if (poging === 0 && (r.status === 500 || tekst.toLowerCase().includes('profile'))) continue
      throw new BronFout('BRouter', `HTTP ${r.status}: ${tekst.slice(0, 300) || '(leeg antwoord)'}`)
    }
    throw new BronFout('BRouter', 'geen route ontvangen')
  }
}

// ---------- BGT via PDOK (vectortegels) ----------
export class Bgt {
  /** voortgang(klaar, totaal) wordt aangeroepen terwijl de tegels binnenkomen. */
  constructor({ snap = K.SNAP_M, signal, voortgang, tegelijk = 6 } = {}) {
    this.vlakken = new K.BgtVlakken(snap)
    this.signal = signal
    this.voortgang = voortgang || (() => {})
    this.tegelijk = tegelijk
    this.gehaald = new Set()
    this.fouten = []
    this.verzoeken = 0
    this.onbereikbaar = false
  }

  /**
   * Haal een tegel op en lees de vlakken eruit. PDOK laat de browser een tegel
   * een uur bewaren (Cache-Control), dus opnieuw plannen kost dan geen data.
   */
  async haalTegel(col, row) {
    this.verzoeken += 1
    const r = await vraag(BGT_BRON, `${TEGEL_URL}${row}/${col}?f=mvt`, { signal: this.signal })
    if (r.status === 204 || r.status === 404) return [] // lege tegel (zee, buitenland)
    if (!r.ok) throw new BronFout(BGT_BRON, `tegel ${row}/${col}: HTTP ${r.status}`)
    const soort = r.headers.get('Content-Type') || ''
    if (!/vector-tile|protobuf|octet-stream/.test(soort)) {
      throw new BronFout(BGT_BRON, `tegel ${row}/${col}: onverwacht antwoord (${soort || 'geen type'})`)
    }
    const bytes = new Uint8Array(await r.arrayBuffer())
    try {
      return K.leesTegel(bytes, col, row)
    } catch (fout) {
      throw new BronFout(BGT_BRON, `tegel ${row}/${col} onleesbaar (${fout.message})`)
    }
  }

  async haalTegels(tegels) {
    tegels = tegels.filter(([col, row]) => !this.gehaald.has(col + '/' + row))
    if (!tegels.length || this.onbereikbaar) return
    let volgende = 0
    let klaar = 0
    let mislukt = 0
    const werker = async () => {
      while (volgende < tegels.length) {
        const [col, row] = tegels[volgende++]
        try {
          const vlakken = await this.haalTegel(col, row)
          const gebied = K.tegelGebied(col, row)
          for (const v of vlakken) {
            if (v.collectie === 'waterdeel') {
              if (v.props.type === 'zee') this.vlakken.voegToeZee(v.props.lokaal_id, v.polygonen)
            } else this.vlakken.voegToeVlak(v.collectie, v.props, v.polygonen, gebied)
          }
          this.gehaald.add(col + '/' + row)
        } catch (fout) {
          if (afgebroken(fout)) throw fout
          mislukt += 1
          this.fouten.push(fout.melding || fout.message)
        }
        klaar += 1
        this.voortgang(klaar, tegels.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.tegelijk, tegels.length) }, werker))
    if (tegels.length >= 4 && mislukt === tegels.length) this.onbereikbaar = true // PDOK ligt eruit
  }

  /** Zorg dat de BGT-vlakken rond deze meetpunten in het geheugen staan. */
  async haalVoor(punten) {
    await this.haalTegels(K.tegelsVoor(punten, this.vlakken.snap))
  }
}

// ---------- Luchtfoto ----------
/** WMS-adres van een vierkante luchtfoto-uitsnede (RD-bbox) van 'pixels' breed. */
export function luchtfotoUrl(bb, pixels) {
  return (
    `${LUCHTFOTO_WMS}?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_orthoHR&styles=` +
    `&crs=EPSG:28992&bbox=${bb.join(',')}&width=${pixels}&height=${pixels}&format=image/jpeg`
  )
}

// ---------- Plaatsen zoeken ----------
/** Zoek plekken in Nederland bij PDOK (Locatieserver): [{naam, soort, punt: [lat, lon]}]. */
export async function zoekPlaats(tekst, signal) {
  const url = `${LOCATIESERVER}?q=${encodeURIComponent(tekst)}&rows=7&fl=weergavenaam,type,centroide_ll`
  const r = await fetch(url, { signal })
  if (!r.ok) throw new BronFout('PDOK Locatieserver', `HTTP ${r.status}`)
  const d = await r.json()
  const uit = []
  for (const doc of (d.response && d.response.docs) || []) {
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(doc.centroide_ll || '')
    if (m) uit.push({ naam: doc.weergavenaam, soort: doc.type, punt: [Number(m[2]), Number(m[1])] })
  }
  return uit
}

// ---------- Planner ----------
export async function analyseerRoute(traject, bgt) {
  const xy = K.trajectXy(traject)
  const { stukken, lengte } = K.maakStukken(traject, xy)
  const punten = K.meetpunten(stukken)
  if (bgt) await bgt.haalVoor(punten)
  return K.analyseer(traject, bgt ? bgt.vlakken : null, { xy, stukken, lengte, punten })
}

const naarLatLon = ([x, y]) => {
  const [lon, lat] = K.naarWgs(x, y)
  return [lat, lon]
}

/**
 * Haal doodlopende stukjes weg bij automatisch gekozen tussenpunten: komt
 * de route bij een tussenpunt een pad in en over hetzelfde pad terug, dan
 * leggen we het tussenpunt op de plek waar dat stukje begint en vragen de
 * route opnieuw op. 'vrij' zijn de indexen van de punten die we mogen
 * verplaatsen.
 */
async function zonderDoodlopend(traject, punten, vrij, br) {
  const xy = K.trajectXy(traject)
  let verplaatst = false
  const nieuw = punten.slice()
  for (const i of vrij) {
    const [lat, lon] = punten[i]
    const spoor = K.doodlopend(xy, K.naarRd(lon, lat))
    if (spoor.lengte >= 25) {
      nieuw[i] = naarLatLon(spoor.basis)
      verplaatst = true
    }
  }
  if (!verplaatst) return { traject, punten }
  try {
    const t = await br.route(nieuw, 0)
    return { traject: t, punten: nieuw }
  } catch (fout) {
    if (afgebroken(fout)) throw fout
    return { traject, punten }
  }
}

/** De BRouter-alternatieven van a naar b, elk met analyse, beste (laagste routekosten) eerst. */
async function optiesVoorDeel(a, b, br, bgt, aantal, meld, wat, waarschuwingen) {
  const lijst = []
  for (let i = 0; i < aantal; i++) {
    meld(`${wat}: route ${i + 1} van ${aantal} zoeken`)
    let t
    try {
      t = await br.route([a, b], i)
    } catch (fout) {
      if (afgebroken(fout) || i === 0) throw fout // zonder de eerste route geen plan
      waarschuwingen.push(`alternatief ${i + 1} (${wat.toLowerCase()}) niet beschikbaar (${fout.melding || fout.message})`)
      continue
    }
    if (lijst.some((o) => K.zelfdeTraject(o.traject, t))) continue
    meld(`${wat}: ondergrond van route ${i + 1} controleren`)
    const an = await analyseerRoute(t, bgt)
    lijst.push({ traject: t, an, kosten: br.kosten(an), alt: i })
  }
  if (bgt && lijst[0].an.bgtGebruikt) lijst.sort((x, y) => x.kosten - y.kosten)
  return lijst
}

/**
 * Van punt naar punt. Per deel vragen we de alternatieven van BRouter op en
 * leggen ze langs de officiële kaart. Route A is per deel de beste, route B
 * per deel de op één na beste, enzovoort.
 */
export async function planRoute(punten, br, bgt, alternatieven, meld = () => {}) {
  const waarschuwingen = []
  const delen = []
  const n = punten.length - 1
  for (let nr = 1; nr <= n; nr++) {
    const wat = n > 1 ? `Deel ${nr} van ${n}` : 'Route'
    delen.push(await optiesVoorDeel(punten[nr - 1], punten[nr], br, bgt, bgt ? alternatieven : 1, meld, wat, waarschuwingen))
  }
  const opties = []
  const gezien = new Set()
  const max = Math.max(...delen.map((d) => d.length))
  for (let k = 0; k < max; k++) {
    const keus = delen.map((d) => Math.min(k, d.length - 1))
    if (gezien.has(keus.join())) continue
    gezien.add(keus.join())
    const traject = delen.length === 1 ? delen[0][keus[0]].traject : K.plak(delen.map((d, i) => d[keus[i]].traject))
    traject.punten = punten.slice()
    opties.push({ traject, an: delen.length === 1 ? delen[0][keus[0]].an : null, alt: delen.length === 1 ? delen[0][keus[0]].alt : 0 })
  }
  return { opties, waarschuwingen }
}

/**
 * Hoe goed is een rondje (hoger = beter): het aandeel onverhard, bij
 * trailrunnen extra punten voor smalle paadjes, aftrek voor heen en terug
 * over hetzelfde pad en (als je het strand overslaat) voor strand.
 */
function waardering(an, br, bron) {
  let w = K.zachtAandeel(an, bron) - an.dubbel
  if (br.trail) w += 0.5 * K.paadjesAandeel(an)
  if (br.strandMijden && an.lengte) w -= 2 * (K.strandMeter(an) / an.lengte)
  return w
}

/**
 * Een rondje van ongeveer km kilometer vanaf start. Per windrichting een
 * cirkel door het startpunt met drie tussenpunten; de straal wordt bijgesteld
 * tot de lengte klopt. Doodlopende stukjes bij de tussenpunten worden
 * weggewerkt. Van de kandidaten binnen ±10% gaan de beste langs de
 * officiële kaart; je krijgt er minstens twee die echt van elkaar verschillen.
 */
export async function planRondje(start, km, br, bgt, kandidaten, aantalOpties, meld = () => {}) {
  const doel = km * 1000
  const lijst = []
  const fouten = []
  const waarschuwingen = []
  for (let n = 0; n < kandidaten; n++) {
    const peiling = (360 * n) / kandidaten
    meld(`Rondje zoeken, richting ${n + 1} van ${kandidaten}`)
    let straal = doel / (4 * Math.SQRT2 * 1.3) // vierkant in de cirkel, 30% omweg t.o.v. hemelsbreed
    let beste = null
    for (let ronde = 0; ronde < 4; ronde++) {
      const punten = K.rondjePunten(start, peiling, straal)
      let t
      let gebruikt = punten
      try {
        t = await br.route(punten, 0)
        // doodlopende stukjes bij de tussenpunten meteen weghalen, vóór we de lengte beoordelen
        const schoon = await zonderDoodlopend(t, punten, [1, 2, 3], br)
        t = schoon.traject
        gebruikt = schoon.punten
      } catch (fout) {
        if (afgebroken(fout)) throw fout
        fouten.push(fout.melding || fout.message)
        break
      }
      const lengte = K.lijnLengte(K.trajectXy(t))
      if (!beste || Math.abs(lengte - doel) < Math.abs(beste.lengte - doel)) beste = { t, lengte, punten: gebruikt }
      if (Math.abs(lengte - doel) / doel <= 0.04) break
      straal *= Math.max(0.5, Math.min(2, doel / lengte))
    }
    if (beste) {
      // ligt een tussenpunt ver van de route (in zee, of geen pad in de buurt), dan is deze richting onbruikbaar
      const xy = K.trajectXy(beste.t)
      beste.afwijking = Math.max(...beste.punten.slice(1, -1).map(([la, lo]) => {
        const p = K.naarRd(lo, la)
        return Math.min(...xy.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])))
      }))
      lijst.push({ peiling, ...beste })
    }
  }
  if (!lijst.length) throw new BronFout('BRouter', 'geen enkel rondje gevonden: ' + fouten.join('; '))
  const binnen = lijst.filter((k) => Math.abs(k.lengte - doel) / doel <= 0.1)
  const goed = binnen.filter((k) => k.afwijking < 300)
  const bereid = async (k) => {
    if (k.an) return
    k.traject = { ...k.t, punten: k.punten }
    k.an = await analyseerRoute(k.traject, bgt)
    k.score = waardering(k.an, br, bgt ? 'eind' : 'osm')
  }
  // alle goede rondjes langs de officiële kaart: dan telt ook het strand mee bij de keuze
  for (const [i, k] of goed.entries()) {
    meld(`Ondergrond van rondje ${i + 1} van ${goed.length} controleren`)
    await bereid(k)
  }
  goed.sort((a, b) => b.score - a.score)
  // daarna, als er te weinig verschillende zijn: rondjes met een afwijkende lengte of een lastig tussenpunt
  const rest = lijst.filter((k) => !goed.includes(k)).sort((a, b) => Math.abs(a.lengte - doel) - Math.abs(b.lengte - doel))
  const opties = []
  const nodig = Math.max(2, aantalOpties)
  for (const k of [...goed, ...rest]) {
    if (opties.length >= nodig) break
    if (!goed.includes(k)) {
      meld('Nog een rondje controleren')
      await bereid(k)
    }
    if (opties.every((o) => K.overlap(o.an.xy, k.an.xy) < 0.7)) opties.push({ traject: k.traject, an: k.an })
  }
  for (const o of opties) {
    if (Math.abs(o.an.lengte - doel) / doel > 0.1) {
      waarschuwingen.push(`een van de rondjes is ${(o.an.lengte / 1000).toFixed(1).replace('.', ',')} km: in die richting lukte ${km} km niet`)
    }
  }
  return { opties, waarschuwingen, doel }
}

/**
 * Een rondje via een keerpunt: heen en terug over verschillende paden. We
 * vragen alternatieven voor heen en voor terug op, plus terugwegen via een
 * punt links en rechts van de rechte lijn, en kiezen de combinaties waarbij
 * de terugweg zo min mogelijk over de heenweg loopt.
 */
export async function planLus(start, keer, br, bgt, alternatieven, meld = () => {}) {
  const waarschuwingen = []
  const aantal = Math.max(2, alternatieven)
  const heen = await optiesVoorDeel(start, keer, br, bgt, aantal, meld, 'Heenweg', waarschuwingen)
  const terug = await optiesVoorDeel(keer, start, br, bgt, aantal, meld, 'Terugweg', waarschuwingen)
  const s = K.naarRd(start[1], start[0])
  const k = K.naarRd(keer[1], keer[0])
  const d = Math.hypot(k[0] - s[0], k[1] - s[1])
  const mid = [(s[0] + k[0]) / 2, (s[1] + k[1]) / 2]
  const loodrecht = [-(k[1] - s[1]) / d, (k[0] - s[0]) / d]
  const richting = [(k[0] - s[0]) / d, (k[1] - s[1]) / d]
  const kandidaten = [
    // opzij van de rechte lijn, dichtbij en verder weg
    ...[0.35, -0.35, 0.6, -0.6].map((f) => [mid[0] + loodrecht[0] * f * d, mid[1] + loodrecht[1] * f * d]),
    // voorbij het keerpunt, schuin links en rechts: dan loop je door in plaats van om te keren
    ...[35, -35, 75, -75].map((graden) => {
      const h = (graden * Math.PI) / 180
      const r = [richting[0] * Math.cos(h) - richting[1] * Math.sin(h), richting[0] * Math.sin(h) + richting[1] * Math.cos(h)]
      const afst = Math.min(Math.max(0.25 * d, 300), 1500)
      return [k[0] + r[0] * afst, k[1] + r[1] * afst]
    }),
  ]
  for (const [nr, rd] of kandidaten.entries()) {
    const via = naarLatLon(rd)
    meld(`Andere terugweg zoeken (${nr + 1} van ${kandidaten.length})`)
    try {
      const t0 = await br.route([keer, via, start], 0)
      const schoon = await zonderDoodlopend(t0, [keer, via, start], [1], br)
      if (terug.some((o) => K.zelfdeTraject(o.traject, schoon.traject))) continue
      meld('Ondergrond van de terugweg controleren')
      const an = await analyseerRoute(schoon.traject, bgt)
      terug.push({ traject: schoon.traject, an, kosten: br.kosten(an), via: schoon.punten[1] })
    } catch (fout) {
      if (afgebroken(fout)) throw fout
    }
  }
  const paren = []
  for (const h of heen) {
    for (const t of terug) {
      const ov = K.overlap(h.an.xy, t.an.xy)
      // elke km die de terugweg over de heenweg loopt, telt zwaar mee
      paren.push({ h, t, ov, kosten: h.kosten + t.kosten + 5 * ov * (t.an.lengte / 1000) })
    }
  }
  // eerst de echte lussen (terugweg hooguit 15% over de heenweg), daarna de rest
  paren.sort((a, b) => (a.ov > 0.15) - (b.ov > 0.15) || a.kosten - b.kosten)
  if (paren[0].ov > 0.15) {
    waarschuwingen.push(`er is geen terugweg gevonden die echt anders loopt; ${Math.round(100 * paren[0].ov)}% van de terugweg gaat over de heenweg`)
  }
  // alleen echte lussen aanbieden; heen-en-terug alleen als er niets anders is
  const echt = paren.filter((p) => p.ov <= 0.15)
  const keuze = echt.length ? echt : paren.slice(0, 1)
  const opties = []
  for (const p of keuze) {
    if (opties.length >= Math.max(2, alternatieven)) break
    const xy = p.h.an.xy.concat(p.t.an.xy)
    if (opties.some((o) => K.overlap(o.xy, xy) > 0.85)) continue
    const traject = K.plak([p.h.traject, p.t.traject])
    traject.punten = p.t.via ? [start, keer, p.t.via, start] : [start, keer, start]
    opties.push({ traject, an: null, xy })
  }
  if (echt.length && opties.length < 2) {
    waarschuwingen.push('er is maar één echte lus via dit keerpunt gevonden; verschuif het keerpunt voor meer keus')
  }
  return { opties, waarschuwingen }
}

const LETTERS = 'ABCDEFGH'

/**
 * No-go-cirkels op de strandstukken van een route, niet vlak bij de
 * routepunten (een cirkel om een routepunt negeert BRouter).
 */
function strandNogos(an, punten) {
  const rd = punten.map(([lat, lon]) => K.naarRd(lon, lat))
  const uit = []
  for (const s of an.stukken) {
    if (!s.strand) continue
    for (const p of K.bemonster(s.xy, 75)) {
      if (rd.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 150)) continue
      const [lon, lat] = K.naarWgs(p[0], p[1])
      uit.push(`${lon.toFixed(5)},${lat.toFixed(5)},40`)
    }
  }
  return uit
}

/**
 * Vraag de route opnieuw op zonder de strandstukken (hooguit twee keer). De
 * nieuwe route telt alleen als hij niet veel langer wordt (bij een rondje:
 * binnen 10% van de gevraagde lengte) en niet meer heen en terug gaat.
 */
async function zonderStrand(o, br, bgt, meld, naam, doel) {
  let nogos = []
  for (let ronde = 0; ronde < 2 && K.strandMeter(o.an) > 100; ronde++) {
    const extra = strandNogos(o.an, o.traject.punten)
    if (!extra.length) break
    nogos = nogos.concat(extra)
    meld(`Route ${naam} om het strand heen leggen`)
    let t
    try {
      t = await br.route(o.traject.punten, o.alt || 0, nogos)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      break
    }
    t.punten = o.traject.punten
    const an = await analyseerRoute(t, bgt)
    if (K.strandMeter(an) >= K.strandMeter(o.an)) break
    const lengteGoed = doel ? Math.abs(an.lengte - doel) / doel <= 0.1 : an.lengte <= 1.25 * o.an.lengte
    if (!lengteGoed || an.dubbel > o.an.dubbel + 0.05) break
    o.traject = t
    o.an = an
  }
}

/** Alles wat de app over één route-optie laat zien. */
export function details(optie, minTwijfel = 30) {
  const analyse = optie.analyse
  const twijfels = K.twijfelStukken(analyse, minTwijfel)
  twijfels.forEach((s, i) => {
    s.nr = i + 1
  })
  const kort = analyse.samengevoegd.filter((s) => s.twijfel && !s.nr)
  return {
    naam: optie.naam,
    traject: optie.traject,
    analyse,
    twijfels,
    twijfelKort: { aantal: kort.length, meter: Math.round(kort.reduce((a, s) => a + s.tot - s.van, 0)) },
    tabel: K.tabel(analyse),
    zacht: { osm: K.zachtAandeel(analyse, 'osm'), bgt: K.zachtAandeel(analyse, 'bgt'), eind: K.zachtAandeel(analyse, 'eind') },
    law: K.lawAandeel(analyse),
    zachteStukken: K.zachteStukken(analyse),
  }
}

/**
 * Het hele plan. opties: {punten, rondjeKm, law, alternatieven, kandidaten,
 * metBgt, signal, meld, voortgang}. Bij een rondje met twee punten is het
 * tweede punt het keerpunt. Geeft {opties: [{naam, traject, analyse, km,
 * zacht, law, dubbel}], meldingen, verzoeken, vlakken}; optie A is de beste.
 */
export async function maakPlan(opties) {
  const meld = opties.meld || (() => {})
  const br = new BRouter(opties.law ?? 1, opties.signal, { trail: opties.trail ?? true, strandMijden: opties.strandMijden ?? true })
  const bgt = opties.metBgt === false ? null : new Bgt({ signal: opties.signal, voortgang: opties.voortgang })
  const alternatieven = Math.max(1, opties.alternatieven ?? 2)
  let plan
  if (opties.rondjeKm && opties.punten.length > 1) plan = await planLus(opties.punten[0], opties.punten[1], br, bgt, alternatieven, meld)
  else if (opties.rondjeKm) plan = await planRondje(opties.punten[0], opties.rondjeKm, br, bgt, opties.kandidaten ?? 8, alternatieven, meld)
  else plan = await planRoute(opties.punten, br, bgt, alternatieven, meld)
  const lijst = []
  const meldingen = plan.waarschuwingen.slice()
  for (const [i, o] of plan.opties.entries()) {
    if (!o.an || !K.zelfdeTraject(o.an.traject, o.traject)) {
      meld(`Route ${LETTERS[i]} samenstellen`)
      o.an = await analyseerRoute(o.traject, bgt)
    }
    if (br.strandMijden && bgt) await zonderStrand(o, br, bgt, meld, LETTERS[i], plan.doel)
    if (lijst.some((x) => K.zelfdeTraject(x.traject, o.traject))) continue
    lijst.push({
      naam: LETTERS[i],
      traject: o.traject,
      analyse: o.an,
      km: o.an.lengte / 1000,
      zacht: K.zachtAandeel(o.an, 'eind'),
      law: K.lawAandeel(o.an),
      dubbel: o.an.dubbel,
      paadjes: K.paadjesAandeel(o.an),
      strand: K.strandMeter(o.an),
    })
  }
  lijst.forEach((o, i) => {
    o.naam = LETTERS[i]
  })
  if (br.strandMijden && lijst.some((o) => o.strand > 300)) {
    meldingen.push('Niet elk strandstuk is te vermijden zonder grote omweg; bij die routes staat hoeveel strand er nog in zit.')
  }
  if (bgt && bgt.fouten.length) {
    meldingen.push(
      `De officiële kaart: ${bgt.fouten.length} van ${bgt.verzoeken} kaarttegels mislukt (bv. ${bgt.fouten[0]}); ` +
        "die stukken staan daar als 'onbekend'" + (bgt.onbereikbaar ? ' en de routes zijn alleen met OpenStreetMap vergeleken' : ''),
    )
  }
  return {
    opties: lijst,
    meldingen,
    verzoeken: br.verzoeken + (bgt ? bgt.verzoeken : 0),
    vlakken: bgt ? bgt.vlakken.lijst.length : 0,
  }
}
