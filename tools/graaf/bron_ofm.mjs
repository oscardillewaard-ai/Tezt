// Bron "ofm": de OpenStreetMap-kaarttegels van OpenFreeMap (zoom 14), precies wat de app nu leest.
// Geeft dezelfde elementen als de app ({type:'way', id, tags, geometry, osm}), plus stations en POI's.
import { haal, tegelijk } from './haal.mjs'
import * as T from '../../public/onverhard/osmtegels.js'

export async function ofmVersie() {
  const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json()
  return { sjabloon: tj.tiles[0], versie: tj.tiles[0].split('/').slice(-4)[0] }
}

/** Alle elementen van de tegels (zoom 14) binnen de blokken (zoom 12). */
export async function ofmElementen(blokken, { tegelijkN = 4 } = {}) {
  const { sjabloon, versie } = await ofmVersie()
  const tegels = []
  for (const [bx, by] of blokken) for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 4; dy++) tegels.push([bx * 4 + dx, by * 4 + dy])
  const lijsten = await tegelijk(tegels, tegelijkN, async ([x, y], i) => {
    const b = await haal(sjabloon.replace('{z}', 14).replace('{x}', x).replace('{y}', y), `ofm/${versie}/14/${x}/${y}.pbf`)
    return b ? T.leesOsmTegel(b, x, y, i * 1e6, { lagen: ['transportation', 'landcover', 'poi'] }) : []
  }, { naam: 'ofm-tegels' })
  return { elementen: lijsten.flat(), bron: { naam: 'OpenFreeMap (OpenStreetMap-kaarttegels, zoom 14)', versie, tegels: tegels.length } }
}
