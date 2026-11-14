// Onverhard: de drie bronnen (BRouter, BGT en luchtfoto van PDOK) en de
// planner die ze combineert. Alles draait in de browser; er is geen eigen
// server. De antwoorden blijven in het geheugen zolang de pagina open is.

import * as K from './kern.js'
import * as G from './graaf.js'
import * as T from './osmtegels.js'
import * as H from './hoogte.js'

const BROUTER_URL = 'https://brouter.de/brouter'
const BGT_BRON = 'de officiële kaart (PDOK)'
const LOCATIESERVER = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free'
const TEGEL_URL = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/tiles/NetherlandsRDNewQuad/12/'
const LUCHTFOTO_WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0'
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
const OSM_BRON = 'OpenStreetMap (Overpass)'
const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const OFM_BRON = 'OpenStreetMap-kaarttegels (OpenFreeMap)'

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
  const klok = setTimeout(() => c.abort(new DOMException('Geen antwoord binnen de tijd', 'TimeoutError')), opties.tijdslimiet || TIJDSLIMIET_MS)
  const gebruiker = opties.signal
  const stop = () => c.abort(gebruiker.reason)
  if (gebruiker) {
    if (gebruiker.aborted) stop()
    else gebruiker.addEventListener('abort', stop, { once: true })
  }
  try {
    const r = await fetch(url, { ...opties, signal: c.signal })
    const inhoud = await r.arrayBuffer()
    // een antwoord zonder inhoud (204: lege kaarttegel, 304) mag geen inhoud meekrijgen
    const leeg = r.status === 204 || r.status === 304
    return new Response(leeg ? null : inhoud, { status: r.status, statusText: r.statusText, headers: r.headers })
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
      laatste = fout.name === 'TimeoutError' ? `geen antwoord binnen ${Math.round((opties.tijdslimiet || TIJDSLIMIET_MS) / 1000)} seconden` : `netwerkfout (${fout.message})`
    }
    if (poging < pogingen - 1) await wacht(wachttijden[Math.min(poging, 2)], opties.signal)
  }
  throw new BronFout(bron, `${laatste} (na ${pogingen} pogingen)`)
}

// ---------- BRouter ----------
const PROFIEL_GELDIG_MS = 2 * 3600 * 1000
const routeCache = new Map()
const profielCache = new Map()
let brouterRij = Promise.resolve() // de publieke server begrenst het tempo: hooguit één nieuw verzoek per seconde
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
  constructor(law = 1, signal = undefined, { trail = false, strandMijden = false, kaartje = false } = {}) {
    this.law = law
    this.signal = signal
    this.trail = trail
    this.strandMijden = strandMijden
    this.kaartje = kaartje
    this.profiel = K.maakProfiel(law, { trail, kaartje })
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
   * Stranden die eerdere routes raakten, als verboden vlakken voor BRouter
   * (die zelf niet weet wat strand is: in OpenStreetMap is een strandpad
   * gewoon een zandpad). Niet als een routepunt erin of vlakbij ligt: dan
   * weigert BRouter ('wpt in restricted area'). Hooguit 15 km van de start.
   */
  verbodenVlakken(punten) {
    if (!this.strandMijden || !this.bgt || !this.bgt.vlakken.stranden.size) return ''
    const rd = punten.map(([lat, lon]) => K.naarRd(lon, lat))
    const uit = []
    for (const v of this.bgt.vlakken.stranden) {
      for (const poly of v.polygonen) {
        if (!poly.tekst) {
          poly.tekst = K.vereenvoudigRing(poly[0], 15)
            .map(([x, y]) => K.naarWgs(x, y).map((g) => g.toFixed(5)).join(','))
            .join(',')
        }
        const d = rd.map(([x, y]) => K.afstandTotVlak(x, y, [poly]))
        if (Math.min(...d) < 150 || Math.min(...d) > 15000) continue
        uit.push(poly.tekst)
      }
    }
    return uit.join('|')
  }

  /**
   * Route langs punten [[lat, lon], ...]. Let op: BRouter wil lon voor lat.
   * 'nogos' zijn cirkels die de route moet mijden: ['lon,lat,straal', ...].
   */
  async route(punten, alternatief = 0, nogos = []) {
    const lonlats = punten.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|')
    const verboden = this.verbodenVlakken(punten)
    const sleutel = `${this.profiel}|${lonlats}|${alternatief}|${nogos.join('|')}|${verboden}`
    if (routeCache.has(sleutel)) return routeCache.get(sleutel)
    for (const poging of [0, 1]) {
      const pid = await this.profielId(poging === 1)
      await brouterBeurt(this.signal)
      this.verzoeken += 1
      let url = `${BROUTER_URL}?lonlats=${encodeURIComponent(lonlats)}&profile=${pid}&alternativeidx=${alternatief}&format=geojson`
      if (nogos.length) url += `&nogos=${encodeURIComponent(nogos.join('|'))}`
      if (verboden) url += `&polygons=${encodeURIComponent(verboden)}`
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
      // de gratis BRouter-server stopt zware berekeningen ('watchdog'); de volgende alternatieven lukken dan ook niet
      const zwaar = /watchdog|killed|timeout|geen antwoord/i.test(fout.melding || '')
      const wie = wat === 'Route' ? 'deze route' : wat.toLowerCase()
      waarschuwingen.push(zwaar
        ? `BRouter: ${lijst.length} van ${aantal} routes voor ${wie} (te zwaar; kies 1 route)`
        : `Route ${i + 1} voor ${wie} lukte niet`)
      if (zwaar) break
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
 * Vraag een route op; valt een tussenpunt op een 'eilandje' (paden die
 * alleen via afgesloten wegen bereikbaar zijn, zoals in waterwingebieden)
 * of buiten het netwerk, schuif dat punt dan stapsgewijs richting de start
 * en probeer opnieuw. BRouter noemt in de fout welk deel van de route niet
 * lukt ('section N': het doel van dat deel is punt N+1).
 */
async function routeMetUitwijk(punten, br, pogingen = 4) {
  let nu = punten.slice()
  for (let poging = 0; ; poging++) {
    try {
      return { traject: await br.route(nu, 0), punten: nu }
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      const tekst = fout.melding || ''
      if (poging >= pogingen || !/island|not mapped|no track/i.test(tekst)) throw fout
      const m = /section (\d+)/.exec(tekst)
      const welke = m ? [Number(m[1]) + 1] : [1, 2, 3]
      const start = nu[0]
      nu = nu.map((p, i) => (welke.includes(i) && i > 0 && i < nu.length - 1
        ? [p[0] + 0.25 * (start[0] - p[0]), p[1] + 0.25 * (start[1] - p[1])]
        : p))
    }
  }
}

/**
 * Trek tussenpunten naar de natuur: ligt een punt in de bebouwing, op
 * verharding of in zee (volgens de officiële kaart, 100 m rondom), schuif het
 * dan stapsgewijs richting de start. Een rondje vanuit de duinen blijft zo in
 * de duinen in plaats van door het dorp ernaast te gaan. Boerenland telt half
 * mee, zodat rondjes door de polder gewoon kunnen.
 */
async function opLand(punten, bgt) {
  if (!bgt) return punten
  const uit = punten.slice()
  const start = punten[0]
  for (let i = 1; i < uit.length - 1; i++) {
    for (let stap = 0; stap < 4; stap++) {
      const [x, y] = K.naarRd(uit[i][1], uit[i][0])
      await bgt.haalVoor([{ x: x - 100, y: y - 100 }, { x: x + 100, y: y + 100 }, { x: x - 100, y: y + 100 }, { x: x + 100, y: y - 100 }])
      if (bgt.vlakken.natuur(x, y) >= 0.4) break
      uit[i] = [uit[i][0] + 0.25 * (start[0] - uit[i][0]), uit[i][1] + 0.25 * (start[1] - uit[i][1])]
    }
  }
  return uit
}

/**
 * Hoe goed is een rondje (hoger = beter): het aandeel onverhard, bij
 * trailrunnen extra punten voor smalle paadjes, aftrek voor heen en terug
 * over hetzelfde pad en (als je het strand overslaat) voor strand.
 */
function waardering(an, br, bron) {
  // 'maakt niet uit': ondergrond telt niet, alleen weinig heen en terug (en geen strand)
  let w = (br.alles ? 1 : K.zachtAandeel(an, bron)) - 1.5 * an.dubbel
  if (br.alles) return br.strandMijden && an.lengte ? w - 4 * (K.strandMeter(an) / an.lengte) : w
  if (br.trail) w += 0.5 * K.paadjesAandeel(an)
  if (br.strandMijden && an.lengte) w -= 4 * (K.strandMeter(an) / an.lengte)
  return w
}

/**
 * Een rondje van ongeveer km kilometer vanaf start, in twee fasen.
 *
 * Verkennen: per windrichting een cirkel door het startpunt met drie
 * tussenpunten, één route per richting. Tussenpunten in zee schuiven we
 * eerst richting de start; valt een punt op een 'eilandje' (paden alleen
 * bereikbaar via afgesloten wegen), dan schuift het ook. De omweg ten
 * opzichte van hemelsbreed (op kronkelige duinpaden groot) leren we van de
 * vorige richtingen, zodat de lengte meteen ongeveer klopt.
 *
 * Bijstellen: alleen de kansrijkste rondjes (volgens OpenStreetMap) brengen
 * we op lengte, ontdoen we van doodlopende stukjes en leggen we langs de
 * officiële kaart. Zo blijft het aantal verzoeken aan BRouter klein; de
 * publieke server antwoordt bij te veel verzoeken met 'probeer later'.
 */
export async function planRondje(start, km, br, bgt, kandidaten, aantalOpties, meld = () => {}, vorm = 'lus') {
  const doel = km * 1000
  const fouten = []
  const waarschuwingen = []
  const metingen = []
  let omweg = 1.3
  const afwijkingVan = (t, punten) => {
    const xy = K.trajectXy(t)
    return Math.max(...punten.slice(1, -1).map(([la, lo]) => {
      const p = K.naarRd(lo, la)
      return Math.min(...xy.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])))
    }))
  }
  const probeer = async (peiling, straal, rek) => {
    const punten = await opLand(K.vormPunten(start, peiling, straal, rek), bgt)
    const r = await routeMetUitwijk(punten, br)
    const lengte = K.lijnLengte(K.trajectXy(r.traject))
    metingen.push(lengte / K.rondjeOmtrek(straal, rek))
    omweg = metingen.slice().sort((a, b) => a - b)[Math.floor(metingen.length / 2)]
    return { peiling, rek, straal, t: r.traject, punten: r.punten, lengte }
  }

  // fase 1: verkennen, met ronde rondjes en langgerekte (die passen in een smalle strook natuur)
  // rek 1 = rond, 2,5 = langgerekt, 0 = kronkelen (een ster van vijf tussenpunten)
  const vormen = vorm === 'kronkel'
    ? Array.from({ length: kandidaten }, (_, n) => [(360 * n) / kandidaten, 0])
    : [
        ...Array.from({ length: kandidaten }, (_, n) => [(360 * n) / kandidaten, 1]),
        ...Array.from({ length: kandidaten / 2 }, (_, n) => [15 + (720 * n) / kandidaten, 2.5]),
      ]
  const lijst = []
  const verkenBgt = br.strandMijden ? bgt : null
  for (const [n, [peiling, rek]] of vormen.entries()) {
    meld(`Rondjes verkennen: ${n + 1} van ${vormen.length}`)
    try {
      const k = await probeer(peiling, doel / (K.rondjeOmtrek(1, rek) * omweg), rek)
      k.afwijking = afwijkingVan(k.t, k.punten)
      // met 'strand overslaan' al hier de officiële kaart: dan leert BRouter de stranden meteen mijden
      const an = await analyseerRoute(k.t, verkenBgt)
      k.strand = K.strandMeter(an)
      // ver van de gevraagde lengte kost punten: dat is in fase 2 niet altijd goed te maken
      k.osm = waardering(an, br, 'osm') - 0.5 * Math.abs(k.lengte - doel) / doel
      lijst.push(k)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      fouten.push(fout.melding || fout.message)
    }
  }
  if (!lijst.length) throw new BronFout('BRouter', 'geen enkel rondje gevonden: ' + fouten.join('; '))
  // richtingen die er ver naast zaten krijgen één extra poging met een bijgestelde straal
  const scheef = lijst.filter((k) => k.afwijking < 1200 && Math.abs(k.lengte - doel) / doel > 0.2)
  for (const [i, k] of scheef.entries()) {
    meld(`Rondjes verkennen: lengte bijstellen (${i + 1} van ${scheef.length})`)
    try {
      const nieuw = await probeer(k.peiling, k.straal * Math.max(0.5, Math.min(2, doel / k.lengte)), k.rek)
      if (Math.abs(nieuw.lengte - doel) >= Math.abs(k.lengte - doel)) continue
      nieuw.afwijking = afwijkingVan(nieuw.t, nieuw.punten)
      const an = await analyseerRoute(nieuw.t, verkenBgt)
      nieuw.strand = K.strandMeter(an)
      nieuw.osm = waardering(an, br, 'osm') - 0.5 * Math.abs(nieuw.lengte - doel) / doel
      Object.assign(k, nieuw)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
    }
  }

  // fase 2: de kansrijkste op lengte brengen en van doodlopende stukjes ontdoen
  // (een tussenpunt mag ver van een pad liggen in afgesloten natuur; kilometers weg is zee)
  const bruikbaar = lijst.filter((k) => k.afwijking < 1200)
  const kansrijk = (bruikbaar.length ? bruikbaar : lijst).sort((a, b) => b.osm - a.osm).slice(0, Math.max(6, aantalOpties + 2))
  for (const [i, k] of kansrijk.entries()) {
    meld(`Rondje ${i + 1} van ${kansrijk.length} op lengte brengen`)
    if (k.strand > 0) {
      // gevonden voordat dat strand bekend was: nu opnieuw, BRouter mijdt het inmiddels
      try {
        const r = await routeMetUitwijk(k.punten, br)
        Object.assign(k, { t: r.traject, punten: r.punten, lengte: K.lijnLengte(K.trajectXy(r.traject)), strand: 0 })
      } catch (fout) {
        if (afgebroken(fout)) throw fout
      }
    }
    for (let ronde = 0; ronde < 3; ronde++) {
      const schoon = await zonderDoodlopend(k.t, k.punten, k.punten.slice(1, -1).map((_, i) => i + 1), br)
      k.t = schoon.traject
      k.punten = schoon.punten
      k.lengte = K.lijnLengte(K.trajectXy(k.t))
      if (Math.abs(k.lengte - doel) / doel <= 0.06) break
      let nieuw
      try {
        nieuw = await probeer(k.peiling, k.straal * Math.max(0.5, Math.min(2, doel / k.lengte)), k.rek)
      } catch (fout) {
        if (afgebroken(fout)) throw fout
        break
      }
      Object.assign(k, nieuw)
    }
    // de laatste poging kan een nieuwe route zijn: ook daarvan doodlopende stukjes weghalen
    const schoon = await zonderDoodlopend(k.t, k.punten, k.punten.slice(1, -1).map((_, j) => j + 1), br)
    k.t = schoon.traject
    k.punten = schoon.punten
    k.lengte = K.lijnLengte(K.trajectXy(k.t))
    k.afwijking = afwijkingVan(k.t, k.punten)
    k.traject = { ...k.t, punten: k.punten }
    meld(`Ondergrond van rondje ${i + 1} van ${kansrijk.length} controleren`)
    k.an = await analyseerRoute(k.traject, bgt)
    k.score = waardering(k.an, br, bgt ? 'eind' : 'osm')
  }

  // eerst rondjes binnen ±10% die aan de harde eisen voldoen (weinig heen en terug, geen strand als je dat niet wilt)
  const binnen = (k) => Math.abs(k.lengte - doel) / doel <= 0.1
  const voldoet = (k) => k.an.dubbel <= 0.12 && (!br.strandMijden || K.strandMeter(k.an) <= 300)
  kansrijk.sort((a, b) => binnen(b) + voldoet(b) - (binnen(a) + voldoet(a)) || b.score - a.score)
  const opties = []
  for (const k of kansrijk) {
    if (opties.length >= Math.max(2, aantalOpties)) break
    if (opties.length && k.an.dubbel > 0.25) continue // een rondje dat vooral heen en terug gaat, alleen als er niets anders is
    if (opties.every((o) => K.overlap(o.an.xy, k.an.xy) < 0.7)) opties.push({ traject: k.traject, an: k.an, knopen: k.knopen, segs: k.segs })
  }
  for (const o of opties) {
    if (Math.abs(o.an.lengte - doel) / doel > 0.1) {
      waarschuwingen.push(`Een rondje is ${(o.an.lengte / 1000).toFixed(1).replace('.', ',')} km`)
    }
  }
  const uitleg = lijst.map((k) => ({
    richting: k.peiling, rek: k.rek, km: k.lengte / 1000, afwijking: Math.round(k.afwijking), osm: k.osm,
    ...(k.an ? { score: k.score, zacht: K.zachtAandeel(k.an, 'eind'), paadjes: K.paadjesAandeel(k.an), strand: K.strandMeter(k.an), dubbel: k.an.dubbel, voldoet: voldoet(k) } : {}),
  }))
  return { opties, waarschuwingen, doel, uitleg }
}

/**
 * Een rondje via een keerpunt: heen en terug over verschillende paden. We
 * vragen alternatieven voor heen en voor terug op, plus terugwegen via een
 * punt links en rechts van de rechte lijn, en kiezen de combinaties waarbij
 * de terugweg zo min mogelijk over de heenweg loopt.
 */
export async function planLus(start, keer, br, bgt, alternatieven, meld = () => {}, { licht = false } = {}) {
  const waarschuwingen = []
  // licht (voor automatische rondjes): één heenweg, de directe terugweg en vier terugwegen opzij of voorbij het keerpunt
  const aantal = licht ? 1 : Math.max(2, alternatieven)
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
    ...(licht ? [0.35, -0.35] : [0.35, -0.35, 0.6, -0.6]).map((f) => [mid[0] + loodrecht[0] * f * d, mid[1] + loodrecht[1] * f * d]),
    // voorbij het keerpunt, schuin links en rechts: dan loop je door in plaats van om te keren
    ...(licht ? [40, -40] : [35, -35, 75, -75]).map((graden) => {
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
    waarschuwingen.push(`Terugweg ${Math.round(100 * paren[0].ov)}% over de heenweg`)
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
    waarschuwingen.push('Maar één lus via dit keerpunt')
  }
  return { opties, waarschuwingen }
}

/**
 * Een brede lus via een keerpunt, voor automatische rondjes. Heenweg: direct
 * of via een punt links of rechts van de rechte lijn (op halve afstand
 * opzij); terugweg: direct, via links of rechts, of schuin voorbij het
 * keerpunt. Van alle combinaties kiezen we het paar dat echt een lus is,
 * veel onverhard en smalle paden heeft en het dichtst bij de gevraagde lengte
 * komt. Geeft {traject, an, lengte} of null.
 */
async function bredeLus(start, keer, br, bgt, doel, snel = false) {
  const s = K.naarRd(start[1], start[0])
  const k = K.naarRd(keer[1], keer[0])
  const d = Math.hypot(k[0] - s[0], k[1] - s[1]) || 1
  const mid = [(s[0] + k[0]) / 2, (s[1] + k[1]) / 2]
  const lood = [-(k[1] - s[1]) / d, (k[0] - s[0]) / d]
  const richting = [(k[0] - s[0]) / d, (k[1] - s[1]) / d]
  const opzij = (f) => naarLatLon([mid[0] + lood[0] * f * d, mid[1] + lood[1] * f * d])
  const voorbij = (graden) => {
    const h = (graden * Math.PI) / 180
    const r = [richting[0] * Math.cos(h) - richting[1] * Math.sin(h), richting[0] * Math.sin(h) + richting[1] * Math.cos(h)]
    const afst = Math.min(Math.max(0.3 * d, 300), 1500)
    return naarLatLon([k[0] + r[0] * afst, k[1] + r[1] * afst])
  }
  const deel = async (punten) => {
    try {
      const t0 = await br.route(punten, 0)
      const schoon = punten.length > 2 ? await zonderDoodlopend(t0, punten, [1], br) : { traject: t0, punten }
      const an = await analyseerRoute(schoon.traject, bgt)
      return { traject: schoon.traject, punten: schoon.punten, an }
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      return null
    }
  }
  const heen = []
  // snel: heen direct of via links, terug direct, via rechts of schuin voorbij (vijf routes in plaats van zeven)
  for (const via of snel ? [null, opzij(0.5)] : [null, opzij(0.5), opzij(-0.5)]) {
    const r = await deel(via ? [start, via, keer] : [start, keer])
    if (r && !heen.some((h) => K.zelfdeTraject(h.traject, r.traject))) heen.push(r)
  }
  if (!heen.length) throw new BronFout('BRouter', 'geen heenweg naar het keerpunt')
  const terug = []
  for (const via of snel ? [null, opzij(-0.5), voorbij(-40)] : [null, opzij(0.5), opzij(-0.5), voorbij(40)]) {
    const r = await deel(via ? [keer, via, start] : [keer, start])
    if (r && !terug.some((t) => K.zelfdeTraject(t.traject, r.traject))) terug.push(r)
  }
  let beste = null
  for (const h of heen) {
    for (const t of terug) {
      const ov = K.overlap(h.an.xy, t.an.xy)
      const L = h.an.lengte + t.an.lengte
      const gewogen = (f) => (f(h.an) * h.an.lengte + f(t.an) * t.an.lengte) / L
      const zacht = gewogen((a) => K.zachtAandeel(a, bgt ? 'eind' : 'osm'))
      const paadjes = gewogen((a) => K.paadjesAandeel(a))
      const strand = (K.strandMeter(h.an) + K.strandMeter(t.an)) / L
      const waarde = zacht + (br.trail ? 0.5 * paadjes : 0) - 1.5 * ov - (br.strandMijden ? 4 * strand : 0)
        - 3 * Math.max(0, Math.abs(L - doel) / doel - 0.1)
      const kand = { h, t, ov, L, waarde, echt: ov <= 0.15 }
      if (!beste || kand.echt > beste.echt || (kand.echt === beste.echt && kand.waarde > beste.waarde)) beste = kand
    }
  }
  const traject = K.plak([beste.h.traject, beste.t.traject])
  traject.punten = [...beste.h.punten.slice(0, -1), ...beste.t.punten]
  const an = await analyseerRoute(traject, bgt)
  return { traject, an, lengte: an.lengte }
}

/**
 * Een rondje zoals mensen ze zelf maken: heen over het ene pad, terug over
 * een ander. Per windrichting kiezen we een keerpunt (naar de natuur
 * getrokken, niet op een eilandje, niet op een doodlopend pad) en plannen
 * we een lus via dat keerpunt. De verhouding lengte / afstand tot het
 * keerpunt leren we van de vorige richtingen, zodat de lengte meteen ongeveer
 * klopt.
 */
export async function planRondjeLussen(start, km, br, bgt, aantalOpties, meld = () => {}, snel = false) {
  const doel = km * 1000
  const waarschuwingen = []
  const fouten = []
  const s = K.naarRd(start[1], start[0])
  const metingen = []
  let verhouding = 4.2 // Komoot-rondjes zijn 3,4 tot 5,3 keer zo lang als hun verste punt
  const lijst = []
  // snel: 6 richtingen en smallere zoektocht, ongeveer half zo veel verzoeken (en minder mooie rondjes)
  const richtingen = snel ? 6 : 8
  for (let n = 0; n < richtingen; n++) {
    const peiling = (360 * n) / richtingen
    meld(`Rondjes zoeken: richting ${n + 1} van ${richtingen}`)
    let afstand = doel / verhouding
    let keer = naarLatLon(K.verplaats(s, peiling, afstand))
    let beste = null
    for (let poging = 0; poging < 2; poging++) {
      keer = (await opLand([start, keer, start], bgt))[1]
      let o
      try {
        o = await bredeLus(start, keer, br, bgt, doel, snel)
      } catch (fout) {
        if (afgebroken(fout)) throw fout
        if (!/island|not mapped|no track/i.test(fout.melding || '')) {
          fouten.push(fout.melding || fout.message)
          break
        }
        keer = [keer[0] + 0.25 * (start[0] - keer[0]), keer[1] + 0.25 * (start[1] - keer[1])] // eilandje: dichter bij de start
        continue
      }
      const an = o.an
      const kr = K.naarRd(keer[1], keer[0])
      // het keerpunt op een doodlopend pad? dan naar het begin daarvan en nog een keer
      const spoor = K.doodlopend(an.xy, kr)
      const dk = Math.hypot(kr[0] - s[0], kr[1] - s[1]) || 1
      metingen.push(an.lengte / dk)
      verhouding = metingen.slice().sort((a, b) => a - b)[Math.floor(metingen.length / 2)]
      const kand = { peiling, traject: o.traject, an, keer, lengte: an.lengte, afwijking: 0, osm: 0 }
      if (spoor.lengte < 25 && (!beste || Math.abs(an.lengte - doel) < Math.abs(beste.lengte - doel))) beste = kand
      if (spoor.lengte >= 25) {
        keer = naarLatLon(spoor.basis)
        continue
      }
      if (Math.abs(an.lengte - doel) / doel <= 0.2) break // een tweede poging kost veel verzoeken
      afstand = dk * Math.max(0.5, Math.min(2.5, doel / an.lengte))
      keer = naarLatLon(K.verplaats(s, peiling, afstand))
    }
    if (beste) {
      beste.score = waardering(beste.an, br, bgt ? 'eind' : 'osm')
      lijst.push(beste)
    }
  }
  if (!lijst.length) throw new BronFout('BRouter', 'geen enkel rondje gevonden: ' + fouten.join('; '))
  const voldoet = (k) => k.an.dubbel <= 0.12 && (!br.strandMijden || K.strandMeter(k.an) <= 300)
  // heen en terug en strand zitten al in de score; een lengte buiten ±10% kost veel punten
  const waarde = (k) => k.score - 3 * Math.max(0, Math.abs(k.lengte - doel) / doel - 0.1)
  const lus = (k) => k.an.dubbel <= 0.15 // Komoot-rondjes gaan hooguit 6% heen en terug
  lijst.sort((a, b) => lus(b) - lus(a) || waarde(b) - waarde(a))
  const opties = []
  for (const k of lijst) {
    if (opties.length >= Math.max(2, aantalOpties)) break
    if (opties.length && k.an.dubbel > 0.25) continue
    if (opties.every((o) => K.overlap(o.an.xy, k.an.xy) < 0.7)) opties.push({ traject: k.traject, an: k.an, knopen: k.knopen, segs: k.segs })
  }
  for (const o of opties) {
    if (Math.abs(o.an.lengte - doel) / doel > 0.1) {
      waarschuwingen.push(`Een rondje is ${(o.an.lengte / 1000).toFixed(1).replace('.', ',')} km`)
    }
  }
  const uitleg = lijst.map((k) => ({
    richting: k.peiling, rek: 'lus', km: k.lengte / 1000, afwijking: 0, osm: 0, score: k.score,
    zacht: K.zachtAandeel(k.an, 'eind'), paadjes: K.paadjesAandeel(k.an), strand: K.strandMeter(k.an), dubbel: k.an.dubbel, voldoet: voldoet(k),
  }))
  return { opties, waarschuwingen, doel, uitleg }
}

// ---------- Eigen routeplanner (OpenStreetMap-paden, zelf rekenen) ----------
const padenCache = new Map()

/**
 * Alle wegen, paden en stranden binnen 'straal' meter van een punt, uit
 * OpenStreetMap via de Overpass API (twee servers; de tweede als de eerste
 * het niet doet). Het antwoord blijft bewaard zolang de app open is.
 */
export async function haalPaden([lat, lon], straal, signal) {
  const sleutel = `${lat.toFixed(4)},${lon.toFixed(4)},${Math.round(straal / 100)}`
  if (padenCache.has(sleutel)) return padenCache.get(sleutel)
  const body = new URLSearchParams({ data: G.overpassVraag(lat, lon, straal) })
  let laatste = 'onbekende fout'
  for (const url of OVERPASS) {
    try {
      const r = await vraag(OSM_BRON, url, { method: 'POST', body, signal, tijdslimiet: 45000 }, 1)
      if (!r.ok) {
        laatste = `HTTP ${r.status}`
        continue
      }
      const d = await r.json()
      if (d.remark && /error|timed out/i.test(d.remark)) {
        laatste = d.remark.slice(0, 120)
        continue
      }
      if (padenCache.size >= 2) padenCache.delete(padenCache.keys().next().value)
      padenCache.set(sleutel, d.elements)
      return d.elements
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      laatste = fout.melding || fout.message
    }
  }
  throw new BronFout(OSM_BRON, laatste)
}

let ofmSjabloon = null

/** Het adres van de nieuwste kaarttegels van OpenFreeMap (wisselt elke week). */
async function ofmAdres(signal) {
  if (ofmSjabloon && Date.now() - ofmSjabloon.tijd < 3600000) return ofmSjabloon.url
  const r = await vraag(OFM_BRON, OFM_TILEJSON, { signal, tijdslimiet: 20000 }, 2)
  if (!r.ok) throw new BronFout(OFM_BRON, `HTTP ${r.status}`)
  const url = ((await r.json()).tiles || [])[0]
  if (!url || !url.includes('{z}')) throw new BronFout(OFM_BRON, 'onverwachte tegelbeschrijving')
  ofmSjabloon = { url, tijd: Date.now() }
  return url
}

/**
 * Alle wegen, paden en stranden rond een punt uit de kaarttegels van
 * OpenFreeMap (zoomniveau 14, in Nederland zo'n 1,5 km per tegel). Die staan op een
 * groot CDN zonder limiet; de browser bewaart ze (het adres verandert met elke
 * nieuwe kaartversie), dus een tweede rondje in dezelfde buurt kost niets.
 */
export async function haalTegelPaden([lat, lon], straal, signal, voortgang = () => {}) {
  return haalTegels(T.tegelsRond(lat, lon, straal), signal, voortgang)
}

/** Lees deze kaarttegels ([[x, y], ...] op zoom 14): wegen, paden, stranden en punten. */
export async function haalTegels(tegels, signal, voortgang = () => {}) {
  const sjabloon = await ofmAdres(signal)
  const uit = []
  let volgende = 0
  let klaar = 0
  let mislukt = 0
  let laatste = ''
  const werker = async () => {
    while (volgende < tegels.length) {
      const i = volgende++
      const [x, y] = tegels[i]
      try {
        const r = await vraag(OFM_BRON, sjabloon.replace('{z}', T.TEGEL_ZOOM).replace('{x}', x).replace('{y}', y), { signal, tijdslimiet: 30000 }, 3)
        if (r.ok) {
          let bytes = new Uint8Array(await r.arrayBuffer())
          if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
            // nog ingepakt (sommige servers sturen geen Content-Encoding mee)
            bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
          }
          uit.push(...T.leesOsmTegel(bytes, x, y, i * 1e6))
        } else if (r.status !== 204 && r.status !== 404) {
          mislukt += 1
          laatste = `HTTP ${r.status}`
        }
      } catch (fout) {
        if (afgebroken(fout)) throw fout
        mislukt += 1
        laatste = fout.melding || fout.message
      }
      voortgang(++klaar, tegels.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, tegels.length) }, werker))
  if (mislukt > 0.1 * tegels.length) throw new BronFout(OFM_BRON, `${mislukt} van ${tegels.length} tegels mislukt (${laatste})`)
  return uit
}

/**
 * Meer hoogtemeters: meet het AHN langs alle kandidaten (gedeelde blokken één
 * keer) en geef een bonus voor meters stijgen per km (vol bij 15 m/km).
 */
async function hoogteBonus(kandidaten, signal, meld) {
  const items = kandidaten.map((k) => ({ traject: k.traject, analyse: k.an }))
  meld('Hoogtemeters van de rondjes meten')
  await voegHoogtesToe(items, signal, () => {})
  kandidaten.forEach((k, i) => {
    const h = items[i].hoogte
    if (!h) return
    k.score += 0.5 * Math.min(1.5, h.stijgen / (k.an.lengte / 1000) / 15)
  })
}

/**
 * Een rondje met de eigen routeplanner: haal de paden in de buurt op, zoek
 * honderden rondjes op de graaf (dat kost minder dan een seconde) en leg de
 * beste langs de officiële kaart. Vindt die strand of afgesloten stukken
 * buiten de natuur die OpenStreetMap niet als zodanig kent, dan zoeken we nog
 * één keer met die plekken verboden.
 */
export async function planRondjeEigen(start, km, instel, bgt, aantalOpties, meld = () => {}, signal) {
  const doel = km * 1000
  const kronkel = instel.vorm === 'kronkel'
  const straal = Math.max(1500, (kronkel ? 0.32 : 0.38) * doel)
  // paden: eerst de kaarttegels (betrouwbaar), anders Overpass (meer detail, maar vaak druk)
  let elementen = instel.paden // alleen voor tests
  let snap = instel.paden && instel.paden.some((e) => e.bron === 'tegel') ? 1.5 : 0
  const waarschuwingen = []
  if (!elementen) {
    meld('Paden in de buurt ophalen (OpenStreetMap)')
    try {
      elementen = await haalTegelPaden(start, straal, signal, instel.voortgang)
      snap = 1.5 // kaarttegels: losse eindjes aan het netwerk knopen
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      meld('Paden ophalen bij Overpass')
      elementen = await haalPaden(start, straal, signal)
      snap = 0
      waarschuwingen.push('Paden via Overpass (kaarttegels lukten niet)')
    }
  }
  const [sx, sy] = K.naarRd(start[1], start[0])
  const opbouw = { trail: instel.trail, alles: instel.alles, kaartje: instel.kaartje, strandMijden: instel.strandMijden, extraStranden: [], mijdPunten: [], snap }
  let lijst = []
  let gezocht = 0
  let graaf = null
  for (let ronde = 0; ronde < 2; ronde++) {
    meld(ronde ? 'Rondjes opnieuw zoeken, nu zonder strand en afgesloten stukken' : 'Rondjes zoeken')
    await wacht(0, signal) // de pagina even laten bijwerken
    const g = G.bouwGraaf(elementen, opbouw)
    graaf = g
    const s = G.dichtsteKnoop(g, sx, sy)
    if (s.knoop < 0) throw new BronFout(OSM_BRON, 'geen paden in de buurt van de start')
    if (s.afstand > 400) throw new BronFout(OSM_BRON, `het dichtstbijzijnde pad ligt ${Math.round(s.afstand)} m van de start`)
    const z = G.zoekRondjes(g, s.knoop, doel, { kronkel, aantal: instel.heuvels ? 10 : Math.max(5, aantalOpties + 3), maxProbeer: kronkel ? 220 : 160 })
    gezocht += z.geprobeerd
    if (!z.rondjes.length) throw new BronFout(OSM_BRON, 'geen rondje gevonden vanaf deze plek (te weinig paden in de buurt?)')
    lijst = []
    for (const [i, r] of z.rondjes.entries()) {
      meld(`Ondergrond van rondje ${i + 1} van ${z.rondjes.length} controleren`)
      const traject = G.maakTraject(g, r.knopen, r.segs, [start, ...r.via.map((v) => [g.lat[v], g.lon[v]]), start])
      const an = await analyseerRoute(traject, bgt)
      const af = Math.abs(an.lengte - doel) / doel
      lijst.push({ traject, an, lengte: an.lengte, knopen: r.knopen, segs: r.segs, score: waardering(an, instel, bgt ? 'eind' : 'osm') - 3 * Math.max(0, af - 0.1) })
    }
    if (!bgt || ronde === 1) break
    let opnieuw = false
    if (instel.strandMijden && lijst.some((k) => K.strandMeter(k.an) > 0)) {
      opbouw.extraStranden = [...bgt.vlakken.stranden]
      opnieuw = true
    }
    if (instel.kaartje) {
      for (const k of lijst) {
        if (!(await markeerOngewenst(k.an, { strandMijden: false, kaartje: true }, bgt))) continue
        for (const st of k.an.stukken) if (st.ongewenst) opbouw.mijdPunten.push(...K.bemonster(st.xy, 15))
        opnieuw = true
      }
    }
    if (!opnieuw) break
  }
  if (instel.heuvels) {
    try {
      await hoogteBonus(lijst, signal, meld)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
    }
  }
  lijst.sort((a, b) => b.score - a.score)
  const opties = []
  for (const k of lijst) {
    if (opties.length >= Math.max(2, aantalOpties)) break
    if (opties.every((o) => K.overlap(o.an.xy, k.an.xy) < 0.7)) opties.push({ traject: k.traject, an: k.an, knopen: k.knopen, segs: k.segs })
  }
  for (const o of opties) {
    if (Math.abs(o.an.lengte - doel) / doel > 0.1) {
      waarschuwingen.push(`Een rondje is ${(o.an.lengte / 1000).toFixed(1).replace('.', ',')} km`)
    }
  }
  const uitleg = lijst.map((k) => ({
    richting: null, rek: kronkel ? 'kronkel' : 'lus', km: k.lengte / 1000, afwijking: 0, osm: 0, score: k.score,
    zacht: K.zachtAandeel(k.an, 'eind'), paadjes: K.paadjesAandeel(k.an), strand: K.strandMeter(k.an), dubbel: k.an.dubbel, voldoet: true,
  }))
  return { opties, waarschuwingen, doel, uitleg, eigen: true, gezocht, graaf }
}

// ---------- Tekenen op de kaart: gebied, elke straat, route langs een lijn ----------
/** Midden en straal (m) die een getekende vorm (lat/lon) helemaal omvatten, plus een marge. */
function omvang(punten, marge) {
  const rd = punten.map(([la, lo]) => K.naarRd(lo, la))
  const xs = rd.map((p) => p[0])
  const ys = rd.map((p) => p[1])
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2
  const my = (Math.min(...ys) + Math.max(...ys)) / 2
  const straal = Math.max(...rd.map(([x, y]) => Math.hypot(x - mx, y - my))) + marge
  const [lon, lat] = K.naarWgs(mx, my)
  return { midden: [lat, lon], straal, rd, mx, my }
}

/** Een gesloten ring in RD (plat Float64Array) van een getekend gebied. */
function ringVan(rd) {
  const ring = rd.concat([rd[0]])
  return Float64Array.from(ring.flat())
}

async function padenVoorTekening(punten, marge, instel, signal, meld) {
  const o = omvang(punten, marge)
  if (o.straal > 15000) throw new BronFout('Tekening', 'dat is te groot: teken een gebied van hooguit zo’n 20 km doorsnee')
  meld('Paden in en rond het gebied ophalen (OpenStreetMap)')
  const elementen = instel.paden || (await haalTegelPaden(o.midden, o.straal, signal, instel.voortgang))
  return { o, elementen }
}

/**
 * Startknoop: het getikte startpunt als dat in (of vlak bij) het gebied ligt,
 * anders de plek binnen het gebied het dichtst bij het midden.
 */
function startVoor(g, startpunt, o, binnen) {
  if (startpunt) {
    const k = G.dichtsteKnoop(g, ...K.naarRd(startpunt[1], startpunt[0])).knoop
    if (!binnen || binnen[k] || o.rd.some(([x, y]) => Math.hypot(g.x[k] - x, g.y[k] - y) < 300)) return k
  }
  let beste = -1
  let besteD = Infinity
  for (let i = 0; i < g.n; i++) {
    if (binnen && !binnen[i]) continue
    if (g.begin[i + 1] === g.begin[i]) continue
    const d = Math.hypot(g.x[i] - o.mx, g.y[i] - o.my)
    if (d < besteD) {
      besteD = d
      beste = i
    }
  }
  return beste >= 0 ? beste : G.dichtsteKnoop(g, o.mx, o.my).knoop
}

/** Rondjes die binnen een getekend gebied blijven (zo nodig meerdere rondjes achter elkaar). */
export async function planGebied(instel, bgt, aantalOpties, meld, signal) {
  const { o, elementen } = await padenVoorTekening(instel.tekening, 400, instel, signal, meld)
  meld('Rondjes in het gebied zoeken')
  await wacht(0, signal)
  const ring = ringVan(o.rd)
  const g = G.bouwGraaf(elementen, { trail: instel.trail, alles: instel.alles, kaartje: instel.kaartje, strandMijden: instel.strandMijden, snap: 1.5, gebied: ring })
  const binnen = G.knopenBinnen(g, ring)
  const start = startVoor(g, instel.start, o, binnen)
  const doel = instel.km * 1000
  // hoeveel onverhard pad ligt er in het gebied?
  const onverhard = G.onverhardeSegmenten(g)
  let onverhardM = 0
  let totaalM = 0
  for (let s = 0; s < onverhard.length; s++) {
    if (g.binnenSeg[s]) totaalM += g.lengte[s]
    if (onverhard[s]) onverhardM += g.lengte[s]
  }
  const z = G.zoekRondjesInGebied(g, start, doel, binnen, { aantal: instel.heuvels ? 6 : Math.max(2, aantalOpties) })
  if (!z.rondjes.length) throw new BronFout('Tekening', 'geen rondje gevonden binnen dit gebied (te weinig paden, of de start ligt er te ver vanaf)')
  let opties = []
  for (const [i, r] of z.rondjes.slice(0, instel.heuvels ? 6 : Math.max(2, aantalOpties)).entries()) {
    meld(`Ondergrond van rondje ${i + 1} controleren`)
    const traject = G.maakTraject(g, r.knopen, r.segs, [[g.lat[start], g.lon[start]]])
    opties.push({ traject, an: await analyseerRoute(traject, bgt), ronden: r.ronden, knopen: r.knopen, segs: r.segs, score: -i * 0.01 })
  }
  // Zelf kiezen voor onverhard (niet bij 'maakt niet uit'): ook een route over élk onverhard pad in
  // het gebied, zo nodig een paar keer rond. In een gebied met weinig onverhard (een stadspark) is
  // dat vaak onverharder dan een rondje; dan wint die.
  if (!instel.alles && onverhardM > 300) {
    const r = G.doorElkeStraat(g, start, onverhard)
    if (r && r.segs.length > 2) {
      let knopen = r.knopen
      let segs = r.segs
      let ronden = 1
      while (ronden < 10 && (ronden + 0.5) * r.meter < doel) {
        knopen = knopen.concat(r.knopen.slice(1))
        segs = segs.concat(r.segs)
        ronden++
      }
      const traject = G.maakTraject(g, knopen, segs, [[g.lat[start], g.lon[start]]])
      const an = await analyseerRoute(traject, bgt)
      const zacht = (x) => K.zachtAandeel(x.an, bgt ? 'eind' : 'osm')
      const kandidaat = { traject, an, ronden, knopen, segs, score: 1 }
      if (!opties.length || zacht(kandidaat) > zacht(opties[0]) + 0.05) opties.unshift(kandidaat)
      else opties.push(kandidaat)
    }
  }
  if (instel.heuvels) {
    try {
      await hoogteBonus(opties, signal, meld)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
    }
    opties.sort((a, b) => b.score - a.score)
  }
  opties = opties.slice(0, Math.max(2, aantalOpties))
  const waarschuwingen = []
  if (!instel.alles && totaalM > 0 && onverhardM < 0.3 * totaalM) {
    waarschuwingen.push(`Weinig onverhard hier: ${(onverhardM / 1000).toFixed(1).replace('.', ',')} km van ${(totaalM / 1000).toFixed(0)} km pad`)
  }
  if (opties[0].ronden > 1) {
    waarschuwingen.push(`${opties[0].ronden} rondjes van ca. ${(opties[0].an.lengte / opties[0].ronden / 1000).toFixed(1).replace('.', ',')} km`)
  }
  return { opties, waarschuwingen, doel, eigen: true, uitleg: [], graaf: g }
}

/** Een route door elke straat (of elk pad) binnen een getekend gebied. */
export async function planStraten(instel, bgt, meld, signal) {
  const { o, elementen } = await padenVoorTekening(instel.tekening, 400, instel, signal, meld)
  meld('Route door elke straat berekenen')
  await wacht(0, signal)
  const ring = ringVan(o.rd)
  const g = G.bouwGraaf(elementen, { trail: instel.trail, kaartje: instel.kaartje, strandMijden: instel.strandMijden, snap: 1.5, gebied: ring, buitenFactor: 1 })
  const binnen = G.knopenBinnen(g, ring)
  const start = startVoor(g, instel.start, o, binnen)
  const vereist = G.vereisteSegmenten(g, instel.wegen || 'straten', { zonderDoodlopend: instel.zonderDoodlopend !== false })
  const r = G.doorElkeStraat(g, start, vereist)
  if (!r || r.segs.length < 2) throw new BronFout('Tekening', `geen ${instel.wegen === 'paden' ? 'paden' : 'straten'} gevonden in dit gebied`)
  let gemist = 0
  const gelopen = new Set(r.segs)
  for (let s = 0; s < vereist.length; s++) if (vereist[s] && !gelopen.has(s)) gemist += g.lengte[s]
  meld('Ondergrond controleren')
  const traject = G.maakTraject(g, r.knopen, r.segs, [[g.lat[start], g.lon[start]]])
  const an = await analyseerRoute(traject, bgt)
  const km1 = (m) => (m / 1000).toFixed(1).replace('.', ',')
  const waarschuwingen = []
  if (gemist > 50) waarschuwingen.push(`${km1(gemist)} km onbereikbaar, zit er niet in`)
  return { opties: [{ traject, an, dubbel: r.extraMeter / r.meter, knopen: r.knopen, segs: r.segs }], waarschuwingen, doel: r.meter, eigen: true, uitleg: [], graaf: g }
}

/** Een route over echte paden langs een getekende lijn. */
export async function planTekening(instel, bgt, meld, signal) {
  const { elementen } = await padenVoorTekening(instel.tekening, 400, instel, signal, meld)
  meld('Route langs je tekening zoeken')
  await wacht(0, signal)
  const g = G.bouwGraaf(elementen, { trail: instel.trail, alles: instel.alles, kaartje: instel.kaartje, strandMijden: instel.strandMijden, snap: 1.5 })
  const lijn = instel.tekening.map(([la, lo]) => K.naarRd(lo, la))
  const r = G.volgTekening(g, lijn)
  if (!r) throw new BronFout('Tekening', 'geen route langs deze lijn gevonden (liggen er paden in de buurt?)')
  meld('Ondergrond controleren')
  const traject = G.maakTraject(g, r.knopen, r.segs, r.via.map((k) => [g.lat[k], g.lon[k]]))
  const an = await analyseerRoute(traject, bgt)
  const waarschuwingen = []
  if (r.afwijkend > 0.25) waarschuwingen.push(`${Math.round(100 * r.afwijkend)}% ligt >40 m van je lijn (geen paden dichterbij)`)
  return { opties: [{ traject, an, knopen: r.knopen, segs: r.segs }], waarschuwingen, doel: r.meter, eigen: true, uitleg: [], graaf: g }
}

// ---------- Water onderweg ----------
/**
 * Waterpunten langs elke route: de kaarttegels waar de routes doorheen gaan
 * (en de buren), uit de browsercache als ze al gehaald zijn. Hooguit 250 tegels.
 */
async function voegWaterToe(lijst, signal, meld) {
  const tegels = new Map()
  for (const o of lijst) {
    const xy = o.analyse.xy
    for (let i = 0; i < xy.length; i += 8) {
      const [lon, lat] = K.naarWgs(xy[i][0], xy[i][1])
      const [x, y] = T.tegelXY(lat, lon)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tegels.set(`${x + dx}/${y + dy}`, [x + dx, y + dy])
    }
  }
  if (tegels.size > 250) return
  meld('Water onderweg zoeken')
  const pois = (await haalTegels([...tegels.values()], signal)).filter((e) => e.type === 'poi')
  for (const o of lijst) o.water = G.waterLangs(o.analyse.xy, pois)
}

/**
 * Openingstijden bij de waterpunten, uit OpenStreetMap via Overpass (de
 * kaarttegels hebben ze niet). Mag mislukken: dan staan er geen tijden bij.
 * Zet p.open (de opening_hours-tekst) bij elk punt dat een tijd heeft.
 */
export async function haalOpeningstijden(punten, signal) {
  const mogelijk = punten.filter((p) => p.soort !== 'water')
  if (!mogelijk.length) return 0
  const lat = mogelijk.map((p) => p.lat)
  const lon = mogelijk.map((p) => p.lon)
  const bb = [Math.min(...lat) - 0.002, Math.min(...lon) - 0.003, Math.max(...lat) + 0.002, Math.max(...lon) + 0.003].map((x) => x.toFixed(5)).join(',')
  const vraagTekst = `[out:json][timeout:20];(nwr["opening_hours"]["shop"~"^(supermarket|convenience|bakery)$"](${bb});` +
    `nwr["opening_hours"]["amenity"~"^(cafe|restaurant|fast_food|pub|bar|ice_cream|toilets|fuel)$"](${bb}););out center tags;`
  const body = new URLSearchParams({ data: vraagTekst })
  let elementen = null
  for (const url of OVERPASS) {
    try {
      const r = await vraag(OSM_BRON, url, { method: 'POST', body, signal, tijdslimiet: 25000 }, 1)
      if (r.ok) {
        elementen = (await r.json()).elements
        break
      }
    } catch (fout) {
      if (afgebroken(fout)) throw fout
    }
  }
  if (!elementen) return 0
  let gevonden = 0
  for (const p of mogelijk) {
    const [px, py] = K.naarRd(p.lon, p.lat)
    let beste = null
    let besteD = 60
    for (const e of elementen) {
      const la = e.lat ?? (e.center && e.center.lat)
      const lo = e.lon ?? (e.center && e.center.lon)
      if (la === undefined) continue
      const [x, y] = K.naarRd(lo, la)
      const d = Math.hypot(x - px, y - py)
      const zelfdeNaam = p.naam && e.tags.name && p.naam === e.tags.name
      if (d < besteD || (zelfdeNaam && d < 150)) {
        besteD = zelfdeNaam ? 0 : d
        beste = e
      }
    }
    if (beste) {
      p.open = beste.tags.opening_hours
      gevonden++
    }
  }
  return gevonden
}

// ---------- Hoogtemeters (AHN via PDOK) ----------
const ahnCache = new Map()

/**
 * Zet bij elke route een hoogteprofiel en de hoogte in de coördinaten (voor
 * de GPX). Haalt de AHN-blokken van alle routes in één keer (gedeelde blokken
 * één keer). Bij heel lange routes (meer dan 160 blokken) slaan we het AHN
 * over en gebruiken we de hoogtes die BRouter meestuurt (SRTM), als die er zijn.
 */
async function voegHoogtesToe(lijst, signal, meld) {
  const blokken = new Map()
  for (const o of lijst) for (const b of H.blokkenVoor(o.analyse.xy)) blokken.set(b.join(','), b)
  const rasters = new Map()
  if (blokken.size <= 160) {
    meld('Hoogtes ophalen (AHN)')
    const nodig = [...blokken.entries()].filter(([k]) => !ahnCache.has(k))
    let volgende = 0
    let mislukt = 0
    const werker = async () => {
      while (volgende < nodig.length) {
        const [sleutel, [x0, y0]] = nodig[volgende++]
        try {
          const r = await vraag('het AHN (PDOK)', H.ahnUrl(x0, y0), { signal, tijdslimiet: 30000 }, 2)
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          ahnCache.set(sleutel, await H.leesAhnTiff(await r.arrayBuffer()))
        } catch (fout) {
          if (afgebroken(fout)) throw fout
          mislukt += 1
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, nodig.length) }, werker))
    for (const k of blokken.keys()) if (ahnCache.has(k)) rasters.set(k, ahnCache.get(k))
    if (ahnCache.size > 400) for (const k of [...ahnCache.keys()].slice(0, 200)) ahnCache.delete(k)
    if (mislukt > 0.2 * blokken.size) rasters.clear()
  }
  for (const o of lijst) {
    let profiel = rasters.size ? H.hoogteprofiel(o.analyse.xy, rasters) : null
    const coords = o.traject.coords
    if (profiel) {
      for (let i = 0; i < coords.length; i++) {
        const [x, y] = o.analyse.xy[i] || K.naarRd(coords[i][0], coords[i][1])
        const r = rasters.get(Math.floor(x / H.BLOK_M) * H.BLOK_M + ',' + Math.floor(y / H.BLOK_M) * H.BLOK_M)
        const h = r ? H.hoogteOp(r, x, y) : NaN
        coords[i][2] = Number.isNaN(h) ? null : Math.round(h * 10) / 10
      }
      profiel.bron = 'AHN'
    } else if (coords.some((c) => typeof c[2] === 'number')) {
      // BRouter-hoogtes (SRTM, 90 m): grover, maar beter dan niets
      profiel = profielUitCoords(o.analyse.xy, coords)
      if (profiel) profiel.bron = 'SRTM (BRouter)'
    }
    o.hoogte = profiel
  }
  return rasters.size > 0
}

/** Hoogteprofiel uit de hoogtes in de coördinaten zelf (BRouter). */
function profielUitCoords(xy, coords) {
  const afstand = [0]
  const hoogte = [coords[0][2]]
  for (let i = 1; i < xy.length; i++) {
    afstand.push(afstand[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
    hoogte.push(coords[i][2])
  }
  if (hoogte.some((h) => typeof h !== 'number')) return null
  let stijgen = 0
  let dalen = 0
  let anker = hoogte[0]
  for (const h of hoogte) {
    if (h - anker >= 2) {
      stijgen += h - anker
      anker = h
    } else if (anker - h >= 2) {
      dalen += anker - h
      anker = h
    }
  }
  return { afstand, hoogte, stijgen, dalen, min: Math.min(...hoogte), max: Math.max(...hoogte) }
}

// ---------- GPX inlezen ----------
/** Punten uit een GPX-bestand (track, anders route): [[lon, lat, hoogte|null], ...]. */
export function leesGpx(tekst) {
  const doc = new DOMParser().parseFromString(tekst, 'application/xml')
  if (doc.querySelector('parsererror')) throw new BronFout('GPX', 'dit is geen geldig GPX-bestand')
  let punten = [...doc.getElementsByTagName('trkpt')]
  if (!punten.length) punten = [...doc.getElementsByTagName('rtept')]
  const coords = []
  for (const p of punten) {
    const lat = Number(p.getAttribute('lat'))
    const lon = Number(p.getAttribute('lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const ele = p.getElementsByTagName('ele')[0]
    const vorige = coords[coords.length - 1]
    if (vorige && vorige[0] === lon && vorige[1] === lat) continue
    coords.push([lon, lat, ele ? Number(ele.textContent) : null])
  }
  if (coords.length < 2) throw new BronFout('GPX', 'geen route gevonden in dit bestand')
  const naam = (doc.getElementsByTagName('name')[0] || {}).textContent || ''
  return { coords, naam: naam.trim() }
}

/**
 * Een ingelezen GPX-route bekijken zoals een geplande route: de paden eronder
 * herkennen (kaarttegels, voor de OSM-ondergrond), langs de officiële kaart
 * leggen, en hoogte en water erbij. Geeft hetzelfde als maakPlan.
 */
export async function importeerGpx(tekst, opties = {}) {
  const meld = opties.meld || (() => {})
  const { coords, naam } = leesGpx(tekst)
  const xy = coords.map(([lon, lat]) => K.naarRd(lon, lat))
  const meldingen = []
  let segs = [[0, coords.length - 1, '']]
  // tegels langs de route (en de buren), voor de wegen eronder
  const tegels = new Map()
  for (let i = 0; i < coords.length; i += 5) {
    const [x, y] = T.tegelXY(coords[i][1], coords[i][0])
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tegels.set(`${x + dx}/${y + dy}`, [x + dx, y + dy])
  }
  if (tegels.size <= 400) {
    try {
      meld('Paden onder de route herkennen')
      const elementen = await haalTegels([...tegels.values()], opties.signal, opties.voortgang)
      const g = G.bouwGraaf(elementen, { snap: 1.5, strandMijden: false })
      segs = G.tagsLangs(g, xy)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      meldingen.push('Paden onder de route niet herkend; alleen de officiële kaart')
    }
  } else meldingen.push('Route te lang om de paden eronder te herkennen; alleen de officiële kaart')
  const traject = { coords: coords.map((c) => [c[0], c[1], c[2]]), segs, punten: [] }
  const bgt = opties.metBgt === false ? null : new Bgt({ signal: opties.signal, voortgang: opties.voortgang })
  meld('Ondergrond controleren')
  const an = await analyseerRoute(traject, bgt)
  const optie = optieVan({ traject, an }, 'A')
  optie.ingelezen = naam || 'GPX'
  const lijst = [optie]
  try {
    await voegHoogtesToe(lijst, opties.signal, meld)
    optie.stijgen = optie.hoogte ? optie.hoogte.stijgen : null
    optie.dalen = optie.hoogte ? optie.hoogte.dalen : null
    await voegWaterToe(lijst, opties.signal, meld)
  } catch (fout) {
    if (afgebroken(fout)) throw fout
  }
  return { opties: lijst, uitleg: [], meldingen, verzoeken: 0, vlakken: bgt ? bgt.vlakken.lijst.length : 0, graaf: null, bgt, instel: {} }
}

const LETTERS = 'ABCDEFGH'

/** Eén route zoals de app hem toont. */
function optieVan(o, naam) {
  return {
    naam,
    traject: o.traject,
    analyse: o.an,
    km: o.an.lengte / 1000,
    zacht: K.zachtAandeel(o.an, 'eind'),
    law: K.lawAandeel(o.an),
    dubbel: o.dubbel ?? o.an.dubbel, // bij elke straat: wat je echt dubbel loopt (niet: straten aan twee kanten van een gracht)
    paadjes: K.paadjesAandeel(o.an),
    strand: K.strandMeter(o.an),
    kaartje: K.kaartjeMeter(o.an),
    ronden: o.ronden || 1,
  }
}

/**
 * Versleep de gekozen route: het stuk rond positie i0 gaat via [lat, lon]
 * ('punt'), of (met loslaten) een versleept punt verdwijnt weer. Rekent
 * alleen dat stuk opnieuw op het netwerk dat bij het plannen gebouwd is, en
 * legt de nieuwe route opnieuw langs de officiële kaart en het AHN.
 * Geeft een nieuwe optie, of null als het niet lukte.
 */
export async function pasRouteAan(uitslag, optie, { i0, punt, loslaten = null, weghalen = false }, signal) {
  const g = uitslag.graaf
  if (!g || !optie.knopen) return null
  let r
  if (loslaten !== null) r = G.laatLos(g, optie.knopen, optie.segs, optie.vast, loslaten)
  else if (weghalen) r = G.haalStukWeg(g, optie.knopen, optie.segs, optie.vast, i0)
  else {
    const doel = G.dichtsteKnoop(g, ...K.naarRd(punt[1], punt[0])).knoop
    r = G.versleep(g, optie.knopen, optie.segs, optie.vast.filter((k) => k !== i0 || k === 0 || k === optie.knopen.length - 1), i0, doel)
  }
  if (!r) return null
  const traject = G.maakTraject(g, r.knopen, r.segs, optie.traject.punten || [])
  const an = await analyseerRoute(traject, uitslag.bgt)
  if (uitslag.bgt) await markeerOngewenst(an, uitslag.instel || {}, uitslag.bgt)
  const nieuw = optieVan({ traject, an, ronden: optie.ronden }, optie.naam)
  Object.assign(nieuw, { knopen: r.knopen, segs: r.segs, vast: r.vast })
  try {
    await voegWaterToe([nieuw], signal, () => {})
  } catch (fout) {
    if (afgebroken(fout)) throw fout
  }
  try {
    await voegHoogtesToe([nieuw], signal, () => {})
    nieuw.stijgen = nieuw.hoogte ? nieuw.hoogte.stijgen : null
    nieuw.dalen = nieuw.hoogte ? nieuw.hoogte.dalen : null
  } catch (fout) {
    if (afgebroken(fout)) throw fout
  }
  return nieuw
}

/**
 * Stukken die een route niet mag hebben: strand (als je dat wilt overslaan),
 * en met een toegangskaart: afgesloten paden die NIET midden in de natuur
 * liggen (dat is eerder een erf, een tuin of een bedrijfsterrein dan een
 * waterleidingduin). Zet bij elk stuk 'ongewenst'.
 */
async function markeerOngewenst(an, br, bgt) {
  let meter = 0
  for (const s of an.stukken) {
    s.ongewenst = br.strandMijden && s.strand
    if (!s.ongewenst && s.kaartje && bgt) {
      const [x, y] = K.puntOpLijn(s.xy, K.lijnLengte(s.xy) / 2)
      await bgt.haalVoor([{ x: x - 100, y: y - 100 }, { x: x + 100, y: y + 100 }, { x: x - 100, y: y + 100 }, { x: x + 100, y: y - 100 }])
      s.ongewenst = bgt.vlakken.natuur(x, y) < 0.6
    }
    if (s.ongewenst) meter += s.tot - s.van
  }
  return meter
}

/** No-go-cirkels op de ongewenste stukken, niet vlak bij de routepunten (die negeert BRouter). */
function ongewenstNogos(an, punten) {
  const rd = punten.map(([lat, lon]) => K.naarRd(lon, lat))
  const uit = []
  for (const s of an.stukken) {
    if (!s.ongewenst) continue
    for (const p of K.bemonster(s.xy, 75)) {
      if (rd.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 150)) continue
      const [lon, lat] = K.naarWgs(p[0], p[1])
      uit.push(`${lon.toFixed(5)},${lat.toFixed(5)},40`)
    }
  }
  return uit
}

/**
 * Vraag de route opnieuw op zonder de ongewenste stukken (hooguit twee keer).
 * De nieuwe route telt alleen als hij niet veel langer wordt (bij een rondje:
 * binnen 10% van de gevraagde lengte) en niet meer heen en terug gaat.
 */
async function zonderOngewenst(o, br, bgt, meld, naam, doel) {
  let nogos = []
  let meter = await markeerOngewenst(o.an, br, bgt)
  for (let ronde = 0; ronde < 2 && meter > 100; ronde++) {
    const extra = ongewenstNogos(o.an, o.traject.punten)
    if (!extra.length) break
    nogos = nogos.concat(extra)
    meld(`Route ${naam} om ongewenste stukken heen leggen`)
    let t
    try {
      t = await br.route(o.traject.punten, o.alt || 0, nogos)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      break
    }
    t.punten = o.traject.punten
    const an = await analyseerRoute(t, bgt)
    const nieuw = await markeerOngewenst(an, br, bgt)
    if (nieuw >= meter) break
    const lengteGoed = doel ? Math.abs(an.lengte - doel) / doel <= 0.1 : an.lengte <= 1.25 * o.an.lengte
    if (!lengteGoed || an.dubbel > o.an.dubbel + 0.05) break
    o.traject = t
    o.an = an
    meter = nieuw
  }
  return meter
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
  const br = new BRouter(opties.law ?? 1, opties.signal, {
    trail: opties.trail ?? true, strandMijden: opties.strandMijden ?? true, kaartje: opties.kaartje ?? false,
  })
  br.alles = !!opties.alles
  const bgt = opties.metBgt === false ? null : new Bgt({ signal: opties.signal, voortgang: opties.voortgang })
  br.bgt = bgt // zodat BRouter de stranden kan mijden die de officiële kaart aanwijst
  const alternatieven = Math.max(1, opties.alternatieven ?? 2)
  let plan
  const vooraf = []
  // Een rondje vanaf één punt rekenen we zelf uit op de paden van OpenStreetMap: sneller en
  // beter dan via BRouter. Niet bij een voorkeur voor LAW-routes (die kent alleen BRouter).
  const tekenInstel = {
    trail: br.trail, alles: br.alles, strandMijden: br.strandMijden, kaartje: br.kaartje, tekening: opties.tekening, start: opties.punten && opties.punten[0],
    km: opties.rondjeKm || 10, wegen: opties.wegen, zonderDoodlopend: opties.zonderDoodlopend, paden: opties.paden, voortgang: opties.voortgang, heuvels: opties.heuvels,
  }
  if (opties.modus === 'gebied') plan = await planGebied(tekenInstel, bgt, alternatieven, meld, opties.signal)
  else if (opties.modus === 'straten') plan = await planStraten(tekenInstel, bgt, meld, opties.signal)
  else if (opties.modus === 'tekenen') plan = await planTekening(tekenInstel, bgt, meld, opties.signal)
  else if (opties.rondjeKm && opties.punten.length === 1 && (opties.law ?? 1) === 1 && opties.methode !== 'brouter') {
    try {
      plan = await planRondjeEigen(opties.punten[0], opties.rondjeKm, { trail: br.trail, alles: br.alles, strandMijden: br.strandMijden, kaartje: br.kaartje, vorm: opties.vorm, paden: opties.paden, voortgang: opties.voortgang, heuvels: opties.heuvels }, bgt, alternatieven, meld, opties.signal)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
      vooraf.push('Paden niet op te halen; via BRouter gerekend')
    }
  }
  if (plan) {
    // al gedaan
  } else if (opties.rondjeKm && opties.punten.length > 1) plan = await planLus(opties.punten[0], opties.punten[1], br, bgt, alternatieven, meld)
  else if (opties.rondjeKm && opties.vorm !== 'kronkel') plan = await planRondjeLussen(opties.punten[0], opties.rondjeKm, br, bgt, alternatieven, meld, alternatieven === 1)
  else if (opties.rondjeKm) plan = await planRondje(opties.punten[0], opties.rondjeKm, br, bgt, opties.kandidaten ?? 12, alternatieven, meld, opties.vorm)
  else plan = await planRoute(opties.punten, br, bgt, alternatieven, meld)
  const lijst = []
  const meldingen = vooraf.concat(plan.waarschuwingen)
  for (const [i, o] of plan.opties.entries()) {
    if (!o.an || !K.zelfdeTraject(o.an.traject, o.traject)) {
      meld(`Route ${LETTERS[i]} samenstellen`)
      o.an = await analyseerRoute(o.traject, bgt)
    }
    if ((br.strandMijden || br.kaartje) && bgt && !plan.eigen) await zonderOngewenst(o, br, bgt, meld, LETTERS[i], plan.doel)
    else if (plan.eigen && bgt) await markeerOngewenst(o.an, br, bgt)
    if (lijst.some((x) => K.zelfdeTraject(x.traject, o.traject))) continue
    const optie = optieVan(o, LETTERS[i])
    // versleepbaar: de route op het eigen netwerk (niet bij elke straat), met start en finish vast
    if (plan.graaf && o.knopen && o.knopen.length === o.traject.coords.length) {
      optie.knopen = o.knopen
      optie.segs = o.segs
      optie.vast = [0, o.knopen.length - 1]
    }
    lijst.push(optie)
  }
  // Een andere route die veel minder onverhard is dan de beste helpt niemand (zoals een rondje
  // door de polder naast een rondje door de duinen): laat die weg en zeg dat erbij.
  const zwak = lijst.filter((o, i) => i > 0 && o.zacht < lijst[0].zacht - 0.2)
  if (zwak.length) {
    for (const o of zwak) lijst.splice(lijst.indexOf(o), 1)
    meldingen.push(
      `${zwak.length === 1 ? 'Andere route' : `${zwak.length} andere routes`} weggelaten: veel minder onverhard`,
    )
  }
  lijst.forEach((o, i) => {
    o.naam = LETTERS[i]
  })
  if (opties.hoogtes !== false && lijst.length) {
    try {
      await voegHoogtesToe(lijst, opties.signal, meld)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
    }
    for (const o of lijst) {
      o.stijgen = o.hoogte ? o.hoogte.stijgen : null
      o.dalen = o.hoogte ? o.hoogte.dalen : null
    }
    if (lijst.some((o) => !o.hoogte)) meldingen.push('Hoogtemeters onbekend')
    try {
      await voegWaterToe(lijst, opties.signal, meld)
    } catch (fout) {
      if (afgebroken(fout)) throw fout
    }
  }
  if (br.strandMijden && lijst.some((o) => o.strand > 300)) {
    meldingen.push('Strand niet helemaal te vermijden')
  }
  if (bgt && bgt.fouten.length) {
    meldingen.push(
      `Officiële kaart: ${bgt.fouten.length} van ${bgt.verzoeken} tegels mislukt` + (bgt.onbereikbaar ? ' (alleen OpenStreetMap gebruikt)' : ''),
    )
  }
  return {
    opties: lijst,
    uitleg: plan.uitleg || [],
    meldingen,
    verzoeken: br.verzoeken + (bgt ? bgt.verzoeken : 0),
    graaf: plan.graaf || null, // om de route te kunnen verslepen
    bgt,
    instel: { strandMijden: br.strandMijden, kaartje: br.kaartje },
    vlakken: bgt ? bgt.vlakken.lijst.length : 0,
  }
}
