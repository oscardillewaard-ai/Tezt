// Welke BGT-tegels en AHN-blokken de voorbewerking nodig heeft (zelfde regels als de app):
// BGT: de tegels van alle meetpunten (om de 5 m, marge SNAP_M), plus ±100 m rond het midden van afgesloten
// stukken (de natuurtoets voor de toegangskaart). AHN: de 500 m-blokken van alle knopen en tussenhoogtes.
import * as K from '../../public/onverhard/kern.js'
import * as H from '../../public/onverhard/hoogte.js'

/** Meetpunten van één segment, zoals K.meetpunten ze voor een stuk legt. */
export function segMeetpunten(g, s) {
  const a = g.van[s]
  const b = g.naar[s]
  const k = Math.max(3, Math.ceil(g.lengte[s] / K.STAP_M))
  const uit = []
  for (let j = 0; j < k; j++) {
    const f = (j + 0.5) / k
    uit.push([g.x[a] + f * (g.x[b] - g.x[a]), g.y[a] + f * (g.y[b] - g.y[a])])
  }
  return uit
}

/** Tussenhoogtes: om de 10 m vanaf 'van' (niet op de knopen zelf). */
export function segTussen(g, s) {
  const a = g.van[s]
  const b = g.naar[s]
  const l = g.lengte[s]
  const uit = []
  for (let d = 10; d < l - 0.5; d += 10) uit.push([g.x[a] + (d / l) * (g.x[b] - g.x[a]), g.y[a] + (d / l) * (g.y[b] - g.y[a])])
  return uit
}

export function bgtTegelsVoorSeg(g, s, afgesloten, set) {
  for (const [x, y] of segMeetpunten(g, s)) for (const dx of [-K.SNAP_M, 0, K.SNAP_M]) for (const dy of [-K.SNAP_M, 0, K.SNAP_M]) set.add(K.tegelVan(x + dx, y + dy).join('/'))
  if (afgesloten) {
    const mx = (g.x[g.van[s]] + g.x[g.naar[s]]) / 2
    const my = (g.y[g.van[s]] + g.y[g.naar[s]]) / 2
    for (const dx of [-100, 0, 100]) for (const dy of [-100, 0, 100]) set.add(K.tegelVan(mx + dx, my + dy).join('/'))
  }
}

export function ahnBlokVan(x, y) {
  return [Math.floor(x / H.BLOK_M) * H.BLOK_M, Math.floor(y / H.BLOK_M) * H.BLOK_M]
}
