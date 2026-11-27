# Meegeleverde OCR (Tesseract.js) voor "Etiket scannen"

Leest de tekst van een foto van het voedingsetiket, helemaal op de telefoon (geen externe dienst).
Pas geladen als je op "Etiket scannen" tikt; de service worker bewaart de bestanden daarna voor offline gebruik.

| Bestand | Herkomst | Licentie |
|---|---|---|
| `tesseract.esm.min.js`, `worker.min.js` | npm `tesseract.js@7.0.0`, `dist/` (alleen de sourcemap-regel verwijderd) | Apache-2.0 |
| `tesseract-core-simd-lstm.js/.wasm`, `tesseract-core-lstm.js/.wasm` | npm `tesseract.js-core@7.0.0` (ongewijzigd) | Apache-2.0 |
| `lang/nld.traineddata.gz` | npm `@tesseract.js-data/nld@1.0.0`, `4.0.0_best_int/` (ongewijzigd; Tesseract-traineddata, Apache-2.0) | MIT / Apache-2.0 |

SHA-256:
- `tesseract-core-simd-lstm.wasm`: `34e8d50cac216427d86bf397d610fdd9f49492539bbcdfbfccc4eda20c810bea`
- `tesseract-core-lstm.wasm`: `66b17df6e20c5329a17ffa9c202a47eaa3e32500b253d4c7f38e7f2bc01457c3`
- `lang/nld.traineddata.gz`: `a2d904b6ddc4feb0d31ecfcd7361a554102e7aa2e278c54f4fc029e0d0815571`

`../../ocr.js` kiest de SIMD-variant als de browser die aankan, anders de gewone; de "relaxed SIMD"-variant
is bewust weggelaten (kleiner; de SIMD-variant werkt in dezelfde browsers).
