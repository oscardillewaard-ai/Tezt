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

// Reserve: ZXing naast de ingebouwde scanner. Bij gebogen of kleine barcodes (deksels, blikjes)
// leest hij vaak wat de ingebouwde niet leest.
let reservePromise = null
function reserveDetector() {
  reservePromise ||= polyfillDetector().catch(() => null)
  return reservePromise
}

// Uitsneden van het midden (rand links/rechts, boven/onder als deel van de breedte/hoogte).
// Gemeten op een echte foto van een gebogen Lidl-deksel: het hele beeld gaf niets; met 15 % van
// links en rechts eraf (en vergroot) werkte het bij elke hoogte. De rand van het deksel en de tekst
// ernaast brengen de scanner in de war.
export const UITSNEDEN = [
  [0.15, 0.18],
  [0.22, 0.26],
  [0.08, 0.26],
]

/** Uitsnede [nr] van het beeld, vergroot op een canvas als hij smal is. */
export function middenVan(bron, breedte, hoogte, canvas = document.createElement('canvas'), nr = 0) {
  const [mx, my] = UITSNEDEN[nr % UITSNEDEN.length]
  const sx = Math.round(breedte * mx)
  const sy = Math.round(hoogte * my)
  const sw = breedte - 2 * sx
  const sh = hoogte - 2 * sy
  const schaal = sw < 1000 ? 2 : 1
  canvas.width = sw * schaal
  canvas.height = sh * schaal
  const g = canvas.getContext('2d', { willReadFrequently: true })
  g.imageSmoothingQuality = 'high'
  g.drawImage(bron, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function maakDetector() {
  detectorPromise ||= (async () => {
    const eigen = await nativeDetector()
    if (eigen) return eigen
    // Geen ingebouwde scanner: ZXing is dan al de hoofdscanner, geen reserve nodig.
    reservePromise = Promise.resolve(null)
    return polyfillDetector()
  })()
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
    // Scherp beeld: liefst Full HD (standaard is vaak 640×480, te grof voor dunne streepjes).
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
  } catch (err) {
    const msg =
      err?.name === 'NotAllowedError'
        ? 'Tarapp mag de camera niet gebruiken. Sta de camera toe in de instellingen van je browser, of typ de barcode in.'
        : err?.name === 'NotFoundError'
          ? 'Geen camera gevonden. Typ de barcode in.'
          : 'De camera start niet. Typ de barcode in.'
    throw new Error(msg)
  }
  // Doorlopend scherpstellen, als de camera dat kan (vooral Android).
  try {
    const track = stream.getVideoTracks()[0]
    const kan = track.getCapabilities?.() || {}
    if (kan.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
  } catch {
    // niet elke camera kent dit
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
  let ronde = 0
  const canvas = document.createElement('canvas')
  // Om de beurt: het hele beeld, dan de uitsneden van het midden; vanaf ±1 s ook met ZXing erbij.
  const probeer = async () => {
    const stap = ronde++
    const fase = stap % (UITSNEDEN.length + 1)
    if (fase === 0) return detector.detect(video)
    const midden = middenVan(video, video.videoWidth, video.videoHeight, canvas, fase - 1)
    const codes = await detector.detect(midden)
    if (codes.length || stap < 8) return codes
    const reserve = await reserveDetector()
    return reserve ? reserve.detect(midden) : []
  }
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
        const codes = await probeer()
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
    setTimeout(tick, 120)
  }
  tick()
  return stop
}
