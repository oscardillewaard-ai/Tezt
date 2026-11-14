// Onverhard: de interface. Plain JS zonder build-stap, net als Parkenjacht.
// De rekenkern staat in kern.js, de bronnen en de planner in bronnen.js.

import * as K from './kern.js'
import { maakPlan, luchtfotoUrl, details, zoekPlaats } from './bronnen.js'

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
const staat = { modus: 'route', punten: [], km: 10, law: 1, grondig: 2, trail: true, strand: true, kaartje: false, vorm: 'lus', luchtfoto: false, vlak: null, lijn: null, wegen: 'straten' }
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
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng()
      staat.punten[i] = [lat, lng]
      puntenGewijzigd()
    })
    const knop = document.createElement('button')
    knop.type = 'button'
    knop.textContent = 'Verwijder dit punt'
    knop.addEventListener('click', () => {
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
      staat.punten.splice(i, 1)
      puntenGewijzigd()
    })
    li.appendChild(knop)
    lijst.appendChild(li)
  })
  const rondje = staat.modus === 'rondje'
  const n = staat.punten.length
  const tm = tekenModus()
  el('tekenpaneel').hidden = !tm
  el('wegenveld').hidden = staat.modus !== 'straten'
  el('tekenVierkant').hidden = staat.modus === 'tekenen'
  el('tekenWis').hidden = !tekening()
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
  if (staat.modus === 'tekenen') return
  if (!inNederland(p)) {
    toonFout('Dat punt ligt buiten Nederland. De officiële kaart en de luchtfoto dekken alleen Nederland.')
    return
  }
  toonFout('')
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

function tekenTekening() {
  tekenLaag.clearLayers()
  const t = tekening()
  if (!t || !t.length) return
  const stijl = { color: '#ffcb05', weight: 4, opacity: 1, dashArray: '8 6', interactive: false }
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
  if (punten.length >= nodig && (staat.modus === 'tekenen' || kaart.distance(punten[0], punten[2] || punten[1]) > 30)) {
    if (staat.modus === 'tekenen') staat.lijn = punten
    else staat.vlak = punten
    toonFout('')
  } else toonFout('Die tekening was te klein. Teken nog eens, wat groter.')
  bewaar()
  tekenTekening()
  tekenPuntenlijst()
}
kaartVlak.addEventListener('pointerup', eindeSchets, { capture: true })
kaartVlak.addEventListener('pointercancel', eindeSchets, { capture: true })
el('tekenVrij').addEventListener('click', () => startTekenen('vrij'))
el('tekenVierkant').addEventListener('click', () => startTekenen('rechthoek'))
el('tekenWis').addEventListener('click', () => {
  stopTekenen()
  if (staat.modus === 'tekenen') staat.lijn = null
  else staat.vlak = null
  bewaar()
  tekenTekening()
  tekenPuntenlijst()
})
el('wegen').addEventListener('change', () => {
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
  if (modus !== 'route' && staat.modus !== modus) staat.punten = staat.punten.slice(0, 1) // alleen de start blijft
  stopTekenen()
  staat.modus = modus
  tekenTekening()
  for (const b of el('modus').children) b.setAttribute('aria-pressed', String(b.dataset.modus === modus))
  puntenGewijzigd()
}
el('modus').addEventListener('click', (e) => {
  if (e.target.dataset.modus && !stopper) zetModus(e.target.dataset.modus)
})
el('km').addEventListener('change', () => {
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
  bewaar()
})
el('strand').addEventListener('change', () => {
  staat.strand = el('strand').checked
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
  const delen = [staat.trail ? 'trail' : 'alles onverhard']
  if (staat.strand) delen.push('strand overslaan')
  if (staat.kaartje) delen.push('toegangskaart')
  if (staat.law !== 1) delen.push(staat.law <= 0.3 ? 'sterke LAW-voorkeur' : 'lichte LAW-voorkeur')
  delen.push(staat.grondig === 0 ? '1 route, zonder officiële kaart' : `${Math.max(1, staat.grondig)} ${staat.grondig === 1 ? 'route' : 'routes'}`)
  if (staat.luchtfoto) delen.push("luchtfoto's")
  el('instSamenvatting').textContent = '· ' + delen.join(' · ')
}
el('instellingen').addEventListener('change', vatSamen)
el('twijfelblok').addEventListener('toggle', () => {
  if (plan) tekenRoute(false)
})
el('vorm').addEventListener('change', () => {
  staat.vorm = el('vorm').value
  bewaar()
})
el('keerom').addEventListener('click', () => {
  staat.punten.reverse()
  puntenGewijzigd()
})
el('wis').addEventListener('click', () => {
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
      punten: rondje ? staat.punten.slice(0, 2) : staat.punten,
      rondjeKm: rondje || staat.modus === 'gebied' ? staat.km : null,
      law: staat.law,
      trail: staat.trail,
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
    lijn.bindPopup(() => popup(s), { maxWidth: 300 })
    lijn.bindTooltip(() => `km ${nl(s.van / 1000)}–${nl(s.tot / 1000)} · ${s[bron]}${s.twijfel ? ' · twijfel' : ''}`, { sticky: true })
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
  if (passend) {
    const grens = L.latLngBounds(alles)
    for (const i of opKaart) grens.extend(L.latLngBounds(naarLatLon(uitslag.opties[i].analyse.xy)))
    kaart.fitBounds(grens.pad(0.06))
  }
}

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
    kies.innerHTML = `<span class="letter">${o.naam}</span><span><b>Route ${o.naam}</b>${i === 0 ? ' · aanbevolen' : ''}<small>${regel}</small></span>`
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
  else if (a.dubbel > 0.02) delen.push(`${pct(a.dubbel)} dubbel`)
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
  el('twijfelblok').hidden = !plan.twijfels.length && !plan.twijfelKort.aantal
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
  profielMeting = (clientX) => {
    const r = svg.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * W
    const d = Math.max(0, Math.min(totaal, ((x - links) / (W - links - 4)) * totaal))
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
    const [lon, lat] = K.naarWgs(...puntOpAfstand(xy, opgeteld, h.afstand[i] * schaalD))
    stip.setLatLng([lat, lon])
    if (!profielLaag.hasLayer(stip)) stip.addTo(profielLaag)
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
  el('resultaat').hidden = false
  tekenKern()
  el('meldingen').innerHTML = uitslag.meldingen.map((m) => `<p class="melding">${veilig(m)}</p>`).join('')
  tekenOpties()
  tekenProfiel()
  tekenAlternatieven()
  tekenRoute(nieuw)
  tekenBalken()
  tekenTabel()
  tekenZachteStukken()
  tekenTwijfels()
  kleurRoute()
  if (nieuw) el('resultaat').scrollIntoView({ behavior: 'smooth', block: 'start' })
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
el('trail').value = staat.trail ? '1' : '0'
el('strand').checked = staat.strand
el('kaartje').checked = !!staat.kaartje
el('luchtfoto').checked = !!staat.luchtfoto
vatSamen()
el('vorm').value = staat.vorm === 'kronkel' ? 'kronkel' : 'lus'
el('wegen').value = staat.wegen
for (const b of el('modus').children) b.setAttribute('aria-pressed', String(b.dataset.modus === staat.modus))
puntenGewijzigd()
tekenTekening()
if (tekenModus() && tekening()) kaart.fitBounds(L.latLngBounds(tekening()).pad(0.2))
if (staat.punten.length > 1) kaart.fitBounds(L.latLngBounds(staat.punten).pad(0.2))
else if (staat.punten.length === 1) kaart.setView(staat.punten[0], 13)
// een gedeelde link opent terwijl de app al open staat: opnieuw beginnen met die punten
window.addEventListener('hashchange', () => {
  const h = new URLSearchParams(location.hash.slice(1))
  if (h.get('p') || h.get('t')) location.reload()
})
// #...&plan=1 start meteen (handig voor een gedeelde link en voor de test)
if (hash.get('plan') && !el('plan').disabled) planNu()
// voor de end-to-end-test
window.onverhard = { krijgPlan: () => plan && { ...plan, opties: uitslag.opties, vlakken: uitslag.vlakken, kies: kiesRoute } }

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
