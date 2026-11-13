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
      // de gratis BRouter-server stopt zware berekeningen ('watchdog'); de volgende alternatieven lukken dan ook niet
      const zwaar = /watchdog|killed|timeout|geen antwoord/i.test(fout.melding || '')
      const wie = wat === 'Route' ? 'deze route' : wat.toLowerCase()
      waarschuwingen.push(zwaar
        ? `Voor ${wie} kon BRouter maar ${lijst.length} van de ${aantal} gevraagde routes berekenen: de gratis server stopt zware berekeningen, zoals lange afstanden. Kies "1 route" of plan in kortere stukken.`
        : `Route ${i + 1} voor ${wie} lukte niet (${fout.melding || fout.message}).`)
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
  let w = K.zachtAandeel(an, bron) - 1.5 * an.dubbel
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
  for (const [n, [peiling, rek]] of vormen.entries()) {
    meld(`Rondjes verkennen: ${n + 1} van ${vormen.length}`)
    try {
      const k = await probeer(peiling, doel / (K.rondjeOmtrek(1, rek) * omweg), rek)
      k.afwijking = afwijkingVan(k.t, k.punten)
      const an = await analyseerRoute(k.t, null)
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
      const an = await analyseerRoute(nieuw.t, null)
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
    if (opties.every((o) => K.overlap(o.an.xy, k.an.xy) < 0.7)) opties.push({ traject: k.traject, an: k.an })
  }
  for (const o of opties) {
    if (Math.abs(o.an.lengte - doel) / doel > 0.1) {
      waarschuwingen.push(`een van de rondjes is ${(o.an.lengte / 1000).toFixed(1).replace('.', ',')} km: in die richting lukte ${km} km niet`)
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
    if (opties.every((o) => K.overlap(o.an.xy, k.an.xy) < 0.7)) opties.push({ traject: k.traject, an: k.an })
  }
  for (const o of opties) {
    if (Math.abs(o.an.lengte - doel) / doel > 0.1) {
      waarschuwingen.push(`een van de rondjes is ${(o.an.lengte / 1000).toFixed(1).replace('.', ',')} km: in die richting lukte ${km} km niet`)
    }
  }
  const uitleg = lijst.map((k) => ({
    richting: k.peiling, rek: 'lus', km: k.lengte / 1000, afwijking: 0, osm: 0, score: k.score,
    zacht: K.zachtAandeel(k.an, 'eind'), paadjes: K.paadjesAandeel(k.an), strand: K.strandMeter(k.an), dubbel: k.an.dubbel, voldoet: voldoet(k),
  }))
  return { opties, waarschuwingen, doel, uitleg }
}

const LETTERS = 'ABCDEFGH'

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
  const bgt = opties.metBgt === false ? null : new Bgt({ signal: opties.signal, voortgang: opties.voortgang })
  const alternatieven = Math.max(1, opties.alternatieven ?? 2)
  let plan
  if (opties.rondjeKm && opties.punten.length > 1) plan = await planLus(opties.punten[0], opties.punten[1], br, bgt, alternatieven, meld)
  else if (opties.rondjeKm && opties.vorm !== 'kronkel') plan = await planRondjeLussen(opties.punten[0], opties.rondjeKm, br, bgt, alternatieven, meld, alternatieven === 1)
  else if (opties.rondjeKm) plan = await planRondje(opties.punten[0], opties.rondjeKm, br, bgt, opties.kandidaten ?? 12, alternatieven, meld, opties.vorm)
  else plan = await planRoute(opties.punten, br, bgt, alternatieven, meld)
  const lijst = []
  const meldingen = plan.waarschuwingen.slice()
  for (const [i, o] of plan.opties.entries()) {
    if (!o.an || !K.zelfdeTraject(o.an.traject, o.traject)) {
      meld(`Route ${LETTERS[i]} samenstellen`)
      o.an = await analyseerRoute(o.traject, bgt)
    }
    if ((br.strandMijden || br.kaartje) && bgt) await zonderOngewenst(o, br, bgt, meld, LETTERS[i], plan.doel)
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
      kaartje: K.kaartjeMeter(o.an),
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
    uitleg: plan.uitleg || [],
    meldingen,
    verzoeken: br.verzoeken + (bgt ? bgt.verzoeken : 0),
    vlakken: bgt ? bgt.vlakken.lijst.length : 0,
  }
}
