// Renders the Parkenjacht icon SVG to the PNG sizes iOS and the manifest need.
// Run: node scripts/gen-parken-icons.mjs
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('./parken-icon.svg', import.meta.url))
const out = fileURLToPath(new URL('../public/parken/icons/', import.meta.url))

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(src).resize(size, size).png().toFile(out + name)
}
