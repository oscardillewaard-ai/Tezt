# Meegeleverde barcode-scanner (polyfill)

Alleen gebruikt als de browser zelf geen Barcode Detection API heeft (Safari op iOS).

| Bestand | Herkomst | Licentie |
|---|---|---|
| `barcode-detector.js` | npm `barcode-detector@3.2.5`, `dist/es/zxing-exported.js` (ongewijzigd) | MIT |
| `zxing_reader.wasm` | npm `zxing-wasm@3.1.8`, `dist/reader/zxing_reader.wasm` (ongewijzigd) | MIT (zxing-cpp: Apache-2.0) |

SHA-256 van de wasm: `8451d7fe72f3d8e9ced56c7b6805e8bab88a0c218bfcd25c47c0a999e8188f3d`
(gelijk aan `ZXING_WASM_SHA256` in `barcode-detector.js`).

De wasm wordt van deze map geladen (niet van een CDN) via `setZXingModuleOverrides({ locateFile })`
in `../scanner.js`, en de service worker bewaart hem voor offline gebruik.

Bijwerken: `npm pack barcode-detector zxing-wasm`, beide bestanden vervangen, hash hierboven bijwerken.
