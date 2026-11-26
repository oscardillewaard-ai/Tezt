// Voeding: barcode scannen met de camera.
// - Chrome op Android heeft de Barcode Detection API zelf: die gebruiken we.
// - Safari op iOS heeft hem niet: dan laden we (pas nu) de polyfill "barcode-detector"
//   met ZXing in WebAssembly. Het .wasm-bestand staat in vendor/ op onze eigen site
//   (geen CDN) en de service worker bewaart hem voor offline gebruik.
// Faalt er iets (geen camera, geweigerd), dan krijgt de gebruiker een nette melding
// en kan hij de barcode intypen.

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']
const WASM_URL = new URL('./vendor/zxing_reader.wasm', import.meta.url).href

let detectorPromise = null

async function nativeDetector() {
  if (!('BarcodeDetector' in globalThis)) return null
  try {
    const supported = await globalThis.BarcodeDetector.getSupportedFormats()
    const formats = FORMATS.filter((f) => supported.includes(f))
    return formats.length ? new globalThis.BarcodeDetector({ formats }) : null
  } catch {
    return null
  }
}

async function polyfillDetector() {
  const mod = await import('./vendor/barcode-detector.js')
  // In vendor/barcode-detector.js heten de exports kort: t = BarcodeDetector, a = setZXingModuleOverrides.
  const BarcodeDetector = mod.BarcodeDetector || mod.t
  const setOverrides = mod.setZXingModuleOverrides || mod.a
  setOverrides({ locateFile: (path, prefix) => (path.endsWith('.wasm') ? WASM_URL : prefix + path) })
  return new BarcodeDetector({ formats: FORMATS })
}

export function maakDetector() {
  detectorPromise ||= (async () => (await nativeDetector()) || (await polyfillDetector()))()
  detectorPromise.catch(() => (detectorPromise = null))
  return detectorPromise
}

export const cameraMogelijk = () => !!navigator.mediaDevices?.getUserMedia

/**
 * Start de camera in [video] en roept [onCode]({ code, format }) aan bij de eerste
 * herkende barcode. Geeft een stop-functie terug. Gooit een Error met een
 * Nederlandse uitleg als het niet lukt.
 */
export async function startScanner(video, onCode) {
  if (!cameraMogelijk()) throw new Error('Deze browser kan de camera niet gebruiken. Typ de barcode in.')
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
  } catch (err) {
    const msg =
      err?.name === 'NotAllowedError'
        ? 'Tarapp mag de camera niet gebruiken. Sta de camera toe in de instellingen van je browser, of typ de barcode in.'
        : err?.name === 'NotFoundError'
          ? 'Geen camera gevonden. Typ de barcode in.'
          : 'De camera start niet. Typ de barcode in.'
    throw new Error(msg)
  }
  video.srcObject = stream
  video.setAttribute('playsinline', '')
  video.muted = true
  await video.play().catch(() => {})
  let detector
  try {
    detector = await maakDetector()
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('De scanner kon niet laden. Typ de barcode in.')
  }
  let stopped = false
  let busy = false
  const stop = () => {
    stopped = true
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
  }
  const tick = async () => {
    if (stopped) return
    if (!busy && video.readyState >= 2) {
      busy = true
      try {
        const codes = await detector.detect(video)
        const hit = codes.find((c) => c.rawValue)
        if (hit && !stopped) {
          try {
            navigator.vibrate?.(30)
          } catch {
            // geen trilfunctie (iPhone)
          }
          stop()
          onCode({ code: hit.rawValue, format: hit.format })
          return
        }
      } catch {
        // Eén mislukt beeldje is niet erg; volgende proberen.
      }
      busy = false
    }
    setTimeout(tick, 180)
  }
  tick()
  return stop
}
