// Graaf en router in een Web Worker (snelheid, stap 4). Het zware rekenwerk (kaarttegels lezen, de
// graaf bouwen, rondjes en routes zoeken) gebeurt buiten de pagina, zodat de kaart en de knoppen
// blijven reageren. Stop breekt de worker echt af (terminate). Zonder Worker (Node: tests en
// benchmarks) gebeurt hetzelfde gewoon hier, met dezelfde aanroepen.
import * as G from './graaf.js'
import * as M from './meting.js'
import * as BG from './blokgraaf.js'

const kanWerker = () => typeof Worker !== 'undefined' && typeof window !== 'undefined' && !globalThis.__geenWerker

let werker = null
let volgnummer = 0
const open = new Map() // id -> {klaar, fout, voortgang}
let tegelLezer = null // haalTegelsRuw uit bronnen.js (voor zonder worker); bronnen.js zet hem

export function zetTegelLezer(fn) {
  tegelLezer = fn
}
let blokLezer = null // haalBlokkenRuw uit bronnen.js (vooraf bewerkte graaf)
export function zetBlokLezer(fn) {
  blokLezer = fn
}

function afgebroken() {
  return new DOMException('Gestopt', 'AbortError')
}

/** De worker stoppen; alles wat nog liep, eindigt met AbortError. Een volgende vraag start een nieuwe. */
export function stop() {
  if (werker) werker.terminate()
  werker = null
  for (const w of open.values()) w.fout(afgebroken())
  open.clear()
}

function zorgVoorWerker() {
  if (werker) return werker
  werker = new Worker(new URL('./rekenwerker.js', import.meta.url), { type: 'module' })
  werker.onmessage = ({ data }) => {
    const w = open.get(data.id)
    if (!w) return
    if (data.voortgang) return w.voortgang(...data.voortgang)
    open.delete(data.id)
    if (data.meting) M.voegBronnenToe(data.meting.bronnen)
    if (data.fout) w.fout(Object.assign(new Error(data.fout.message), data.fout))
    else w.klaar(data.uit)
  }
  werker.onerror = (e) => {
    for (const w of open.values()) w.fout(new Error(`rekenwerker: ${e.message || 'fout'}`))
    open.clear()
    werker = null
  }
  return werker
}

function vraag(taak, data, { signal, voortgang = () => {} } = {}) {
  if (signal && signal.aborted) return Promise.reject(afgebroken())
  const w = zorgVoorWerker()
  const id = ++volgnummer
  return new Promise((klaar, fout) => {
    const bijStop = () => stop()
    if (signal) signal.addEventListener('abort', bijStop, { once: true })
    const opruimen = () => signal && signal.removeEventListener('abort', bijStop)
    open.set(id, {
      klaar: (x) => { opruimen(); klaar(x) },
      fout: (x) => { opruimen(); fout(x) },
      voortgang,
    })
    w.postMessage({ id, taak, ...data })
  })
}

/** Kaarttegels ophalen en lezen. Geeft een handvat naar de elementen (die blijven in de worker). */
export async function paden(tegels, { signal, voortgang, zoom, lagen } = {}) {
  if (!kanWerker()) return { elementen: await tegelLezer(tegels, signal, voortgang, zoom ? { zoom, lagen } : {}) }
  const sjabloon = await tegelLezer.sjabloon(signal)
  return vraag('paden', { tegels, sjabloon, zoom, lagen }, { signal, voortgang })
}

/** Elementen die al in de pagina zijn (Overpass, tests): ook een handvat. */
export async function viaElementen(elementen, { signal } = {}) {
  if (!kanWerker()) return { elementen }
  return vraag('elementen', { elementen }, { signal })
}

/** De graaf bouwen. Geeft de graaf (een kopie voor de pagina, met g.__gid voor de worker). */
export async function bouw(handvat, opbouw, { signal } = {}) {
  if (handvat.elementen) return G.bouwGraaf(handvat.elementen, opbouw)
  const { gid, g } = await vraag('bouw', { handvat: handvat.handvat, opbouw }, { signal })
  Object.defineProperty(g, '__gid', { value: gid, enumerable: false })
  return g
}

/**
 * De graaf uit vooraf bewerkte blokken (graaf-proef): ophalen, lezen en samenvoegen, in de worker.
 * Meet 'blokken' (ophalen en lezen) en 'graaf' (samenvoegen) apart.
 */
export async function vooraf(urls, opbouw, { signal, tegels = null } = {}) {
  if (!kanWerker()) {
    const t0 = performance.now()
    const blokken = await blokLezer(urls, signal)
    const t1 = performance.now()
    const g = BG.bouwVoorafGraaf(blokken, opbouw, tegels)
    M.tijd('blokken', t1 - t0)
    M.tijd('graaf', performance.now() - t1)
    return g
  }
  const { gid, g, ms } = await vraag('vooraf', { urls, opbouw, tegels }, { signal })
  M.tijd('blokken', ms.blokken)
  M.tijd('graaf', ms.graaf)
  Object.defineProperty(g, '__gid', { value: gid, enumerable: false })
  return g
}

/** Een zoekfunctie uit graaf.js op de graaf: in de worker als die de graaf heeft, anders hier. */
export async function zoek(naam, g, args, { signal } = {}) {
  if (!g.__gid || !kanWerker()) return G[naam](g, ...args)
  return vraag('zoek', { naam, gid: g.__gid, args }, { signal })
}
