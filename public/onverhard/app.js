// Onverhard: de interface. Plain JS zonder build-stap, net als Parkenjacht.
// De rekenkern staat in kern.js, de bronnen en de planner in bronnen.js.

import * as K from './kern.js'
import { haalOpeningstijden, importeerGpx, pasRouteAan, maakPlan, luchtfotoUrl, details, zoekPlaats } from './bronnen.js'

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

// ---------- Toestand ----------
const staat = { modus: 'route', punten: [], km: 10, law: 1, grondig: 2, trail: true, strand: true, kaartje: false, vorm: 'lus', luchtfoto: false, vlak: null, lijn: null, wegen: 'straten', dood: true, heuvels: false }
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
    staat.modus = hash.get('rondje') ? 'rondje' : 'route'
    if (hash.get('rondje')) staat.km = Number(hash.get('rondje')) || staat.km
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
const lagen = {
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
lagen.OpenStreetMap.addTo(kaart)
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
      staat.punten[i] = [lat, lng]
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
  const n = staat.punten.length
  const tm = tekenModus()
  // stap 2: kop per soort, en pas verder als de plek bekend is
  el('stap2kop').textContent = { route: 'Start en eind', rondje: 'Startpunt', gebied: 'Teken het gebied', straten: 'Teken de wijk', tekenen: 'Teken je route' }[staat.modus]
  plaatsKlaar = tm ? !!tekening() : rondje ? n >= 1 : n >= 2
  el('naar3').disabled = !plaatsKlaar
  werkStapperBij()
  el('tekenpaneel').hidden = !tm
  el('wegenveld').hidden = staat.modus !== 'straten'
  el('doodveld').hidden = staat.modus !== 'straten'
  el('tekenVierkant').hidden = staat.modus === 'tekenen'
  el('tekenWis').hidden = !tekening()
  const getekend = tekening()
  el('tekenstatus').hidden = !getekend
  el('tekenVrij').textContent = getekend ? '✎ Opnieuw tekenen' : '✎ Teken'
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
    else if (n === 1) hint = 'Kies de lengte, of tik een keerpunt.'
    else hint = ''
  } else if (n === 0) hint = 'Zoek of tik het startpunt.'
  else if (n === 1) hint = 'Zoek of tik het eindpunt.'
  else hint = ''
  el('hint').textContent = hint
  el('keerom').hidden = rondje || n < 2
  el('wis').hidden = n === 0
  el('kmveld').hidden = !rondje || n > 1
  el('vormveld').hidden = !rondje || n > 1
  el('plan').disabled = rondje ? n < 1 : n < 2
  if (!rondje) el('plan').textContent = 'Plan route'
  else el('plan').textContent = n > 1 ? 'Plan rondje via keerpunt' : 'Plan rondje'
}

function puntenGewijzigd() {
  if (staat.modus === 'rondje' && staat.punten.length > 2) staat.punten = [staat.punten[0], staat.punten[staat.punten.length - 1]]
  if (tekenModus() && staat.punten.length > 1) staat.punten = staat.punten.slice(-1)
  if (staat.modus === 'tekenen') staat.punten = []
  bewaar()
  tekenPunten()
  tekenPuntenlijst()
}

function toonFout(tekst) {
  el('fout').textContent = tekst
  el('fout').hidden = !tekst
}

function voegPuntToe(p) {
  if (stopper || tekenen || Date.now() - netGetekend < 400) return // tijdens het plannen of tekenen geen punten zetten
  if (staat.modus === 'tekenen' || stap === 4) return
  if (stap === 1) toonStap(2)
  if (!inNederland(p)) {
    toonFout('Dat punt ligt buiten Nederland. De officiële kaart en de luchtfoto dekken alleen Nederland.')
    return
  }
  toonFout('')
  onthoud()
  if (staat.modus === 'rondje') staat.punten = staat.punten.length ? [staat.punten[0], p] : [p]
  else if (tekenModus()) staat.punten = [p]
  else staat.punten.push(p)
  puntenGewijzigd()
}

kaart.on('click', (e) => voegPuntToe([e.latlng.lat, e.latlng.lng]))

// ---------- Tekenen op de kaart (gebied, elke straat, route langs een lijn) ----------
const tekenLaag = L.layerGroup().addTo(kaart)
let tekenen = null // 'vrij' of 'rechthoek' terwijl je tekent
let netGetekend = 0 // de tik waarmee je stopt met tekenen is geen startpunt
let schets = null // { punten, lijn } tijdens het tekenen

function tekenTekening(vers = false) {
  tekenLaag.clearLayers()
  const t = tekening()
  if (!t || !t.length) return
  const stijl = { color: '#ffcb05', weight: 4, opacity: 1, dashArray: '8 6', interactive: false, className: vers ? 'tekening-vers' : '' }
  if (staat.modus === 'tekenen') {
    L.polyline(t, { ...stijl, color: '#1f3328', weight: 7, dashArray: null, opacity: 0.35 }).addTo(tekenLaag)
    L.polyline(t, stijl).addTo(tekenLaag)
  } else {
    L.polygon(t, { ...stijl, color: '#1f3328', weight: 7, dashArray: null, opacity: 0.35, fill: false }).addTo(tekenLaag)
    L.polygon(t, { ...stijl, fillColor: '#ffcb05', fillOpacity: 0.08 }).addTo(tekenLaag)
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
  tekenPuntenlijst()
}

function stopTekenen() {
  tekenen = null
  schets = null
  for (const h of [kaart.dragging, kaart.touchZoom, kaart.doubleClickZoom, kaart.boxZoom]) h.enable()
  kaart.getContainer().classList.remove('tekent')
  el('tekenVrij').setAttribute('aria-pressed', 'false')
  el('tekenVierkant').setAttribute('aria-pressed', 'false')
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
  schets = { punten: [[p.lat, p.lng]], lijn: L.polyline([[p.lat, p.lng]], { color: '#ffcb05', weight: 4, dashArray: '8 6', interactive: false }).addTo(tekenLaag) }
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
el('dood').addEventListener('change', () => {
  staat.dood = el('dood').checked
  bewaar()
})
el('wegen').addEventListener('change', () => {
  onthoud()
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
  voegPuntToe(t.punt)
}
async function zoek(tekst) {
  if (zoekStopper) zoekStopper.abort()
  zoekStopper = new AbortController()
  const lijst = el('zoekresultaten')
  try {
    zoekTreffers = (await zoekPlaats(tekst, zoekStopper.signal)).filter((t) => inNederland(t.punt))
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

function werkStapperBij() {
  const stapper = el('stapper')
  if (!stapper) return
  for (const b of stapper.children) {
    const n = Number(b.dataset.stap)
    b.classList.toggle('nu', n === stap)
    b.classList.toggle('klaar', n !== stap && (n === 1 || (n === 2 && plaatsKlaar) || (n === 3 && !!uitslag) || (n === 4 && !!uitslag && stap < 4)))
    b.disabled = (n === 3 && !plaatsKlaar) || (n === 4 && !uitslag)
  }
}

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
  if (window.innerWidth <= 860) el('stapper').scrollIntoView({ behavior: 'smooth', block: 'start' })
  else document.querySelector('main').scrollTo({ top: 0, behavior: 'smooth' })
}

function toonTab(t) {
  tab = t
  for (const b of el('tabs').children) b.setAttribute('aria-pressed', String(b.dataset.tab === t))
  for (const k of ['hoogte', 'water', 'ondergrond']) el(`tab-${k}`).hidden = k !== t
  if (t === 'hoogte' && plan) tekenProfiel() // de breedte is pas bekend als het tabblad zichtbaar is
  if (t === 'water') el('geenWater').hidden = !!(keuze().water && keuze().water.punten.length)
}

el('stapper').addEventListener('click', (e) => {
  const knop = e.target.closest('[data-stap]')
  if (knop && !knop.disabled && !stopper) toonStap(Number(knop.dataset.stap))
})
for (const knop of document.querySelectorAll('.terugknop')) knop.addEventListener('click', () => !stopper && toonStap(Number(knop.dataset.naar)))
el('naar3').addEventListener('click', () => toonStap(3))
el('tabs').addEventListener('click', (e) => {
  const knop = e.target.closest('[data-tab]')
  if (knop) toonTab(knop.dataset.tab)
})
el('km').addEventListener('change', () => {
  onthoud()
  staat.km = Math.max(2, Math.min(60, Number(el('km').value) || 10))
  el('km').value = staat.km
  bewaar()
})
el('law').addEventListener('change', () => {
  staat.law = Number(el('law').value)
  bewaar()
})
el('grondig').addEventListener('change', () => {
  staat.grondig = Number(el('grondig').value)
  bewaar()
})
el('trail').addEventListener('change', () => {
  staat.trail = el('trail').value === '1'
  staat.alles = el('trail').value === 'a'
  bewaar()
})
el('strand').addEventListener('change', () => {
  staat.strand = el('strand').checked
  bewaar()
})
el('heuvels').addEventListener('change', () => {
  staat.heuvels = el('heuvels').checked
  bewaar()
})
el('kaartje').addEventListener('change', () => {
  staat.kaartje = el('kaartje').checked
  bewaar()
})
el('luchtfoto').addEventListener('change', () => {
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
  for (const laag of [routeLaag, altLaag, profielLaag, tekenLaag, waterLaag]) laag.clearLayers()
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
      if (!staat.punten.length) voegPuntToe(p)
    },
    () => toonFout('Je locatie is niet beschikbaar. Geef de browser toestemming, of zoek of tik zelf een plek.'),
    { enableHighAccuracy: true, timeout: 10000 },
  )
})

// ---------- Plannen ----------
function stopBezig() {
  stopper = null
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
  stopper = new AbortController()
  el('plan').hidden = true
  el('bezig').hidden = false
  el('voortgang').style.width = '0'
  const status = (tekst) => {
    el('status').textContent = tekst
  }
  let stap = ''
  try {
    const rondje = staat.modus === 'rondje'
    const resultaat = await maakPlan({
      modus: tekenModus() ? staat.modus : undefined,
      tekening: tekenModus() ? tekening() : undefined,
      wegen: staat.wegen,
      zonderDoodlopend: staat.dood !== false,
      heuvels: !!staat.heuvels,
      punten: rondje ? staat.punten.slice(0, 2) : staat.punten,
      rondjeKm: rondje || staat.modus === 'gebied' ? staat.km : null,
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
        el('voortgang').style.width = '0'
      },
      voortgang: (klaar, totaal) => {
        status(`${stap}: ${klaar} van ${totaal} kaarttegels`)
        el('voortgang').style.width = `${(100 * klaar) / totaal}%`
      },
    })
    onthoud() // zo brengt 'ongedaan maken' de vorige route terug
    uitslag = resultaat
    gekozen = 0
    opKaart.clear()
    uitslag.opties.forEach((_, i) => opKaart.add(i)) // eerst alle routes tonen, om te vergelijken
    plan = details(uitslag.opties[0], MIN_TWIJFEL)
    stopBezig() // eerst de voortgangsbalk weg, dan pas naar het resultaat scrollen (anders schuift het weg)
    toonResultaat(true)
  } catch (fout) {
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
    const tip = `Route ${o.naam}: ${nl(o.km)} km, ${pct(o.zacht)} onverhard. Tik om te kiezen.`
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
        knop.textContent = '✂ Haal dit stukje weg'
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
    slepen.elastiek = L.polyline([slepen.van, ll], { color: '#1f3328', weight: 3, dashArray: '6 6', interactive: false }).addTo(routeLaag)
    slepen.stip = L.circleMarker(ll, { radius: 9, color: '#1f3328', weight: 3, fillColor: '#ffcb05', fillOpacity: 1, interactive: false }).addTo(routeLaag)
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
  el('afspeel').textContent = '▶ Afspelen'
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
    el('afspeel').textContent = '↺ Nog eens'
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
    el('afspeel').textContent = '▶ Verder'
    return
  }
  if (!afspelen) {
    const xy = plan.analyse.xy
    const opgeteld = [0]
    for (let i = 1; i < xy.length; i++) opgeteld.push(opgeteld[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
    const h = keuze().hoogte
    const totaal = opgeteld[opgeteld.length - 1]
    const loper = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="loper">🏃</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false, zIndexOffset: 2000 })
    afspelen = { d: 0, totaal, xy, opgeteld, loper, schaal: h ? h.afstand[h.afstand.length - 1] / totaal : 1 }
    loper.addTo(afspeelLaag)
  }
  if (afspelen.klaar) afspelen.klaar = false
  afspelen.laatst = 0
  el('afspeel').textContent = '❚❚ Pauze'
  afspelen.raf = requestAnimationFrame(afspeelStap)
}
el('afspeel').addEventListener('click', wisselAfspelen)
el('tempo').addEventListener('click', (e) => {
  const t = Number(e.target.dataset.tempo)
  if (!t) return
  tempo = t
  for (const b of el('tempo').children) b.setAttribute('aria-pressed', String(Number(b.dataset.tempo) === t))
})

// ---------- Water onderweg ----------
const waterLaag = L.layerGroup().addTo(kaart)
const WATER = { water: ['💧', 'Drinkwater'], horeca: ['☕', 'Horeca'], winkel: ['🛒', 'Winkel'], toilet: ['🚻', 'Toilet'], tank: ['⛽', 'Tankstation'] }
let waterAlles = false
const waterAan = new Set(['water', 'winkel']) // standaard alleen drinkwater en winkels; de rest met een tik erbij
let waterOpKaart = true
let tijdenGehaald = null // de water-uitslag waarvoor de openingstijden al gehaald zijn

/** Korte tekst over open/dicht, of '' als er geen (bruikbare) tijden zijn. */
function openTekst(p) {
  if (!p.open) return ''
  const o = K.isOpen(p.open)
  if (!o) return `<small>${veilig(p.open.slice(0, 40))}</small>`
  if (o.open) return `<small class="open">nu open${o.tot ? ` · tot ${o.tot}` : ''}</small>`
  return `<small class="dicht">nu dicht${o.vanaf ? ` · open om ${o.vanaf}` : ''}</small>`
}

function tekenWater() {
  waterLaag.clearLayers()
  const w = keuze().water
  const blok = el('water')
  if (!w) {
    blok.hidden = true
    return
  }
  blok.hidden = false
  const aantalWater = w.punten.filter((p) => p.soort === 'water').length
  el('waterkop').textContent = `Water onderweg · ${aantalWater} tap${aantalWater === 1 ? '' : 'punten'} · langste stuk zonder ${nl(w.langsteZonder / 1000, 1)} km`
  const kanVia = !!(uitslag.graaf && keuze().knopen) || staat.modus === 'route'
  // filterknoppen per soort, met aantallen
  const filter = el('waterfilter')
  filter.innerHTML = ''
  for (const [soort, [ico, naam]] of Object.entries(WATER)) {
    const n = w.punten.filter((p) => p.soort === soort).length
    if (!n) continue
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.className = 'klein'
    knop.setAttribute('aria-pressed', String(waterAan.has(soort)))
    knop.textContent = `${ico} ${naam} ${n}`
    knop.addEventListener('click', () => {
      if (waterAan.has(soort)) waterAan.delete(soort)
      else waterAan.add(soort)
      tekenWater()
    })
    filter.appendChild(knop)
  }
  const kaartKnop = document.createElement('button')
  kaartKnop.type = 'button'
  kaartKnop.className = 'klein'
  kaartKnop.setAttribute('aria-pressed', String(waterOpKaart))
  kaartKnop.textContent = waterOpKaart ? '📍 Op kaart' : '📍 Niet op kaart'
  kaartKnop.addEventListener('click', () => {
    waterOpKaart = !waterOpKaart
    tekenWater()
  })
  filter.prepend(kaartKnop)
  const gefilterd = w.punten.filter((p) => waterAan.has(p.soort))
  const lijst = el('waterlijst')
  lijst.innerHTML = ''
  const tonen = waterAlles ? gefilterd : gefilterd.slice(0, 10)
  for (const p of tonen) {
    const [ico, soort] = WATER[p.soort]
    const li = document.createElement('li')
    li.innerHTML = `<span class="ico">${ico}</span><span class="km">km ${nl(p.km, 1)}</span><span>${veilig(p.naam || soort)}<small>${Math.round(p.afstand)} m van de route</small>${openTekst(p)}</span>`
    if (kanVia) {
      const knop = document.createElement('button')
      knop.type = 'button'
      knop.textContent = 'Via hier'
      knop.addEventListener('click', () => versleepNaar(p.index, [p.lat, p.lon]))
      li.appendChild(knop)
    }
    li.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') kaart.setView([p.lat, p.lon], Math.max(kaart.getZoom(), 16))
    })
    lijst.appendChild(li)
  }
  el('waterMeer').hidden = waterAlles || gefilterd.length <= 10
  for (const p of waterOpKaart ? gefilterd : []) {
    const [ico, soort] = WATER[p.soort]
    const m = L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: '', html: `<div class="waterico ${p.soort}">${ico}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      keyboard: false, zIndexOffset: 500,
    }).addTo(waterLaag)
    const inhoud = document.createElement('div')
    inhoud.innerHTML = `<b>${veilig(p.naam || soort)}</b><br>${soort} · km ${nl(p.km, 1)} · ${Math.round(p.afstand)} m van de route${p.open ? `<br>${veilig(p.open)}` : ''}<br>`
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
  if (!w || tijdenGehaald === w || !w.punten.some((p) => p.soort !== 'water')) return
  tijdenGehaald = w
  try {
    if (await haalOpeningstijden(w.punten)) tekenWater()
  } catch {
    // geen tijden: dan niet
  }
}

el('waterMeer').addEventListener('click', () => {
  waterAlles = true
  tekenWater()
})

function kleurRoute() {
  for (const [lijn, s] of lijnen) lijn.setStyle({ color: KLEUR[s[bron]] })
  for (const b of el('bron').children) b.setAttribute('aria-pressed', String(b.dataset.bron === bron))
}
el('bron').addEventListener('click', (e) => {
  if (e.target.dataset.bron) {
    bron = e.target.dataset.bron
    kleurRoute()
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
    let regel = `${nl(o.km)} km · ${pct(o.zacht)} onverhard · ${pct(o.paadjes)} smalle paadjes`
    if (o.law > 0.05) regel += ` · ${pct(o.law)} LAW`
    if (o.stijgen !== null && o.stijgen !== undefined) regel += ` · ↗ ${Math.round(o.stijgen)} m`
    if (o.ronden > 1) regel += ` · ${o.ronden} rondjes`
    else if ((rondje || staat.modus === 'straten') && o.dubbel > 0.02) regel += ` · ${pct(o.dubbel)} dubbel gelopen`
    if (o.strand > 100) regel += ` · ${km(o.strand)} strand`
    if (o.kaartje > 50) regel += ` · ${km(o.kaartje)} met toegangskaart`
    const titel = o.ingelezen ? `GPX · ${veilig(o.ingelezen)}` : `Route ${o.naam}${i === 0 ? '</b> · aanbevolen<b>' : ''}`
    kies.innerHTML = `<span class="letter">${o.naam}</span><span><b>${titel}</b><small>${regel}</small></span>`
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

const tip = el('tip')
function verplaatsTip(e) {
  const b = tip.offsetWidth
  tip.style.left = Math.max(6, Math.min(window.innerWidth - b - 6, e.clientX - b / 2)) + 'px'
  tip.style.top = e.clientY - 34 + 'px'
}

function tekenBalken() {
  const doos = el('balken')
  doos.innerHTML = ''
  for (const b of ['eind', 'bgt', 'osm']) {
    const rij = document.createElement('div')
    rij.className = 'balkrij'
    rij.innerHTML = `<span>${BRONNAAM[b]}</span>`
    const balk = document.createElement('div')
    balk.className = 'balk'
    balk.setAttribute('role', 'img')
    balk.setAttribute('aria-label', `${BRONNAAM[b]}: ` + plan.tabel.map((r) => `${r.klasse} ${nl(r[b].pct, 1)}%`).join(', '))
    for (const r of plan.tabel) {
      if (r[b].km <= 0) continue
      const deel = document.createElement('i')
      deel.style.flex = `${r[b].pct} 0 0`
      deel.style.background = KLEUR[r.klasse]
      const tekst = `${BRONNAAM[b]} · ${r.klasse}: ${nl(r[b].km)} km (${nl(r[b].pct, 1)}%)`
      deel.addEventListener('pointerenter', (e) => {
        tip.textContent = tekst
        tip.style.display = 'block'
        verplaatsTip(e)
      })
      deel.addEventListener('pointermove', verplaatsTip)
      deel.addEventListener('pointerleave', () => {
        tip.style.display = 'none'
      })
      balk.appendChild(deel)
    }
    rij.appendChild(balk)
    doos.appendChild(rij)
  }
  el('legenda').innerHTML = K.KLASSEN.map((k) => `<li><i style="background:${KLEUR[k]}"></i>${k}</li>`).join('')
}

function tekenTabel() {
  const cel = (c) => `${nl(c.km)} km<small>${nl(c.pct, 1)}%</small>`
  let h = '<tr><th>Ondergrond</th><th>OpenStreet&shy;Map</th><th>Officiële kaart</th><th>Eind&shy;oordeel</th></tr>'
  for (const r of plan.tabel) {
    h +=
      `<tr><td><i style="background:${KLEUR[r.klasse]}"></i>${r.klasse}<small>${TOELICHTING[r.klasse]}</small></td>` +
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
  if (pts.length) kaart.fitBounds(L.latLngBounds(pts).pad(0.15))
  if (window.innerWidth <= 860) window.scrollTo({ top: 0, behavior: 'smooth' })
}

function tekenZachteStukken() {
  const t = el('zacht')
  t.innerHTML = '<tr><th>Waar</th><th>Lengte</th><th>Ondergrond</th></tr>'
  if (!plan.zachteStukken.length) {
    t.innerHTML = '<tr><td>Geen onverharde stukken gevonden.</td></tr>'
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
      kaart.once('moveend', () => twijfelLijn[s.nr].openPopup(s.midden))
      kaart.fitBounds(twijfelLijn[s.nr].getBounds().pad(0.6), { maxZoom: 19, animate: false })
      if (window.innerWidth <= 860) window.scrollTo({ top: 0, behavior: 'smooth' })
    })
    lijst.appendChild(li)
  }
  el('twijfelnoot').textContent = plan.twijfels.length ? 'Bronnen oneens. Tik om te zoomen.' : 'Geen twijfelstukken.'
}

function tekenKern() {
  el('kern').innerHTML =
    `<div><b>${nl(plan.analyse.lengte / 1000)} km</b><span>route ${plan.naam}</span></div>` +
    `<div><b>${pct(plan.zacht.eind)}</b><span>onverhard + half verhard</span></div>` +
    `<div><b>${pct(K.paadjesAandeel(plan.analyse))}</b><span>smalle paadjes</span></div>` +
    (keuze().hoogte
      ? `<div><b>↗ ${Math.round(keuze().hoogte.stijgen)} m</b><span>hoogte&shy;meters</span></div>`
      : `<div><b>${plan.twijfels.length}</b><span>twijfel&shy;stukken</span></div>`)
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
  if (!h || h.afstand.length < 3) {
    blok.hidden = true
    return
  }
  blok.hidden = false
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
  stap = 4
  for (const k of [1, 2, 3]) el(`stap${k}`).hidden = true
  el('resultaat').hidden = false
  werkStapperBij()
  tekenKern()
  el('meldingen').innerHTML = uitslag.meldingen.map((m) => `<p class="melding">${veilig(m)}</p>`).join('')
  tekenOpties()
  tekenWater()
  toonTab(tab)
  haalTijdenErbij()
  tekenAlternatieven()
  tekenRoute(nieuw)
  tekenBalken()
  tekenTabel()
  tekenZachteStukken()
  tekenTwijfels()
  kleurRoute()
  if (nieuw) el(window.innerWidth <= 860 ? 'stapper' : 'resultaat').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

el('gpx').addEventListener('click', () => {
  if (!plan) return
  const nu = new Date()
  const stempel = nu.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  const naam = `onverhard-${stempel}-route-${plan.naam}`
  const url = URL.createObjectURL(new Blob([K.maakGpx(plan.traject, naam, nu)], { type: 'application/gpx+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = naam + '.gpx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
el('deel').addEventListener('click', async () => {
  const link = deelLink()
  try {
    await navigator.clipboard.writeText(link)
    el('deel').textContent = 'Link gekopieerd'
  } catch {
    prompt('Kopieer deze link:', link)
  }
  setTimeout(() => {
    el('deel').textContent = 'Kopieer link'
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
    for (const laag of [routeLaag, altLaag, profielLaag, waterLaag]) laag.clearLayers()
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
const MODI = ['route', 'rondje', 'gebied', 'straten', 'tekenen']
document.addEventListener('keydown', (e) => {
  if (el('intro').open || el('foto').open || el('hulp').open) return
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
    return
  }
  if (typen || cmd || e.altKey) return
  if (/^[1-5]$/.test(e.key) && !stopper) {
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
  } else if (e.key === '?') openIntro()
  else return
  e.preventDefault()
})

// ---------- GPX inlezen ----------
async function leesGpxBestand(bestand) {
  if (!bestand || stopper) return
  toonFout('')
  stopper = new AbortController()
  el('plan').hidden = true
  el('bezig').hidden = false
  let stap = ''
  try {
    const tekst = await bestand.text()
    const resultaat = await importeerGpx(tekst, {
      signal: stopper.signal,
      metBgt: staat.grondig > 0,
      meld: (t) => {
        stap = t
        el('status').textContent = t + '…'
        el('voortgang').style.width = '0'
      },
      voortgang: (klaar, totaal) => {
        el('status').textContent = `${stap}: ${klaar} van ${totaal}`
        el('voortgang').style.width = `${(100 * klaar) / totaal}%`
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

// ---------- Kennismaking ----------
const INTRO = 'onverhard.intro'
let introDia = 0
function toonDia(i) {
  introDia = i
  const dias = [...document.querySelectorAll('.intro-dia')]
  dias.forEach((d, k) => {
    d.hidden = k !== i
    // animaties opnieuw starten: de svg even vervangen door een kopie
    if (k === i) {
      const svg = d.querySelector('svg')
      svg.replaceWith(svg.cloneNode(true))
    }
  })
  document.querySelectorAll('.intro-stippen i').forEach((s, k) => s.classList.toggle('aan', k === i))
  el('introVerder').textContent = i === dias.length - 1 ? 'Aan de slag' : 'Verder'
  const teller = document.querySelector(`.intro-dia[data-dia="${i}"] .teller`)
  if (teller) telOp(teller)
}
function telOp(tekst) {
  if (!tekst) return
  const start = performance.now() + 1000
  const stap = (nu) => {
    const t = Math.max(0, Math.min(1, (nu - start) / 1600))
    tekst.textContent = `${Math.round(13 * (1 - (1 - t) ** 3))} km`
    if (t < 1 && el('intro').open) requestAnimationFrame(stap)
  }
  requestAnimationFrame(stap)
}
function sluitIntro() {
  el('intro').close()
  try {
    localStorage.setItem(INTRO, '1')
  } catch {
    // zonder opslag zie je hem de volgende keer weer
  }
}
function openIntro() {
  if (!el('intro').open) el('intro').showModal()
  toonDia(0)
}
el('introVerder').addEventListener('click', () => {
  if (introDia >= document.querySelectorAll('.intro-dia').length - 1) sluitIntro()
  else toonDia(introDia + 1)
})
el('introSla').addEventListener('click', sluitIntro)
el('intro').addEventListener('cancel', (e) => {
  e.preventDefault()
  sluitIntro()
})
el('intro').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' && introDia < 4) toonDia(introDia + 1)
  if (e.key === 'ArrowLeft' && introDia > 0) toonDia(introDia - 1)
})
// vegen op de telefoon
let veegX = null
el('intro').addEventListener('pointerdown', (e) => {
  veegX = e.clientX
})
el('intro').addEventListener('pointerup', (e) => {
  if (veegX === null) return
  const dx = e.clientX - veegX
  veegX = null
  if (dx < -40 && introDia < 4) toonDia(introDia + 1)
  else if (dx > 40 && introDia > 0) toonDia(introDia - 1)
})
// uitleg met voorbeelden
const VOORBEELDEN = {
  route: 'p=52.13081,4.35323;52.10350,4.30180',
  rondje: 'p=52.13081,4.35323&rondje=12',
  gebied: 'modus=gebied&t=52.03342,4.33407;52.03751,4.34372;52.03553,4.34544;52.03183,4.34393;52.03104,4.33986;52.02946,4.33814;52.03183,4.33385&p=52.03262,4.33428&rondje=8',
  straten: 'modus=straten&t=52.0168,4.3527;52.0150,4.3640;52.0060,4.3678;52.0010,4.3600;52.0030,4.3500;52.0110,4.3470&wegen=straten',
  tekenen: 'modus=tekenen&t=52.03289,4.33514;52.03421,4.33814;52.03553,4.34115;52.03632,4.34286;52.03421,4.34372;52.03236,4.34115',
}
el('uitleg').addEventListener('click', () => el('hulp').showModal())
el('hulpDicht').addEventListener('click', () => el('hulp').close())
el('hulp').addEventListener('click', (e) => {
  if (e.target === el('hulp')) el('hulp').close() // tik naast het venster
  const v = e.target.dataset && e.target.dataset.voorbeeld
  if (!v) return
  el('hulp').close()
  onthoud()
  location.hash = `${VOORBEELDEN[v]}&plan=1` // de app laadt de link opnieuw en plant meteen
})
el('hulpIntro').addEventListener('click', () => {
  el('hulp').close()
  openIntro()
})

// ---------- Start ----------
const hash = laad()
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
if (tekenModus() && tekening()) kaart.fitBounds(L.latLngBounds(tekening()).pad(0.2))
toonStap(staat.punten.length || tekening() ? (plaatsKlaar ? 3 : 2) : 1, false)
if (staat.punten.length > 1) kaart.fitBounds(L.latLngBounds(staat.punten).pad(0.2))
else if (staat.punten.length === 1) kaart.setView(staat.punten[0], 13)
// een gedeelde link opent terwijl de app al open staat: opnieuw beginnen met die punten
window.addEventListener('hashchange', () => {
  const h = new URLSearchParams(location.hash.slice(1))
  if (h.get('p') || h.get('t')) location.reload()
})
// de eerste keer (zonder gedeelde link): even kennismaken
let introGezien = true
try {
  introGezien = localStorage.getItem(INTRO) === '1'
} catch {
  // geen opslag: niet elke keer lastigvallen
}
if (!introGezien && !hash.get('p') && !hash.get('t')) openIntro()
// #...&plan=1 start meteen (handig voor een gedeelde link en voor de test)
if (hash.get('plan') && !el('plan').disabled) planNu()
// voor de end-to-end-test
window.onverhard = { krijgPlan: () => plan && { ...plan, opties: uitslag.opties, vlakken: uitslag.vlakken, kies: kiesRoute } }

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
