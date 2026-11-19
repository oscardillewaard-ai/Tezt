// Onverhard: de interface. Plain JS zonder build-stap, net als Parkenjacht.
// De rekenkern staat in kern.js, de bronnen en de planner in bronnen.js.

import * as K from './kern.js'
import { maakSheet } from './sheet.js'
import * as Gebruik from './gebruik.js'
import { aandelen, ondergrondTekst, totaalTekst, waaromTekst } from './weergave.js'
import { korrelStijl as kaartStijl, koppelKorrels, kanWebgl, KAART_BRON } from './korrelkaart.js'
import { bekijkRoute, haalOpeningstijden, importeerGpx, pasRouteAan, routeNaarStation, zoekOmwegen, maakPlan, luchtfotoUrl, details, zoekPlaats } from './bronnen.js'

/* global L */
const SLEUTEL = 'onverhard.v1'
const THEMA = 'onverhard.thema'
const MIN_TWIJFEL = 30 // twijfelstukken korter dan dit (m) worden niet apart genoemd
const MAX_FOTOS = 12
const FOTO_M = 120 // zijde van een luchtfoto-uitsnede in meters
const FOTO_PX = 800
const NEDERLAND = { zuid: 50.5, noord: 53.8, west: 3.0, oost: 7.4 }

const el = (id) => document.getElementById(id)
const nl = (x, d = 2) => Number(x).toFixed(d).replace('.', ',')
const km = (m) => nl(m / 1000) + ' km'
const pct = (x, d = 0) => nl(100 * x, d) + '%'
const veilig = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const TOELICHTING = {
  [K.ONVERHARD]: 'gras, zand, aarde, bospad',
  [K.HALF]: 'schelpen, grind',
  [K.OPEN]: 'klinkers, tegels',
  [K.GESLOTEN]: 'asfalt, beton',
  [K.ONBEKEND]: 'geen gegevens',
}
const BRONNAAM = { eind: 'Eindoordeel', bgt: 'Officiële kaart', osm: 'OpenStreetMap' }

let KLEUR = {}
function leesKleuren() {
  const stijl = getComputedStyle(document.documentElement)
  const v = (naam) => stijl.getPropertyValue(naam).trim()
  KLEUR = {
    [K.ONVERHARD]: v('--onverhard'),
    [K.HALF]: v('--half'),
    [K.OPEN]: v('--open'),
    [K.GESLOTEN]: v('--gesloten'),
    [K.ONBEKEND]: v('--onbekend'),
    rouw: v('--rouw'),
    inkt: v('--inkt'),
  }
}
leesKleuren()

/** Een pictogram uit de sprite in index.html (een lijntekening in de kleur van de tekst). */
const ico = (naam) => `<svg class="ico" aria-hidden="true"><use href="#i-${naam}"/></svg>`
/** 'onverhard' wordt 'kl-onverhard': de korrel bij een ondergrondklasse (zie styles.css). */
const korrelKlasse = (klasse) => `kl kl-${String(klasse).split(' ')[0]}`
/**
 * De korrel op de route zelf: een dunne laag erover, zodat de klasse ook zonder kleur te zien is.
 * Onverhard krijgt stippen, half verhard streepjes, open verharding lange strepen en onbekend losse
 * puntjes; gesloten verharding (asfalt) blijft effen.
 */
function korrelStijl(klasse) {
  const inkt = '#2B211B'
  if (klasse === K.ONVERHARD) return { color: inkt, weight: 2.4, opacity: 0.7, dashArray: '0.1 6', lineCap: 'round' }
  if (klasse === K.HALF) return { color: inkt, weight: 2.2, opacity: 0.65, dashArray: '5 5', lineCap: 'butt' }
  if (klasse === K.OPEN) return { color: '#F2E4B8', weight: 1.8, opacity: 0.9, dashArray: '10 6', lineCap: 'butt' }
  if (klasse === K.ONBEKEND) return { color: inkt, weight: 2, opacity: 0.5, dashArray: '0.1 10', lineCap: 'round' }
  return null
}

// ---------- Toestand ----------
const staat = { modus: 'rondje', punten: [], km: 10, law: 1, grondig: 2, trail: true, strand: true, kaartje: false, vorm: 'lus', luchtfoto: false, vlak: null, lijn: null, wegen: 'straten', dood: true, heuvels: false }
const TEKENMODI = new Set(['gebied', 'straten', 'tekenen'])
const tekenModus = () => TEKENMODI.has(staat.modus)
/** de tekening die bij deze modus hoort: een gebied (vlak) of een lijn */
const tekening = () => (staat.modus === 'tekenen' ? staat.lijn : staat.vlak)
let uitslag = null // wat maakPlan teruggaf: alle routes
let plan = null // de details van de gekozen route
let gekozen = 0
const opKaart = new Set() // routes die op de kaart staan
let bron = 'eind' // waar de routekleur naar kijkt
let stopper = null // AbortController van de lopende planning
let sheet = null // het paneel als bottom sheet op de telefoon (sheet.js)

// ---------- Ongedaan maken ----------
const terugStapel = []
const vooruitStapel = []
/** Hoe het nu is: punten, tekening, keuzes én de geplande routes (die laatste als verwijzing). */
const momentopname = () => ({
  json: JSON.stringify({ modus: staat.modus, punten: staat.punten, vlak: staat.vlak, lijn: staat.lijn, km: staat.km, vorm: staat.vorm, wegen: staat.wegen }),
  uitslag, gekozen, opKaart: [...opKaart],
})
/** Onthoud hoe het nu is, vlak voor een wijziging. */
function onthoud() {
  const nu = momentopname()
  const laatste = terugStapel[terugStapel.length - 1]
  if (!laatste || laatste.json !== nu.json || laatste.uitslag !== nu.uitslag) terugStapel.push(nu)
  if (terugStapel.length > 60) terugStapel.shift()
  vooruitStapel.length = 0
  zetTerugKnop()
}
function zetTerugKnop() {
  const knop = document.getElementById('terug')
  if (knop) knop.disabled = !terugStapel.length
}

function bewaar() {
  try {
    localStorage.setItem(SLEUTEL, JSON.stringify(staat))
  } catch {
    // opslag vol of geblokkeerd: de app werkt ook zonder
  }
}

function leesPunten(tekst) {
  return tekst
    .split(';')
    .map((p) => p.split(',').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
}

function laad() {
  try {
    Object.assign(staat, JSON.parse(localStorage.getItem(SLEUTEL) || '{}'))
  } catch {
    // kapotte opslag: begin leeg
  }
  // een gedeelde link gaat voor: #p=lat,lon;lat,lon&rondje=12&law=0.3
  const hash = new URLSearchParams(location.hash.slice(1))
  if (hash.get('p')) {
    staat.punten = leesPunten(hash.get('p'))
    staat.modus = hash.get('rondje') ? 'rondje' : hash.get('station') ? 'station' : 'route'
    if (hash.get('rondje') || hash.get('station')) staat.km = Number(hash.get('rondje') || hash.get('station')) || staat.km
    staat.law = Number(hash.get('law')) || 1
    if (hash.get('bgt') !== null) staat.grondig = Number(hash.get('bgt'))
    if (hash.get('trail') !== null) staat.trail = hash.get('trail') !== '0'
    if (hash.get('strand') !== null) staat.strand = hash.get('strand') !== '0'
    staat.kaartje = hash.get('kaartje') === '1'
    staat.vorm = hash.get('vorm') === 'kronkel' ? 'kronkel' : 'lus'
  }
  if (TEKENMODI.has(hash.get('modus'))) {
    staat.modus = hash.get('modus')
    if (hash.get('t')) {
      const t = leesPunten(hash.get('t'))
      if (staat.modus === 'tekenen') staat.lijn = t
      else staat.vlak = t
    }
    if (hash.get('rondje')) staat.km = Number(hash.get('rondje')) || staat.km
    if (['straten', 'paden', 'alles'].includes(hash.get('wegen'))) staat.wegen = hash.get('wegen')
    staat.punten = hash.get('p') ? leesPunten(hash.get('p')).slice(0, 1) : []
  }
  if (!Array.isArray(staat.punten)) staat.punten = []
  // de link uit de adresbalk halen: anders wint hij bij herladen van je nieuwe punten
  if (hash.get('p') || hash.get('t')) history.replaceState(null, '', location.pathname + location.search)
  return hash
}

function deelLink() {
  const p = staat.punten.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(';')
  if (tekenModus()) {
    const t = (tekening() || []).map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(';')
    let hash = `#modus=${staat.modus}&t=${t}`
    if (p) hash += `&p=${p}`
    if (staat.modus === 'gebied') hash += `&rondje=${staat.km}`
    if (staat.modus === 'straten') hash += `&wegen=${staat.wegen}`
    if (!staat.trail) hash += '&trail=0'
    if (!staat.strand) hash += '&strand=0'
    if (staat.kaartje) hash += '&kaartje=1'
    return location.origin + location.pathname + hash
  }
  let hash = `#p=${p}`
  if (staat.modus === 'rondje') hash += `&rondje=${staat.km}`
  if (staat.modus === 'station') hash += `&station=${staat.km}`
  if (staat.law !== 1) hash += `&law=${staat.law}`
  if (!staat.trail) hash += '&trail=0'
  if (!staat.strand) hash += '&strand=0'
  if (staat.kaartje) hash += '&kaartje=1'
  if (staat.modus === 'rondje' && staat.vorm === 'kronkel') hash += '&vorm=kronkel'
  return location.origin + location.pathname + hash
}

// ---------- Thema ----------
const THEMA_TEKST = { auto: ['◐', 'automatisch'], licht: ['☀', 'licht'], donker: ['☾', 'donker'] }
function themaKeuze() {
  try {
    return localStorage.getItem(THEMA) || 'auto'
  } catch {
    return 'auto'
  }
}
function zetThema(keuze) {
  try {
    localStorage.setItem(THEMA, keuze)
  } catch {
    // zonder opslag geldt de keuze tot je de pagina sluit
  }
  const donker = keuze === 'donker' || (keuze === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = donker ? 'dark' : 'light'
  el('thema').textContent = THEMA_TEKST[keuze][0]
  el('thema').setAttribute('aria-label', `Thema: ${THEMA_TEKST[keuze][1]} (tik om te wisselen)`)
  el('thema').title = `Thema: ${THEMA_TEKST[keuze][1]}`
  leesKleuren()
  if (korrelLaag && donker !== kaartDonker) {
    kaartDonker = donker
    if (kaart.hasLayer(korrelLaag)) korrelLaag.getMaplibreMap().setStyle(kaartStijl(donker))
    else korrelLaag.options.style = kaartStijl(donker) // bij de volgende keer dat de laag aan gaat
  }
  if (plan) herteken()
}
el('thema').addEventListener('click', () => {
  const volgorde = ['auto', 'licht', 'donker']
  zetThema(volgorde[(volgorde.indexOf(themaKeuze()) + 1) % volgorde.length])
})
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themaKeuze() === 'auto') zetThema('auto')
})

// ---------- Kaart ----------
const kaart = L.map('kaart', { maxZoom: 21 }).setView([52.1, 5.3], 8)
// De kaart in Korrel (vectortegels met MapLibre). Zonder WebGL, of als de tegels niet laden, blijft de
// gewone OpenStreetMap-kaart over.
const donkerNu = () => document.documentElement.dataset.theme === 'dark'
let korrelLaag = null
let kaartDonker = donkerNu() // welke stijl er nu op de kaart staat
if (kanWebgl() && window.maplibregl && L.maplibreGL) {
  korrelLaag = L.maplibreGL({ style: kaartStijl(donkerNu()), attribution: KAART_BRON, interactive: false })
  korrelLaag.on('add', () => {
    const gl = korrelLaag.getMaplibreMap()
    koppelKorrels(gl)
    let geladen = false
    gl.once('load', () => {
      geladen = true
    })
    gl.on('error', () => {
      if (geladen || !kaart.hasLayer(korrelLaag)) return
      geladen = true // maar één keer terugvallen
      kaart.removeLayer(korrelLaag)
      lagen.OpenStreetMap.addTo(kaart)
    })
  })
}
const lagen = {
  ...(korrelLaag ? { Korrel: korrelLaag } : {}),
  OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,
    className: 'osm-tegels',
    attribution: '© OpenStreetMap-bijdragers',
  }),
  'Luchtfoto (PDOK)': L.tileLayer(
    'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    { maxZoom: 21, maxNativeZoom: 21, attribution: 'Luchtfoto: PDOK / Het Waterschapshuis' },
  ),
}
// De kaart van de officiële registratie (BGT) bestaat pas vanaf zoomniveau 17: daarom een aan/uit-laag.
const bgtLaag = L.tileLayer(
  'https://service.pdok.nl/lv/bgt/wmts/v1_0/standaardvisualisatie/EPSG:3857/{z}/{x}/{y}.png',
  { minZoom: 17, maxZoom: 21, maxNativeZoom: 20, opacity: 0.8, attribution: 'BGT: Kadaster / PDOK' },
)
;(korrelLaag || lagen.OpenStreetMap).addTo(kaart)
L.control.layers(lagen, { 'Officiële kaart (vanaf zoom 17)': bgtLaag }).addTo(kaart)
L.control.scale({ imperial: false }).addTo(kaart)
kaart.createPane('alternatieven').style.zIndex = 390 // onder de gekozen route
const puntLaag = L.layerGroup().addTo(kaart)
const altLaag = L.layerGroup().addTo(kaart)
const routeLaag = L.layerGroup().addTo(kaart)
const icoon = (tekst, klasse = '') =>
  L.divIcon({ className: '', html: `<div class="punt ${klasse}">${tekst}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })

function inNederland([lat, lon]) {
  return lat >= NEDERLAND.zuid && lat <= NEDERLAND.noord && lon >= NEDERLAND.west && lon <= NEDERLAND.oost
}

function puntNaam(i) {
  if (staat.modus === 'rondje') return i === 0 ? 'Start en finish' : 'Keerpunt'
  if (tekenModus()) return 'Start en finish'
  if (i === 0) return 'Start'
  return i === staat.punten.length - 1 ? 'Eind' : `Tussenpunt ${i}`
}

function puntLabel(i) {
  if (staat.modus === 'rondje') return i === 0 ? ['S', ''] : ['K', 'via']
  if (tekenModus()) return ['S', '']
  const laatste = i === staat.punten.length - 1
  if (i === 0) return ['S', '']
  return laatste ? ['F', ''] : [String(i), 'via']
}

function tekenPunten() {
  puntLaag.clearLayers()
  staat.punten.forEach((p, i) => {
    const [tekst, klasse] = puntLabel(i)
    const marker = L.marker(p, { icon: icoon(tekst, klasse), draggable: true, title: puntNaam(i), zIndexOffset: 1000 })
    marker.on('dragstart', onthoud)
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng()
      const oud = staat.punten[0]
      staat.punten[i] = [lat, lng]
      if (i === 0) merkStart('slepen', oud)
      puntenGewijzigd()
    })
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.textContent = 'Verwijder dit punt'
    knop.addEventListener('click', () => {
      onthoud()
      staat.punten.splice(i, 1)
      puntenGewijzigd()
    })
    const inhoud = document.createElement('div')
    inhoud.innerHTML = `<b>${puntNaam(i)}</b><br>Sleep om te verplaatsen.<br>`
    inhoud.appendChild(knop)
    marker.bindPopup(inhoud)
    marker.addTo(puntLaag)
  })
}

function tekenPuntenlijst() {
  const lijst = el('punten')
  lijst.innerHTML = ''
  staat.punten.forEach((p, i) => {
    const li = document.createElement('li')
    const [tekst, klasse] = puntLabel(i)
    li.innerHTML = `<div class="punt ${klasse}">${tekst}</div><div>${puntNaam(i)}<small>${p[0].toFixed(5)}, ${p[1].toFixed(5)}</small></div>`
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.textContent = '✕'
    knop.setAttribute('aria-label', `Verwijder ${puntNaam(i).toLowerCase()}`)
    knop.addEventListener('click', () => {
      onthoud()
      staat.punten.splice(i, 1)
      puntenGewijzigd()
    })
    li.appendChild(knop)
    lijst.appendChild(li)
  })
  const rondje = staat.modus === 'rondje'
  const station = staat.modus === 'station'
  const n = staat.punten.length
  const tm = tekenModus()
  // stap 2: kop per soort, en pas verder als de plek bekend is
  el('stap2kop').textContent = { route: 'Start en eind', rondje: 'Startpunt', station: 'Startpunt', gebied: 'Teken het gebied', straten: 'Teken de wijk', tekenen: 'Teken je route' }[staat.modus]
  plaatsKlaar = tm ? !!tekening() : rondje || station ? n >= 1 : n >= 2
  el('naar3').disabled = !plaatsKlaar
  werkStapperBij()
  el('tekenpaneel').hidden = !tm
  el('wegenveld').hidden = staat.modus !== 'straten'
  el('doodveld').hidden = staat.modus !== 'straten'
  el('tekenVierkant').hidden = staat.modus === 'tekenen'
  el('tekenWis').hidden = !tekening()
  const getekend = tekening()
  el('tekenstatus').hidden = !getekend
  el('tekenVrij').innerHTML = ico('potlood') + (getekend ? 'Opnieuw tekenen' : 'Teken')
  if (getekend) {
    let maat
    if (staat.modus === 'tekenen') {
      let m = 0
      for (let i = 1; i < getekend.length; i++) m += kaart.distance(getekend[i - 1], getekend[i])
      maat = `${nl(m / 1000, 1)} km`
    } else {
      const rd = getekend.map(([la, lo]) => K.naarRd(lo, la))
      let opp = 0
      for (let i = 0; i < rd.length; i++) {
        const [x1, y1] = rd[i]
        const [x2, y2] = rd[(i + 1) % rd.length]
        opp += x1 * y2 - x2 * y1
      }
      const km2 = Math.abs(opp) / 2e6
      maat = km2 >= 0.1 ? `${nl(km2, 1)} km²` : `${Math.round(km2 * 100)} ha`
    }
    el('tekenstatus').innerHTML = `<span>✓</span><b>${staat.modus === 'tekenen' ? 'Route getekend' : 'Gebied getekend'}</b><small>${maat}</small>`
  }
  el('locatie').hidden = staat.modus === 'tekenen'
  if (tm) {
    const t = tekening()
    let hint
    if (tekenen) {
      hint = staat.modus === 'tekenen' ? 'Trek de route op de kaart.' : tekenen === 'rechthoek' ? 'Sleep van hoek naar hoek.' : 'Omcirkel het gebied.'
    } else if (!t) {
      hint = staat.modus === 'tekenen' ? 'Tik op Teken en trek je route.' : 'Tik op Teken en omcirkel het gebied.'
    } else if (staat.modus === 'tekenen') hint = ''
    else hint = n ? '' : 'Tik eventueel een startpunt.'
    el('hint').textContent = hint
    el('keerom').hidden = true
    el('wis').hidden = n === 0
    el('kmveld').hidden = staat.modus !== 'gebied'
    el('vormveld').hidden = true
    el('plan').disabled = !t || !!tekenen
    el('plan').textContent = { gebied: 'Plan rondjes in het gebied', straten: 'Plan route door elke straat', tekenen: 'Maak route van tekening' }[staat.modus]
    if (staat.modus === 'straten') el('plan').textContent = { straten: 'Plan route door elke straat', paden: 'Plan route over elk pad', alles: 'Plan route door elke straat en elk pad' }[staat.wegen]
    return
  }
  let hint
  if (rondje) {
    if (n === 0) hint = 'Zoek of tik het startpunt.'
    else if (n === 1) hint = 'Tik op Verder om de lengte te kiezen, of tik een keerpunt.'
    else hint = ''
  } else if (station) hint = n === 0 ? 'Zoek of tik waar je begint.' : 'Tik op Verder: daar kies je de lengte.'
  else if (n === 0) hint = 'Zoek of tik het startpunt.'
  else if (n === 1) hint = 'Zoek of tik het eindpunt.'
  else hint = ''
  el('hint').textContent = hint
  el('keerom').hidden = rondje || station || n < 2
  el('wis').hidden = n === 0
  el('kmveld').hidden = !(rondje || station) || (rondje && n > 1)
  el('vormveld').hidden = !rondje || n > 1
  el('plan').disabled = rondje || station ? n < 1 : n < 2
  if (station) el('plan').textContent = 'Zoek routes naar stations'
  else if (!rondje) el('plan').textContent = 'Plan route'
  else el('plan').textContent = n > 1 ? 'Plan rondje via keerpunt' : 'Plan rondje'
}

/** Op een lege kaart één zin en een knop (in plaats van een intro); weg zodra er een punt, tekening of route is. */
function werkWelkom() {
  el('welkom').hidden = !!(staat.punten.length || uitslag || staat.modus === 'tekenen' || tekening() || tekenen)
}
el('welkomLocatie').addEventListener('click', () => el('locatie').click())

function puntenGewijzigd() {
  werkWelkom()
  if (staat.modus === 'rondje' && staat.punten.length > 2) staat.punten = [staat.punten[0], staat.punten[staat.punten.length - 1]]
  if ((tekenModus() || staat.modus === 'station') && staat.punten.length > 1) staat.punten = staat.punten.slice(-1)
  if (staat.modus === 'tekenen') staat.punten = []
  bewaar()
  tekenPunten()
  tekenPuntenlijst()
}

function toonFout(tekst) {
  el('fout').textContent = tekst
  el('fout').hidden = !tekst
}

/** Onthoud hoe de start gezet is (voor de teller); was er al een andere start, dan is hij verplaatst. */
function merkStart(bron, oud) {
  const nieuw = staat.punten[0]
  if (!nieuw || (oud && oud[0] === nieuw[0] && oud[1] === nieuw[1])) return
  if (oud) Gebruik.log('start_moved', { hoe: bron, soort: staat.modus })
  startBron = bron
}

function voegPuntToe(p, bron = 'tik') {
  if (stopper || tekenen || Date.now() - netGetekend < 400) return // tijdens het plannen of tekenen geen punten zetten
  if (staat.modus === 'tekenen' || stap === 4) return
  if (stap === 1) toonStap(2)
  if (!inNederland(p)) {
    toonFout('Dat punt ligt buiten Nederland. De officiële kaart en de luchtfoto dekken alleen Nederland.')
    return
  }
  toonFout('')
  onthoud()
  const oud = staat.punten[0]
  if (staat.modus === 'rondje') staat.punten = staat.punten.length ? [staat.punten[0], p] : [p]
  else if (staat.modus === 'station' || tekenModus()) staat.punten = [p]
  else staat.punten.push(p)
  merkStart(bron, oud)
  puntenGewijzigd()
}

kaart.on('click', (e) => voegPuntToe([e.latlng.lat, e.latlng.lng]))

// ---------- Tekenen op de kaart (gebied, elke straat, route langs een lijn) ----------
const tekenLaag = L.layerGroup().addTo(kaart)
let tekenen = null // 'vrij' of 'rechthoek' terwijl je tekent
let netGetekend = 0 // de tik waarmee je stopt met tekenen is geen startpunt
let schets = null // { punten, lijn } tijdens het tekenen

function tekenTekening(vers = false) {
  werkWelkom()
  tekenLaag.clearLayers()
  const t = tekening()
  if (!t || !t.length) return
  const stijl = { color: '#9B4A7A', weight: 4, opacity: 1, dashArray: '8 6', interactive: false, className: vers ? 'tekening-vers' : '' }
  if (staat.modus === 'tekenen') {
    L.polyline(t, { ...stijl, color: '#2B211B', weight: 7, dashArray: null, opacity: 0.35 }).addTo(tekenLaag)
    L.polyline(t, stijl).addTo(tekenLaag)
  } else {
    L.polygon(t, { ...stijl, color: '#2B211B', weight: 7, dashArray: null, opacity: 0.35, fill: false }).addTo(tekenLaag)
    L.polygon(t, { ...stijl, fillColor: '#9B4A7A', fillOpacity: 0.08 }).addTo(tekenLaag)
  }
}

function startTekenen(soort) {
  if (stopper) return
  if (tekenen === soort) {
    stopTekenen()
    tekenPuntenlijst()
    return
  }
  tekenen = soort
  for (const h of [kaart.dragging, kaart.touchZoom, kaart.doubleClickZoom, kaart.boxZoom]) h.disable()
  kaart.getContainer().classList.add('tekent')
  el('tekenVrij').setAttribute('aria-pressed', String(soort === 'vrij'))
  el('tekenVierkant').setAttribute('aria-pressed', String(soort === 'rechthoek'))
  werkWelkom()
  tekenPuntenlijst()
}

function stopTekenen() {
  tekenen = null
  schets = null
  for (const h of [kaart.dragging, kaart.touchZoom, kaart.doubleClickZoom, kaart.boxZoom]) h.enable()
  kaart.getContainer().classList.remove('tekent')
  el('tekenVrij').setAttribute('aria-pressed', 'false')
  el('tekenVierkant').setAttribute('aria-pressed', 'false')
  werkWelkom()
}

/** Ligt een punt [lat, lon] binnen (of hooguit 150 m buiten) een getekend vlak? */
function binnenVlak(p, vlak) {
  let binnen = false
  for (let i = 0, j = vlak.length - 1; i < vlak.length; j = i++) {
    const [ai, bi] = vlak[i]
    const [aj, bj] = vlak[j]
    if (bi > p[1] !== bj > p[1] && p[0] < ((aj - ai) * (p[1] - bi)) / (bj - bi) + ai) binnen = !binnen
  }
  return binnen || vlak.some((q) => kaart.distance(p, q) < 150)
}

function rechthoek(a, b) {
  return [a, [a[0], b[1]], b, [b[0], a[1]]]
}

/** Punten die minder dan 'min' meter na het vorige komen, weglaten. */
function dunUit(punten, min) {
  const uit = [punten[0]]
  for (const p of punten.slice(1)) {
    const q = uit[uit.length - 1]
    if (kaart.distance(p, q) >= min) uit.push(p)
  }
  return uit
}

const kaartVlak = kaart.getContainer()
kaartVlak.addEventListener('pointerdown', (e) => {
  if (!tekenen || e.button > 0) return
  e.preventDefault()
  e.stopPropagation()
  kaartVlak.setPointerCapture(e.pointerId)
  const p = kaart.mouseEventToLatLng(e)
  schets = { punten: [[p.lat, p.lng]], lijn: L.polyline([[p.lat, p.lng]], { color: '#9B4A7A', weight: 4, dashArray: '8 6', interactive: false }).addTo(tekenLaag) }
}, { capture: true })
kaartVlak.addEventListener('pointermove', (e) => {
  if (!tekenen || !schets) return
  e.preventDefault()
  const p = kaart.mouseEventToLatLng(e)
  if (tekenen === 'rechthoek') {
    schets.punten = [schets.punten[0], [p.lat, p.lng]]
    schets.lijn.setLatLngs(rechthoek(schets.punten[0], schets.punten[1]).concat([schets.punten[0]]))
  } else {
    schets.punten.push([p.lat, p.lng])
    schets.lijn.addLatLng([p.lat, p.lng])
  }
}, { capture: true })
function eindeSchets(e) {
  if (!tekenen || !schets) return
  e.preventDefault()
  netGetekend = Date.now()
  let punten = schets.punten
  if (tekenen === 'rechthoek') punten = punten.length > 1 ? rechthoek(punten[0], punten[1]) : []
  else punten = dunUit(punten, 8)
  const nodig = staat.modus === 'tekenen' ? 2 : 3
  stopTekenen()
  // groot genoeg: de hele tekening moet minstens 30 m beslaan (niet het begin ervan)
  const omvang = punten.length >= 2 ? kaart.distance(L.latLngBounds(punten).getSouthWest(), L.latLngBounds(punten).getNorthEast()) : 0
  if (punten.length >= nodig && omvang > 30) {
    onthoud()
    if (staat.modus === 'tekenen') staat.lijn = punten
    else {
      staat.vlak = punten
      // een startpunt van eerder dat buiten het nieuwe gebied ligt, hoort er niet meer bij
      if (staat.punten.length && !binnenVlak(staat.punten[0], punten)) {
        staat.punten = []
        tekenPunten()
      }
    }
    toonFout('')
  } else toonFout('Die tekening was te klein. Teken nog eens, wat groter.')
  bewaar()
  tekenTekening(true)
  tekenPuntenlijst()
  if (tekening()) {
    const status = el('tekenstatus')
    status.classList.remove('vers')
    void status.offsetWidth
    status.classList.add('vers')
    const vak = L.latLngBounds(tekening())
    if (!kaart.getBounds().contains(vak)) kaart.fitBounds(vak.pad(0.15))
  }
}
kaartVlak.addEventListener('pointerup', eindeSchets, { capture: true })
kaartVlak.addEventListener('pointercancel', eindeSchets, { capture: true })
el('tekenVrij').addEventListener('click', () => startTekenen('vrij'))
el('tekenVierkant').addEventListener('click', () => startTekenen('rechthoek'))
el('tekenWis').addEventListener('click', () => {
  onthoud()
  stopTekenen()
  if (staat.modus === 'tekenen') staat.lijn = null
  else staat.vlak = null
  bewaar()
  tekenTekening()
  tekenPuntenlijst()
})
/** Een voorkeur veranderde (voor de teller). */
function voorkeur(sleutel, oud, nieuw) {
  if (oud !== nieuw) Gebruik.log('pref_change', { sleutel, oud, nieuw })
}
/** De voorkeuren in een paar tekens, voor de teller: P(aden) 1/0/a, S(trand), T(oegangskaart), H(euvels), L(AW), R(outes), V(orm). */
function voorkeurCode() {
  return `P${staat.alles ? 'a' : staat.trail ? 1 : 0}|S${staat.strand ? 1 : 0}|T${staat.kaartje ? 1 : 0}|H${staat.heuvels ? 1 : 0}|L${staat.law}|R${staat.grondig}|V${staat.vorm === 'kronkel' ? 'k' : 'l'}`
}
el('dood').addEventListener('change', () => {
  voorkeur('doodlopend', staat.dood !== false, el('dood').checked)
  staat.dood = el('dood').checked
  bewaar()
})
el('wegen').addEventListener('change', () => {
  onthoud()
  voorkeur('wegen', staat.wegen, el('wegen').value)
  staat.wegen = el('wegen').value
  bewaar()
  tekenPuntenlijst()
})

// ---------- Zoeken ----------
let zoekTimer = null
let zoekStopper = null
let zoekTreffers = []
function verbergZoek() {
  el('zoekresultaten').hidden = true
  zoekTreffers = []
}
function kiesTreffer(t) {
  el('zoek').value = ''
  verbergZoek()
  kaart.setView(t.punt, Math.max(kaart.getZoom(), 15))
  voegPuntToe(t.punt, 'zoek')
}
async function zoek(tekst) {
  if (zoekStopper) zoekStopper.abort()
  zoekStopper = new AbortController()
  const lijst = el('zoekresultaten')
  try {
    // treffers bij de start (of anders het midden van de kaart) eerst
    const midden = kaart.getCenter()
    const dichtbij = staat.punten[0] || [midden.lat, midden.lng]
    zoekTreffers = (await zoekPlaats(tekst, zoekStopper.signal, dichtbij)).filter((t) => inNederland(t.punt))
  } catch (fout) {
    if (fout.name === 'AbortError') return
    lijst.innerHTML = '<li class="leeg">Zoeken lukt nu niet; tik de plek op de kaart.</li>'
    lijst.hidden = false
    return
  }
  lijst.innerHTML = ''
  if (!zoekTreffers.length) lijst.innerHTML = '<li class="leeg">Niets gevonden.</li>'
  for (const t of zoekTreffers) {
    const li = document.createElement('li')
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.setAttribute('role', 'option')
    knop.innerHTML = `${veilig(t.naam)}<small>${veilig(t.soort)}</small>`
    knop.addEventListener('click', () => kiesTreffer(t))
    li.appendChild(knop)
    lijst.appendChild(li)
  }
  lijst.hidden = false
}
el('zoek').addEventListener('input', () => {
  clearTimeout(zoekTimer)
  const tekst = el('zoek').value.trim()
  if (tekst.length < 3) {
    verbergZoek()
    return
  }
  zoekTimer = setTimeout(() => zoek(tekst), 300)
})
el('zoek').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && zoekTreffers.length) {
    e.preventDefault()
    kiesTreffer(zoekTreffers[0])
  } else if (e.key === 'Escape') verbergZoek()
})
document.addEventListener('click', (e) => {
  if (!e.target.closest('.zoek')) verbergZoek()
})

// ---------- Invoer ----------
function zetModus(modus) {
  if (modus !== staat.modus) onthoud()
  if (modus !== 'route' && staat.modus !== modus) staat.punten = staat.punten.slice(0, 1) // alleen de start blijft
  stopTekenen()
  staat.modus = modus
  tekenTekening()
  for (const b of el('modus').children) b.setAttribute('aria-pressed', String(b.dataset.modus === modus))
  puntenGewijzigd()
}
el('modus').addEventListener('click', (e) => {
  const knop = e.target.closest('[data-modus]')
  if (!knop || stopper) return
  zetModus(knop.dataset.modus)
  toonStap(2)
})

// ---------- Stappen ----------
let stap = 1
let plaatsKlaar = false
let tab = 'hoogte'
let startBron = null // hoe de start gezet is: gps, tik, zoek, menu, slepen, link of bewaard (voor de teller)

function werkStapperBij() {
  const stapper = el('stapper')
  if (!stapper) return
  for (const b of stapper.children) {
    const n = Number(b.dataset.stap)
    b.classList.toggle('nu', n === stap)
    b.classList.toggle('klaar', n !== stap && (n === 1 || (n === 2 && plaatsKlaar) || (n === 3 && !!uitslag) || (n === 4 && !!uitslag && stap < 4)))
    b.disabled = (n === 3 && !plaatsKlaar) || (n === 4 && !uitslag)
  }
  werkPiekbalk()
}

/** De ene regel die je ziet als het paneel op de telefoon op piek staat: score, of de hoofdknop. */
function werkPiekbalk() {
  const balk = document.getElementById('piekbalk')
  if (!balk) return
  if (!sheet || !sheet.actief()) {
    balk.innerHTML = ''
    return
  }
  let h
  if (stopper) h = '<span class="piekloop" aria-hidden="true">' + ico('loper') + '</span><span class="psamen"></span><button type="button" data-proxy="stop">Stop</button>'
  else if (stap === 4 && plan) {
    h =
      `<span class="pscore ${scoreKlasse(plan.score)}">${plan.score}</span>` +
      `<span class="psamen"><b>${veilig(plan.label)}</b></span>` +
      '<span class="pknoppen"><button type="button" data-proxy="gpx" aria-label="Download GPX">' + ico('gpx') + '</button><button type="button" data-proxy="bewaar" aria-label="Bewaar">' + ico('bewaar') + '</button><button type="button" data-proxy="deel" aria-label="Kopieer link">' + ico('link') + '</button></span>' +
      // tweede regel over de hele breedte: niets wordt afgekapt
      `<span class="pregel">${nl(plan.analyse.lengte / 1000)} km · ${ondergrondTekst(aandelen(plan.analyse))}</span>`
  } else if (stap === 2) {
    h = `<span class="psamen"><b>${veilig(el('stap2kop').textContent)}</b></span><button type="button" class="hoofd" data-proxy="naar3" ${plaatsKlaar ? '' : 'disabled'}>Verder →</button>`
  } else if (stap === 3) h = '<span class="psamen"><b>Klaar om te plannen</b></span><button type="button" class="hoofd" data-proxy="plan">Plan route</button>'
  else h = '<span class="psamen"><b>Wat voor route?</b></span><button type="button" data-sheet="half">Kies ↑</button>'
  balk.innerHTML = h
}
el('piekbalk').addEventListener('click', (e) => {
  const knop = e.target.closest('button')
  if (!knop || knop.disabled) return
  if (knop.dataset.proxy) el(knop.dataset.proxy).click()
  else if (knop.dataset.sheet && sheet) sheet.zet(knop.dataset.sheet)
})

/** Toon één stap: 1 soort, 2 waar, 3 opties, 4 route. */
function toonStap(n, scroll = true) {
  if (n === 4 && !uitslag) n = 3
  if (n === 3 && !plaatsKlaar) n = 2
  stap = n
  for (const k of [1, 2, 3]) el(`stap${k}`).hidden = k !== n
  el('resultaat').hidden = n !== 4
  if (n !== 2) stopTekenen()
  if (n === 4) toonTab(tab)
  werkStapperBij()
  // het paneel bovenaan in beeld (op de telefoon: net onder de kaart)
  if (!scroll) return
  if (sheet && sheet.actief()) {
    document.querySelector('main').scrollTo({ top: 0, behavior: 'smooth' })
    if (sheet.stand() === 'piek' && n !== 4) sheet.zet('half')
  } else if (window.innerWidth <= 860) el('stapper').scrollIntoView({ behavior: 'smooth', block: 'start' })
  else document.querySelector('main').scrollTo({ top: 0, behavior: 'smooth' })
}

function toonTab(t) {
  tab = t
  for (const b of el('tabs').children) b.setAttribute('aria-pressed', String(b.dataset.tab === t))
  for (const k of ['hoogte', 'ondergrond']) el(`tab-${k}`).hidden = k !== t
  if (t === 'hoogte' && plan) tekenProfiel() // de breedte is pas bekend als het tabblad zichtbaar is
}

el('stapper').addEventListener('click', (e) => {
  const knop = e.target.closest('[data-stap]')
  if (knop && !knop.disabled && !stopper) toonStap(Number(knop.dataset.stap))
})
for (const knop of document.querySelectorAll('.terugknop')) knop.addEventListener('click', () => !stopper && toonStap(Number(knop.dataset.naar)))
el('naar3').addEventListener('click', () => toonStap(3))
el('tabs').addEventListener('click', (e) => {
  const knop = e.target.closest('[data-tab]')
  if (!knop) return
  if (knop.dataset.tab !== tab) Gebruik.log('details_open', { deel: `tab ${knop.dataset.tab}` })
  toonTab(knop.dataset.tab)
})
// uitklapblokken in het resultaat (twijfelstukken, tabel, langste stukken): wat gaat er open?
for (const blok of document.querySelectorAll('#resultaat details')) {
  blok.addEventListener('toggle', () => {
    if (!blok.open) return
    const kop = blok.querySelector('summary')
    const naam = blok.id || (kop ? kop.textContent.trim().split(/\s+/).slice(0, 3).join(' ') : 'blok')
    Gebruik.log('details_open', { deel: naam })
  })
}
el('km').addEventListener('change', () => {
  onthoud()
  const oud = staat.km
  staat.km = Math.max(2, Math.min(60, Number(el('km').value) || 10))
  el('km').value = staat.km
  if (oud !== staat.km) Gebruik.log('km_change', { oud, nieuw: staat.km, soort: staat.modus })
  bewaar()
})
el('law').addEventListener('change', () => {
  voorkeur('law', staat.law, Number(el('law').value))
  staat.law = Number(el('law').value)
  bewaar()
})
el('grondig').addEventListener('change', () => {
  voorkeur('routes', staat.grondig, Number(el('grondig').value))
  staat.grondig = Number(el('grondig').value)
  bewaar()
})
const ONDERGROND_HINT = { 1: 'liever singletrack en smalle paadjes', 0: 'alles wat onverhard is, ook brede zandwegen', a: 'ook asfalt is goed; alleen weinig heen en terug' }
/** De schakelaar 'Ondergrond' volgt de (verborgen) keuzelijst waar de rest van de app op leunt. */
function zetOndergrondKnoppen() {
  const w = el('trail').value
  for (const b of el('ondergrond').children) b.setAttribute('aria-pressed', String(b.dataset.waarde === w))
  el('ondergrondHint').textContent = ONDERGROND_HINT[w]
}
el('ondergrond').addEventListener('click', (e) => {
  const knop = e.target.closest('[data-waarde]')
  if (!knop) return
  el('trail').value = knop.dataset.waarde
  el('trail').dispatchEvent(new Event('change', { bubbles: true }))
})
el('trail').addEventListener('change', () => {
  voorkeur('ondergrond', staat.alles ? 'a' : staat.trail ? '1' : '0', el('trail').value)
  staat.trail = el('trail').value === '1'
  staat.alles = el('trail').value === 'a'
  zetOndergrondKnoppen()
  bewaar()
})
el('strand').addEventListener('change', () => {
  voorkeur('strand', !!staat.strand, el('strand').checked)
  staat.strand = el('strand').checked
  bewaar()
})
el('heuvels').addEventListener('change', () => {
  voorkeur('hoogtemeters', !!staat.heuvels, el('heuvels').checked)
  staat.heuvels = el('heuvels').checked
  bewaar()
})
el('kaartje').addEventListener('change', () => {
  voorkeur('toegangskaart', !!staat.kaartje, el('kaartje').checked)
  staat.kaartje = el('kaartje').checked
  bewaar()
})
el('luchtfoto').addEventListener('change', () => {
  voorkeur('luchtfoto', !!staat.luchtfoto, el('luchtfoto').checked)
  staat.luchtfoto = el('luchtfoto').checked
  bewaar()
  if (plan) tekenTwijfels()
})
/** Eén regel onder 'Instellingen' met wat er aan staat. */
function vatSamen() {
  const delen = [staat.alles ? 'ook verhard' : staat.trail ? 'trail' : 'alles onverhard']
  if (staat.strand) delen.push('strand overslaan')
  if (staat.kaartje) delen.push('toegangskaart')
  if (staat.heuvels) delen.push('meer hoogtemeters')
  if (staat.law !== 1) delen.push(staat.law <= 0.3 ? 'sterke LAW-voorkeur' : 'lichte LAW-voorkeur')
  delen.push(staat.grondig === 0 ? '1 route, zonder officiële kaart' : `${Math.max(1, staat.grondig)} ${staat.grondig === 1 ? 'route' : 'routes'}`)

  el('instSamenvatting').textContent = '· ' + delen.join(' · ')
}
el('instellingen').addEventListener('change', vatSamen)
el('twijfelblok').addEventListener('toggle', () => {
  if (plan) tekenRoute(false)
})
el('vorm').addEventListener('change', () => {
  onthoud()
  voorkeur('vorm', staat.vorm, el('vorm').value)
  staat.vorm = el('vorm').value
  bewaar()
})
/** Alles leeg: punten, tekening en routes (instellingen blijven). */
el('opnieuw').addEventListener('click', () => {
  if (stopper) stopper.abort()
  onthoud()
  stopTekenen()
  staat.punten = []
  staat.vlak = null
  staat.lijn = null
  uitslag = null
  plan = null
  gekozen = 0
  opKaart.clear()
  stopAfspelen()
  for (const laag of [routeLaag, altLaag, profielLaag, tekenLaag, waterLaag, stationLaag, omwegLaag]) laag.clearLayers()
  tekenKaartlagen(null) // de knoppen voor stations en water horen bij de oude route
  el('resultaat').hidden = true
  toonFout('')
  bewaar()
  puntenGewijzigd()
  toonStap(1)
  main.scrollTo?.({ top: 0 })
  window.scrollTo({ top: 0 })
})
const main = document.querySelector('main')
el('nieuw').addEventListener('click', () => el('opnieuw').click())
el('keerom').addEventListener('click', () => {
  onthoud()
  staat.punten.reverse()
  puntenGewijzigd()
})
el('wis').addEventListener('click', () => {
  onthoud()
  staat.punten = []
  puntenGewijzigd()
})
el('locatie').addEventListener('click', () => {
  if (!navigator.geolocation) {
    toonFout('Deze browser geeft geen locatie door.')
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const p = [pos.coords.latitude, pos.coords.longitude]
      kaart.setView(p, 15)
      if (!inNederland(p)) {
        toonFout('Je staat buiten Nederland. De officiële kaart en de luchtfoto dekken alleen Nederland.')
        return
      }
      if (!staat.punten.length) voegPuntToe(p, 'gps')
    },
    () => toonFout('Je locatie is niet beschikbaar. Geef de browser toestemming, of zoek of tik zelf een plek.'),
    { enableHighAccuracy: true, timeout: 10000 },
  )
})

// ---------- Plannen ----------
/** Voortgang van 0 tot 1, of null als we het niet weten (dan loopt het poppetje heen en weer). */
function zetVoortgang(deel) {
  const baan = el('baan')
  baan.classList.toggle('onbepaald', deel === null)
  baan.style.setProperty('--p', deel === null ? 0 : Math.max(0, Math.min(1, deel)))
}

function stopBezig() {
  stopper = null
  werkPiekbalk()
  el('plan').hidden = false
  el('bezig').hidden = true
}

async function planNu() {
  if (stopper) return
  toonFout('')
  if (tekenModus() && !(tekening() || []).every(inNederland)) {
    toonFout('De tekening ligt (deels) buiten Nederland. De officiële kaart dekt alleen Nederland.')
    return
  }
  if (!staat.punten.every(inNederland)) {
    toonFout('Een van de punten ligt buiten Nederland. De officiële kaart en de luchtfoto dekken alleen Nederland.')
    return
  }
  toonStap(3)
  const t0 = performance.now()
  const metKm = ['rondje', 'station', 'gebied'].includes(staat.modus)
  Gebruik.log('plan_start', { soort: staat.modus, km: metKm ? staat.km : null, start: startBron, voorkeuren: voorkeurCode() })
  stopper = new AbortController()
  el('plan').hidden = true
  el('bezig').hidden = false
  zetVoortgang(null)
  zetVoortgang(null)
  const status = (tekst) => {
    el('status').textContent = tekst
  }
  let stap = ''
  try {
    const rondje = staat.modus === 'rondje'
    const station = staat.modus === 'station'
    const resultaat = await maakPlan({
      modus: tekenModus() || station ? staat.modus : undefined,
      tekening: tekenModus() ? tekening() : undefined,
      wegen: staat.wegen,
      zonderDoodlopend: staat.dood !== false,
      heuvels: !!staat.heuvels,
      punten: rondje ? staat.punten.slice(0, 2) : station ? staat.punten.slice(0, 1) : staat.punten,
      rondjeKm: rondje || station || staat.modus === 'gebied' ? staat.km : null,
      law: staat.law,
      trail: staat.trail,
      alles: !!staat.alles,
      strandMijden: staat.strand,
      kaartje: staat.kaartje,
      vorm: staat.vorm,
      alternatieven: Math.max(1, staat.grondig),
      metBgt: staat.grondig > 0,
      signal: stopper.signal,
      meld: (tekst) => {
        stap = tekst
        status(tekst + '…')
        zetVoortgang(null)
      },
      voortgang: (klaar, totaal) => {
        status(`${stap}: ${klaar} van ${totaal} kaarttegels`)
        zetVoortgang(klaar / totaal)
      },
    })
    onthoud() // zo brengt 'ongedaan maken' de vorige route terug
    uitslag = resultaat
    gekozen = 0
    opKaart.clear()
    uitslag.opties.forEach((_, i) => opKaart.add(i)) // eerst alle routes tonen, om te vergelijken
    plan = details(uitslag.opties[0], MIN_TWIJFEL)
    Gebruik.log('plan_done', { soort: staat.modus, ok: true, ms: Math.round(performance.now() - t0), routes: uitslag.opties.length })
    stopBezig() // eerst de voortgangsbalk weg, dan pas naar het resultaat scrollen (anders schuift het weg)
    toonResultaat(true)
  } catch (fout) {
    Gebruik.log('plan_done', { soort: staat.modus, ok: false, ms: Math.round(performance.now() - t0), fout: fout.name === 'AbortError' ? 'gestopt' : fout.bron || 'fout' })
    if (fout.name === 'AbortError') toonFout('Gestopt. Er is geen route gemaakt.')
    else if (fout.bron) toonFout(`Het lukte niet bij ${fout.bron}: ${fout.melding}. Er is geen route gemaakt.`)
    else {
      toonFout(`Er ging iets mis: ${fout.message}`)
      console.error(fout)
    }
  } finally {
    stopBezig()
  }
}
el('plan').addEventListener('click', planNu)
el('stop').addEventListener('click', () => stopper && stopper.abort())

function kiesRoute(i) {
  if (!uitslag || i === gekozen) return
  gekozen = i
  opKaart.add(i)
  plan = details(uitslag.opties[i], MIN_TWIJFEL)
  toonResultaat(false)
}

// ---------- Resultaat ----------
const naarLatLon = (xy) => xy.map(([x, y]) => {
  const [lon, lat] = K.naarWgs(x, y)
  return [lat, lon]
})
let lijnen = [] // [[polyline, stuk], ...]
let korrels = [] // [[polyline, stuk], ...]: de korrel op de route
let twijfelLijn = {}

function popup(s) {
  let h =
    `<b>Route ${plan.naam} · km ${nl(s.van / 1000)}–${nl(s.tot / 1000)}</b> · ${Math.round(s.tot - s.van)} m<br>` +
    `Eindoordeel: <b>${s.eind}</b><br>OpenStreetMap: ${s.osm}${s.osmZeker ? '' : ' (aanname)'}<br>` +
    `<code>${veilig(s.tags.slice(0, 4).join(' | '))}</code><br>Officiële kaart: ${s.bgt}${s.strand ? ' (strand)' : ''}<br>` +
    `<code>${veilig(s.bgtUitleg)}</code>`
  if (s.kaartje) h += '<br><b>Toegang:</b> in OpenStreetMap afgesloten; alleen met een toegangskaart (en als de borden het toelaten)'
  if (s.twijfel) h += `<br><b style="color:var(--twijfel)">Twijfel${s.nr ? ' #' + s.nr : ''}:</b> ${veilig(s.twijfelTekst)}`
  if (s.indicatie) h += `<br>Kleurindicatie luchtfoto: ${veilig(s.indicatie)}`
  return h
}

/** De andere routes die op de kaart staan: dun en gestippeld, in de kleur van de ondergrond. */
function tekenAlternatieven() {
  altLaag.clearLayers()
  for (const i of opKaart) {
    if (i === gekozen) continue
    const o = uitslag.opties[i]
    const tip = `Route ${o.naam}: ${nl(o.km)} km, score ${o.score}, ${o.analyse ? ondergrondTekst(aandelen(o.analyse)) : totaalTekst(o.zacht)}. Tik om te kiezen.`
    const kies = () => kiesRoute(i)
    L.polyline(naarLatLon(o.analyse.xy), { pane: 'alternatieven', color: KLEUR.rouw, weight: 7, opacity: 0.7, bubblingMouseEvents: false })
      .bindTooltip(tip, { sticky: true })
      .on('click', kies)
      .addTo(altLaag)
    for (const s of o.analyse.samengevoegd) {
      L.polyline(naarLatLon(s.xy), {
        pane: 'alternatieven', color: KLEUR[s.eind], weight: 3.5, dashArray: '6 6', lineCap: 'butt', bubblingMouseEvents: false,
      })
        .bindTooltip(tip, { sticky: true })
        .on('click', kies)
        .addTo(altLaag)
    }
    const [lat, lon] = naarLatLon([K.puntOpLijn(o.analyse.xy, o.analyse.lengte * 0.3)])[0]
    L.marker([lat, lon], { icon: icoon(o.naam, 'alt'), keyboard: false, title: tip }).on('click', kies).addTo(altLaag)
  }
}

function tekenRoute(passend) {
  routeLaag.clearLayers()
  lijnen = []
  korrels = []
  twijfelLijn = {}
  const alles = naarLatLon(plan.analyse.xy)
  L.polyline(alles, { color: KLEUR.rouw, weight: 9, opacity: 0.9, interactive: false }).addTo(routeLaag)
  for (const s of plan.analyse.samengevoegd) {
    const pad = naarLatLon(s.xy)
    const lijn = L.polyline(pad, { color: KLEUR[s[bron]], weight: 5, opacity: 1, lineCap: 'butt', bubblingMouseEvents: false }).addTo(routeLaag)
    lijn.bindPopup(() => {
      const inhoud = document.createElement('div')
      inhoud.innerHTML = popup(s)
      if (uitslag.graaf && keuze().knopen) {
        const knop = document.createElement('button')
        knop.type = 'button'
        knop.className = 'weghalen'
        knop.innerHTML = ico('schaar') + 'Haal dit stukje weg'
        knop.addEventListener('click', () => {
          const plek = lijn.getPopup().getLatLng()
          kaart.closePopup()
          versleepNaar(dichtsteIndex(plek), null, null, true)
        })
        inhoud.appendChild(knop)
      }
      return inhoud
    }, { maxWidth: 300 })
    lijn.bindTooltip(() => `km ${nl(s.van / 1000)}–${nl(s.tot / 1000)} · ${s[bron]}${s.twijfel ? ' · twijfel' : ''}`, { sticky: true })
    maakVersleepbaar(lijn)
    lijnen.push([lijn, s])
    korrels.push([L.polyline(pad, { ...(korrelStijl(s[bron]) || { color: '#000', weight: 1, dashArray: '1 9' }), opacity: korrelStijl(s[bron]) ? korrelStijl(s[bron]).opacity : 0, interactive: false }).addTo(routeLaag), s])
    const twijfelsTonen = el('twijfelblok').open
    if (s.twijfel && twijfelsTonen) {
      // dunne stippellijn eroverheen, zodat twijfel niet alleen aan kleur hangt
      L.polyline(pad, { color: KLEUR.inkt, weight: 1.5, dashArray: '3 6', interactive: false }).addTo(routeLaag)
    }
    if (s.nr) {
      twijfelLijn[s.nr] = lijn
      const [mx, my] = K.puntOpLijn(s.xy, K.lijnLengte(s.xy) / 2)
      const [lon, lat] = K.naarWgs(mx, my)
      s.midden = [lat, lon]
      if (twijfelsTonen) {
        L.marker(s.midden, { icon: icoon(s.nr, 'tw'), keyboard: false })
          .on('click', () => lijn.openPopup(s.midden))
          .addTo(routeLaag)
      }
    }
  }
  tekenHandvatten()
  if (passend) {
    const grens = L.latLngBounds(alles)
    for (const i of opKaart) grens.extend(L.latLngBounds(naarLatLon(uitslag.opties[i].analyse.xy)))
    kaart.fitBounds(grens.pad(0.06))
  }
}

// ---------- Route verslepen ----------
let slepen = null // { i0, x, y, bewogen, stip, elastiek }
let aanpassen = false

function kanSlepen() {
  if (!uitslag || stopper || tekenen || aanpassen) return false
  return !!(uitslag.graaf && keuze().knopen) || staat.modus === 'route'
}

/** Index van het routepunt het dichtst bij een plek op de kaart. */
function dichtsteIndex(latlng) {
  const [x, y] = K.naarRd(latlng.lng, latlng.lat)
  let beste = 0
  let besteD = Infinity
  plan.analyse.xy.forEach(([px, py], i) => {
    const d = (px - x) ** 2 + (py - y) ** 2
    if (d < besteD) {
      besteD = d
      beste = i
    }
  })
  return beste
}

function maakVersleepbaar(lijn) {
  const pak = lijn.getElement && lijn.getElement()
  if (!pak) return
  pak.style.cursor = kanSlepen() ? 'grab' : ''
  pak.addEventListener('pointerdown', (e) => {
    if (!kanSlepen() || e.button > 0) return
    e.stopPropagation()
    kaart.dragging.disable()
    const ll = kaart.mouseEventToLatLng(e)
    slepen = { i0: dichtsteIndex(ll), x: e.clientX, y: e.clientY, bewogen: false, van: ll }
  })
}

document.addEventListener('pointermove', (e) => {
  if (!slepen) return
  if (!slepen.bewogen && Math.hypot(e.clientX - slepen.x, e.clientY - slepen.y) < 8) return
  e.preventDefault()
  const ll = kaart.mouseEventToLatLng(e)
  if (!slepen.bewogen) {
    slepen.bewogen = true
    kaart.closePopup()
    slepen.elastiek = L.polyline([slepen.van, ll], { color: '#2B211B', weight: 3, dashArray: '6 6', interactive: false }).addTo(routeLaag)
    slepen.stip = L.circleMarker(ll, { radius: 9, color: '#2B211B', weight: 3, fillColor: '#9B4A7A', fillOpacity: 1, interactive: false }).addTo(routeLaag)
  }
  slepen.elastiek.setLatLngs([slepen.van, ll])
  slepen.stip.setLatLng(ll)
})

document.addEventListener('pointerup', (e) => {
  if (!slepen) return
  const s = slepen
  slepen = null
  kaart.dragging.enable()
  if (!s.bewogen) return
  netGetekend = Date.now() // deze tik is geen nieuw punt
  setTimeout(() => kaart.closePopup(), 0)
  const ll = kaart.mouseEventToLatLng(e)
  versleepNaar(s.i0, [ll.lat, ll.lng])
})

/** Laat de route via een nieuw punt lopen (of, met loslaten, een versleept punt weer vrij). */
async function versleepNaar(i0, punt, loslaten = null, weghalen = false) {
  if (uitslag.graaf && keuze().knopen) {
    aanpassen = true
    kaart.getContainer().classList.add('rekent')
    try {
      const nieuw = await pasRouteAan(uitslag, keuze(), { i0, punt, loslaten, weghalen })
      if (!nieuw) {
        toonFout(weghalen ? 'Dit stukje kan niet weg zonder grote omweg.' : 'Daar kan de route niet langs.')
        tekenRoute(false)
        return
      }
      onthoud()
      uitslag = { ...uitslag, opties: uitslag.opties.map((o, i) => (i === gekozen ? nieuw : o)) }
      plan = details(nieuw, MIN_TWIJFEL)
      toonFout('')
      toonResultaat(false)
    } catch (fout) {
      toonFout(`Aanpassen lukte niet: ${fout.melding || fout.message}`)
      tekenRoute(false)
    } finally {
      aanpassen = false
      kaart.getContainer().classList.remove('rekent')
    }
    return
  }
  // van A naar B (via BRouter): een tussenpunt erbij op de juiste plek, en opnieuw plannen
  const plekken = staat.punten.map((p) => dichtsteIndex(L.latLng(p[0], p[1])))
  let na = 0
  for (let k = 0; k < plekken.length - 1; k++) if (plekken[k] <= i0) na = k
  onthoud()
  staat.punten.splice(na + 1, 0, punt)
  puntenGewijzigd()
  planNu()
}

/** Versleepte punten als handvat: nog eens slepen, of tikken om weg te halen. */
function tekenHandvatten() {
  const o = keuze()
  if (!o.vast || !uitslag.graaf) return
  for (const k of o.vast) {
    if (k === 0 || k === o.knopen.length - 1) continue
    const c = plan.traject.coords[k]
    if (!c) continue
    const handvat = L.divIcon({ className: '', html: '<div class="punt via sleep"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })
    const m = L.marker([c[1], c[0]], { icon: handvat, draggable: true, zIndexOffset: 900, title: 'Sleep, of tik om weg te halen' }).addTo(routeLaag)
    m.on('dragend', () => {
      const { lat, lng } = m.getLatLng()
      versleepNaar(k, [lat, lng])
    })
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.textContent = 'Haal dit punt weg'
    knop.addEventListener('click', () => {
      kaart.closePopup()
      versleepNaar(k, null, k)
    })
    m.bindPopup(knop)
  }
}

// ---------- Route afspelen ----------
const afspeelLaag = L.layerGroup().addTo(kaart)
let afspelen = null // { d, totaal, tempo, laatst, raf, xy, opgeteld, loper }
let tempo = 1
const AFSPEEL_MS = 40000 // hele route in 40 s bij 1×

function stopAfspelen(wissen = true) {
  if (afspelen && afspelen.raf) cancelAnimationFrame(afspelen.raf)
  if (wissen) {
    afspelen = null
    afspeelLaag.clearLayers()
    el('afspeelstand').textContent = ''
  } else if (afspelen) afspelen.raf = null
  el('afspeel').innerHTML = ico('play')
  el('tempo').hidden = true
}

function afspeelStap(nu) {
  const a = afspelen
  if (!a) return
  const dt = a.laatst ? nu - a.laatst : 0
  a.laatst = nu
  a.d = Math.min(a.totaal, a.d + (a.totaal / AFSPEEL_MS) * dt * tempo)
  const [x, y] = puntOpAfstand(a.xy, a.opgeteld, a.d)
  const [lon, lat] = K.naarWgs(x, y)
  a.loper.setLatLng([lat, lon])
  // de kaart volgt de loper als die uit het midden van beeld loopt
  const binnen = kaart.getBounds().pad(-0.25)
  if (!binnen.contains([lat, lon])) kaart.panTo([lat, lon], { animate: true, duration: 0.6 })
  const h = profielNaar ? profielNaar(a.d * a.schaal, false) : null
  el('afspeelstand').textContent = `km ${nl(a.d / 1000, 1)}${typeof h === 'number' ? ` · ${Math.round(h)} m` : ''}`
  if (a.d >= a.totaal) {
    stopAfspelen(false)
    el('afspeel').innerHTML = ico('nogeens')
    a.d = 0
    a.klaar = true
    return
  }
  a.raf = requestAnimationFrame(afspeelStap)
}

function wisselAfspelen() {
  if (!plan) return
  if (afspelen && afspelen.raf) {
    stopAfspelen(false)
    el('afspeel').innerHTML = ico('play')
    return
  }
  if (!afspelen) {
    const xy = plan.analyse.xy
    const opgeteld = [0]
    for (let i = 1; i < xy.length; i++) opgeteld.push(opgeteld[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
    const h = keuze().hoogte
    const totaal = opgeteld[opgeteld.length - 1]
    const loper = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="loper">' + ico('loper') + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false, zIndexOffset: 2000 })
    afspelen = { d: 0, totaal, xy, opgeteld, loper, schaal: h ? h.afstand[h.afstand.length - 1] / totaal : 1 }
    loper.addTo(afspeelLaag)
  }
  if (afspelen.klaar) afspelen.klaar = false
  afspelen.laatst = 0
  el('afspeel').innerHTML = ico('pauze')
  el('tempo').hidden = false
  afspelen.raf = requestAnimationFrame(afspeelStap)
}
el('afspeel').addEventListener('click', () => {
  if (!afspelen) Gebruik.log('details_open', { deel: 'afspelen' })
  wisselAfspelen()
})
el('tempo').addEventListener('click', (e) => {
  const t = Number(e.target.dataset.tempo)
  if (!t) return
  tempo = t
  for (const b of el('tempo').children) b.setAttribute('aria-pressed', String(Number(b.dataset.tempo) === t))
})

// ---------- Groene omwegen ----------
const omwegLaag = L.layerGroup().addTo(kaart)
let omwegModus = false

const kanOmwegen = () => !!(uitslag && uitslag.graaf && keuze().knopen && staat.modus !== 'straten' && stap === 4)
const plus = (n) => (n >= 0 ? '+' : '−') + nl(Math.abs(n), 1)

/** Korte melding bij het resultaat die vanzelf weer weggaat. */
function kortMelding(tekst) {
  const p = document.createElement('p')
  p.className = 'melding'
  p.textContent = tekst
  el('meldingen').appendChild(p)
  setTimeout(() => p.remove(), 4000)
}

/** Teken de omwegen voor de gekozen route: groene stippellijnen met een chip; een tik past toe. */
function tekenOmwegen() {
  omwegLaag.clearLayers()
  const knop = el('omwegen')
  knop.hidden = !kanOmwegen()
  knop.setAttribute('aria-pressed', String(omwegModus && !knop.hidden))
  if (!omwegModus || knop.hidden) return
  const lijst = zoekOmwegen(uitslag, keuze())
  if (!lijst.length) {
    omwegModus = false
    knop.setAttribute('aria-pressed', 'false')
    kortMelding('Geen groene omweg gevonden')
    return
  }
  for (const o of lijst) {
    const toepassen = () => omwegToepassen(o)
    L.polyline(o.lijn, { color: '#F2E4B8', weight: 10, opacity: 0.9, lineCap: 'round', interactive: false }).addTo(omwegLaag)
    L.polyline(o.lijn, { color: '#5F7A2F', weight: 6, opacity: 0.95, dashArray: '2 9', lineCap: 'round', bubblingMouseEvents: false })
      .on('click', toepassen)
      .addTo(omwegLaag)
    const mid = o.lijn[Math.floor(o.lijn.length / 2)]
    const chip = L.marker(mid, {
      icon: L.divIcon({ className: '', html: `<button type="button" class="omwegchip" title="Tik om deze omweg te lopen">${plus(o.extraM / 1000)} km · ≈ ${o.puntenWinst >= 0 ? '+' : '−'}${Math.abs(o.puntenWinst)} punten</button>`, iconSize: [0, 0] }),
      keyboard: false, zIndexOffset: 1500,
    }).addTo(omwegLaag)
    chip.on('click', toepassen)
  }
}

async function omwegToepassen(o) {
  if (aanpassen || stopper) return
  aanpassen = true
  kaart.getContainer().classList.add('rekent')
  try {
    const nieuw = await pasRouteAan(uitslag, keuze(), { omweg: o })
    if (!nieuw) {
      toonFout('Deze omweg lukte niet.')
      return
    }
    onthoud()
    uitslag = { ...uitslag, opties: uitslag.opties.map((x, i) => (i === gekozen ? nieuw : x)) }
    plan = details(nieuw, MIN_TWIJFEL)
    toonFout('')
    toonResultaat(false) // tekent ook de omwegen van de nieuwe route opnieuw
  } catch (fout) {
    toonFout(`Omweg toepassen lukte niet: ${fout.melding || fout.message}`)
  } finally {
    aanpassen = false
    kaart.getContainer().classList.remove('rekent')
  }
}

function wisselOmwegen() {
  omwegModus = !omwegModus
  tekenOmwegen()
}
el('omwegen').addEventListener('click', wisselOmwegen)

// ---------- Stations (modus 'station') ----------
const stationLaag = L.layerGroup().addTo(kaart)
let stationsAan = true

/** De kandidaat-stations als kleine 🚉 op de kaart; een tik geeft 'Route hierheen'. */
function tekenStations() {
  stationLaag.clearLayers()
  if (!uitslag || !uitslag.stations || !stationsAan) return
  for (const s of uitslag.stations) {
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: '', html: `<div class="stationico${s.trein ? '' : ' halte'}">${ico('station')}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      keyboard: false, zIndexOffset: 600,
    }).addTo(stationLaag)
    const inhoud = document.createElement('div')
    inhoud.innerHTML = `<b>${veilig(s.naam)}</b><br>${nl(s.km, 1)} km over het netwerk${s.trein ? '' : '<br><small>misschien een tram- of metrohalte</small>'}<br>`
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.textContent = 'Route hierheen'
    knop.addEventListener('click', () => {
      kaart.closePopup()
      naarStation(s)
    })
    inhoud.appendChild(knop)
    m.bindPopup(inhoud)
  }
}

/** Voeg de route naar dit station toe (of kies hem als hij er al is). */
async function naarStation(s) {
  const bestaand = uitslag.opties.findIndex((o) => o.station === s.naam)
  if (bestaand >= 0) {
    opKaart.add(bestaand)
    if (bestaand === gekozen) return
    kiesRoute(bestaand)
    return
  }
  if (uitslag.opties.length >= 8) {
    toonFout('Er staan al 8 routes. Haal een route weg (Ongedaan maken) of begin opnieuw.')
    return
  }
  aanpassen = true
  kaart.getContainer().classList.add('rekent')
  try {
    const nieuw = await routeNaarStation(uitslag, s)
    if (!nieuw) {
      toonFout('Daar kan de route niet langs.')
      return
    }
    nieuw.naam = 'ABCDEFGH'[uitslag.opties.length]
    onthoud()
    uitslag = { ...uitslag, opties: [...uitslag.opties, nieuw] }
    gekozen = uitslag.opties.length - 1
    opKaart.add(gekozen)
    plan = details(nieuw, MIN_TWIJFEL)
    toonFout('')
    toonResultaat(false)
  } catch (fout) {
    toonFout(`Route naar het station lukte niet: ${fout.melding || fout.message}`)
  } finally {
    aanpassen = false
    kaart.getContainer().classList.remove('rekent')
  }
}

// ---------- Water onderweg ----------
const waterLaag = L.layerGroup().addTo(kaart)
const WATER = { water: ['water', 'Drinkwater'], horeca: ['horeca', 'Horeca'], winkel: ['winkel', 'Winkel'], toilet: ['toilet', 'Toilet'], tank: ['tank', 'Tankstation'] }
const waterAan = new Set(['water', 'winkel']) // standaard alleen drinkwater en winkels; de rest met een tik erbij
let tijdenGehaald = null // de water-uitslag waarvoor de openingstijden al gehaald zijn

/** Korte tekst over open/dicht, of '' als er geen (bruikbare) tijden zijn. */
function openTekst(p) {
  if (!p.open) return ''
  const o = K.isOpen(p.open)
  if (!o) return `<small>${veilig(p.open.slice(0, 40))}</small>`
  if (o.open) return `<small class="open">nu open${o.tot ? ` · tot ${o.tot}` : ''}</small>`
  return `<small class="dicht">nu dicht${o.vanaf ? ` · open om ${o.vanaf}` : ''}</small>`
}

/** De knop rechtsboven op de kaart: per soort punt een tik om de laag aan of uit te zetten. */
const kaartlagenKnop = L.control({ position: 'topright' })
let kaartlagenVak = null
kaartlagenKnop.onAdd = () => {
  kaartlagenVak = L.DomUtil.create('div', 'kaartlagen leaflet-bar')
  kaartlagenVak.hidden = true
  L.DomEvent.disableClickPropagation(kaartlagenVak)
  L.DomEvent.disableScrollPropagation(kaartlagenVak)
  return kaartlagenVak
}
kaartlagenKnop.addTo(kaart)

function tekenKaartlagen(w) {
  kaartlagenVak.innerHTML = ''
  const soorten = w ? Object.entries(WATER).filter(([soort]) => w.punten.some((p) => p.soort === soort)) : []
  const stations = uitslag && uitslag.stations
  kaartlagenVak.hidden = !soorten.length && !stations
  if (stations) {
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.setAttribute('aria-pressed', String(stationsAan))
    knop.setAttribute('aria-label', `Stations: ${stations.length}`)
    knop.title = `Stations (${stations.length})`
    knop.innerHTML = `<span>${ico('station')}</span><small>${stations.length}</small>`
    knop.addEventListener('click', () => {
      stationsAan = !stationsAan
      tekenStations()
      tekenKaartlagen(w)
    })
    kaartlagenVak.appendChild(knop)
  }
  for (const [soort, [pictogram, naam]] of soorten) {
    const n = w.punten.filter((p) => p.soort === soort).length
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.setAttribute('aria-pressed', String(waterAan.has(soort)))
    knop.setAttribute('aria-label', `${naam}: ${n}`)
    knop.title = `${naam} (${n})`
    knop.innerHTML = `<span>${ico(pictogram)}</span><small>${n}</small>`
    knop.addEventListener('click', () => {
      if (waterAan.has(soort)) waterAan.delete(soort)
      else waterAan.add(soort)
      tekenWater()
      haalTijdenErbij() // openingstijden pas ophalen als een laag met winkels of horeca aangaat
    })
    kaartlagenVak.appendChild(knop)
  }
}

function tekenWater() {
  waterLaag.clearLayers()
  const w = keuze().water
  const regel = el('waterregel')
  tekenKaartlagen(w)
  if (!w) {
    regel.hidden = true
    return
  }
  regel.hidden = false
  regel.textContent = `Langste stuk zonder water: ${nl(w.langsteZonder / 1000, 1)} km`
  const kanVia = !!(uitslag.graaf && keuze().knopen) || staat.modus === 'route'
  for (const p of w.punten.filter((p) => waterAan.has(p.soort))) {
    const [pictogram, soort] = WATER[p.soort]
    const m = L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: '', html: `<div class="waterico ${p.soort}">${ico(pictogram)}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      keyboard: false, zIndexOffset: 500,
    }).addTo(waterLaag)
    const inhoud = document.createElement('div')
    inhoud.innerHTML = `<b>${veilig(p.naam || soort)}</b><br>${soort} · km ${nl(p.km, 1)} · ${Math.round(p.afstand)} m van de route${openTekst(p) ? `<br>${openTekst(p)}` : ''}${p.open ? `<br><small>${veilig(p.open)}</small>` : ''}<br>`
    if (kanVia) {
      const knop = document.createElement('button')
      knop.type = 'button'
      knop.textContent = 'Route via hier'
      knop.addEventListener('click', () => {
        kaart.closePopup()
        versleepNaar(p.index, [p.lat, p.lon])
      })
      inhoud.appendChild(knop)
    }
    m.bindPopup(inhoud)
  }
}
async function haalTijdenErbij() {
  const w = keuze().water
  if (!w || tijdenGehaald === w || ![...waterAan].some((s) => s !== 'water' && w.punten.some((p) => p.soort === s))) return
  tijdenGehaald = w
  try {
    if (await haalOpeningstijden(w.punten)) tekenWater()
  } catch {
    // geen tijden: dan niet
  }
}


function kleurRoute() {
  for (const [lijn, s] of lijnen) lijn.setStyle({ color: KLEUR[s[bron]] })
  for (const [k, s] of korrels) k.setStyle(korrelStijl(s[bron]) || { opacity: 0 })
  for (const b of el('bron').children) b.setAttribute('aria-pressed', String(b.dataset.bron === bron))
}
el('bron').addEventListener('click', (e) => {
  if (e.target.dataset.bron && e.target.dataset.bron !== bron) Gebruik.log('details_open', { deel: `kleur ${e.target.dataset.bron}` })
  if (e.target.dataset.bron) {
    bron = e.target.dataset.bron
    kleurRoute()
    if (plan) tekenBalken()
  }
})

function tekenOpties() {
  const lijst = el('opties')
  lijst.innerHTML = ''
  const rondje = staat.modus === 'rondje'
  uitslag.opties.forEach((o, i) => {
    const li = document.createElement('li')
    li.className = 'optie' + (i === gekozen ? ' gekozen' : '')
    const kies = document.createElement('button')
    kies.type = 'button'
    kies.className = 'kies'
    kies.setAttribute('aria-pressed', String(i === gekozen))
    let regel = `${o.analyse ? ondergrondTekst(aandelen(o.analyse)) : totaalTekst(o.zacht)} · ${pct(o.paadjes)} paadjes`
    if (o.law > 0.05) regel += ` · ${pct(o.law)} LAW`
    if (o.stijgen !== null && o.stijgen !== undefined) regel += ` · ↗ ${Math.round(o.stijgen)} m`
    if (o.ronden > 1) regel += ` · ${o.ronden} rondjes`
    else if ((rondje || staat.modus === 'straten') && o.dubbel > 0.02) regel += ` · ${pct(o.dubbel)} dubbel gelopen`
    if (o.strand > 100) regel += ` · ${km(o.strand)} strand`
    if (o.kaartje > 50) regel += ` · ${km(o.kaartje)} met toegangskaart`
    const titel = o.ingelezen ? veilig(o.ingelezen) : o.station ? `→ ${veilig(o.station)}</b> · ${nl(o.km)} km<b>` : `${nl(o.km)} km${i === 0 && uitslag.opties.length > 1 ? '</b> · aanbevolen<b>' : ''}`
    kies.innerHTML = `<span class="letter">${o.naam}</span><span><b>${titel}</b><small>${regel}</small></span><span class="badge ${scoreKlasse(o.score)}" title="Nopav.es-score: ${veilig(o.label)}">${o.score}</span>`
    kies.addEventListener('click', () => kiesRoute(i))
    const toon = document.createElement('label')
    toon.className = 'toon'
    toon.innerHTML = `<input type="checkbox" ${opKaart.has(i) ? 'checked' : ''} ${i === gekozen ? 'disabled' : ''}> op kaart`
    toon.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) opKaart.add(i)
      else opKaart.delete(i)
      tekenAlternatieven()
    })
    li.append(kies, toon)
    lijst.appendChild(li)
  })
}


/** Overzicht van de ondergrond voor de gekozen bron: per soort een balk met km en procent. */
function tekenBalken() {
  const doos = el('balken')
  let h = `<p class="ondergrondkop"><b>${ondergrondTekst(aandelen(plan.analyse, bron))}</b> <small>volgens ${BRONNAAM[bron].toLowerCase()}</small></p><ul class="ondergrondlijst">`
  for (const r of plan.tabel) {
    const c = r[bron]
    if (c.km <= 0.005) continue
    h += `<li><span class="ondergrondnaam"><i class="${korrelKlasse(r.klasse)}" style="background-color:${KLEUR[r.klasse]}"></i>${r.klasse}<small>${TOELICHTING[r.klasse]}</small></span>` +
      `<span class="ondergrondbalk"><i class="${korrelKlasse(r.klasse)}" style="width:${Math.max(2, c.pct)}%;background-color:${KLEUR[r.klasse]}"></i></span>` +
      `<span class="ondergrondgetal"><b>${nl(c.km, 1)} km</b><small>${nl(c.pct, 0)}%</small></span></li>`
  }
  doos.innerHTML = h + '</ul>'
  el('legenda').innerHTML = ''
}

function tekenTabel() {
  const cel = (c) => `${nl(c.km)} km<small>${nl(c.pct, 1)}%</small>`
  let h = '<tr><th>Ondergrond</th><th>OpenStreet&shy;Map</th><th>Officiële kaart</th><th>Eind&shy;oordeel</th></tr>'
  for (const r of plan.tabel) {
    h +=
      `<tr><td><i class="${korrelKlasse(r.klasse)}" style="background-color:${KLEUR[r.klasse]}"></i>${r.klasse}<small>${TOELICHTING[r.klasse]}</small></td>` +
      `<td>${cel(r.osm)}</td><td>${cel(r.bgt)}</td><td>${cel(r.eind)}</td></tr>`
  }
  h +=
    `<tr class="som"><td>Onverhard + half verhard</td><td>${nl(100 * plan.zacht.osm, 1)}%</td>` +
    `<td>${nl(100 * plan.zacht.bgt, 1)}%</td><td>${nl(100 * plan.zacht.eind, 1)}%</td></tr>`
  el('tabel').innerHTML = h
  const a = plan.analyse
  const delen = []
  if (!a.bgtGebruikt) delen.push('zonder officiële kaart')
  const strand = K.strandMeter(a)
  if (strand > 50) delen.push(`${km(strand)} strand`)
  const kaartje = K.kaartjeMeter(a)
  if (kaartje > 50) delen.push(`${km(kaartje)} met toegangskaart`)
  if (plan.law > 0.005) delen.push(`${pct(plan.law)} LAW`)
  const ronden = uitslag.opties[gekozen] && uitslag.opties[gekozen].ronden
  if (ronden > 1) delen.push(`${ronden} rondjes`)
  else {
    const dub = keuze().dubbel ?? a.dubbel
    if (dub > 0.02) delen.push(`${pct(dub)} dubbel`)
  }
  const noot = delen.join(' · ')
  el('noot').textContent = noot
}

function zoomNaar(van, tot) {
  const pts = []
  for (const [lijn, s] of lijnen) if (s.tot > van && s.van < tot) pts.push(...lijn.getLatLngs())
  const opSheet = sheet && sheet.actief()
  if (opSheet) sheet.zet('piek') // eerst het paneel omlaag, dan past het stuk boven het paneel
  if (pts.length) kaart.fitBounds(L.latLngBounds(pts).pad(0.15))
  if (!opSheet && window.innerWidth <= 860) window.scrollTo({ top: 0, behavior: 'smooth' })
}

function tekenZachteStukken() {
  const t = el('zacht')
  t.innerHTML = '<tr><th>Waar</th><th>Lengte</th><th>Ondergrond</th></tr>'
  if (!plan.zachteStukken.length) {
    t.innerHTML = '<tr><td>Geen stukken onverhard of half gevonden.</td></tr>'
    return
  }
  for (const z of plan.zachteStukken) {
    const tr = document.createElement('tr')
    tr.className = 'klik'
    tr.innerHTML = `<td>km ${nl(z.van / 1000)}–${nl(z.tot / 1000)}</td><td>${km(z.tot - z.van)}</td><td>${z.klassen.join(' + ')}</td>`
    tr.addEventListener('click', () => zoomNaar(z.van, z.tot))
    t.appendChild(tr)
  }
}

/** Teken de luchtfoto van een twijfelstuk op een canvas en bepaal de kleurindicatie. */
function tekenLuchtfoto(canvas, s, regel) {
  const [mx, my] = K.puntOpLijn(s.xy, K.lijnLengte(s.xy) / 2)
  const h = FOTO_M / 2
  const bb = [mx - h, my - h, mx + h, my + h].map((v) => Math.round(v * 10) / 10)
  const schaal = FOTO_PX / FOTO_M
  const px = ([x, y]) => [(x - bb[0]) * schaal, (bb[3] - y) * schaal]
  const route = plan.analyse.xy
  const beeld = new Image()
  beeld.crossOrigin = 'anonymous' // nodig om de pixels te mogen lezen
  beeld.onload = () => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(beeld, 0, 0, FOTO_PX, FOTO_PX)
    const pad = (c, punten) => {
      c.beginPath()
      punten.map(px).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
    }
    // kleurmaat: strook van 2 m breed onder de lijn van dit stuk
    const masker = document.createElement('canvas')
    masker.width = masker.height = FOTO_PX
    const mctx = masker.getContext('2d', { willReadFrequently: true })
    mctx.strokeStyle = '#fff'
    mctx.lineWidth = 2 * schaal
    pad(mctx, s.xy)
    mctx.stroke()
    try {
      const foto = ctx.getImageData(0, 0, FOTO_PX, FOTO_PX).data
      const m = mctx.getImageData(0, 0, FOTO_PX, FOTO_PX).data
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let i = 0; i < m.length; i += 4) {
        if (m[i + 3] > 128) {
          r += foto[i]
          g += foto[i + 1]
          b += foto[i + 2]
          n += 1
        }
      }
      if (n >= 30) {
        const ind = K.kleurIndicatie(r / n, g / n, b / n)
        s.indicatie = ind.tekst
        if (ind.steun && s.twijfel === 'conflict') {
          s.indicatie += ` (past bij ${K.groep(s.osm) === ind.steun ? 'OpenStreetMap' : 'de officiële kaart'})`
        }
        regel.textContent = `Eindoordeel: ${s.eind} · luchtfoto (indicatie): ${s.indicatie}`
      }
    } catch {
      // pixels niet leesbaar: dan alleen de foto, zonder indicatie
    }
    // de route als twee randlijnen, zodat de ondergrond zichtbaar blijft
    const rand = (punten, kleur, dikte) => {
      const laag = document.createElement('canvas')
      laag.width = laag.height = FOTO_PX
      const c = laag.getContext('2d')
      c.lineJoin = 'round'
      c.strokeStyle = kleur
      c.lineWidth = 6 * schaal + 2 * dikte
      pad(c, punten)
      c.stroke()
      c.globalCompositeOperation = 'destination-out'
      c.lineWidth = 6 * schaal
      pad(c, punten)
      c.stroke()
      ctx.drawImage(laag, 0, 0)
    }
    rand(route, '#fff', 2)
    rand(s.xy, '#ff00c8', 4)
    // schaalbalk van 20 m
    ctx.fillStyle = '#fff'
    ctx.fillRect(14, FOTO_PX - 50, 20 * schaal + 12, 40)
    ctx.fillStyle = '#000'
    ctx.fillRect(20, FOTO_PX - 22, 20 * schaal, 4)
    ctx.font = '16px system-ui, sans-serif'
    ctx.fillText('20 m', 20, FOTO_PX - 28)
    canvas.dataset.klaar = '1'
  }
  beeld.onerror = () => {
    regel.textContent = `Eindoordeel: ${s.eind} · luchtfoto niet beschikbaar`
  }
  beeld.src = luchtfotoUrl(bb, FOTO_PX)
}

function tekenTwijfels() {
  const lijst = el('twijfels')
  lijst.innerHTML = ''
  el('twijfelkop').textContent = `Twijfelstukken (${plan.twijfels.length})`
  el('twijfelblok').hidden = true // op verzoek niet meer getoond
  const metFoto = new Set(staat.luchtfoto ? plan.twijfels.slice().sort((a, b) => b.tot - b.van - (a.tot - a.van)).slice(0, MAX_FOTOS) : [])
  for (const s of plan.twijfels) {
    const li = document.createElement('li')
    li.innerHTML =
      `<div class="nr">${s.nr}</div><div><div class="kop">km ${nl(s.van / 1000)}–${nl(s.tot / 1000)} · ` +
      `${Math.round(s.tot - s.van)} m</div><div>${veilig(s.twijfelTekst)}</div><div class="ind">Eindoordeel: ${s.eind}</div></div>`
    const regel = li.querySelector('.ind')
    if (metFoto.has(s)) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = FOTO_PX
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', `Luchtfoto van twijfelstuk ${s.nr}; tik om te vergroten`)
      canvas.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!canvas.dataset.klaar) return
        const dialoog = el('foto')
        dialoog.querySelector('img').src = canvas.toDataURL('image/jpeg', 0.85)
        dialoog.querySelector('p').textContent =
          `Twijfelstuk ${s.nr}: ${s.twijfelTekst}. Roze = dit stuk, wit = de rest van de route. ` +
          `Noorden boven, ${FOTO_M} × ${FOTO_M} m. Kleurindicatie (geen meting): ${s.indicatie || 'geen'}.`
        dialoog.showModal()
      })
      li.appendChild(canvas)
      tekenLuchtfoto(canvas, s, regel)
    } else {
      li.appendChild(document.createElement('span'))
    }
    li.addEventListener('click', () => {
      if (!twijfelLijn[s.nr]) return
      const opSheet = sheet && sheet.actief()
      if (opSheet) sheet.zet('piek')
      kaart.once('moveend', () => twijfelLijn[s.nr].openPopup(s.midden))
      kaart.fitBounds(twijfelLijn[s.nr].getBounds().pad(0.6), { maxZoom: 19, animate: false })
      if (!opSheet && window.innerWidth <= 860) window.scrollTo({ top: 0, behavior: 'smooth' })
    })
    lijst.appendChild(li)
  }
  el('twijfelnoot').textContent = plan.twijfels.length ? 'Bronnen oneens. Tik om te zoomen.' : 'Geen twijfelstukken.'
}

/** Kleurklasse bij een score, voor de tegel en de badge. */
const scoreKlasse = (s) => (s >= 90 ? 's-top' : s >= 75 ? 's-goed' : s >= 55 ? 's-mid' : 's-laag')

/** De ondergrond van de gekozen route als één strook korrels, met de grootste delen eronder. */
function strookHtml() {
  const rijen = plan.tabel.filter((r) => r.eind.pct >= 0.5)
  if (!rijen.length) return ''
  const delen = rijen.map((r) => `<i class="${korrelKlasse(r.klasse)}" style="width:${r.eind.pct}%;background-color:${KLEUR[r.klasse]}"></i>`).join('')
  const beschrijving = rijen.map((r) => `${r.klasse} ${nl(r.eind.pct, 0)}%`).join(', ')
  const leg = rijen
    .slice()
    .sort((x, y) => y.eind.pct - x.eind.pct)
    .slice(0, 4)
    .map((r) => `<span><i class="${korrelKlasse(r.klasse)}" style="background-color:${KLEUR[r.klasse]}"></i>${nl(r.eind.pct, 0)}% ${r.klasse === 'half verhard' ? 'half' : r.klasse}</span>`)
    .join('')
  return `<div class="strook" role="img" aria-label="Ondergrond: ${beschrijving}">${delen}</div><p class="strookleg">${leg}</p>`
}

function tekenKern() {
  el('kern').innerHTML =
    `<div class="score ${scoreKlasse(plan.score)}"><b>${plan.score}</b><span>Nopav.es-score · ${veilig(plan.label)}</span><small class="waarom">${waaromTekst(plan.analyse)}</small></div>` +
    strookHtml() +
    `<div><b>${nl(plan.analyse.lengte / 1000)} km</b><span>route ${plan.naam}</span></div>` +
    `<div class="ondergrondtegel"><b>${pct(aandelen(plan.analyse).onverhard)}</b><span>${ondergrondTekst(aandelen(plan.analyse)).replace(/^\d+% /, '')}</span></div>` +
    (keuze().hoogte
      ? `<div><b>↗ ${Math.round(keuze().hoogte.stijgen)} m</b><span>hoogte&shy;meters</span></div>`
      : `<div><b>${plan.twijfels.length}</b><span>twijfel&shy;stukken</span></div>`)
  werkPiekbalk()
}

/** De gekozen route zoals maakPlan hem gaf (met hoogte en rondjes). */
const keuze = () => uitslag.opties[gekozen] || {}

// ---------- Hoogteprofiel ----------
const profielLaag = L.layerGroup().addTo(kaart)
let profielMeting = null
let profielNaar = null // (meter langs de route, metStip) -> hoogte; het profiel wijst die plek aan

/** RD-punt op 'd' meter langs de route (voor de stip op de kaart). */
function puntOpAfstand(xy, opgeteld, d) {
  let lo = 0
  let hi = opgeteld.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (opgeteld[m] <= d) lo = m
    else hi = m
  }
  const l = opgeteld[hi] - opgeteld[lo] || 1
  const t = Math.max(0, Math.min(1, (d - opgeteld[lo]) / l))
  return [xy[lo][0] + t * (xy[hi][0] - xy[lo][0]), xy[lo][1] + t * (xy[hi][1] - xy[lo][1])]
}

function mooieStap(totaal, doel) {
  const ruw = totaal / doel
  const macht = 10 ** Math.floor(Math.log10(ruw))
  return [1, 2, 5, 10].map((f) => f * macht).find((s) => s >= ruw) || 10 * macht
}

function tekenProfiel() {
  const h = keuze().hoogte
  const blok = el('profiel')
  profielLaag.clearLayers()
  blok.hidden = false
  el('profielvlak').hidden = el('profielnoot').hidden = !h || h.afstand.length < 3
  if (!h || h.afstand.length < 3) {
    // geen hoogtes: wel de afspeelknop, geen grafiek
    el('profielkop').textContent = 'Route afspelen'
    profielNaar = null
    return
  }
  profielNaar = null
  el('profielkop').textContent = `Hoogteprofiel · ↗ ${Math.round(h.stijgen)} m · ↘ ${Math.round(h.dalen)} m`
  el('profielnoot').textContent = `${Math.round(h.min)}–${Math.round(h.max)} m · ${h.bron === 'AHN' ? 'AHN' : 'SRTM (grof)'}`
  const vlak = el('profielvlak')
  const W = Math.max(200, vlak.clientWidth)
  const Hh = vlak.clientHeight || 128
  const links = 36
  const onder = 18
  const boven = 6
  const totaal = h.afstand[h.afstand.length - 1]
  const lo = Math.min(...h.hoogte)
  const hi = Math.max(...h.hoogte)
  const span = Math.max(10, hi - lo)
  const yMin = Math.floor((lo - 0.08 * span) / 5) * 5
  const yMax = Math.ceil((lo + 1.08 * span) / 5) * 5
  const sx = (d) => links + ((W - links - 4) * d) / totaal
  const sy = (z) => boven + ((Hh - onder - boven) * (yMax - z)) / (yMax - yMin)
  const stap = Math.max(1, Math.ceil(h.afstand.length / (W - links)))
  let pad = ''
  for (let i = 0; i < h.afstand.length; i += stap) pad += `${pad ? 'L' : 'M'}${sx(h.afstand[i]).toFixed(1)},${sy(h.hoogte[i]).toFixed(1)}`
  pad += `L${sx(totaal).toFixed(1)},${sy(h.hoogte[h.hoogte.length - 1]).toFixed(1)}`
  const vlakPad = `${pad}L${sx(totaal).toFixed(1)},${sy(yMin).toFixed(1)}L${sx(0).toFixed(1)},${sy(yMin).toFixed(1)}Z`
  let assen = ''
  const yStap = mooieStap(yMax - yMin, 3)
  for (let z = Math.ceil(yMin / yStap) * yStap; z <= yMax; z += yStap) {
    assen += `<line class="raster" x1="${links}" x2="${W - 4}" y1="${sy(z)}" y2="${sy(z)}"/><text x="${links - 5}" y="${sy(z) + 3.5}" text-anchor="end">${z}</text>`
  }
  const kmStap = mooieStap(totaal / 1000, 5)
  for (let k = 0; k <= totaal / 1000 + 1e-9; k += kmStap) {
    assen += `<text x="${sx(k * 1000)}" y="${Hh - 4}" text-anchor="middle">${nl(k, kmStap < 1 ? 1 : 0)}</text>`
  }
  vlak.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Hoogteprofiel: ${Math.round(h.stijgen)} meter stijgen en ${Math.round(h.dalen)} meter dalen over ${nl(totaal / 1000, 1)} km, tussen ${Math.round(h.min)} en ${Math.round(h.max)} meter.">
    ${assen}<line class="as" x1="${links}" x2="${W - 4}" y1="${sy(yMin)}" y2="${sy(yMin)}"/>
    <path class="vlak" d="${vlakPad}"/><path class="lijn" d="${pad}"/>
    <g class="wijzer" visibility="hidden"><line class="draad" y1="${boven}" y2="${sy(yMin)}"/><circle class="stip" r="4.5"/></g>
  </svg><div class="profieltip" hidden></div>`
  // kruisdraad: de dichtstbijzijnde meting onder de vinger, met een stip op de kaart
  const xy = plan.analyse.xy
  const opgeteld = [0]
  for (let i = 1; i < xy.length; i++) opgeteld.push(opgeteld[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
  const schaalD = opgeteld[opgeteld.length - 1] / totaal
  const svg = vlak.querySelector('svg')
  const wijzer = svg.querySelector('.wijzer')
  const tip = vlak.querySelector('.profieltip')
  const stip = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 3, fillColor: getComputedStyle(document.documentElement).getPropertyValue('--hoogtelijn').trim() || '#a8661c', fillOpacity: 1, interactive: false })
  profielNaar = (d, metStip = true) => {
    let i = Math.round(d / (h.afstand[1] - h.afstand[0] || 10))
    i = Math.max(0, Math.min(h.afstand.length - 1, i))
    const px = sx(h.afstand[i])
    const py = sy(h.hoogte[i])
    wijzer.setAttribute('visibility', 'visible')
    wijzer.querySelector('line').setAttribute('x1', px)
    wijzer.querySelector('line').setAttribute('x2', px)
    wijzer.querySelector('circle').setAttribute('cx', px)
    wijzer.querySelector('circle').setAttribute('cy', py)
    tip.hidden = false
    tip.style.left = `${Math.max(14, Math.min(86, (px / W) * 100))}%`
    tip.textContent = `${nl(h.afstand[i] / 1000, 1)} km · ${Math.round(h.hoogte[i])} m`
    if (!metStip) return h.hoogte[i]
    const [lon, lat] = K.naarWgs(...puntOpAfstand(xy, opgeteld, h.afstand[i] * schaalD))
    stip.setLatLng([lat, lon])
    if (!profielLaag.hasLayer(stip)) stip.addTo(profielLaag)
    return h.hoogte[i]
  }
  profielMeting = (clientX) => {
    const r = svg.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * W
    profielNaar(Math.max(0, Math.min(totaal, ((x - links) / (W - links - 4)) * totaal)))
  }
  svg.addEventListener('pointermove', (e) => profielMeting(e.clientX))
  svg.addEventListener('pointerdown', (e) => profielMeting(e.clientX))
  svg.addEventListener('pointerleave', () => {
    wijzer.setAttribute('visibility', 'hidden')
    tip.hidden = true
    profielLaag.clearLayers()
  })
}
window.addEventListener('resize', () => {
  if (plan && !el('profiel').hidden) tekenProfiel()
})

/** Alles opnieuw tekenen in de huidige kleuren (na een themawissel), zonder de kaart te verschuiven. */
function herteken() {
  tekenAlternatieven()
  tekenRoute(false)
  kleurRoute()
  tekenBalken()
  tekenTabel()
}

function toonResultaat(nieuw) {
  stopAfspelen()
  if (nieuw && sheet && sheet.actief()) sheet.zet('piek') // de route meteen groot in beeld
  stap = 4
  for (const k of [1, 2, 3]) el(`stap${k}`).hidden = true
  el('resultaat').hidden = false
  werkStapperBij()
  tekenKern()
  el('meldingen').innerHTML = uitslag.meldingen.map((m) => `<p class="melding">${veilig(m)}</p>`).join('')
  tekenOpties()
  tekenWater()
  tekenStations()
  tekenOmwegen()
  toonTab(tab)
  haalTijdenErbij()
  tekenAlternatieven()
  tekenRoute(nieuw)
  tekenBalken()
  tekenTabel()
  tekenZachteStukken()
  tekenTwijfels()
  kleurRoute()
  if (nieuw && !(sheet && sheet.actief())) el(window.innerWidth <= 860 ? 'stapper' : 'resultaat').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

el('gpx').addEventListener('click', () => {
  if (!plan) return
  Gebruik.log('gpx', { soort: staat.modus, km: Math.round(plan.analyse.lengte / 100) / 10, score: plan.score })
  const nu = new Date()
  const stempel = nu.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  const station = keuze().station
  const naam = station ? `Nopav.es → ${station}` : `onverhard-${stempel}-route-${plan.naam}`
  const url = URL.createObjectURL(new Blob([K.maakGpx(plan.traject, naam, nu, `Nopav.es-score ${plan.score} (${plan.label}), ${ondergrondTekst(aandelen(plan.analyse))}`)], { type: 'application/gpx+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = naam.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') + '.gpx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
el('deel').addEventListener('click', async () => {
  const link = deelLink()
  try {
    await navigator.clipboard.writeText(link)
    el('deel').innerHTML = ico('link') + 'Gekopieerd'
  } catch {
    prompt('Kopieer deze link:', link)
  }
  setTimeout(() => {
    el('deel').innerHTML = ico('link') + 'Link'
  }, 2000)
})

// ---------- Ongedaan maken: herstellen ----------
function herstel(opname) {
  Object.assign(staat, JSON.parse(opname.json))
  stopTekenen()
  // de routes van toen weer tonen (of weghalen als er toen nog geen waren)
  uitslag = opname.uitslag
  gekozen = opname.gekozen
  opKaart.clear()
  for (const i of opname.opKaart) opKaart.add(i)
  if (uitslag) {
    plan = details(uitslag.opties[gekozen], MIN_TWIJFEL)
    toonResultaat(false)
  } else {
    plan = null
    for (const laag of [routeLaag, altLaag, profielLaag, waterLaag, stationLaag, omwegLaag]) laag.clearLayers()
    tekenKaartlagen(null)
    el('resultaat').hidden = true
    if (stap === 4) toonStap(2)
  }
  el('km').value = staat.km
  el('vorm').value = staat.vorm
  el('wegen').value = staat.wegen
  for (const b of el('modus').children) b.setAttribute('aria-pressed', String(b.dataset.modus === staat.modus))
  toonFout('')
  puntenGewijzigd()
  tekenTekening()
  zetTerugKnop()
}
function ongedaanMaken() {
  if (stopper || !terugStapel.length) return
  vooruitStapel.push(momentopname())
  herstel(terugStapel.pop())
}
function opnieuwDoen() {
  if (stopper || !vooruitStapel.length) return
  terugStapel.push(momentopname())
  herstel(vooruitStapel.pop())
}
el('terug').addEventListener('click', ongedaanMaken)

// ---------- Sneltoetsen ----------
// sneltoetsen 1-6 in de volgorde op het scherm (A naar B, Rondje, Naar station, In gebied, Elke straat, Tekenen)
const MODI = [...document.querySelectorAll('#modus [data-modus]')].map((b) => b.dataset.modus)
document.addEventListener('keydown', (e) => {
  if (el('foto').open || el('hulp').open) return
  const doel = e.target
  const typen = doel && (doel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(doel.tagName))
  const cmd = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  if (cmd && k === 'z' && !typen) {
    e.preventDefault()
    if (e.shiftKey) opnieuwDoen()
    else ongedaanMaken()
    return
  }
  if (cmd && k === 'y' && !typen) {
    e.preventDefault()
    opnieuwDoen()
    return
  }
  if (e.key === 'Escape') {
    if (tekenen) {
      stopTekenen()
      tekenPuntenlijst()
    } else if (stopper) stopper.abort()
    else if (omwegModus) wisselOmwegen()
    return
  }
  if (typen || cmd || e.altKey) return
  if (/^[1-9]$/.test(e.key) && MODI[Number(e.key) - 1] && !stopper) {
    zetModus(MODI[Number(e.key) - 1])
    toonStap(2)
  }
  else if (k === 'p' || e.key === 'Enter') {
    if (!el('plan').disabled && !stopper) planNu()
  } else if (k === 't' && tekenModus()) {
    if (stap !== 2) toonStap(2)
    startTekenen('vrij')
  } else if (k === 'r' && tekenModus() && staat.modus !== 'tekenen') {
    if (stap !== 2) toonStap(2)
    startTekenen('rechthoek')
  }
  else if (k === 'g' && plan) el('gpx').click()
  else if (e.key === ' ' && plan && !el('resultaat').hidden) wisselAfspelen()
  else if (k === 'l') el('locatie').click()
  else if (k === 'n') el('opnieuw').click()
  else if ((e.key === 'Backspace' || e.key === 'Delete') && staat.punten.length && !stopper) {
    e.preventDefault()
    onthoud()
    staat.punten.pop()
    puntenGewijzigd()
  } else if (e.key === '?') el('uitleg').click()
  else return
  e.preventDefault()
})

// ---------- Bewaarde routes (in de browser) ----------
const BEWAARD = 'onverhard.routes'
function bewaardeRoutes() {
  try {
    return JSON.parse(localStorage.getItem(BEWAARD) || '[]')
  } catch {
    return []
  }
}
function zetBewaardeRoutes(lijst) {
  try {
    localStorage.setItem(BEWAARD, JSON.stringify(lijst))
    return true
  } catch {
    toonFout('Bewaren lukte niet: de opslag van de browser is vol of uitgezet.')
    return false
  }
}
function tekenBewaard() {
  const lijst = bewaardeRoutes()
  el('mijnRoutes').hidden = !lijst.length
  const ul = el('bewaardlijst')
  ul.innerHTML = ''
  for (const r of lijst) {
    const li = document.createElement('li')
    li.innerHTML = `<span><b>${veilig(r.naam)}</b><small>${nl(r.km, 1)} km${typeof r.score === 'number' ? ` · score ${r.score}` : ''} · ${typeof r.onverhard === 'number' ? ondergrondTekst({ onverhard: r.onverhard, half: r.half || 0 }) : totaalTekst(r.zacht)}${r.stijgen ? ` · ↗ ${Math.round(r.stijgen)} m` : ''} · ${veilig(r.datum)}</small></span>`
    const open = document.createElement('button')
    open.type = 'button'
    open.textContent = 'Open'
    open.addEventListener('click', () => openBewaard(r))
    const weg = document.createElement('button')
    weg.type = 'button'
    weg.className = 'klein'
    weg.textContent = '✕'
    weg.setAttribute('aria-label', `Verwijder ${r.naam}`)
    weg.addEventListener('click', () => {
      if (!confirm(`"${r.naam}" verwijderen?`)) return
      zetBewaardeRoutes(bewaardeRoutes().filter((x) => x.id !== r.id))
      tekenBewaard()
    })
    li.append(open, weg)
    ul.appendChild(li)
  }
}
el('bewaar').addEventListener('click', () => {
  if (!plan) return
  const o = keuze()
  const soort = { route: 'Route', rondje: 'Rondje', station: 'Naar station', gebied: 'Rondjes in gebied', straten: 'Elke straat', tekenen: 'Getekende route' }[staat.modus] || 'Route'
  const datum = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  const naam = prompt('Naam van de route', o.ingelezen ? o.ingelezen.replace(/^(★|GPX ·) /, '') : `${soort} ${nl(o.km, 0)} km · ${datum}`)
  if (!naam) return
  const r = {
    id: Date.now().toString(36),
    naam: naam.slice(0, 80),
    datum,
    km: o.km,
    zacht: o.zacht,
    ...(o.analyse ? aandelen(o.analyse) : {}),
    score: o.score,
    stijgen: o.stijgen || null,
    traject: { coords: o.traject.coords.map((c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]), segs: o.traject.segs, punten: o.traject.punten || [] },
    staat: JSON.parse(momentopname().json),
  }
  const lijst = [r, ...bewaardeRoutes()].slice(0, 50)
  if (zetBewaardeRoutes(lijst)) {
    Gebruik.log('bewaar', { soort: staat.modus })
    el('bewaar').innerHTML = ico('bewaar') + 'Bewaard'
    setTimeout(() => {
      el('bewaar').innerHTML = ico('bewaar') + 'Bewaar'
    }, 2000)
    tekenBewaard()
  }
})
async function openBewaard(r) {
  if (stopper) return
  onthoud()
  Object.assign(staat, r.staat || {})
  startBron = 'bewaard'
  puntenGewijzigd()
  tekenTekening()
  for (const b of el('modus').children) b.setAttribute('aria-pressed', String(b.dataset.modus === staat.modus))
  toonStap(3)
  stopper = new AbortController()
  el('plan').hidden = true
  el('bezig').hidden = false
  zetVoortgang(null)
  try {
    const resultaat = await bekijkRoute({ coords: r.traject.coords.map((c) => [c[0], c[1], null]), segs: r.traject.segs, punten: r.traject.punten || [] }, `★ ${r.naam}`, {
      signal: stopper.signal,
      metBgt: staat.grondig > 0,
      meld: (t) => {
        el('status').textContent = t + '…'
      },
    })
    uitslag = resultaat
    gekozen = 0
    opKaart.clear()
    opKaart.add(0)
    plan = details(uitslag.opties[0], MIN_TWIJFEL)
    stopBezig()
    toonResultaat(true)
  } catch (fout) {
    toonFout(fout.name === 'AbortError' ? 'Gestopt.' : `Openen lukte niet: ${fout.melding || fout.message}`)
  } finally {
    stopBezig()
  }
}

// ---------- GPX inlezen ----------
async function leesGpxBestand(bestand) {
  if (!bestand || stopper) return
  toonFout('')
  stopper = new AbortController()
  el('plan').hidden = true
  el('bezig').hidden = false
  zetVoortgang(null)
  let stap = ''
  try {
    const tekst = await bestand.text()
    const resultaat = await importeerGpx(tekst, {
      signal: stopper.signal,
      metBgt: staat.grondig > 0,
      meld: (t) => {
        stap = t
        el('status').textContent = t + '…'
        zetVoortgang(null)
      },
      voortgang: (klaar, totaal) => {
        el('status').textContent = `${stap}: ${klaar} van ${totaal}`
        zetVoortgang(klaar / totaal)
      },
    })
    onthoud()
    uitslag = resultaat
    gekozen = 0
    opKaart.clear()
    opKaart.add(0)
    plan = details(uitslag.opties[0], MIN_TWIJFEL)
    stopBezig()
    toonResultaat(true)
  } catch (fout) {
    if (fout.name === 'AbortError') toonFout('Gestopt.')
    else toonFout(`GPX: ${fout.melding || fout.message}`)
  } finally {
    stopBezig()
  }
}
el('gpxOpen').addEventListener('click', () => el('gpxBestand').click())
el('gpxBestand').addEventListener('change', () => {
  leesGpxBestand(el('gpxBestand').files[0])
  el('gpxBestand').value = ''
})
// een GPX-bestand op de kaart (of de pagina) slepen
for (const plek of [document.body]) {
  plek.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault()
  })
  plek.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    e.preventDefault()
    leesGpxBestand(f)
  })
}

// ---------- Rechtermuisknop / lang drukken op de kaart ----------
/** Het pictogram vóór een regel in het kaartmenu: het eerste teken van de tekst. */
const MENUICO = { '↪': 'route', '🌿': 'omweg', '📍': 'start', '🏁': 'eind', '➕': 'plus', '🚉': 'station', '⟳': 'rondje', '🔍': 'zoek', '📋': 'kopie' }
function sluitMenu() {
  el('kaartmenu').hidden = true
}
kaart.on('contextmenu', (e) => {
  if (tekenen || stopper) return
  L.DomEvent.preventDefault(e.originalEvent)
  const p = [e.latlng.lat, e.latlng.lng]
  const opties = []
  const zet = (fn) => () => {
    sluitMenu()
    if (!inNederland(p)) return toonFout('Dat punt ligt buiten Nederland.')
    fn()
  }
  if (uitslag && uitslag.graaf && keuze().knopen && stap === 4) {
    opties.push(['↪ Route via hier', zet(() => versleepNaar(dichtsteIndex(e.latlng), p))])
    if (kanOmwegen()) opties.push([omwegModus ? '🌿 Groene omwegen uit' : '🌿 Groene omwegen', () => {
      sluitMenu()
      wisselOmwegen()
    }])
    opties.push(null)
  }
  if (staat.modus === 'route') {
    opties.push(['📍 Start hier', zet(() => {
      onthoud()
      const oud = staat.punten[0]
      staat.punten = staat.punten.length ? [p, ...staat.punten.slice(1)] : [p]
      merkStart('menu', oud)
      puntenGewijzigd()
      if (stap < 2 || stap === 4) toonStap(2)
    })])
    opties.push(['🏁 Eindpunt hier', zet(() => {
      onthoud()
      staat.punten = staat.punten.length > 1 ? [...staat.punten.slice(0, -1), p] : [...staat.punten, p]
      puntenGewijzigd()
      if (stap < 2 || stap === 4) toonStap(2)
    })])
    if (staat.punten.length >= 2) {
      opties.push(['➕ Tussenpunt hier', zet(() => {
        onthoud()
        staat.punten.splice(staat.punten.length - 1, 0, p)
        puntenGewijzigd()
      })])
    }
  }
  opties.push(['🚉 Naar station vanaf hier', zet(() => {
    onthoud()
    const oud = staat.punten[0]
    zetModus('station')
    staat.punten = [p]
    merkStart('menu', oud)
    puntenGewijzigd()
    toonStap(3)
  })])
  opties.push(['⟳ Rondje vanaf hier', zet(() => {
    onthoud()
    const oud = staat.punten[0]
    zetModus('rondje')
    staat.punten = [p]
    merkStart('menu', oud)
    puntenGewijzigd()
    toonStap(3)
  })])
  if (TEKENMODI.has(staat.modus) && staat.modus !== 'tekenen') {
    opties.push(['📍 Start van het rondje hier', zet(() => {
      onthoud()
      const oud = staat.punten[0]
      staat.punten = [p]
      merkStart('menu', oud)
      puntenGewijzigd()
    })])
  }
  opties.push(null)
  opties.push(['🔍 Zoom in hier', () => {
    sluitMenu()
    kaart.setView(e.latlng, Math.min(18, kaart.getZoom() + 2))
  }])
  opties.push(['📋 Kopieer coördinaten', async () => {
    sluitMenu()
    const tekst = `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`
    try {
      await navigator.clipboard.writeText(tekst)
    } catch {
      prompt('Coördinaten:', tekst)
    }
  }])
  const menu = el('kaartmenu')
  menu.innerHTML = ''
  for (const o of opties) {
    if (!o) {
      if (menu.lastChild && menu.lastChild.tagName !== 'HR') menu.appendChild(document.createElement('hr'))
      continue
    }
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.setAttribute('role', 'menuitem')
    const [, symbool, tekst] = o[0].match(/^(\S+)\s+(.*)$/) || []
    if (MENUICO[symbool]) {
      knop.innerHTML = ico(MENUICO[symbool])
      knop.append(document.createTextNode(tekst))
    } else knop.textContent = o[0]
    knop.addEventListener('click', o[1])
    menu.appendChild(knop)
  }
  menu.hidden = false
  const x = e.originalEvent.clientX
  const y = e.originalEvent.clientY
  menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`
  menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`
  netGetekend = Date.now() // de tik die het menu sluit is geen nieuw punt
  menu.querySelector('button')?.focus()
})
document.addEventListener('pointerdown', (e) => {
  if (!el('kaartmenu').hidden && !el('kaartmenu').contains(e.target)) sluitMenu()
})
kaart.on('movestart zoomstart', sluitMenu)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') sluitMenu()
})

// uitleg met voorbeelden
const VOORBEELDEN = {
  station: 'p=52.0116,4.3571&station=15',
  route: 'p=52.13081,4.35323;52.10350,4.30180',
  rondje: 'p=52.13081,4.35323&rondje=12',
  gebied: 'modus=gebied&t=52.03342,4.33407;52.03751,4.34372;52.03553,4.34544;52.03183,4.34393;52.03104,4.33986;52.02946,4.33814;52.03183,4.33385&p=52.03262,4.33428&rondje=8',
  straten: 'modus=straten&t=52.0168,4.3527;52.0150,4.3640;52.0060,4.3678;52.0010,4.3600;52.0030,4.3500;52.0110,4.3470&wegen=straten',
  tekenen: 'modus=tekenen&t=52.03289,4.33514;52.03421,4.33814;52.03553,4.34115;52.03632,4.34286;52.03421,4.34372;52.03236,4.34115',
}
el('uitleg').addEventListener('click', () => {
  tekenGebruik()
  el('hulp').showModal()
})

// ---------- Mijn gebruik (de lokale teller) ----------
const TELNAMEN = { route: 'A naar B', rondje: 'Rondje', station: 'Naar station', gebied: 'In gebied', straten: 'Elke straat', tekenen: 'Tekenen' }
function tekenGebruik() {
  const s = Gebruik.samenvatting()
  const lijst = (titel, t, naam = (k) => k) => {
    const delen = Object.entries(t).sort((x, y) => y[1] - x[1])
    if (!delen.length) return ''
    return `<p><b>${titel}:</b> ${delen.map(([k, v]) => `${veilig(naam(k))} ${v}×`).join(' · ')}</p>`
  }
  const datum = (t) => new Date(t).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  el('gebruik').innerHTML = s.regels
    ? `<p>${s.regels} regels, van ${datum(s.van)} tot ${datum(s.tot)}. Gepland: ${s.planGelukt} gelukt, ${s.planMislukt} niet${s.planDuurMediaanMs ? `, meestal ${nl(s.planDuurMediaanMs / 1000, 0)} s wachten` : ''}.</p>` +
      lijst('Soort', s.perSoort, (k) => TELNAMEN[k] || k) +
      lijst('Start', s.perStart) +
      lijst('Afstand', s.perAfstand) +
      lijst('Voorkeur gewijzigd', s.voorkeuren) +
      lijst('Geopend', s.onderdelen) +
      lijst('Paneel', s.sheet) +
      lijst('Weergave', s.weergave) +
      lijst('Locatie', s.locatie)
    : '<p>Nog niets geteld.</p>'
  el('gebruikJson').hidden = true
}
el('gebruikKopieer').addEventListener('click', async () => {
  const tekst = JSON.stringify(Gebruik.lees(), null, 1)
  try {
    await navigator.clipboard.writeText(tekst)
    el('gebruikKopieer').textContent = 'Gekopieerd'
  } catch {
    // geen klembord: zet het in een vak om zelf te kopiëren
    el('gebruikJson').value = tekst
    el('gebruikJson').hidden = false
    el('gebruikJson').select()
    el('gebruikKopieer').textContent = 'Kopieer hieronder'
  }
  setTimeout(() => {
    el('gebruikKopieer').textContent = 'Kopieer als JSON'
  }, 2500)
})
let wisBevestig = 0
el('gebruikWis').addEventListener('click', () => {
  // twee keer tikken in plaats van een bevestigingsvenster
  if (Date.now() - wisBevestig > 3000) {
    wisBevestig = Date.now()
    el('gebruikWis').textContent = 'Zeker? Tik nog eens'
    setTimeout(() => {
      if (wisBevestig) el('gebruikWis').textContent = 'Wis'
    }, 3000)
    return
  }
  wisBevestig = 0
  Gebruik.wis()
  el('gebruikWis').textContent = 'Wis'
  tekenGebruik()
})
el('hulpDicht').addEventListener('click', () => el('hulp').close())
el('hulp').addEventListener('click', (e) => {
  if (e.target === el('hulp')) el('hulp').close() // tik naast het venster
  const v = e.target.dataset && e.target.dataset.voorbeeld
  if (!v) return
  el('hulp').close()
  onthoud()
  location.hash = `${VOORBEELDEN[v]}&plan=1` // de app laadt de link opnieuw en plant meteen
})

// ---------- Start ----------
const hash = laad()
if (hash.get('p')) startBron = 'link'
else if (staat.punten.length) startBron = 'vorige keer'
Gebruik.openInfo().then((info) => Gebruik.log('app_open', info))
zetThema(themaKeuze())
el('km').value = staat.km
el('law').value = String(staat.law)
if (el('law').value !== String(staat.law)) {
  // een LAW-factor uit een link die niet in de lijst staat
  el('law').add(new Option(`Factor ${staat.law}`, String(staat.law)))
  el('law').value = String(staat.law)
}
el('grondig').value = String(staat.grondig)
if (el('grondig').value !== String(staat.grondig)) el('grondig').value = '2'
el('trail').value = staat.alles ? 'a' : staat.trail ? '1' : '0'
zetOndergrondKnoppen()
el('strand').checked = staat.strand
el('kaartje').checked = !!staat.kaartje
el('heuvels').checked = !!staat.heuvels
el('luchtfoto').checked = !!staat.luchtfoto
vatSamen()
el('vorm').value = staat.vorm === 'kronkel' ? 'kronkel' : 'lus'
el('wegen').value = staat.wegen
el('dood').checked = staat.dood !== false
for (const b of el('modus').children) b.setAttribute('aria-pressed', String(b.dataset.modus === staat.modus))
puntenGewijzigd()
tekenTekening()
zetTerugKnop()
tekenBewaard()
if (tekenModus() && tekening()) kaart.fitBounds(L.latLngBounds(tekening()).pad(0.2))
toonStap(staat.punten.length || tekening() ? (plaatsKlaar ? 3 : 2) : 1, false)
if (staat.punten.length > 1) kaart.fitBounds(L.latLngBounds(staat.punten).pad(0.2))
else if (staat.punten.length === 1) kaart.setView(staat.punten[0], 13)
// een gedeelde link opent terwijl de app al open staat: opnieuw beginnen met die punten
window.addEventListener('hashchange', () => {
  const h = new URLSearchParams(location.hash.slice(1))
  if (h.get('p') || h.get('t')) location.reload()
})
// #...&plan=1 start meteen (handig voor een gedeelde link en voor de test)
if (hash.get('plan') && !el('plan').disabled) planNu()
sheet = maakSheet({ kaart, main: document.getElementById('paneel'), greep: el('sheetgreep'), bijWijziging: werkPiekbalk, bijGebruiker: (stand) => Gebruik.log('sheet_state', { stand }) })
werkPiekbalk()

// voor de end-to-end-test
window.onverhard = { krijgPlan: () => plan && { ...plan, opties: uitslag.opties, vlakken: uitslag.vlakken, kies: kiesRoute }, kaart, sheet, uitslag: () => uitslag }

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
