// Onverhard: de drie bronnen (BRouter, BGT en luchtfoto van PDOK) en de
// planner die ze combineert. Alles draait in de browser; er is geen eigen
// server. De antwoorden blijven in het geheugen zolang de pagina open is.

import * as K from './kern.js'

const BROUTER_URL = 'https://brouter.de/brouter'
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

/** Doe een verzoek; herhaal bij netwerkfouten en 'probeer later'-antwoorden. */
async function vraag(bron, url, opties = {}, pogingen = 4) {
  const wachttijden = [2000, 6000, 15000]
  let laatste = 'onbekende fout'
  for (let poging = 0; poging < pogingen; poging++) {
    try {
      const r = await fetch(url, opties)
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
      if (afgebroken(fout)) throw fout
      laatste = `netwerkfout (${fout.message})`
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
  constructor(law = 1, signal = undefined) {
    this.law = law
    this.signal = signal
    this.profiel = K.maakProfiel(law)
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

  /** Route langs punten [[lat, lon], ...]. Let op: BRouter wil lon voor lat. */
  async route(punten, alternatief = 0) {
    const lonlats = punten.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|')
    const sleutel = `${this.law}|${lonlats}|${alternatief}`
    if (routeCache.has(sleutel)) return routeCache.get(sleutel)
    for (const poging of [0, 1]) {
      const pid = await this.profielId(poging === 1)
      await brouterBeurt(this.signal)
      this.verzoeken += 1
      const url = `${BROUTER_URL}?lonlats=${encodeURIComponent(lonlats)}&profile=${pid}&alternativeidx=${alternatief}&format=geojson`
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
    const r = await vraag('PDOK BGT', `${TEGEL_URL}${row}/${col}?f=mvt`, { signal: this.signal })
    if (r.status === 204 || r.status === 404) return [] // lege tegel (zee, buitenland)
    if (!r.ok) throw new BronFout('PDOK BGT', `tegel ${row}/${col}: HTTP ${r.status}`)
    const soort = r.headers.get('Content-Type') || ''
    if (!/vector-tile|protobuf|octet-stream/.test(soort)) {
      throw new BronFout('PDOK BGT', `tegel ${row}/${col}: onverwacht antwoord (${soort || 'geen type'})`)
    }
    const bytes = new Uint8Array(await r.arrayBuffer())
    try {
      return K.leesTegel(bytes, col, row)
    } catch (fout) {
      throw new BronFout('PDOK BGT', `tegel ${row}/${col} onleesbaar (${fout.message})`)
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
          for (const v of vlakken) this.vlakken.voegToeVlak(v.collectie, v.props, v.polygonen, gebied)
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

// ---------- Planner ----------
export async function analyseerRoute(traject, bgt) {
  const xy = K.trajectXy(traject)
  const { stukken, lengte } = K.maakStukken(traject, xy)
  const punten = K.meetpunten(stukken)
  if (bgt) await bgt.haalVoor(punten)
  return K.analyseer(traject, bgt ? bgt.vlakken : null, { xy, stukken, lengte, punten })
}

/**
 * Plan van punt naar punt. Ronde 1: BRouter met alleen OSM-kennis. Ronde 2:
 * per deeltraject leggen we de alternatieven van BRouter langs de BGT en
 * rekenen we de routekosten opnieuw uit met de ondergrond van het eindoordeel;
 * het alternatief met de laagste kosten wint.
 */
export async function planRoute(punten, br, bgt, alternatieven, meld = () => {}) {
  const gekozen = []
  const log = []
  const waarschuwingen = []
  const delen = punten.length - 1
  for (let nr = 1; nr <= delen; nr++) {
    const a = punten[nr - 1]
    const b = punten[nr]
    meld(`Route zoeken, deel ${nr} van ${delen}`)
    const opties = [[0, await br.route([a, b], 0)]] // een fout hier is fataal: zonder route geen rapport
    for (let i = 1; i < (bgt ? alternatieven : 1); i++) {
      meld(`Alternatief ${i + 1} van ${alternatieven} zoeken, deel ${nr} van ${delen}`)
      try {
        const t = await br.route([a, b], i)
        if (!opties.some(([, o]) => K.zelfdeTraject(t, o))) opties.push([i, t])
      } catch (fout) {
        if (afgebroken(fout)) throw fout
        waarschuwingen.push(`alternatief ${i} voor deel ${nr} niet beschikbaar (${fout.melding || fout.message})`)
      }
    }
    if (!bgt) {
      gekozen.push(opties[0][1])
      continue
    }
    const scores = []
    for (const [i, t] of opties) {
      meld(`Ondergrond controleren bij de BGT, deel ${nr} van ${delen}, alternatief ${scores.length + 1} van ${opties.length}`)
      const an = await analyseerRoute(t, bgt)
      scores.push({
        deel: nr, alt: i, km: an.lengte / 1000, osm: K.zachtAandeel(an, 'osm'), eind: K.zachtAandeel(an, 'eind'),
        law: K.lawAandeel(an), kosten: K.routeKosten(an, br.law), gekozen: false, bgt: an.bgtGebruikt, traject: t,
      })
    }
    // zonder BGT-gegevens heeft ronde 2 geen zin: houd alternatief 0
    let beste = scores[0]
    if (scores[0].bgt) for (const s of scores) if (s.kosten < beste.kosten) beste = s
    beste.gekozen = true
    gekozen.push(beste.traject)
    for (const s of scores) {
      delete s.traject
      log.push(s)
    }
  }
  const traject = K.plak(gekozen)
  traject.punten = punten.slice()
  return { traject, log, waarschuwingen }
}

/**
 * Plan een rondje van ongeveer km kilometer vanaf start. Per windrichting
 * leggen we een cirkel door het startpunt met drie tussenpunten en stellen we
 * de straal bij tot de lengte klopt. Binnen ±10% kiest de BGT de meest
 * onverharde kandidaat; heen en terug over hetzelfde pad telt als minpunt.
 */
export async function planRondje(start, km, br, bgt, kandidaten, bgtTop, meld = () => {}) {
  const doel = km * 1000
  const lijst = []
  const log = []
  const waarschuwingen = []
  for (let n = 0; n < kandidaten; n++) {
    const peiling = (360 * n) / kandidaten
    meld(`Rondje zoeken, richting ${n + 1} van ${kandidaten}`)
    let straal = doel / (4 * Math.SQRT2 * 1.3) // vierkant in de cirkel, 30% omweg t.o.v. hemelsbreed
    let beste = null
    let foutTekst = null
    for (let ronde = 0; ronde < 4; ronde++) {
      const punten = K.rondjePunten(start, peiling, straal)
      let t
      try {
        t = await br.route(punten, 0)
      } catch (fout) {
        if (afgebroken(fout)) throw fout
        foutTekst = fout.melding || fout.message
        break
      }
      const lengte = K.lijnLengte(K.trajectXy(t))
      if (!beste || Math.abs(lengte - doel) < Math.abs(beste.lengte - doel)) beste = { t, lengte, punten }
      if (Math.abs(lengte - doel) / doel <= 0.04) break
      straal *= Math.max(0.5, Math.min(2, doel / lengte))
    }
    if (!beste) {
      log.push({ richting: peiling, fout: foutTekst || 'geen route' })
      continue
    }
    const traject = { ...beste.t, punten: beste.punten }
    const an = await analyseerRoute(traject, null)
    lijst.push({
      richting: peiling, km: beste.lengte / 1000, osm: K.zachtAandeel(an, 'osm'), dubbel: an.dubbel,
      binnen: Math.abs(beste.lengte - doel) / doel <= 0.1, traject, eind: null, gekozen: false,
    })
  }
  if (!lijst.length) {
    throw new BronFout('BRouter', 'geen enkel rondje gevonden: ' + log.map((l) => l.fout).join('; '))
  }
  const score = (k, bron) => k[bron] - 0.5 * k.dubbel
  let goed = lijst.filter((k) => k.binnen)
  if (!goed.length) {
    const dichtst = lijst.reduce((a, b) => (Math.abs(b.km - km) < Math.abs(a.km - km) ? b : a))
    waarschuwingen.push(`geen kandidaat binnen 10% van ${km} km; de dichtstbijzijnde is ${dichtst.km.toFixed(2)} km`)
    goed = [dichtst]
  }
  goed.sort((a, b) => score(b, 'osm') - score(a, 'osm'))
  const top = goed.slice(0, Math.max(1, bgtTop))
  if (bgt) {
    for (const [i, k] of top.entries()) {
      meld(`Ondergrond controleren bij de BGT, rondje ${i + 1} van ${top.length}`)
      const an = await analyseerRoute(k.traject, bgt)
      k.eind = an.bgtGebruikt ? K.zachtAandeel(an, 'eind') : null
    }
  }
  const bruikbaar = top.filter((k) => k.eind !== null)
  let winnaar = top[0]
  if (bruikbaar.length) winnaar = bruikbaar.reduce((a, b) => (score(b, 'eind') > score(a, 'eind') ? b : a))
  winnaar.gekozen = true
  const traject = winnaar.traject
  for (const k of lijst) {
    delete k.traject
    log.push(k)
  }
  log.sort((a, b) => a.richting - b.richting)
  return { traject, log, waarschuwingen }
}

/**
 * Het hele plan: route of rondje, analyse en de cijfers voor het rapport.
 * opties: {punten, rondjeKm, law, alternatieven, kandidaten, bgtKandidaten,
 * metBgt, minTwijfel, signal, meld, voortgang}
 */
export async function maakPlan(opties) {
  const meld = opties.meld || (() => {})
  const br = new BRouter(opties.law ?? 1, opties.signal)
  const bgt = opties.metBgt === false ? null : new Bgt({ signal: opties.signal, voortgang: opties.voortgang })
  const plan = opties.rondjeKm
    ? await planRondje(opties.punten[0], opties.rondjeKm, br, bgt, opties.kandidaten ?? 8, opties.bgtKandidaten ?? 3, meld)
    : await planRoute(opties.punten, br, bgt, Math.max(1, opties.alternatieven ?? 4), meld)
  meld('Rapport maken')
  const analyse = await analyseerRoute(plan.traject, bgt)
  const meldingen = plan.waarschuwingen.slice()
  if (bgt && bgt.fouten.length) {
    meldingen.push(
      `PDOK BGT: ${bgt.fouten.length} van ${bgt.verzoeken} tegels mislukt (bv. ${bgt.fouten[0]}); ` +
        "die stukken staan als 'onbekend' in de BGT-kolom" + (bgt.onbereikbaar ? ' en ronde 2 is overgeslagen' : ''),
    )
  }
  const minTwijfel = opties.minTwijfel ?? 30
  const twijfels = K.twijfelStukken(analyse, minTwijfel)
  twijfels.forEach((s, i) => {
    s.nr = i + 1
  })
  const kort = analyse.samengevoegd.filter((s) => s.twijfel && !s.nr)
  return {
    traject: plan.traject,
    analyse,
    log: plan.log,
    meldingen,
    twijfels,
    twijfelKort: { aantal: kort.length, meter: Math.round(kort.reduce((a, s) => a + s.tot - s.van, 0)) },
    tabel: K.tabel(analyse),
    zacht: { osm: K.zachtAandeel(analyse, 'osm'), bgt: K.zachtAandeel(analyse, 'bgt'), eind: K.zachtAandeel(analyse, 'eind') },
    law: K.lawAandeel(analyse),
    zachteStukken: K.zachteStukken(analyse),
    verzoeken: br.verzoeken + (bgt ? bgt.verzoeken : 0),
    vlakken: bgt ? bgt.vlakken.lijst.length : 0,
  }
}
