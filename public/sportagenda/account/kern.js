// Account-sync van Tarapp: rekenkern zonder DOM of netwerk (getest in tests/account/).
//
// Alle gegevens (Tarapp zelf en Voeding) worden opgedeeld in losse "records" met een sleutel, zodat
// twee apparaten elkaars werk niet overschrijven: per record wint de nieuwste wijziging.
//   Tarapp:  s:<id> trainingen, tpl:<id> schema's, type:<id> activiteiten, ser:<id> series,
//            plan:<id> plannen, blk:<id> blokken, w:<datum> gewicht, per:<datum> ongesteld,
//            settings, volgorde:<lijst> (volgorde van een lijst), x:<sleutel> overige velden
//   Voeding: vp:<id> eigen/gescande producten en recepten, vinst instellingen, vboek dagboek-koppeling
// Het dagboek zelf synchroniseert al via de Worker (proxy/voeding/worker.js); hier alleen de koppeling.

const LIJSTEN = { sessions: 's', templates: 'tpl', types: 'type', series: 'ser', plans: 'plan', blocks: 'blk' }
const VAST = new Set(['version', 'settings', 'body', ...Object.keys(LIJSTEN)])

const heeftIds = (lijst) => Array.isArray(lijst) && lijst.every((x) => x && typeof x.id === 'string' && x.id)

/** Tarapp-state (sportagenda.v1) en Voeding naar records { sleutel: waarde }. */
export function naarRecords(state, voeding = {}) {
  const r = {}
  for (const [veld, pre] of Object.entries(LIJSTEN)) {
    const lijst = state?.[veld] || []
    if (heeftIds(lijst)) {
      for (const item of lijst) r[`${pre}:${item.id}`] = item
      r[`volgorde:${veld}`] = lijst.map((x) => x.id)
    } else r[`x:${veld}`] = lijst
  }
  for (const [datum, kg] of Object.entries(state?.body?.weights || {})) r[`w:${datum}`] = kg
  for (const datum of state?.body?.period || []) r[`per:${datum}`] = true
  if (state?.settings) r.settings = state.settings
  if (state?.version !== undefined) r['x:version'] = state.version
  for (const [k, v] of Object.entries(state || {})) if (!VAST.has(k)) r[`x:${k}`] = v
  for (const p of voeding.producten || []) if (p?.id) r[`vp:${p.id}`] = p
  if (voeding.instellingen) r.vinst = voeding.instellingen
  if (voeding.boek) r.vboek = voeding.boek
  return r
}

/** Records terug naar Tarapp-state en Voeding. Lijsten in de bewaarde volgorde; onbekende id's achteraan. */
export function uitRecords(records) {
  const state = { body: { weights: {}, period: [] } }
  const voeding = { producten: [], instellingen: null, boek: null }
  for (const [veld, pre] of Object.entries(LIJSTEN)) {
    if (records[`x:${veld}`] !== undefined) {
      state[veld] = records[`x:${veld}`]
      continue
    }
    const items = Object.entries(records)
      .filter(([k]) => k.startsWith(`${pre}:`))
      .map(([, v]) => v)
    const volgorde = records[`volgorde:${veld}`] || []
    const plek = new Map(volgorde.map((id, i) => [id, i]))
    items.sort((a, b) => (plek.has(a.id) ? plek.get(a.id) : 1e9) - (plek.has(b.id) ? plek.get(b.id) : 1e9))
    state[veld] = items
  }
  for (const [k, v] of Object.entries(records)) {
    if (k.startsWith('w:')) state.body.weights[k.slice(2)] = v
    else if (k.startsWith('per:') && v) state.body.period.push(k.slice(4))
    else if (k === 'settings') state.settings = v
    else if (k === 'x:version') state.version = v
    else if (k.startsWith('x:') && !Object.keys(LIJSTEN).includes(k.slice(2))) state[k.slice(2)] = v
    else if (k.startsWith('vp:')) voeding.producten.push(v)
    else if (k === 'vinst') voeding.instellingen = v
    else if (k === 'vboek') voeding.boek = v
  }
  state.body.period.sort()
  return { state, voeding }
}

const zelfde = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Wijzigingen ten opzichte van de laatst gesynchroniseerde stand ([schaduw]).
 * [t] is het tijdstip van de wijziging (standaard nu); gebruik t = 1 om lokale gegevens bij het
 * samenvoegen te laten verliezen van wat er al in het account staat.
 */
export function wijzigingen(huidig, schaduw, t = Date.now()) {
  const out = {}
  for (const [k, v] of Object.entries(huidig)) if (!(k in schaduw) || !zelfde(v, schaduw[k])) out[k] = { v, t }
  for (const k of Object.keys(schaduw)) if (!(k in huidig)) out[k] = { del: true, t }
  return out
}

/**
 * Wat de server terugstuurt toepassen. [huidig] is wat er nu lokaal staat, [schaduw] de vorige
 * gesynchroniseerde stand, [verstuurd] wat we net stuurden. Een lokale wijziging die na het
 * versturen nog is gemaakt (huidig ≠ wat we stuurden) blijft staan; verder wint de server.
 * Geeft de nieuwe lokale records en de nieuwe schaduw.
 */
export function pasRemoteToe(huidig, schaduw, remote, verstuurd = {}) {
  const records = { ...huidig }
  const nieuweSchaduw = { ...schaduw }
  for (const [k, v] of Object.entries(verstuurd)) {
    if (v.del) delete nieuweSchaduw[k]
    else nieuweSchaduw[k] = v.v
  }
  for (const [k, rec] of Object.entries(remote)) {
    const lokaalGewijzigd = k in huidig ? !zelfde(huidig[k], k in verstuurd ? verstuurd[k].v : schaduw[k]) : k in schaduw && !(k in verstuurd)
    if (lokaalGewijzigd) continue
    if (rec.del) {
      delete records[k]
      delete nieuweSchaduw[k]
    } else {
      records[k] = rec.v
      nieuweSchaduw[k] = rec.v
    }
  }
  return { records, schaduw: nieuweSchaduw }
}

/** Server: inkomende wijzigingen samenvoegen (per record wint het hoogste t). Geeft de nieuwe stand. */
export function voegSamenOpServer(opslag, changes) {
  const records = { ...(opslag?.records || {}) }
  let rev = Number(opslag?.rev) || 0
  for (const [k, c] of Object.entries(changes || {})) {
    if (typeof k !== 'string' || k.length > 120 || !c || typeof c !== 'object') continue
    const t = Number(c.t)
    if (!Number.isFinite(t) || t < 0) continue
    const oud = records[k]
    if (oud && oud.t > t) continue
    if (oud && oud.t === t && zelfde(oud.v, c.v) && !!oud.del === !!c.del) continue
    rev += 1
    records[k] = c.del ? { del: true, t, r: rev } : { v: c.v, t, r: rev }
  }
  return { rev, records }
}

/** Server: alle records die na [sinds] zijn veranderd. */
export function sinds(opslag, rev = 0) {
  const out = {}
  for (const [k, rec] of Object.entries(opslag?.records || {})) if (rec.r > rev) out[k] = rec
  return out
}

/** Staan er op dit apparaat gegevens die het waard zijn om over te zetten? */
export function heeftGegevens(state, voeding = {}) {
  return !!(
    state?.sessions?.length ||
    state?.series?.length ||
    state?.plans?.length ||
    state?.blocks?.length ||
    Object.keys(state?.body?.weights || {}).length ||
    state?.body?.period?.length ||
    voeding.producten?.length ||
    voeding.dagboek?.length
  )
}
