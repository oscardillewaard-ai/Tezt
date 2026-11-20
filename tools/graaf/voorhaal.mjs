// Haal alvast alle BGT-tegels en AHN-blokken voor de regio in de schijfcache (los te draaien, hervatbaar).
//   node --max-old-space-size=8000 tools/graaf/voorhaal.mjs [ofm|pbf-elementen.json]
import { haal, tegelijk, teller } from './haal.mjs'
import { laadRegio, laadElementen } from './bouw.mjs'
import * as G from '../../public/onverhard/graaf.js'
import * as K from '../../public/onverhard/kern.js'
import * as H from '../../public/onverhard/hoogte.js'
import { bgtTegelsVoorSeg, segTussen, ahnBlokVan } from './nodig.mjs'

const regio = laadRegio()
const { elementen, snap } = await laadElementen(regio, process.argv[2] || 'ofm')
const g = G.bouwGraaf(elementen, { kaartje: true, strandMijden: false, snap, metBron: true })
const bgt = new Set()
const ahn = new Map()
for (let s = 0; s < g.van.length; s++) bgtTegelsVoorSeg(g, s, K.alleenMetKaartje(g.tagLijst[g.segTags[s]]), bgt)
for (let i = 0; i < g.n; i++) { const b = ahnBlokVan(g.x[i], g.y[i]); ahn.set(b.join(','), b) }
for (let s = 0; s < g.van.length; s++) for (const [x, y] of segTussen(g, s)) { const b = ahnBlokVan(x, y); ahn.set(b.join(','), b) }
console.log('BGT-tegels', bgt.size, 'AHN-blokken', ahn.size)
const t0 = Date.now()
await tegelijk([...ahn.values()], 4, ([x0, y0]) => haal(H.ahnUrl(x0, y0), `ahn/${x0}_${y0}.tif`, { maxDagen: 365 }).catch((e) => console.log('ahn', e.message)), { naam: 'ahn', elk: 500 })
console.log('AHN klaar', (Date.now() - t0) / 1000, 's', teller)
await tegelijk([...bgt].map((k) => k.split('/').map(Number)), 4, ([col, row]) => haal(`https://api.pdok.nl/kadaster/bgt/ogc/v1/tiles/NetherlandsRDNewQuad/12/${row}/${col}?f=mvt`, `bgt/${col}_${row}.mvt`, { maxDagen: 30 }).catch((e) => console.log('bgt', e.message)), { naam: 'bgt', elk: 1000 })
console.log('BGT klaar', (Date.now() - t0) / 1000, 's', teller)
