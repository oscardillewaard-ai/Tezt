// De rekenwerker (snelheid, stap 4): kaarttegels lezen, graaf bouwen en zoeken, buiten de pagina.
// Zie rekenen.js voor de kant van de pagina.
import * as G from './graaf.js'
import * as M from './meting.js'
import * as BG from './blokgraaf.js'
import { haalTegelsRuw, zetOfmSjabloon, haalBlokkenRuw } from './bronnen.js'

const verzamelingen = new Map() // handvat -> elementen
const grafen = new Map() // gid -> graaf
let teller = 0
const bewaar = (map, waarde, max) => {
  const id = ++teller
  map.set(id, waarde)
  while (map.size > max) map.delete(map.keys().next().value)
  return id
}

self.onmessage = async ({ data }) => {
  const { id, taak } = data
  M.reset()
  try {
    let uit
    if (taak === 'paden') {
      zetOfmSjabloon(data.sjabloon)
      const elementen = await haalTegelsRuw(data.tegels, undefined, (k, n) => self.postMessage({ id, voortgang: [k, n] }), data.zoom ? { zoom: data.zoom, lagen: data.lagen } : {})
      uit = { handvat: bewaar(verzamelingen, elementen, 3), aantal: elementen.length }
    } else if (taak === 'elementen') {
      uit = { handvat: bewaar(verzamelingen, data.elementen, 3), aantal: data.elementen.length }
    } else if (taak === 'bouw') {
      const el = verzamelingen.get(data.handvat)
      if (!el) throw new Error('rekenwerker: onbekende verzameling')
      const g = G.bouwGraaf(el, data.opbouw)
      uit = { gid: bewaar(grafen, g, 2), g }
    } else if (taak === 'vooraf') {
      const t0 = performance.now()
      const blokken = await haalBlokkenRuw(data.urls)
      const t1 = performance.now()
      const g = BG.bouwVoorafGraaf(blokken, data.opbouw, data.tegels)
      uit = { gid: bewaar(grafen, g, 2), g, ms: { blokken: t1 - t0, graaf: performance.now() - t1 } }
    } else if (taak === 'zoek') {
      const g = grafen.get(data.gid)
      if (!g) throw new Error('rekenwerker: onbekende graaf')
      uit = G[data.naam](g, ...data.args)
    } else throw new Error(`rekenwerker: onbekende taak ${taak}`)
    self.postMessage({ id, uit, meting: M.rapport() })
  } catch (fout) {
    self.postMessage({ id, fout: { name: fout.name, message: fout.message, bron: fout.bron, melding: fout.melding }, meting: M.rapport() })
  }
}
