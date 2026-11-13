// Onverhard: de interface. Plain JS zonder build-stap, net als Parkenjacht.
// De rekenkern staat in kern.js, de bronnen en de planner in bronnen.js.

import * as K from './kern.js'
import { maakPlan, luchtfotoUrl } from './bronnen.js'

/* global L */
const SLEUTEL = 'onverhard.v1'
const MIN_TWIJFEL = 30 // twijfelstukken korter dan dit (m) worden niet apart genoemd
const MAX_FOTOS = 12
const FOTO_M = 120 // zijde van een luchtfoto-uitsnede in meters
const FOTO_PX = 800
const NEDERLAND = { zuid: 50.5, noord: 53.8, west: 3.0, oost: 7.4 }

const el = (id) => document.getElementById(id)
const nl = (x, d = 2) => Number(x).toFixed(d).replace('.', ',')
const km = (m) => nl(m / 1000) + ' km'
const veilig = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const stijl = getComputedStyle(document.documentElement)
const KLEUR = {
  [K.ONVERHARD]: stijl.getPropertyValue('--onverhard').trim(),
  [K.HALF]: stijl.getPropertyValue('--half').trim(),
  [K.OPEN]: stijl.getPropertyValue('--open').trim(),
  [K.GESLOTEN]: stijl.getPropertyValue('--gesloten').trim(),
  [K.ONBEKEND]: stijl.getPropertyValue('--onbekend').trim(),
}
const TOELICHTING = {
  [K.ONVERHARD]: 'gras, zand, aarde, bospad',
  [K.HALF]: 'schelpen, grind',
  [K.OPEN]: 'klinkers, tegels',
  [K.GESLOTEN]: 'asfalt, beton',
  [K.ONBEKEND]: 'geen gegevens',
}
const BRONNAAM = { eind: 'Eindoordeel', bgt: 'BGT', osm: 'OSM' }

// ---------- Toestand ----------
const staat = { modus: 'route', punten: [], km: 10, law: 1, grondig: 2 }
let plan = null // het laatste resultaat van maakPlan
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
  }
  if (!Array.isArray(staat.punten)) staat.punten = []
  // de link uit de adresbalk halen: anders wint hij bij herladen van je nieuwe punten
  if (hash.get('p')) history.replaceState(null, '', location.pathname + location.search)
  return hash
}

function deelLink() {
  const p = staat.punten.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(';')
  let hash = `#p=${p}`
  if (staat.modus === 'rondje') hash += `&rondje=${staat.km}`
  if (staat.law !== 1) hash += `&law=${staat.law}`
  return location.origin + location.pathname + hash
}

// ---------- Kaart ----------
const kaart = L.map('kaart', { maxZoom: 21 }).setView([52.1, 5.3], 8)
const lagen = {
  OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: '© OpenStreetMap-bijdragers',
  }),
  'Luchtfoto (PDOK)': L.tileLayer(
    'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    { maxZoom: 21, maxNativeZoom: 21, attribution: 'Luchtfoto: PDOK / Het Waterschapshuis' },
  ),
}
// De BGT-kaart van PDOK bestaat pas vanaf zoomniveau 17: daarom een aan/uit-laag.
const bgtLaag = L.tileLayer(
  'https://service.pdok.nl/lv/bgt/wmts/v1_0/standaardvisualisatie/EPSG:3857/{z}/{x}/{y}.png',
  { minZoom: 17, maxZoom: 21, maxNativeZoom: 20, opacity: 0.8, attribution: 'BGT: Kadaster / PDOK' },
)
lagen.OpenStreetMap.addTo(kaart)
L.control.layers(lagen, { 'BGT-vlakken (vanaf zoom 17)': bgtLaag }).addTo(kaart)
L.control.scale({ imperial: false }).addTo(kaart)
const puntLaag = L.layerGroup().addTo(kaart)
const routeLaag = L.layerGroup().addTo(kaart)
const icoon = (tekst, klasse = '') =>
  L.divIcon({ className: '', html: `<div class="punt ${klasse}">${tekst}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })

function inNederland([lat, lon]) {
  return lat >= NEDERLAND.zuid && lat <= NEDERLAND.noord && lon >= NEDERLAND.west && lon <= NEDERLAND.oost
}

function puntNaam(i) {
  if (staat.modus === 'rondje') return 'Start en finish'
  if (i === 0) return 'Start'
  return i === staat.punten.length - 1 ? 'Eind' : `Tussenpunt ${i}`
}

function tekenPunten() {
  puntLaag.clearLayers()
  staat.punten.forEach((p, i) => {
    const laatste = i === staat.punten.length - 1
    const tekst = i === 0 ? 'S' : laatste ? 'F' : String(i)
    const marker = L.marker(p, { icon: icoon(tekst, i === 0 || laatste ? '' : 'via'), draggable: true, title: puntNaam(i) })
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
    const laatste = i === staat.punten.length - 1
    li.innerHTML =
      `<div class="punt ${i === 0 || laatste ? '' : 'via'}">${i === 0 ? 'S' : laatste ? 'F' : i}</div>` +
      `<div>${puntNaam(i)}<small>${p[0].toFixed(5)}, ${p[1].toFixed(5)}</small></div>`
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
  el('hint').textContent = rondje
    ? n
      ? 'Tik op de kaart om het startpunt te verplaatsen.'
      : 'Tik op de kaart om het startpunt te kiezen.'
    : n === 0
      ? 'Tik op de kaart om het startpunt te zetten.'
      : n === 1
        ? 'Tik nog een keer voor het eindpunt.'
        : 'Elke volgende tik wordt het nieuwe eindpunt; de punten ertussen zijn tussenpunten. Zo dwing je een mooi pad af.'
  el('keerom').hidden = rondje || n < 2
  el('wis').hidden = n === 0
  el('plan').disabled = rondje ? n < 1 : n < 2
  el('plan').textContent = rondje ? 'Plan rondje' : 'Plan route'
}

function puntenGewijzigd() {
  if (staat.modus === 'rondje' && staat.punten.length > 1) staat.punten = [staat.punten[0]]
  bewaar()
  tekenPunten()
  tekenPuntenlijst()
}

function toonFout(tekst) {
  el('fout').textContent = tekst
  el('fout').hidden = !tekst
}

kaart.on('click', (e) => {
  if (stopper) return // tijdens het plannen geen punten verzetten
  const p = [e.latlng.lat, e.latlng.lng]
  if (!inNederland(p)) {
    toonFout('Dat punt ligt buiten Nederland. De BGT en de luchtfoto dekken alleen Nederland.')
    return
  }
  toonFout('')
  if (staat.modus === 'rondje') staat.punten = [p]
  else staat.punten.push(p)
  puntenGewijzigd()
})

// ---------- Invoer ----------
function zetModus(modus) {
  staat.modus = modus
  for (const b of el('modus').children) b.setAttribute('aria-pressed', String(b.dataset.modus === modus))
  el('kmveld').hidden = modus !== 'rondje'
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
        toonFout('Je staat buiten Nederland. De BGT en de luchtfoto dekken alleen Nederland.')
        return
      }
      if (!staat.punten.length) {
        staat.punten = [p]
        puntenGewijzigd()
      }
    },
    () => toonFout('Je locatie is niet beschikbaar. Geef de browser toestemming of tik zelf op de kaart.'),
    { enableHighAccuracy: true, timeout: 10000 },
  )
})

// ---------- Plannen ----------
async function planNu() {
  if (stopper) return
  toonFout('')
  if (!staat.punten.every(inNederland)) {
    toonFout('Een van de punten ligt buiten Nederland. De BGT en de luchtfoto dekken alleen Nederland.')
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
      punten: rondje ? [staat.punten[0]] : staat.punten,
      rondjeKm: rondje ? staat.km : null,
      law: staat.law,
      alternatieven: Math.max(1, staat.grondig),
      bgtKandidaten: staat.grondig >= 4 ? 3 : staat.grondig >= 2 ? 2 : 1,
      metBgt: staat.grondig > 0,
      minTwijfel: MIN_TWIJFEL,
      signal: stopper.signal,
      meld: (tekst) => {
        stap = tekst
        status(tekst + '…')
        el('voortgang').style.width = '0'
      },
      voortgang: (klaar, totaal) => {
        status(`${stap}: ${klaar} van ${totaal} BGT-tegels`)
        el('voortgang').style.width = `${(100 * klaar) / totaal}%`
      },
    })
    plan = resultaat
    toonResultaat()
  } catch (fout) {
    if (fout.name === 'AbortError') toonFout('Gestopt. Er is geen route gemaakt.')
    else if (fout.bron) toonFout(`Het lukte niet bij ${fout.bron}: ${fout.melding}. Er is geen route gemaakt.`)
    else {
      toonFout(`Er ging iets mis: ${fout.message}`)
      console.error(fout)
    }
  } finally {
    stopper = null
    el('plan').hidden = false
    el('bezig').hidden = true
  }
}
el('plan').addEventListener('click', planNu)
el('stop').addEventListener('click', () => stopper && stopper.abort())

// ---------- Resultaat ----------
const naarLatLon = (xy) => xy.map(([x, y]) => {
  const [lon, lat] = K.naarWgs(x, y)
  return [lat, lon]
})
let lijnen = [] // [[polyline, stuk], ...]
let twijfelLijn = {}

function popup(s) {
  let h =
    `<b>km ${nl(s.van / 1000)}–${nl(s.tot / 1000)}</b> · ${Math.round(s.tot - s.van)} m<br>` +
    `Eindoordeel: <b>${s.eind}</b><br>OSM: ${s.osm}${s.osmZeker ? '' : ' (aanname)'}<br>` +
    `<code>${veilig(s.tags.slice(0, 4).join(' | '))}</code><br>BGT: ${s.bgt}<br><code>${veilig(s.bgtUitleg)}</code>`
  if (s.twijfel) h += `<br><b style="color:var(--twijfel)">Twijfel${s.nr ? ' #' + s.nr : ''}:</b> ${veilig(s.twijfelTekst)}`
  if (s.indicatie) h += `<br>Kleurindicatie luchtfoto: ${veilig(s.indicatie)}`
  return h
}

function tekenRoute() {
  routeLaag.clearLayers()
  lijnen = []
  twijfelLijn = {}
  const alles = naarLatLon(plan.analyse.xy)
  L.polyline(alles, { color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(routeLaag)
  for (const s of plan.analyse.samengevoegd) {
    const pad = naarLatLon(s.xy)
    const lijn = L.polyline(pad, { color: KLEUR[s[bron]], weight: 5, opacity: 1, lineCap: 'butt' }).addTo(routeLaag)
    lijn.bindPopup(() => popup(s), { maxWidth: 300 })
    lijn.bindTooltip(() => `km ${nl(s.van / 1000)}–${nl(s.tot / 1000)} · ${s[bron]}${s.twijfel ? ' · twijfel' : ''}`, { sticky: true })
    lijnen.push([lijn, s])
    if (s.twijfel) {
      // dunne stippellijn eroverheen, zodat twijfel niet alleen aan kleur hangt
      L.polyline(pad, { color: '#111', weight: 1.5, dashArray: '3 6', interactive: false }).addTo(routeLaag)
    }
    if (s.nr) {
      twijfelLijn[s.nr] = lijn
      const [mx, my] = K.puntOpLijn(s.xy, K.lijnLengte(s.xy) / 2)
      const [lon, lat] = K.naarWgs(mx, my)
      s.midden = [lat, lon]
      L.marker(s.midden, { icon: icoon(s.nr, 'tw'), keyboard: false })
        .on('click', () => lijn.openPopup(s.midden))
        .addTo(routeLaag)
    }
  }
  kaart.fitBounds(L.latLngBounds(alles).pad(0.06))
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
  let h = '<tr><th>Ondergrond</th><th>OSM</th><th>BGT</th><th>Eindoordeel</th></tr>'
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
  const gok = a.stukken.filter((s) => !s.osmZeker && s.osm !== K.ONBEKEND).reduce((som, s) => som + s.tot - s.van, 0)
  let noot = a.bgtGebruikt ? '' : 'De BGT is niet gebruikt: het eindoordeel is alleen op OSM gebaseerd. '
  noot += `In de OSM-kolom is ${km(gok)} een aanname op basis van het wegtype (geen surface-tag). `
  noot += `${nl(100 * plan.law, 0)}% van de route loopt over een LAW.`
  if (a.dubbel > 0.02) noot += ` Ongeveer ${nl(100 * a.dubbel, 0)}% gaat heen en terug over hetzelfde pad.`
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
    t.innerHTML = '<tr><td>Geen zachte stukken gevonden.</td></tr>'
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
          s.indicatie += ` (past bij ${K.groep(s.osm) === ind.steun ? 'OSM' : 'de BGT'})`
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
    rand(plan.analyse.xy, '#fff', 2)
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
  const metFoto = new Set(plan.twijfels.slice().sort((a, b) => b.tot - b.van - (a.tot - a.van)).slice(0, MAX_FOTOS))
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
      kaart.once('moveend', () => twijfelLijn[s.nr].openPopup(s.midden))
      kaart.fitBounds(twijfelLijn[s.nr].getBounds().pad(0.6), { maxZoom: 19, animate: false })
      if (window.innerWidth <= 860) window.scrollTo({ top: 0, behavior: 'smooth' })
    })
    lijst.appendChild(li)
  }
  let noot = plan.twijfels.length
    ? 'Tik op een regel om erheen te zoomen; tik op de foto om hem te vergroten. '
    : `Geen twijfelstukken van ${MIN_TWIJFEL} m of langer. `
  if (plan.twijfelKort.aantal) {
    noot += `Daarnaast ${plan.twijfelKort.aantal} ${plan.twijfelKort.aantal === 1 ? 'kort stukje' : 'korte stukjes'} ` +
      `(samen ${plan.twijfelKort.meter} m) die niet apart genoemd zijn; op de kaart herken je ze aan de stippellijn.`
  }
  el('twijfelnoot').textContent = noot
}

function tekenPlanlog() {
  const log = plan.log
  const pct = (x) => (x === null || x === undefined ? '–' : nl(100 * x, 1) + '%')
  if (!log.length) {
    el('planblok').innerHTML = ''
    return
  }
  let h
  if (log[0].richting !== undefined) {
    h = '<h2>Kandidaten voor het rondje</h2><table><tr><th>Richting</th><th>km</th><th>Zacht OSM</th><th>Zacht BGT</th><th>Dubbel</th></tr>'
    for (const k of log) {
      if (k.fout) {
        h += `<tr><td>${Math.round(k.richting)}° (mislukt)</td><td colspan="4">${veilig(k.fout)}</td></tr>`
        continue
      }
      h +=
        `<tr${k.gekozen ? ' class="som"' : ''}><td>${Math.round(k.richting)}°${k.gekozen ? ' ← gekozen' : k.binnen ? '' : ' (te kort of te lang)'}</td>` +
        `<td>${nl(k.km)}</td><td>${pct(k.osm)}</td><td>${pct(k.eind)}</td><td>${pct(k.dubbel)}</td></tr>`
    }
    h += '</table><p class="noot">Zacht = onverhard + half verhard. Alleen de beste kandidaten volgens OSM zijn langs de BGT gelegd.</p>'
  } else {
    h = '<h2>Alternatieven langs de BGT</h2><table><tr><th>Deel · alt.</th><th>km</th><th>Zacht OSM</th><th>Zacht eind</th><th>LAW</th><th>Kosten</th></tr>'
    for (const k of log) {
      h +=
        `<tr${k.gekozen ? ' class="som"' : ''}><td>${k.deel} · ${k.alt}${k.gekozen ? ' ← gekozen' : ''}</td><td>${nl(k.km)}</td>` +
        `<td>${pct(k.osm)}</td><td>${pct(k.eind)}</td><td>${pct(k.law)}</td><td>${nl(k.kosten, 1)}</td></tr>`
    }
    h += '</table><p class="noot">Kosten = gewogen kilometers volgens het routeprofiel, met de ondergrond van het eindoordeel ingevuld. Per deel wint het alternatief met de laagste kosten.</p>'
  }
  el('planblok').innerHTML = h
}

function toonResultaat() {
  el('resultaat').hidden = false
  el('kern').innerHTML =
    `<div><b>${nl(plan.analyse.lengte / 1000)} km</b><span>totale afstand</span></div>` +
    `<div><b>${nl(100 * plan.zacht.eind, 0)}%</b><span>onverhard + half verhard</span></div>` +
    `<div><b>${plan.twijfels.length}</b><span>twijfelstukken</span></div>`
  el('meldingen').innerHTML = plan.meldingen.map((m) => `<p class="melding">${veilig(m)}</p>`).join('')
  tekenRoute()
  tekenBalken()
  tekenTabel()
  tekenZachteStukken()
  tekenTwijfels()
  tekenPlanlog()
  kleurRoute()
  el('resultaat').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

el('gpx').addEventListener('click', () => {
  if (!plan) return
  const nu = new Date()
  const stempel = nu.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  const naam = `onverhard-${stempel}`
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
el('km').value = staat.km
el('law').value = String(staat.law)
if (el('law').value !== String(staat.law)) {
  // een LAW-factor uit een link die niet in de lijst staat
  el('law').add(new Option(`Factor ${staat.law}`, String(staat.law)))
  el('law').value = String(staat.law)
}
el('grondig').value = String(staat.grondig)
zetModus(staat.modus === 'rondje' ? 'rondje' : 'route')
if (staat.punten.length > 1) kaart.fitBounds(L.latLngBounds(staat.punten).pad(0.2))
else if (staat.punten.length === 1) kaart.setView(staat.punten[0], 13)
// #...&plan=1 start meteen (handig voor een gedeelde link en voor de test)
if (hash.get('plan') && !el('plan').disabled) planNu()
// een gedeelde link openen terwijl de app al open staat: opnieuw beginnen met die punten
window.addEventListener('hashchange', () => {
  if (new URLSearchParams(location.hash.slice(1)).get('p')) location.reload()
})
window.onverhard = { krijgPlan: () => plan } // voor de end-to-end-test

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
