// "Etiket scannen": foto van het voedingsetiket -> tekst (Tesseract.js, op de telefoon zelf) ->
// kcal en macro's (parseEtiket in kern.js). Pas geladen als je op "Etiket scannen" tikt.
// Alle bestanden staan in vendor/tesseract/ op onze eigen site; er gaat niets naar een externe dienst.

import { parseEtiket } from './kern.js'

const BASE = new URL('./vendor/tesseract/', import.meta.url).href

// Kleinste wasm-module met een SIMD-instructie (zelfde test als wasm-feature-detect).
function heeftSimd() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]))
  } catch {
    return false
  }
}

/** Foto verkleinen (max. 1800 px), grijs maken en het contrast wat oprekken: sneller en beter leesbaar. */
async function voorbereiden(file) {
  const bmp = await createImageBitmap(file)
  const schaal = Math.min(1, 1800 / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * schaal)
  const h = Math.round(bmp.height * schaal)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const c = canvas.getContext('2d', { willReadFrequently: true })
  c.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const img = c.getImageData(0, 0, w, h)
  const d = img.data
  let min = 255
  let max = 0
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = g
    if (g < min) min = g
    if (g > max) max = g
  }
  const span = Math.max(1, max - min)
  for (let i = 0; i < d.length; i += 4) {
    const g = ((d[i] - min) / span) * 255
    d[i] = d[i + 1] = d[i + 2] = g
  }
  c.putImageData(img, 0, 0)
  return canvas
}

/**
 * Leest een etiket. [onProgress] krijgt een getal van 0 tot 1.
 * Geeft { tekst, waarden } terug; waarden zoals parseEtiket (null = niet gevonden).
 */
export async function leesEtiket(file, onProgress = () => {}) {
  const mod = await import('./vendor/tesseract/tesseract.esm.min.js')
  const Tesseract = mod.default || mod
  const worker = await Tesseract.createWorker('nld', 1, {
    workerPath: `${BASE}worker.min.js`,
    corePath: `${BASE}${heeftSimd() ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js'}`,
    langPath: `${BASE}lang`,
    workerBlobURL: false,
    gzip: true,
    logger: (m) => {
      // Laden telt voor de eerste 40%, herkennen voor de rest.
      if (m.status === 'recognizing text') onProgress(0.4 + 0.6 * (m.progress || 0))
      else if (typeof m.progress === 'number') onProgress(0.4 * m.progress)
    },
  })
  try {
    const beeld = await voorbereiden(file)
    const { data } = await worker.recognize(beeld)
    return { tekst: data.text || '', waarden: parseEtiket(data.text || '') }
  } finally {
    await worker.terminate()
  }
}
