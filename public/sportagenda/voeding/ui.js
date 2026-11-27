// Voeding in Tarapp: het dagboek (MyFitnessPal-stijl, alleen kcal, eiwit,
// koolhydraten en vet). Deze module wordt pas geladen als je Voeding opent
// (dynamic import vanuit app.js). app.js geeft via `ctx` alleen een paar
// hulpjes mee (venster, melding, titel); verder staat alles hier.

import { BASIS, BASIS_BRON } from './basis.js'
import { NEVO, NEVO_BRON } from './nevo.js'
import {
  MEALS,
  MEAL_NL,
  controleerProcenten,
  gramVanProcent,
  kjNaarKcal,
  macrosVoor,
  normaliseerBarcode,
  fold,
  num,
  per100,
  receptWaarden,
  round,
  somMacros,
  tijdAmsterdam,
  volgendeTijd,
  zoek,
} from './kern.js'
import * as db from './opslag.js'
import { apparaatLink, koppelHealthbridge, leesApparaatLink, opWijziging, syncNu, syncStatus, syncStraks, zoekBarcode, zoekOff } from './sync.js'

// ---------- Staat ----------

let ctx = null
let root = null
let inst = null
let geladen = false
let pagina = 'dag' // 'dag' | 'instellingen' | 'producten'
let dag = vandaagKey()
let regels = [] // regels van de getoonde dag (zonder verwijderde)
let producten = [] // uit IndexedDB: eigen, recepten, gescande OFF-producten
let alleRegels = [] // voor "recent" en "dag kopiëren"
let pollTimer = null
let foutMelding = ''
let laadPromise = null

const BASIS_PRODUCTEN = BASIS.map((b) => ({
  id: `basis:${b.fdc}:${slug(b.naam)}`,
  naam: b.naam,
  merk: null,
  per100: { kcal: b.kcal, eiwit: b.eiwit, kh: b.kh, vet: b.vet, vezel: b.vezel },
  eenheid: b.cat === 'drank' ? 'ml' : 'g',
  portie: b.portie || null,
  bron: 'usda',
  fdc: b.fdc,
}))

// NEVO (RIVM): ongewijzigd overgenomen, met bron en versie. Leeg zolang nevo.js de plaatshouder is.
const NEVO_PRODUCTEN = NEVO.map((n) => ({
  id: `nevo:${n.code}`,
  naam: n.naam,
  merk: null,
  per100: { kcal: n.kcal, eiwit: n.eiwit, kh: n.kh, vet: n.vet, vezel: n.vezel },
  eenheid: n.eenheid === 'ml' ? 'ml' : 'g',
  portie: null,
  bron: 'nevo',
  nevo: n.code,
}))

const MEAL_TIJD = { breakfast: '08:00', lunch: '12:30', dinner: '18:30', snack: '15:30' }

// ---------- Eetmomenten ----------
// Een regel heeft een eigen eetmoment (moment) en een soort (meal) voor Healthbridge. Oudere regels
// hebben alleen meal; die horen bij het eerste eetmoment van die soort.
const momenten = () => inst.momenten
const momentInfo = (id) => momenten().find((m) => m.id === id)
function momentVan(r) {
  if (r.moment && momentInfo(r.moment)) return r.moment
  return (momenten().find((m) => m.soort === r.meal) || momenten()[momenten().length - 1]).id
}
const soortVan = (id) => momentInfo(id)?.soort || 'snack'
const naamVan = (id) => momentInfo(id)?.naam || MEAL_NL[id] || 'Snack'
const volgorde = (id) => momenten().findIndex((m) => m.id === id)
const MACRO_NL = { kcal: 'kcal', eiwit: 'Eiwit', kh: 'Koolhydraten', vet: 'Vet' }
const MACRO_KLEUR = { kcal: 'var(--accent)', eiwit: '#3b82f6', kh: '#f59e0b', vet: '#ec4899' }

// ---------- Hulpjes ----------

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
function pad(n) {
  return String(n).padStart(2, '0')
}
function vandaagKey() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function verschuif(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  const x = new Date(y, m - 1, d + n)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
function dagLabel(key) {
  const t = vandaagKey()
  if (key === t) return 'Vandaag'
  if (key === verschuif(t, -1)) return 'Gisteren'
  if (key === verschuif(t, 1)) return 'Morgen'
  const [y, m, d] = key.split('-').map(Number)
  const x = new Date(y, m - 1, d)
  return `${DAGEN[x.getDay()]} ${d} ${MAANDEN[m - 1]}`
}
const uid = () => {
  const b = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_')
}
const esc = (s) => ctx.esc(s)
const fmt = (n, d = 0) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('nl-NL', { maximumFractionDigits: d, minimumFractionDigits: 0 }))
const gramTekst = (g, unit) => `${fmt(g, 1)} ${unit === 'ml' ? 'ml' : 'g'}`
const isVandaag = () => dag === vandaagKey()

function productVanId(id) {
  return NEVO_PRODUCTEN.find((p) => p.id === id) || BASIS_PRODUCTEN.find((p) => p.id === id) || producten.find((p) => p.id === id) || null
}

/** Een recept als product: per 100 g en een portie. */
function receptAlsProduct(r) {
  const w = receptWaarden(r)
  return { ...r, per100: w.per100, eenheid: 'g', portie: w.totaalGram ? { g: round(w.portieGram, 1), naam: '1 portie' } : null }
}

function alleProducten() {
  // Volgorde telt bij gelijke zoekscore: eigen producten, dan NEVO, dan USDA (aanvulling).
  return [...producten.map((p) => (p.bron === 'recept' ? receptAlsProduct(p) : p)), ...NEVO_PRODUCTEN, ...BASIS_PRODUCTEN]
}

function recentProducten(max = 25) {
  const seen = new Set()
  const out = []
  for (const r of [...alleRegels].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (r.deleted) continue
    const key = r.productId || `${r.name}|${r.brand || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const p = (r.productId && productVanId(r.productId)) || null
    out.push({
      ...(p ? (p.bron === 'recept' ? receptAlsProduct(p) : p) : {}),
      id: r.productId || `regel:${r.id}`,
      naam: p?.naam || r.name,
      merk: p?.merk ?? r.brand,
      per100: p ? (p.bron === 'recept' ? receptAlsProduct(p).per100 : p.per100) : r.per100,
      eenheid: r.unit,
      bron: p?.bron || r.source,
      barcode: r.barcode,
      laatsteGram: r.grams,
    })
    if (out.length >= max) break
  }
  return out
}

/** Venster openen zonder dat het toetsenbord vanzelf opent: de focus gaat naar de titel. */
function vSheet(html, onSubmit) {
  ctx.openSheet(html.replace('<h2>', '<h2 tabindex="-1" autofocus>'), onSubmit)
}

/**
 * Naar een subpagina van Voeding (instellingen, producten) of terug naar het dagboek. Een subpagina
 * krijgt een stap in de geschiedenis, zodat de terugknop van de telefoon eerst terug naar het dagboek gaat.
 */
function naarPagina(p) {
  if (p === pagina) return
  if (p === 'dag' && history.state?.vPagina) return history.back()
  if (p !== 'dag') history.pushState({ vPagina: p }, '')
  pagina = p
  if (p === 'instellingen') momentenConcept = null
  teken()
  window.scrollTo(0, 0)
}

function bewaarInst() {
  db.bewaarInstellingen(inst)
}

// ---------- Laden ----------

async function laad() {
  inst = db.leesInstellingen()
  // Koppel-link van een ander apparaat van dezelfde persoon (#voeding=...).
  const persoon = leesApparaatLink(location.hash)
  if (persoon) {
    inst.persoon = persoon
    bewaarInst()
    history.replaceState(null, '', location.pathname + location.search)
    setTimeout(() => ctx.showToast('Dit apparaat deelt nu het dagboek 🔗'), 300)
  }
  await db.openDb()
  producten = await db.alle('producten')
  await laadRegels()
  geladen = true
}

async function laadRegels() {
  alleRegels = await db.alle('dagboek')
  regels = alleRegels.filter((r) => r.date === dag && !r.deleted).sort((a, b) => volgorde(momentVan(a)) - volgorde(momentVan(b)) || a.time.localeCompare(b.time))
}

// ---------- Mount ----------

/** Wordt door app.js aangeroepen telkens als het Voeding-scherm (opnieuw) getekend wordt. */
export async function mount(el, context) {
  ctx = context
  root = el
  laadCss()
  root.addEventListener('click', onClick)
  root.addEventListener('submit', onSubmit)
  root.addEventListener('change', onChange)
  root.addEventListener('input', onInput)
  if (!geladen) {
    teken()
    laadPromise ||= (async () => {
      try {
        await laad()
      } catch (err) {
        foutMelding = err?.message || 'onbekende fout'
      }
      // Na een sync: alleen opnieuw tekenen als er nieuwe regels zijn én je op de dagpagina staat.
      // Anders alleen de statusregel bijwerken, zodat wat je net intypt (bijv. bij Doelen) blijft staan.
      opWijziging(async (changed) => {
        if (changed) await laadRegels()
        if (!root?.isConnected) return
        if (changed && pagina === 'dag' && !ctx.sheet.open) return teken()
        const el = root.querySelector('#v-sync')
        if (el) el.textContent = syncTekst()
        const lbl = root.querySelector('[data-page="instellingen"] .pref-value')
        if (lbl) lbl.textContent = syncLabel()
      })
      addEventListener('online', () => inst?.persoon && syncNu(inst))
      // Terugknop van de telefoon: van een subpagina terug naar het dagboek.
      addEventListener('popstate', (e) => {
        const p = e.state?.vPagina || 'dag'
        if (p === pagina || !root?.isConnected) return
        pagina = p
        teken()
        window.scrollTo(0, 0)
      })
      if (inst?.persoon) syncNu(inst)
      vraagSwOmVoedingBestanden()
    })()
    await laadPromise
  }
  if (root !== el) return
  teken()
  clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (!root?.isConnected) return clearInterval(pollTimer)
    if (document.visibilityState === 'visible' && inst?.persoon) syncNu(inst)
  }, 30000)
}

function laadCss() {
  if (document.getElementById('voeding-css')) return
  const link = document.createElement('link')
  link.id = 'voeding-css'
  link.rel = 'stylesheet'
  link.href = new URL('./voeding.css', import.meta.url).href
  document.head.append(link)
}

/** De service worker vragen de Voeding-bestanden (ook de scanner) voor offline te bewaren. */
function vraagSwOmVoedingBestanden() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'voeding-precache' })
}

// ---------- Tekenen ----------

function teken() {
  if (!root) return
  ctx.setTitle('Voeding')
  if (foutMelding) {
    root.innerHTML = `<section class="card"><h2>Voeding kan niet laden</h2><p class="muted">${esc(foutMelding)}. De rest van Tarapp werkt gewoon. Probeer het later opnieuw, of zet Voeding uit onder Meer.</p></section>`
    return
  }
  if (!geladen) {
    root.innerHTML = '<p class="muted">Voeding laden…</p>'
    return
  }
  if (!inst.persoon) {
    root.innerHTML = tekenWelkom()
    return
  }
  root.innerHTML = pagina === 'instellingen' ? tekenInstellingen() : pagina === 'producten' ? tekenProducten() : tekenDag()
  ctx.naTekenen?.()
}

function tekenWelkom() {
  return `
    <section class="card v-welkom">
      <h2>Voeding bijhouden 🍎</h2>
      <p class="muted">Houd per dag bij wat je eet: kcal, eiwit, koolhydraten en vet. Zoek een product, scan de barcode of kies iets wat je vaker eet.</p>
      <p><strong>Wie gebruikt deze telefoon?</strong></p>
      <div class="actions">
        <button type="button" class="btn primary" data-v="persoon" data-p="tara">Tara</button>
        <button type="button" class="btn primary" data-v="persoon" data-p="oscar">Oscar</button>
      </div>
      <p class="muted">Dat kun je later aanpassen bij de instellingen van Voeding.</p>
    </section>`
}

function voortgang(key, waarde, doel) {
  const pct = doel ? Math.min(100, Math.round(((waarde || 0) / doel) * 100)) : 0
  const over = doel && waarde > doel
  return `
    <div class="v-macro">
      <div class="v-macro-top"><span>${MACRO_NL[key]}</span><span><strong>${fmt(waarde)}</strong> / ${fmt(doel)}${key === 'kcal' ? '' : ' g'}</span></div>
      <div class="v-bar ${over ? 'over' : ''}" role="progressbar" aria-label="${MACRO_NL[key]}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%;background:${MACRO_KLEUR[key]}"></i></div>
    </div>`
}

function tekenDag() {
  const items = regels.map((r) => ({ r, m: macrosVoor(r.per100, r.grams) }))
  // Een lege dag is 0 gegeten (niet onbekend).
  const tot = items.length ? somMacros(items.map((x) => x.m)) : { kcal: 0, eiwit: 0, kh: 0, vet: 0, vezel: 0 }
  const vezelOnbekend = items.filter((x) => x.m.vezel === null).length
  const doel = inst.doelen
  const rest = doel.kcal ? doel.kcal - (tot.kcal || 0) : null
  const meals = momenten().map(({ id: meal, naam }) => {
    const list = items.filter((x) => momentVan(x.r) === meal)
    const sum = somMacros(list.map((x) => x.m))
    // In het overzicht hele getallen (geen komma's); de precieze waarden zie je als je op een regel tikt.
    const dicht = inst.weergave.ingeklapt.includes(meal)
    const macros = inst.weergave.macros.includes(meal)
    return `
      <section class="card v-meal ${dicht ? 'dicht' : ''}">
        <div class="v-meal-head">
          <button type="button" class="v-meal-toggle" data-v="klap" data-meal="${esc(meal)}" aria-expanded="${!dicht}"><span class="v-pijl" aria-hidden="true">${dicht ? '▸' : '▾'}</span><h3>${esc(naam)}</h3>${dicht && list.length ? `<small class="muted">${list.length}</small>` : ''}</button>
          <span class="muted v-meal-kcal">${list.length ? `${fmt(sum.kcal)} kcal` : ''}</span>
          ${list.length ? `<button type="button" class="v-macroknop ${macros ? 'on' : ''}" data-v="macros" data-meal="${esc(meal)}" aria-pressed="${macros}" aria-label="Macro's van ${esc(naam)} tonen">E·K·V</button>` : ''}
        </div>
        ${list.length && macros ? `<div class="v-meal-macros"><span>Eiwit <strong>${fmt(sum.eiwit)} g</strong></span><span>Koolh. <strong>${fmt(sum.kh)} g</strong></span><span>Vet <strong>${fmt(sum.vet)} g</strong></span>${sum.vezel === null ? '' : `<span>Vezel <strong>${fmt(sum.vezel)} g</strong></span>`}</div>` : ''}
        ${
          dicht
            ? ''
            : `${list
                .map(
                  ({ r, m }) => `
          <button type="button" class="v-row" data-v="bewerk" data-id="${esc(r.id)}">
            <span class="v-row-main"><span class="v-name">${esc(r.name)}${r.brand ? ` <small>${esc(r.brand)}</small>` : ''}</span><small class="muted">${fmt(r.grams)} ${r.unit === 'ml' ? 'ml' : 'g'} · E ${fmt(m.eiwit)} · K ${fmt(m.kh)} · V ${fmt(m.vet)}${m.vezel === null ? '' : ` · Vz ${fmt(m.vezel)}`}</small></span>
            <span class="v-kcal">${fmt(m.kcal)}</span>
          </button>`,
                )
                .join('')}
        <div class="v-meal-acties">
          <button type="button" class="linkbtn v-add" data-v="toevoegen" data-meal="${meal}">+ Toevoegen</button>
          ${vorigeMaaltijd(meal).length ? `<button type="button" class="linkbtn v-gisteren" data-v="gisteren" data-meal="${meal}">↺ Zoals ${esc(dagLabel(verschuif(dag, -1)).toLowerCase())}</button>` : ''}
        </div>`
        }
      </section>`
  }).join('')
  return `
    <div class="weeknav v-daynav">
      <button type="button" class="iconbtn" data-v="dag" data-n="-1" aria-label="Vorige dag">‹</button>
      <button type="button" class="label linkbtn v-daylabel" data-v="vandaag"><strong>${esc(dagLabel(dag))}</strong>${isVandaag() ? '' : '<small class="muted">tik voor vandaag</small>'}</button>
      <button type="button" class="iconbtn" data-v="dag" data-n="1" aria-label="Volgende dag">›</button>
    </div>
    <section class="card v-sum">
      <div class="v-sum-top">
        <div><span class="v-big">${fmt(tot.kcal)}</span> <span class="muted">kcal gegeten</span></div>
        <div class="v-left">${rest === null ? '' : rest >= 0 ? `nog <strong>${fmt(rest)}</strong>` : `<strong>${fmt(-rest)}</strong> over`}</div>
      </div>
      ${voortgang('kcal', tot.kcal, doel.kcal)}
      ${['eiwit', 'kh', 'vet'].map((k) => voortgang(k, tot[k], doel[k])).join('')}
      <div class="v-vezel"><span>Vezels</span><span><strong>${vezelOnbekend && tot.vezel !== null ? '≥ ' : ''}${fmt(tot.vezel ?? 0)} g</strong>${vezelOnbekend ? `<small class="muted"> · bij ${vezelOnbekend} ${vezelOnbekend === 1 ? 'product' : 'producten'} onbekend</small>` : ''}</span></div>
    </section>
    ${meals}
    ${ctx.gewichtKaart ? ctx.gewichtKaart(dag) : ''}
    <div class="actions v-dagacties">
      <button type="button" class="btn" data-v="vaste">⭐ Vaste items</button>
      <button type="button" class="btn" data-v="kopieer">📋 Dag kopiëren</button>
    </div>
    <div class="pref-list card v-links">
      ${prefRij('producten', '🥫', 'Mijn producten en recepten', String(producten.filter((p) => p.bron === 'eigen' || p.bron === 'recept').length))}
      ${prefRij('instellingen', '⚙️', 'Doelen en instellingen', syncLabel())}
    </div>
    <p class="muted v-bron">${bronRegel()}</p>`
}

function bronRegel() {
  const delen = []
  if (NEVO_BRON) delen.push(`Gebaseerd op gegevens van ${esc(NEVO_BRON)} en andere gegevens`)
  delen.push('Productgegevens: Open Food Facts (ODbL)')
  delen.push(`${NEVO_BRON ? 'Aanvulling' : 'Basisproducten'}: ${esc(BASIS_BRON)}`)
  return delen.join(' · ')
}

function prefRij(page, emoji, label, value = '') {
  return `
    <button type="button" class="pref-row" data-v="pagina" data-page="${page}">
      <span class="pref-ico v-emoji">${emoji}</span>
      <span class="pref-label">${esc(label)}</span>
      <span class="pref-value">${esc(value)}</span>
      <span class="pref-chev" aria-hidden="true">›</span>
    </button>`
}

function syncLabel() {
  if (syncStatus.status === 'busy') return 'Synchroniseren…'
  if (syncStatus.status === 'error') return 'Offline'
  if (syncStatus.last) return 'Gesynchroniseerd'
  return ''
}

function syncTekst() {
  if (syncStatus.status === 'busy') return '⏳ Bezig met synchroniseren…'
  if (syncStatus.status === 'error') return `⚠️ ${syncStatus.error}. Je dagboek staat veilig op deze telefoon en gaat mee zodra het weer lukt.`
  if (syncStatus.last) {
    const t = new Date(syncStatus.last).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    return `✅ Gesynchroniseerd om ${t}`
  }
  return 'Nog niet gesynchroniseerd.'
}

function terug() {
  return '<button type="button" class="linkbtn more-back" data-v="pagina" data-page="dag">‹ Dagboek</button>'
}

function tekenInstellingen() {
  const d = inst.doelen
  const pct = inst.doelenPct || {}
  const fwd = db.doorsturenAan(inst)
  const naam = inst.persoon === 'oscar' ? 'Oscar' : 'Tara'
  return `
    ${terug()}
    <section class="card">
      <h2>Wie gebruikt deze telefoon?</h2>
      <div class="segmented" role="radiogroup" aria-label="Persoon">
        ${['tara', 'oscar'].map((p) => `<button type="button" class="${inst.persoon === p ? 'on' : ''}" data-v="persoon" data-p="${p}">${p === 'oscar' ? 'Oscar' : 'Tara'}</button>`).join('')}
      </div>
      <p class="muted">Ieder houdt een eigen dagboek bij op de eigen telefoon.</p>
    </section>
    <section class="card">
      <h2>Dagdoelen</h2>
      <form id="v-doelen">
        <label class="field">kcal per dag<input name="kcal" inputmode="numeric" value="${d.kcal ?? ''}" /></label>
        <p class="muted">Verdeling over de macro's, samen 100%:</p>
        <div class="v-pct">
          <label class="field">Eiwit<span class="v-pct-in"><input name="eiwit" inputmode="decimal" value="${pct.eiwit ?? ''}" />%</span></label>
          <label class="field">Koolhydraten<span class="v-pct-in"><input name="kh" inputmode="decimal" value="${pct.kh ?? ''}" />%</span></label>
          <label class="field">Vet<span class="v-pct-in"><input name="vet" inputmode="decimal" value="${pct.vet ?? ''}" />%</span></label>
        </div>
        <p class="v-macrokcal" id="v-macrokcal">${doelenTekst(d.kcal, pct)}</p>
        <button type="submit" class="btn primary block">Doelen opslaan</button>
      </form>
    </section>
    <section class="card">
      <h2>Eetmomenten</h2>
      <form id="v-momenten">
        <div id="v-momenten-lijst">${momentenLijst()}</div>
        <button type="button" class="btn block" data-v="moment-nieuw">+ Eetmoment</button>
        <p class="muted">De naam en volgorde kies je zelf. De soort is wat Healthbridge te zien krijgt (ontbijt, lunch, diner of snack).</p>
        <button type="submit" class="btn primary block">Eetmomenten opslaan</button>
      </form>
    </section>
    <h3 class="pref-head">Healthbridge</h3>
    <div class="pref-list card">
      <label class="pref-row">
        <span class="pref-ico v-emoji">🩺</span>
        <span class="pref-label">Doorsturen naar Healthbridge<small>Zodat de coach ${esc(naam === 'Oscar' ? 'je' : 'het')} voedingsdagboek ziet</small></span>
        <input type="checkbox" class="switch" data-v-set="doorsturen" ${fwd ? 'checked' : ''} aria-label="Doorsturen naar Healthbridge" />
      </label>
    </div>
    ${
      fwd
        ? `<section class="card">
      <p class="muted">Eén keer koppelen op de telefoon waar Healthbridge op staat. Healthbridge haalt je dagboek daarna elke dag zelf op.</p>
      <button type="button" class="btn primary block" data-v="koppel-hb">🔗 Koppel met Healthbridge</button>
    </section>`
        : '<p class="muted v-pad">Je dagboek wordt wel gesynchroniseerd (als back-up en voor je andere apparaten), maar niet aan Healthbridge doorgegeven.</p>'
    }
    <h3 class="pref-head">Synchroniseren</h3>
    <section class="card">
      <p class="muted" id="v-sync">${esc(syncTekst())}</p>
      <div class="actions">
        <button type="button" class="btn" data-v="sync">Nu synchroniseren</button>
        <button type="button" class="btn" data-v="apparaat">Nog een apparaat</button>
      </div>
    </section>
    <h3 class="pref-head">Gegevens</h3>
    <section class="card">
      <p class="muted">Voeding gaat mee in de gewone back-up van Tarapp (Meer → Back-up en herstellen).</p>
      <button type="button" class="btn danger block" data-v="wis">Voedingsgegevens van deze telefoon wissen</button>
    </section>
    <p class="muted v-bron">${bronRegel()}. Open Food Facts loopt via de eigen sync-server; USDA-producten hebben een FDC-id.</p>`
}

function tekenProducten() {
  const eigen = producten.filter((p) => p.bron === 'eigen').sort((a, b) => a.naam.localeCompare(b.naam))
  const recepten = producten.filter((p) => p.bron === 'recept').sort((a, b) => a.naam.localeCompare(b.naam))
  const rij = (p, extra) => `
    <div class="list-item">
      <button type="button" class="grow" data-v="${p.bron === 'recept' ? 'recept' : 'product'}" data-id="${esc(p.id)}">
        <strong>${esc(p.naam)}</strong>${p.merk ? ` <small class="muted">${esc(p.merk)}</small>` : ''}<br /><small class="muted">${extra}</small>
      </button>
      <button type="button" class="btn danger" data-v="wis-product" data-id="${esc(p.id)}" aria-label="${esc(p.naam)} verwijderen">✕</button>
    </div>`
  return `
    ${terug()}
    <section class="card">
      <h2>Mijn producten</h2>
      ${eigen.map((p) => rij(p, `${fmt(p.per100.kcal)} kcal per 100 ${p.eenheid === 'ml' ? 'ml' : 'g'}${p.barcode ? ` · ${esc(p.barcode)}` : ''}`)).join('') || '<p class="muted">Nog geen eigen producten.</p>'}
      <button type="button" class="btn block" data-v="product">+ Eigen product</button>
    </section>
    <section class="card">
      <h2>Recepten</h2>
      ${
        recepten
          .map((r) => {
            const w = receptWaarden(r)
            return rij(r, `${w.porties} ${w.porties === 1 ? 'portie' : 'porties'} · ${fmt(w.perPortie.kcal)} kcal per portie`)
          })
          .join('') || '<p class="muted">Nog geen recepten. Een recept is handig voor iets wat je vaker kookt.</p>'
      }
      <button type="button" class="btn block" data-v="recept">+ Recept</button>
    </section>`
}

// ---------- Acties ----------

async function onClick(e) {
  const el = e.target.closest('[data-v]')
  if (!el || !root.contains(el)) return
  const v = el.dataset.v
  try {
    if (v === 'persoon') return kiesPersoon(el.dataset.p)
    if (v === 'dag') return naarDag(verschuif(dag, Number(el.dataset.n)))
    if (v === 'vandaag') return naarDag(vandaagKey())
    if (v === 'pagina') return naarPagina(el.dataset.page)
    if (v === 'moment-op' || v === 'moment-weg' || v === 'moment-nieuw') return wijzigMomenten(v, Number(el.dataset.i))
    if (v === 'toevoegen') return openToevoegen(el.dataset.meal)
    if (v === 'bewerk') {
      const r = regels.find((x) => x.id === el.dataset.id)
      if (r) openHoeveelheid(regelAlsProduct(r), { meal: momentVan(r), regel: r })
      return
    }
    if (v === 'vaste') return openVasteItems()
    if (v === 'gisteren') return kopieerMaaltijd(el.dataset.meal)
    if (v === 'klap' || v === 'macros') return wisselWeergave(v === 'klap' ? 'ingeklapt' : 'macros', el.dataset.meal)
    if (v === 'kopieer') return openKopieer()
    if (v === 'koppel-hb') return koppel()
    if (v === 'sync') {
      await syncNu(inst)
      return
    }
    if (v === 'apparaat') return deelApparaat()
    if (v === 'wis') return wisAlles()
    if (v === 'product') return openProductForm(el.dataset.id ? productVanId(el.dataset.id) : null)
    if (v === 'recept') return openRecept(el.dataset.id ? productVanId(el.dataset.id) : null)
    if (v === 'wis-product') return wisProduct(el.dataset.id)
  } catch (err) {
    ctx.showToast(err?.message || 'Er ging iets mis')
  }
}

/** Live onder de doelen: de grammen die bij de verdeling horen, of wat er niet klopt. */
function doelenTekst(kcal, pct) {
  const fout = controleerProcenten(pct)
  if (fout) return `<span class="v-fout">⚠️ ${esc(fout)}</span>`
  if (num(kcal) === null) return 'Vul je kcal per dag in.'
  const g = gramVanProcent(kcal, pct)
  return `Samen 100% ✓ Dat is per dag: <strong>eiwit ${fmt(g.eiwit)} g</strong> · <strong>koolhydraten ${fmt(g.kh)} g</strong> · <strong>vet ${fmt(g.vet)} g</strong>.<br /><small>Eiwit en koolhydraten 4 kcal per gram, vet 9.</small>`
}

function leesDoelen(form) {
  const fd = new FormData(form)
  return { kcal: num(fd.get('kcal')), pct: { eiwit: num(fd.get('eiwit')), kh: num(fd.get('kh')), vet: num(fd.get('vet')) } }
}

function onInput(e) {
  const form = e.target.closest('#v-doelen')
  if (!form) return
  const { kcal, pct } = leesDoelen(form)
  const el = form.querySelector('#v-macrokcal')
  if (el) el.innerHTML = doelenTekst(kcal, pct)
}

function onSubmit(e) {
  if (e.target.id === 'v-momenten') return bewaarMomenten(e)
  if (e.target.id !== 'v-doelen') return
  e.preventDefault()
  const { kcal, pct } = leesDoelen(e.target)
  const fout = kcal === null ? 'Vul je kcal per dag in.' : controleerProcenten(pct)
  if (fout) {
    ctx.showToast(fout)
    return
  }
  const nieuw = gramVanProcent(kcal, pct)
  inst.doelenPct = pct
  inst.doelen = nieuw
  bewaarInst()
  ctx.showToast('Doelen opgeslagen 🎯')
  naarPagina('dag')
}

function onChange(e) {
  if (e.target.dataset.vSet !== 'doorsturen') return
  inst.doorsturen = e.target.checked
  bewaarInst()
  syncNu(inst)
  teken()
}

function kiesPersoon(p) {
  if (!['oscar', 'tara'].includes(p)) return
  const nieuw = !inst.persoon
  inst.persoon = p
  // "Doorsturen" volgt de persoon, tenzij je hem zelf hebt omgezet.
  if (nieuw) inst.doorsturen = null
  bewaarInst()
  syncNu(inst)
  teken()
  if (nieuw) ctx.showToast(`Hoi ${p === 'oscar' ? 'Oscar' : 'Tara'}! Tik op + Toevoegen bij een maaltijd 🍽️`)
}

async function naarDag(key) {
  dag = key
  await laadRegels()
  teken()
}

// ---------- Regels opslaan ----------

function regelAlsProduct(r) {
  const p = r.productId && productVanId(r.productId)
  const base = p ? (p.bron === 'recept' ? receptAlsProduct(p) : p) : null
  return {
    id: r.productId || `regel:${r.id}`,
    naam: r.name,
    merk: r.brand,
    per100: r.per100,
    eenheid: r.unit,
    portie: base?.portie || null,
    bron: r.source,
    barcode: r.barcode,
  }
}

async function bewaarRegel(product, { grams, meal, regel }) {
  const nu = Date.now()
  const r = {
    id: regel?.id || uid(),
    date: regel?.date || dag,
    time: regel?.time || (isVandaag() ? tijdAmsterdam() : MEAL_TIJD[soortVan(meal)]),
    meal: soortVan(meal),
    moment: meal,
    productId: product.id?.startsWith('regel:') ? regel?.productId || null : product.id,
    name: product.naam,
    brand: product.merk || null,
    grams,
    unit: product.eenheid === 'ml' ? 'ml' : 'g',
    per100: per100(product.per100),
    source: product.bron === 'usda' ? 'usda' : product.bron || 'eigen',
    barcode: product.barcode || null,
    updatedAt: volgendeTijd(regel?.updatedAt, nu),
    dirty: 1,
  }
  await db.zet('dagboek', r)
  await laadRegels()
  teken()
  syncStraks(inst)
  return r
}

async function verwijderRegel(r) {
  const tomb = { id: r.id, date: r.date, updatedAt: volgendeTijd(r.updatedAt), deleted: true, dirty: 1 }
  await db.zet('dagboek', tomb)
  await laadRegels()
  teken()
  syncStraks(inst)
  ctx.showToast(`${r.name} verwijderd`, async () => {
    await db.zet('dagboek', { ...r, updatedAt: volgendeTijd(tomb.updatedAt), dirty: 1 })
    await laadRegels()
    teken()
    syncStraks(inst)
  })
}

// ---------- Venster: toevoegen (zoeken, recent, favorieten, scannen) ----------

let zoekTab = 'recent'

function openToevoegen(meal) {
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>Toevoegen aan ${esc(naamVan(meal).toLowerCase())}</h2>
      <input type="search" name="q" class="v-search" placeholder="Zoek een product, bijv. banaan" autocomplete="off" enterkeyhint="search" />
      <div class="v-scanrow">
        <button type="button" class="btn" data-s="scan">📷 Scannen</button>
        <button type="button" class="btn" data-s="intypen">🔢 Barcode intypen</button>
      </div>
      <div class="segmented v-tabs" role="tablist">
        ${[
          ['recent', 'Recent'],
          ['favorieten', 'Favorieten'],
          ['mijn', 'Mijn'],
        ]
          .map(([id, l]) => `<button type="button" role="tab" data-s="tab" data-tab="${id}" class="${zoekTab === id ? 'on' : ''}">${l}</button>`)
          .join('')}
      </div>
      <div class="v-results" id="v-results"></div>
      <div class="actions">
        <button type="button" class="btn" data-s="etiket">🏷️ Etiket</button>
        <button type="button" class="btn" data-s="nieuw">+ Eigen product</button>
        <button type="submit" class="btn">Sluiten</button>
      </div>
    </form>`,
    () => {},
  )
  const sheet = ctx.sheet
  const input = sheet.querySelector('.v-search')
  const results = sheet.querySelector('#v-results')
  const lijst = (list, leeg) => (list.length ? list.map(resultaatRij).join('') : `<p class="muted">${leeg}</p>`)
  let zichtbaar = []
  let alleLokaal = false
  const toon = () => {
    const q = input.value.trim()
    sheet.querySelector('.v-tabs').hidden = !!q
    if (q) {
      const lokaal = zoek(alleProducten(), q)
      const key = offKey(q)
      const uitLijst = offNl && key.length >= 3 ? zoek(offNl, q, 30) : []
      const gezien = new Set([...producten.map((p) => p.id), ...lokaal.map((p) => p.id)])
      const off = [...uitLijst, ...(offCache.get(key) || [])].filter((o) => !gezien.has(o.id) && gezien.add(o.id))
      zichtbaar = [...lokaal, ...off]
      // Eerst de beste 5, zodat de merkproducten van Open Food Facts niet onder de rand verdwijnen.
      const kort = key.length >= 3 && !alleLokaal && lokaal.length > 6
      results.innerHTML =
        lijst(kort ? lokaal.slice(0, 5) : lokaal, `Niets gevonden voor "${esc(q)}" in je eigen producten, NEVO en USDA.`) +
        (kort ? `<button type="button" class="linkbtn v-meer" data-s="meer">Toon alle ${lokaal.length} uit je producten, NEVO en USDA</button>` : '') +
        offBlok(q, key, off)
      return
    }
    if (zoekTab === 'recent') {
      zichtbaar = recentProducten()
      results.innerHTML = lijst(zichtbaar, 'Nog niets gegeten in Tarapp. Zoek een product of scan een barcode.')
    } else if (zoekTab === 'favorieten') {
      zichtbaar = inst.favorieten.map(productVanId).filter(Boolean).map((p) => (p.bron === 'recept' ? receptAlsProduct(p) : p))
      results.innerHTML = lijst(zichtbaar, 'Nog geen favorieten. Tik op ☆ als je een product toevoegt.')
    } else {
      zichtbaar = producten.filter((p) => p.bron === 'eigen' || p.bron === 'recept').map((p) => (p.bron === 'recept' ? receptAlsProduct(p) : p))
      results.innerHTML = lijst(zichtbaar, 'Nog geen eigen producten of recepten.')
    }
  }
  // Tijdens het typen ook Open Food Facts doorzoeken: na 0,7 s stilte en vanaf 3 letters.
  let wacht = null
  const zoekOffNu = async (handmatig = false) => {
    const q = input.value.trim()
    const key = offKey(q)
    if (key.length < 3 || offCache.has(key)) return toon()
    // Staat het al genoeg in de Nederlandse lijst, dan niet ook nog live zoeken.
    await laadOffNl()
    if (!handmatig && offNl.length && zoek(offNl, q, 5).length >= 5) return toon()
    if (!handmatig && !offMag()) {
      offStatus = { key, status: 'limiet' }
      return toon()
    }
    offStatus = { key, status: 'busy' }
    toon()
    try {
      const r = await zoekOff(inst, q)
      offCache.set(key, r.products || [])
      if (offStatus.key === key) offStatus = { key, status: 'ok' }
    } catch (err) {
      if (offStatus.key === key) offStatus = { key, status: 'fout', melding: err?.status ? err.message : 'Open Food Facts is nu niet bereikbaar' }
    }
    // Alleen tekenen als je intussen niet verder hebt getypt.
    if (sheet.open && offKey(input.value) === key) toon()
  }
  input.addEventListener('input', () => {
    alleLokaal = false
    if (!offNl) laadOffNl().then(() => sheet.open && toon())
    toon()
    clearTimeout(wacht)
    wacht = setTimeout(() => zoekOffNu(false), 700)
  })
  sheet.addEventListener('close', () => clearTimeout(wacht), { once: true })
  sheet.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-s]')
    if (!el) return
    const s = el.dataset.s
    if (s === 'tab') {
      zoekTab = el.dataset.tab
      sheet.querySelectorAll('.v-tabs button').forEach((b) => b.classList.toggle('on', b === el))
      toon()
    } else if (s === 'kies') {
      const p = zichtbaar.find((x) => x.id === el.dataset.id)
      if (!p) return
      if (p.bron === 'off' && !producten.some((x) => x.id === p.id)) await bewaarProduct(p)
      openHoeveelheid(p, { meal, gram: p.laatsteGram })
    } else if (s === 'scan') openScanner(meal)
    else if (s === 'intypen') openBarcodeIntypen(meal)
    else if (s === 'nieuw') openProductForm(null, { meal, naam: input.value.trim() })
    else if (s === 'etiket') openProductForm(null, { meal, naam: input.value.trim(), scan: true })
    else if (s === 'off') zoekOffNu(true)
    else if (s === 'meer') {
      alleLokaal = true
      toon()
    }
  })
  toon()
}

function resultaatRij(p) {
  return `
        <button type="button" class="v-result" data-s="kies" data-id="${esc(p.id)}">
          <span><strong>${esc(p.naam)}</strong>${p.merk ? ` <small class="muted">${esc(p.merk)}</small>` : ''}<br /><small class="muted">${bronLabel(p)}</small></span>
          <span class="v-kcal">${fmt(p.per100?.kcal)}<small> /100${p.eenheid === 'ml' ? 'ml' : 'g'}</small></span>
        </button>`
}

// ---------- Open Food Facts: de Nederlandse lijst (off-nl.json) ----------
// ±63.000 producten die in Nederland verkocht worden, gemaakt met scripts/gen-voeding-off-nl.mjs.
// Pas geladen bij de eerste zoekopdracht of scan; daarna werkt zoeken en scannen ook offline.

let offNl = null // [product] zodra geladen; [] als er (nog) geen lijst is
let offNlBarcode = new Map()
let offNlPromise = null

function laadOffNl() {
  offNlPromise ||= (async () => {
    try {
      const res = await fetch(new URL('./off-nl.json', import.meta.url))
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      const k = Object.fromEntries(data.kolommen.map((c, i) => [c, i]))
      offNl = data.producten.map((r) => {
        const eenheid = r[k.ml] ? 'ml' : 'g'
        const naam = r[k.naam]
        const merk = r[k.merk] || null
        return {
          id: `off:${r[k.barcode]}`,
          naam,
          merk,
          per100: { kcal: r[k.kcal], eiwit: r[k.eiwit], kh: r[k.kh], vet: r[k.vet], vezel: r[k.vezel] },
          eenheid,
          portie: r[k.portie] ? { g: r[k.portie], naam: `1 portie (${fmt(r[k.portie])} ${eenheid})` } : null,
          bron: 'off',
          barcode: r[k.barcode],
          _hay: fold(`${naam} ${merk || ''}`),
          _naam: fold(naam),
        }
      })
      offNlBarcode = new Map(offNl.map((p) => [p.barcode, p]))
    } catch {
      offNl = [] // geen lijst of offline zonder cache: dan alleen live zoeken
    }
    return offNl
  })()
  return offNlPromise
}

// Zoekresultaten van Open Food Facts: per zoekterm onthouden (zolang de app open is) en met een rem
// op het aantal automatische zoekopdrachten (Open Food Facts staat er 10 per minuut toe).
const offCache = new Map()
let offStatus = { key: '', status: '' }
const offTijden = []
const offKey = (q) => String(q || '').trim().toLowerCase().replace(/\s+/g, ' ')
function offMag(now = Date.now()) {
  while (offTijden.length && now - offTijden[0] > 60000) offTijden.shift()
  if (offTijden.length >= 6) return false
  offTijden.push(now)
  return true
}

function offBlok(q, key, off) {
  if (key.length < 3) return ''
  const kop = '<h3 class="v-offkop">Uit Open Food Facts <small class="muted">(merkproducten)</small></h3>'
  if (off.length) return kop + off.map(resultaatRij).join('')
  const st = offStatus.key === key ? offStatus.status : ''
  if (!offNl || st === 'busy') return `${kop}<p class="muted v-offstatus">Zoeken in Open Food Facts…</p>`
  if (st === 'fout' || st === 'limiet') {
    const uitleg = st === 'limiet' ? 'Even te veel zoekopdrachten achter elkaar.' : `${esc(offStatus.melding || 'Open Food Facts is nu niet bereikbaar')}.`
    return `${kop}<p class="muted v-offstatus">${uitleg}</p><button type="button" class="btn block v-offzoek" data-s="off">🔎 Opnieuw zoeken in Open Food Facts</button>`
  }
  return `${kop}<p class="muted v-offstatus">Niets gevonden in Open Food Facts voor "${esc(q)}". Scan de barcode of het etiket.</p>`
}

function bronLabel(p) {
  if (p.bron === 'nevo') return 'NEVO'
  if (p.bron === 'usda') return NEVO_PRODUCTEN.length ? 'Basisproduct (USDA, aanvulling op NEVO)' : 'Basisproduct'
  if (p.bron === 'off') return 'Open Food Facts'
  if (p.bron === 'recept') return `Recept${p.portie ? ` · portie ${fmt(p.portie.g)} g` : ''}`
  if (p.bron === 'eigen') return 'Eigen product'
  return ''
}

async function bewaarProduct(p) {
  const rec = { ...p, updatedAt: Date.now() }
  delete rec.laatsteGram
  delete rec._hay
  delete rec._naam
  await db.zet('producten', rec)
  producten = await db.alle('producten')
}

// ---------- Venster: hoeveelheid ----------

function openHoeveelheid(product, { meal, regel, gram } = {}) {
  const unit = product.eenheid === 'ml' ? 'ml' : 'g'
  const startGram = regel?.grams ?? gram ?? product.portie?.g ?? 100
  const fav = inst.favorieten.includes(product.id)
  const kanFav = !product.id.startsWith('regel:')
  const porties = [
    product.portie ? [product.portie.g, product.portie.naam] : null,
    [100, `100 ${unit}`],
  ].filter(Boolean)
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>${esc(product.naam)}${product.merk ? ` <small class="muted">${esc(product.merk)}</small>` : ''}</h2>
      <p class="muted">${bronLabel(product)} · per 100 ${unit}: ${fmt(product.per100?.kcal)} kcal · E ${fmt(product.per100?.eiwit, 1)} · K ${fmt(product.per100?.kh, 1)} · V ${fmt(product.per100?.vet, 1)}${product.per100?.vezel == null ? '' : ` · Vz ${fmt(product.per100.vezel, 1)}`}</p>
      <label class="field">Hoeveel (${unit})<input name="gram" inputmode="decimal" value="${fmt(startGram, 1).replace(/\./g, '')}" required autocomplete="off" /></label>
      <div class="v-chips">${porties.map(([g, l]) => `<button type="button" class="btn" data-h="portie" data-g="${g}">${esc(l)}</button>`).join('')}</div>
      <div class="v-live" id="v-live"></div>
      <label class="field">Maaltijd
        <select name="meal">${momenten().map((m) => `<option value="${esc(m.id)}" ${m.id === meal ? 'selected' : ''}>${esc(m.naam)}</option>`).join('')}</select>
      </label>
      ${kanFav ? `<label class="v-check"><input type="checkbox" name="fav" ${fav ? 'checked' : ''} /> ☆ Favoriet</label>` : ''}
      <div class="actions">
        ${regel ? '<button type="button" class="btn danger" data-h="wis">Verwijderen</button>' : ''}
        <button type="submit" class="btn primary">${regel ? 'Opslaan' : 'Toevoegen'}</button>
      </div>
      ${product.bron === 'off' ? '<p class="muted v-bron">Productgegevens: Open Food Facts (ODbL)</p>' : product.bron === 'nevo' && NEVO_BRON ? `<p class="muted v-bron">${esc(NEVO_BRON)}</p>` : ''}
    </form>`,
    (fd) => {
      const g = num(fd.get('gram'))
      if (!g || g > 10000) {
        ctx.showToast('Vul een hoeveelheid in')
        return false
      }
      if (kanFav) {
        const wil = fd.get('fav') === 'on'
        inst.favorieten = inst.favorieten.filter((id) => id !== product.id)
        if (wil) inst.favorieten.unshift(product.id)
        bewaarInst()
      }
      bewaarRegel(product, { grams: g, meal: fd.get('meal'), regel }).then(() => {
        if (!regel) ctx.showToast(`${product.naam} toegevoegd 💛`)
      })
    },
  )
  const sheet = ctx.sheet
  const input = sheet.querySelector('input[name="gram"]')
  const live = () => {
    const m = macrosVoor(product.per100, num(input.value))
    sheet.querySelector('#v-live').innerHTML = `<strong>${fmt(m.kcal)} kcal</strong><span>Eiwit ${fmt(m.eiwit, 1)} g</span><span>Koolh. ${fmt(m.kh, 1)} g</span><span>Vet ${fmt(m.vet, 1)} g</span><span>Vezel ${fmt(m.vezel, 1)} g</span>`
  }
  input.addEventListener('input', live)
  sheet.addEventListener('click', (e) => {
    const el = e.target.closest('[data-h]')
    if (!el) return
    if (el.dataset.h === 'portie') {
      input.value = String(el.dataset.g).replace('.', ',')
      live()
    } else if (el.dataset.h === 'wis' && regel) {
      ctx.closeSheet()
      verwijderRegel(regel)
    }
  })
  live()
  // Geen toetsenbord vanzelf; tik je in het veld, dan staat het getal meteen geselecteerd.
  input.addEventListener('focus', () => input.select())
}

// ---------- Scannen en barcodes ----------

async function openScanner(meal) {
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>Barcode scannen</h2>
      <div class="v-video"><video muted playsinline></video><div class="v-aim" aria-hidden="true"></div></div>
      <p class="muted" id="v-scanmsg">Camera starten…</p>
      <div class="actions">
        <button type="button" class="btn" data-c="intypen">Barcode intypen</button>
        <button type="submit" class="btn">Annuleren</button>
      </div>
    </form>`,
    () => {},
  )
  const sheet = ctx.sheet
  let stop = null
  sheet.addEventListener('close', () => stop?.(), { once: true })
  sheet.querySelector('[data-c="intypen"]').addEventListener('click', () => {
    stop?.()
    openBarcodeIntypen(meal)
  })
  try {
    const { startScanner } = await import('./scanner.js')
    stop = await startScanner(sheet.querySelector('video'), ({ code, format }) => vindBarcode(code, meal, format))
    const msg = sheet.querySelector('#v-scanmsg')
    if (msg) msg.textContent = 'Richt de camera op de streepjescode.'
    if (!sheet.open) stop()
  } catch (err) {
    const msg = sheet.querySelector('#v-scanmsg')
    if (msg) msg.textContent = err?.message || 'De camera start niet. Typ de barcode in.'
  }
}

function openBarcodeIntypen(meal) {
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>Barcode intypen</h2>
      <label class="field">De cijfers onder de streepjes<input name="code" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" required /></label>
      <div class="actions"><button type="submit" class="btn primary">Zoeken</button></div>
    </form>`,
    (fd) => {
      const code = normaliseerBarcode(fd.get('code'))
      if (!code) {
        ctx.showToast('Deze barcode klopt niet. Controleer de cijfers.')
        return false
      }
      vindBarcode(code, meal)
      return false
    },
  )
  setTimeout(() => ctx.sheet.querySelector('input')?.focus(), 50)
}

async function vindBarcode(raw, meal, format) {
  const code = normaliseerBarcode(raw, format)
  if (!code) {
    ctx.showToast('Deze barcode wordt niet herkend. Typ hem in of probeer opnieuw.')
    return
  }
  const lokaal = await db.productOpBarcode(code)
  if (lokaal) return openHoeveelheid(lokaal.bron === 'recept' ? receptAlsProduct(lokaal) : lokaal, { meal })
  // Dan de Nederlandse Open Food Facts-lijst (werkt ook offline).
  await laadOffNl()
  const uitLijst = offNlBarcode.get(code)
  if (uitLijst) {
    await bewaarProduct(uitLijst)
    return openHoeveelheid(uitLijst, { meal })
  }
  try {
    ctx.showToast('Product opzoeken…')
    const r = await zoekBarcode(inst, code)
    if (r.product) {
      await bewaarProduct(r.product)
      return openHoeveelheid(r.product, { meal })
    }
    ctx.showToast('Onbekend product. Neem het etiket over, dan kent Tarapp hem voortaan 💛')
  } catch (err) {
    ctx.showToast(err?.status === 429 ? err.message : 'Opzoeken lukt nu niet (geen verbinding?). Neem het etiket over.')
  }
  openProductForm(null, { meal, barcode: code })
}

// ---------- Eigen product ----------

function openProductForm(product, { meal, barcode, naam, scan = false } = {}) {
  const p = product || { naam: naam || '', per100: per100(), eenheid: 'g', barcode: barcode || null }
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>${product ? 'Product aanpassen' : 'Eigen product'}</h2>
      ${barcode && !product ? `<p class="muted">Barcode ${esc(barcode)} is nog onbekend. Scan het etiket of neem de waarden per 100 g of 100 ml over.</p>` : ''}
      <button type="button" class="btn block v-etiket" data-p="etiket">🏷️ Etiket scannen</button>
      <input type="file" accept="image/*" capture="environment" id="v-etiket-foto" hidden />
      <p class="v-etiket-status" id="v-etiket-status" hidden></p>
      <label class="field">Naam<input name="naam" value="${esc(p.naam)}" required maxlength="200" /></label>
      <label class="field">Merk (optioneel)<input name="merk" value="${esc(p.merk || '')}" maxlength="100" /></label>
      <div class="segmented" role="radiogroup" aria-label="Eenheid">
        <button type="button" data-p="eenheid" data-u="g" class="${p.eenheid !== 'ml' ? 'on' : ''}">Per 100 g</button>
        <button type="button" data-p="eenheid" data-u="ml" class="${p.eenheid === 'ml' ? 'on' : ''}">Per 100 ml</button>
      </div>
      <input type="hidden" name="eenheid" value="${p.eenheid === 'ml' ? 'ml' : 'g'}" />
      <div class="row">
        <label class="field">Energie<input name="energie" inputmode="decimal" value="${p.per100.kcal ?? ''}" /></label>
        <label class="field">in<select name="eunit"><option value="kcal">kcal</option><option value="kj">kJ</option></select></label>
        <label class="field">Eiwit (g)<input name="eiwit" inputmode="decimal" value="${p.per100.eiwit ?? ''}" /></label>
        <label class="field">Koolhydraten (g)<input name="kh" inputmode="decimal" value="${p.per100.kh ?? ''}" /></label>
        <label class="field">Vet (g)<input name="vet" inputmode="decimal" value="${p.per100.vet ?? ''}" /></label>
        <label class="field">Vezel (g)<input name="vezel" inputmode="decimal" value="${p.per100.vezel ?? ''}" /></label>
        <label class="field">Portie (optioneel)<input name="portie" inputmode="decimal" value="${p.portie?.g ?? ''}" placeholder="bijv. 30" /></label>
      </div>
      <label class="field">Barcode (optioneel)<input name="barcode" inputmode="numeric" value="${esc(p.barcode || '')}" /></label>
      <p class="muted">Leeg laten mag: een onbekende waarde telt als onbekend, niet als 0.</p>
      <button type="submit" class="btn primary block">${meal ? 'Opslaan en toevoegen' : 'Opslaan'}</button>
    </form>`,
    (fd) => {
      const n = String(fd.get('naam') || '').trim()
      if (!n) return false
      const code = String(fd.get('barcode') || '').trim()
      const bc = code ? normaliseerBarcode(code) : null
      if (code && !bc) {
        ctx.showToast('Deze barcode klopt niet. Controleer de cijfers of laat hem leeg.')
        return false
      }
      const e = num(fd.get('energie'))
      const eenheid = fd.get('eenheid') === 'ml' ? 'ml' : 'g'
      const portie = num(fd.get('portie'))
      const nieuw = {
        id: product?.id || `eigen:${uid()}`,
        naam: n,
        merk: String(fd.get('merk') || '').trim() || null,
        per100: { kcal: e === null ? null : round(fd.get('eunit') === 'kj' ? kjNaarKcal(e) : e, 1), eiwit: num(fd.get('eiwit')), kh: num(fd.get('kh')), vet: num(fd.get('vet')), vezel: num(fd.get('vezel')) },
        eenheid,
        portie: portie ? { g: portie, naam: `1 portie (${fmt(portie)} ${eenheid})` } : null,
        bron: 'eigen',
        barcode: bc,
      }
      bewaarProduct(nieuw).then(() => {
        if (meal) openHoeveelheid(nieuw, { meal })
        else {
          ctx.showToast('Product opgeslagen 💛')
          teken()
        }
      })
      return !meal
    },
  )
  const sheet = ctx.sheet
  const zetEenheid = (u) => {
    sheet.querySelectorAll('[data-p="eenheid"]').forEach((b) => b.classList.toggle('on', b.dataset.u === u))
    sheet.querySelector('input[name="eenheid"]').value = u
  }
  const foto = sheet.querySelector('#v-etiket-foto')
  sheet.addEventListener('click', (e) => {
    const el = e.target.closest('[data-p]')
    if (!el) return
    if (el.dataset.p === 'eenheid') zetEenheid(el.dataset.u)
    if (el.dataset.p === 'etiket') foto.click()
  })
  foto.addEventListener('change', () => {
    const file = foto.files?.[0]
    foto.value = ''
    if (file) scanEtiket(file, sheet, zetEenheid)
  })
  // Vanuit "Toevoegen": meteen de camera openen (nog binnen dezelfde tik).
  if (scan) foto.click()
}

/** Foto van het etiket lezen en de gevonden waarden in het formulier zetten; jij kijkt ze na. */
async function scanEtiket(file, sheet, zetEenheid) {
  const status = sheet.querySelector('#v-etiket-status')
  const knop = sheet.querySelector('[data-p="etiket"]')
  const toon = (html, cls = '') => {
    status.hidden = false
    status.className = `v-etiket-status ${cls}`
    status.innerHTML = html
  }
  knop.disabled = true
  toon('Etiket lezen… 0%')
  try {
    const { leesEtiket } = await import('./ocr.js')
    const { waarden: w } = await leesEtiket(file, (f) => toon(`Etiket lezen… ${Math.round(f * 100)}%`))
    if (!sheet.open) return
    const zet = (name, v) => {
      if (v === null || v === undefined) return false
      const el = sheet.querySelector(`[name="${name}"]`)
      el.value = String(v).replace('.', ',')
      el.classList.add('v-ingevuld')
      return true
    }
    sheet.querySelector('select[name="eunit"]').value = 'kcal'
    const gevonden = [zet('energie', w.kcal) && 'kcal', zet('eiwit', w.eiwit) && 'eiwit', zet('kh', w.kh) && 'koolhydraten', zet('vet', w.vet) && 'vet'].filter(Boolean)
    zet('vezel', w.vezel)
    zet('portie', w.portie)
    zetEenheid(w.eenheid)
    if (!gevonden.length) toon('Er is niets herkend. Probeer een scherpere foto, recht van voren en met goed licht, of vul de waarden zelf in.', 'warn')
    else {
      const mist = ['kcal', 'eiwit', 'koolhydraten', 'vet'].filter((x) => !gevonden.includes(x))
      const check = w.controle === false ? ' ⚠️ De kcal passen niet goed bij de macro\'s; kijk de getallen na.' : ''
      toon(`✓ Ingevuld uit het etiket: ${gevonden.join(', ')} (per 100 ${w.eenheid}).${mist.length ? ` Niet gevonden: ${mist.join(', ')}.` : ''}${check} Controleer de waarden voor je opslaat.`, w.controle === false || mist.length ? 'warn' : 'ok')
    }
  } catch {
    if (sheet.open) toon('Het etiket lezen lukte niet (scanner kon niet laden?). Vul de waarden zelf in.', 'warn')
  } finally {
    knop.disabled = false
  }
}

async function wisProduct(id) {
  const p = productVanId(id)
  if (!p || !confirm(`"${p.naam}" verwijderen? Wat je er al mee in je dagboek zette, blijft staan.`)) return
  await db.wis('producten', id)
  producten = await db.alle('producten')
  inst.favorieten = inst.favorieten.filter((x) => x !== id)
  inst.vasteItems = inst.vasteItems.filter((x) => x.productId !== id)
  bewaarInst()
  teken()
}

// ---------- Recepten ----------

function openRecept(recept) {
  const r = recept ? structuredClone(recept) : { id: `recept:${uid()}`, naam: '', porties: 1, ingredienten: [], bron: 'recept', eenheid: 'g' }
  const tekenIngr = () => {
    const w = receptWaarden(r)
    ctx.sheet.querySelector('#v-ingr').innerHTML =
      (r.ingredienten
        .map(
          (i, n) => `
        <div class="v-ingr">
          <span class="grow">${esc(i.naam)}</span>
          <input aria-label="Gram ${esc(i.naam)}" inputmode="decimal" data-i="${n}" value="${fmt(i.gram, 1).replace(/\./g, '')}" />
          <span class="muted">g</span>
          <button type="button" class="btn danger" data-r="weg" data-i="${n}" aria-label="${esc(i.naam)} weghalen">✕</button>
        </div>`,
        )
        .join('') || '<p class="muted">Voeg ingrediënten toe met de zoekbalk hieronder.</p>') +
      `<p class="v-live"><strong>${fmt(w.perPortie.kcal)} kcal per portie</strong><span>E ${fmt(w.perPortie.eiwit, 1)} g</span><span>K ${fmt(w.perPortie.kh, 1)} g</span><span>V ${fmt(w.perPortie.vet, 1)} g</span><span>Vz ${fmt(w.perPortie.vezel, 1)} g</span><span class="muted">portie ${fmt(w.portieGram)} g</span></p>`
  }
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>${recept ? 'Recept aanpassen' : 'Nieuw recept'}</h2>
      <div class="row">
        <label class="field">Naam<input name="naam" value="${esc(r.naam)}" required maxlength="200" /></label>
        <label class="field">Aantal porties<input name="porties" inputmode="numeric" value="${r.porties}" required /></label>
      </div>
      <div id="v-ingr"></div>
      <input type="search" class="v-search" placeholder="Ingrediënt zoeken…" autocomplete="off" />
      <div class="v-results" id="v-ingr-zoek"></div>
      <button type="submit" class="btn primary block">Recept opslaan</button>
    </form>`,
    (fd) => {
      r.naam = String(fd.get('naam') || '').trim()
      r.porties = Math.max(1, Math.round(num(fd.get('porties')) || 1))
      if (!r.naam || !r.ingredienten.length) {
        ctx.showToast('Geef het recept een naam en minstens één ingrediënt')
        return false
      }
      bewaarProduct({ ...r, bron: 'recept' }).then(() => {
        ctx.showToast('Recept opgeslagen 🍲')
        teken()
      })
    },
  )
  const sheet = ctx.sheet
  const zoekIn = sheet.querySelector('.v-search')
  const res = sheet.querySelector('#v-ingr-zoek')
  let gevonden = []
  zoekIn.addEventListener('input', () => {
    gevonden = zoek(
      alleProducten().filter((p) => p.bron !== 'recept'),
      zoekIn.value,
      8,
    )
    res.innerHTML = gevonden.map((p) => `<button type="button" class="v-result" data-r="plus" data-id="${esc(p.id)}"><span>${esc(p.naam)}${p.merk ? ` <small class="muted">${esc(p.merk)}</small>` : ''}</span><span class="v-kcal">+</span></button>`).join('')
  })
  sheet.addEventListener('click', (e) => {
    const el = e.target.closest('[data-r]')
    if (!el) return
    if (el.dataset.r === 'plus') {
      const p = gevonden.find((x) => x.id === el.dataset.id)
      if (!p) return
      r.ingredienten.push({ productId: p.id, naam: p.naam, gram: p.portie?.g || 100, per100: per100(p.per100) })
      zoekIn.value = ''
      res.innerHTML = ''
      tekenIngr()
    } else if (el.dataset.r === 'weg') {
      r.ingredienten.splice(Number(el.dataset.i), 1)
      tekenIngr()
    }
  })
  sheet.addEventListener('input', (e) => {
    if (e.target.dataset.i === undefined) return
    r.ingredienten[Number(e.target.dataset.i)].gram = num(e.target.value) || 0
    const w = receptWaarden(r)
    const live = sheet.querySelector('#v-ingr .v-live')
    if (live) live.innerHTML = `<strong>${fmt(w.perPortie.kcal)} kcal per portie</strong><span>E ${fmt(w.perPortie.eiwit, 1)} g</span><span>K ${fmt(w.perPortie.kh, 1)} g</span><span>V ${fmt(w.perPortie.vet, 1)} g</span><span>Vz ${fmt(w.perPortie.vezel, 1)} g</span><span class="muted">portie ${fmt(w.portieGram)} g</span>`
  })
  tekenIngr()
}

// ---------- Eetmomenten aanpassen ----------

let momentenConcept = null // werkversie tijdens het aanpassen; pas bij "Opslaan" bewaard

function momentenLijst() {
  momentenConcept ||= momenten().map((m) => ({ ...m }))
  return momentenConcept
    .map(
      (m, i) => `
    <div class="v-moment">
      <input name="naam" aria-label="Naam eetmoment" value="${esc(m.naam)}" maxlength="40" placeholder="Bijv. Na de training" />
      <select name="soort" aria-label="Soort voor Healthbridge">${MEALS.map((k) => `<option value="${k}" ${k === m.soort ? 'selected' : ''}>${MEAL_NL[k]}</option>`).join('')}</select>
      <button type="button" class="btn" data-v="moment-op" data-i="${i}" aria-label="${esc(m.naam)} omhoog" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="btn danger" data-v="moment-weg" data-i="${i}" aria-label="${esc(m.naam)} verwijderen" ${momentenConcept.length <= 1 ? 'disabled' : ''}>✕</button>
    </div>`,
    )
    .join('')
}

/** Wat er in het formulier staat terug in de werkversie zetten (zodat getypte namen blijven). */
function leesMomentenForm() {
  const rijen = root.querySelectorAll('#v-momenten .v-moment')
  rijen.forEach((rij, i) => {
    if (!momentenConcept[i]) return
    momentenConcept[i].naam = rij.querySelector('[name="naam"]').value
    momentenConcept[i].soort = rij.querySelector('[name="soort"]').value
  })
}

function wijzigMomenten(actie, i) {
  leesMomentenForm()
  if (actie === 'moment-op' && i > 0) [momentenConcept[i - 1], momentenConcept[i]] = [momentenConcept[i], momentenConcept[i - 1]]
  if (actie === 'moment-weg' && momentenConcept.length > 1) momentenConcept.splice(i, 1)
  if (actie === 'moment-nieuw') momentenConcept.push({ id: `m-${uid().slice(0, 8)}`, naam: '', soort: 'snack' })
  root.querySelector('#v-momenten-lijst').innerHTML = momentenLijst()
  if (actie === 'moment-nieuw') root.querySelector('#v-momenten .v-moment:last-child [name="naam"]')?.focus()
}

function bewaarMomenten(e) {
  e.preventDefault()
  leesMomentenForm()
  if (momentenConcept.some((m) => !m.naam.trim())) {
    ctx.showToast('Geef elk eetmoment een naam')
    return
  }
  const weg = momenten().filter((m) => !momentenConcept.some((c) => c.id === m.id) && regels.concat(alleRegels).some((r) => !r.deleted && r.moment === m.id))
  if (weg.length && !confirm(`Wat al bij ${weg.map((m) => m.naam).join(', ')} staat, komt bij een ander eetmoment van dezelfde soort. Doorgaan?`)) return
  inst.momenten = db.schoonMomenten(momentenConcept)
  momentenConcept = null
  bewaarInst()
  laadRegels().then(() => {
    ctx.showToast('Eetmomenten opgeslagen 🍽️')
    naarPagina('dag')
  })
}

/** Eetmoment in- of uitklappen, of de macro's ervan tonen; per eetmoment onthouden. */
function wisselWeergave(soort, meal) {
  const lijst = inst.weergave[soort]
  inst.weergave[soort] = lijst.includes(meal) ? lijst.filter((x) => x !== meal) : [...lijst, meal]
  bewaarInst()
  teken()
}

// ---------- Maaltijd van de vorige dag ----------

function vorigeMaaltijd(meal) {
  const prev = verschuif(dag, -1)
  return alleRegels.filter((r) => r.date === prev && momentVan(r) === meal && !r.deleted)
}

async function kopieerMaaltijd(meal) {
  const bron = vorigeMaaltijd(meal)
  if (!bron.length) return
  const nu = Date.now()
  const tijd = isVandaag() ? tijdAmsterdam() : MEAL_TIJD[soortVan(meal)]
  const nieuw = bron.map((r, i) => ({ ...r, id: uid(), date: dag, time: tijd, moment: meal, meal: soortVan(meal), updatedAt: nu + i, dirty: 1 }))
  await db.zetVeel('dagboek', nieuw)
  await laadRegels()
  teken()
  syncStraks(inst)
  ctx.showToast(`${naamVan(meal)} van ${dagLabel(verschuif(dag, -1)).toLowerCase()} overgenomen (${nieuw.length}) ↺`, async () => {
    const t = Date.now()
    await db.zetVeel('dagboek', nieuw.map((r, i) => ({ id: r.id, date: r.date, updatedAt: t + i, deleted: true, dirty: 1 })))
    await laadRegels()
    teken()
    syncStraks(inst)
  })
}

// ---------- Vaste items en dag kopiëren ----------

function openVasteItems() {
  const items = inst.vasteItems
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>⭐ Vaste items</h2>
      <p class="muted">Wat je (bijna) elke dag eet, met één tik aan de dag toevoegen.</p>
      ${
        items.length
          ? items
              .map(
                (it, n) => `
        <label class="v-check v-vast"><input type="checkbox" name="i${n}" checked /> <span class="grow">${esc(it.naam)} <small class="muted">${gramTekst(it.grams, it.unit)} · ${esc(naamVan(it.meal).toLowerCase())}</small></span></label>`,
              )
              .join('')
          : '<p class="muted">Nog geen vaste items. Zet je dag zoals je hem vaak eet en neem hem hieronder over.</p>'
      }
      <div class="actions">
        ${items.length ? '<button type="submit" class="btn primary">Toevoegen aan deze dag</button>' : ''}
      </div>
      <button type="button" class="btn block" data-f="neem" ${regels.length ? '' : 'disabled'}>${items.length ? 'Vervangen door' : 'Overnemen van'} ${esc(dagLabel(dag).toLowerCase())} (${regels.length})</button>
    </form>`,
    (fd) => {
      const kies = items.filter((_, n) => fd.get(`i${n}`) === 'on')
      ;(async () => {
        for (const it of kies) {
          const p = productVanId(it.productId)
          const prod = p ? (p.bron === 'recept' ? receptAlsProduct(p) : p) : { id: it.productId, naam: it.naam, merk: it.merk, per100: it.per100, eenheid: it.unit, bron: it.source, barcode: it.barcode }
          await bewaarRegel(prod, { grams: it.grams, meal: momentInfo(it.meal) ? it.meal : momentVan({ meal: it.meal }) })
        }
        if (kies.length) ctx.showToast(`${kies.length} vaste ${kies.length === 1 ? 'item' : 'items'} toegevoegd ⭐`)
      })()
    },
  )
  ctx.sheet.querySelector('[data-f="neem"]').addEventListener('click', () => {
    inst.vasteItems = regels.map((r) => ({ productId: r.productId || `regel:${r.id}`, naam: r.name, merk: r.brand, grams: r.grams, unit: r.unit, meal: momentVan(r), per100: r.per100, source: r.source, barcode: r.barcode }))
    bewaarInst()
    ctx.closeSheet()
    ctx.showToast('Vaste items opgeslagen ⭐')
  })
}

function openKopieer() {
  const gisteren = verschuif(dag, -1)
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>📋 Dag kopiëren</h2>
      <p class="muted">Zet alles van een andere dag ook op ${esc(dagLabel(dag).toLowerCase())}.</p>
      <label class="field">Van welke dag?<input type="date" name="van" value="${gisteren}" max="${vandaagKey()}" required /></label>
      <button type="submit" class="btn primary block">Kopiëren</button>
    </form>`,
    (fd) => {
      const van = String(fd.get('van') || '')
      const bron = alleRegels.filter((r) => r.date === van && !r.deleted)
      if (van === dag || !bron.length) {
        ctx.showToast(van === dag ? 'Kies een andere dag' : 'Die dag is leeg')
        return false
      }
      ;(async () => {
        const nu = Date.now()
        const nieuw = bron.map((r, i) => ({ ...r, id: uid(), date: dag, updatedAt: nu + i, dirty: 1 }))
        await db.zetVeel('dagboek', nieuw)
        await laadRegels()
        teken()
        syncStraks(inst)
        ctx.showToast(`${nieuw.length} ${nieuw.length === 1 ? 'regel' : 'regels'} gekopieerd 📋`)
      })()
    },
  )
}

// ---------- Healthbridge en apparaten ----------

async function koppel() {
  let link
  try {
    link = await koppelHealthbridge(inst)
  } catch (err) {
    ctx.showToast(err?.status ? err.message : err?.message?.startsWith('Zet') || err?.message?.startsWith('Kies') ? err.message : 'De sync-server is niet bereikbaar. Probeer het straks opnieuw.')
    return
  }
  const u = new URL(link)
  vSheet(
    `
    <form method="dialog" class="v-sheet">
      <h2>🔗 Koppel met Healthbridge</h2>
      <p class="muted">Tik hieronder op de telefoon waar Healthbridge op staat. Healthbridge vraagt dan of het Tarapp mag koppelen; tik op <strong>Koppelen</strong>. Klaar!</p>
      <a class="btn primary block v-hblink" href="${esc(link)}">Open Healthbridge</a>
      <details class="v-details">
        <summary>Werkt de knop niet?</summary>
        <p class="muted">Open Healthbridge → Instellingen → Tarapp en vul dit in:</p>
        <label class="field">Adres<input readonly value="${esc(u.searchParams.get('url'))}" /></label>
        <label class="field">Lees-code<input readonly value="${esc(u.searchParams.get('token'))}" /></label>
        <p class="muted">Deze code geeft alleen leestoegang tot je voedingsdagboek. Koppel je opnieuw, dan vervalt de oude code.</p>
      </details>
      <button type="submit" class="btn block">Sluiten</button>
    </form>`,
    () => {},
  )
}

async function deelApparaat() {
  try {
    await syncNu(inst)
  } catch {
    // status staat in syncStatus
  }
  const link = apparaatLink(`${location.origin}${location.pathname}`)
  if (!link) {
    ctx.showToast('Eerst synchroniseren lukt nog niet. Controleer je internet.')
    return
  }
  const tekst = 'Open deze link op je andere telefoon of tablet om je voedingsdagboek daar ook te zien:'
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Tarapp Voeding', text: tekst, url: link })
      return
    } catch (err) {
      if (err?.name === 'AbortError') return
    }
  }
  try {
    await navigator.clipboard.writeText(link)
    ctx.showToast('Link gekopieerd. Open hem op je andere apparaat 🔗')
  } catch {
    prompt(tekst, link)
  }
}

async function wisAlles() {
  if (!confirm('Alle voedingsgegevens van deze telefoon wissen (dagboek, eigen producten, recepten)? Dit kan niet ongedaan worden gemaakt. Maak eerst een back-up als je twijfelt.')) return
  await db.wisAlles()
  localStorage.removeItem(db.LS.instellingen)
  localStorage.removeItem(db.LS.sync)
  inst = db.leesInstellingen()
  producten = []
  await laadRegels()
  pagina = 'dag'
  teken()
}
