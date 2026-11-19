// Hoe de ondergrond en de score in woorden op het scherm komen. Alleen presentatie: de score zelf
// (kern.js, nopavesScore) blijft zoals hij is. Overal dezelfde betekenis: 'onverhard' is alleen
// onverhard; 'half' is half verhard (grind, schelpen, puin). De score telt die twee samen.
import * as K from './kern.js'

const nl = (x, d = 0) => Number(x).toFixed(d).replace('.', ',')
const pct = (x) => nl(100 * x) + '%'

/** Aandeel onverhard en half verhard (0..1), los van elkaar. */
export function aandelen(analyse, bron = 'eind') {
  if (!analyse || !analyse.lengte) return { onverhard: 0, half: 0 }
  const v = K.kmPerKlasse(analyse, bron)
  return { onverhard: v[K.ONVERHARD] / analyse.lengte, half: v[K.HALF] / analyse.lengte }
}

/**
 * '26% onverhard · 28% half'. Afgerond zodat de twee samen het afgeronde totaal geven (dat is
 * het getal dat de score gebruikt), anders lijkt 26 + 28 ineens 55.
 */
export function ondergrondTekst(a) {
  const totaal = Math.round(100 * (a.onverhard + a.half))
  const o = Math.round(100 * a.onverhard)
  return `${o}% onverhard · ${Math.max(0, totaal - o)}% half`
}

/** Voor oude bewaarde routes die alleen het totaal kennen. */
export const totaalTekst = (zacht) => `${pct(zacht)} onverhard + half`

/** Eén regel bij de score: waar komt het getal vandaan? */
export function waaromTekst(analyse) {
  if (!analyse || !analyse.lengte) return ''
  const zacht = K.zachtAandeel(analyse, 'eind')
  const paadjes = K.paadjesAandeel(analyse)
  const stuk = K.langsteVerhardeStuk(analyse)
  const delen = [`telt vooral onverhard + half samen (${pct(zacht)})`, `paadjes ${pct(paadjes)}`, stuk >= 50 ? `langste verharde stuk ${nl(stuk / 1000, 1)} km` : 'geen lang verhard stuk']
  const min = []
  if ((analyse.dubbel || 0) >= 0.02) min.push(`${pct(analyse.dubbel)} heen en terug`)
  if (K.strandMeter(analyse) >= 100) min.push('strand')
  return `Score ${delen.join(', ')}${min.length ? `; min voor ${min.join(' en ')}` : ''}.`
}
