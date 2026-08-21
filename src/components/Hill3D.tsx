import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { LocalPoint } from '../lib/hillFromGpx'
import { FLANK_COLORS, type TracedFlank } from '../lib/flankVisuals'

interface Hill3DProps {
  flanks: TracedFlank[]
  /** Vertical exaggeration — a 35 m hill over 300 m of ground is invisible at 1:1. */
  verticalScale?: number
  height?: number
}

/**
 * Builds a surface from the traced flanks by inverse-distance weighting
 * their points onto a grid. With only a handful of traces this is an
 * interpolation of where you actually ran, not a survey of the hill — it
 * reads as the right shape between the flanks and gets better the more
 * sessions (and directions) are in the data.
 */
function buildSurface(points: LocalPoint[], gridSize: number, groundZ: number) {
  const minX = Math.min(...points.map((p) => p.x))
  const maxX = Math.max(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const maxY = Math.max(...points.map((p) => p.y))
  // Pad the plane so the hill has ground to sit on rather than being cut off
  // at the outermost trace.
  const padM = Math.max(maxX - minX, maxY - minY) * 0.15
  const geo = new THREE.PlaneGeometry(
    maxX - minX + padM * 2,
    maxY - minY + padM * 2,
    gridSize,
    gridSize,
  )
  const pos = geo.attributes.position
  const offX = (minX + maxX) / 2
  const offY = (minY + maxY) / 2

  // Inverse-distance weighting with a plain 1/d^2 falloff, then a blend back
  // to ground level that fades with distance from the nearest trace. A
  // sharper falloff makes every trace read as a knife-edge ridge with flat
  // plateaus between; this keeps the slope continuous.
  const reachM = 45
  const heights = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + offX
    const wy = pos.getY(i) + offY
    let num = 0
    let den = 0
    let nearest = Infinity
    for (const p of points) {
      const d2 = (p.x - wx) ** 2 + (p.y - wy) ** 2
      if (d2 < nearest) nearest = d2
      const w = 1 / (d2 + 4)
      num += p.z * w
      den += w
    }
    const idw = den > 0 ? num / den : groundZ
    const falloff = Math.exp(-((Math.sqrt(nearest) / reachM) ** 2))
    heights[i] = groundZ + (idw - groundZ) * falloff
  }

  // A couple of box-blur passes over the grid to take the remaining
  // stair-stepping out of the surface.
  const n = gridSize + 1
  for (let pass = 0; pass < 3; pass++) {
    const src = Float32Array.from(heights)
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx
            const ny = gy + dy
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue
            sum += src[ny * n + nx]
            count++
          }
        }
        heights[gy * n + gx] = sum / count
      }
    }
  }

  for (let i = 0; i < pos.count; i++) pos.setZ(i, heights[i])
  geo.computeVertexNormals()
  return { geo, offX, offY }
}

export function Hill3D({ flanks, verticalScale = 3, height = 380 }: Hill3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const all = flanks.flatMap((f) => f.trace)
    if (all.length === 0) return

    const width = mount.clientWidth || 640
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)

    const groundZ = Math.min(...all.map((p) => p.z))
    const scaled = all.map((p) => ({ x: p.x, y: p.y, z: (p.z - groundZ) * verticalScale }))
    const { geo, offX, offY } = buildSurface(scaled, 96, 0)

    const surface = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x2f6b46,
        roughness: 0.95,
        metalness: 0,
        flatShading: false,
      }),
    )
    surface.rotation.x = 0 // geometry is already in the x/y plane with z up
    scene.add(surface)

    // Flank traces, lifted slightly so they read on top of the surface.
    flanks.forEach((f, i) => {
      const pts = f.trace.map(
        (p) =>
          new THREE.Vector3(
            p.x - offX,
            p.y - offY,
            (p.z - groundZ) * verticalScale + 1.5,
          ),
      )
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(FLANK_COLORS[i % FLANK_COLORS.length]),
        }),
      )
      scene.add(line)
    })

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(-200, -300, 400)
    scene.add(sun)

    const span = Math.max(
      Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x)),
      Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y)),
    )
    const radius = span * 1.1
    let angle = Math.PI * 0.25
    let elevationAngle = 0.7
    let dragging = false
    let lastX = 0
    let lastY = 0

    function place() {
      camera.position.set(
        Math.cos(angle) * radius * Math.cos(elevationAngle),
        Math.sin(angle) * radius * Math.cos(elevationAngle),
        radius * Math.sin(elevationAngle),
      )
      camera.up.set(0, 0, 1)
      camera.lookAt(0, 0, 0)
    }
    place()

    const el = renderer.domElement
    el.style.touchAction = 'none'
    const down = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      angle -= (e.clientX - lastX) * 0.01
      elevationAngle = Math.min(1.45, Math.max(0.15, elevationAngle + (e.clientY - lastY) * 0.005))
      lastX = e.clientX
      lastY = e.clientY
      place()
      renderer.render(scene, camera)
    }
    const up = (e: PointerEvent) => {
      dragging = false
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        // pointer already released
      }
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)

    let raf = 0
    let spin = true
    const tick = () => {
      if (spin && !dragging) {
        angle += 0.0025
        place()
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()
    const stopSpin = () => {
      spin = false
    }
    el.addEventListener('pointerdown', stopSpin)

    const onResize = () => {
      const w = mount.clientWidth || width
      camera.aspect = w / height
      camera.updateProjectionMatrix()
      renderer.setSize(w, height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerdown', stopSpin)
      renderer.dispose()
      geo.dispose()
      mount.removeChild(el)
    }
  }, [flanks, verticalScale, height])

  return (
    <div>
      <div ref={mountRef} className="overflow-hidden rounded-lg bg-[var(--surface-3)]" />
      <p className="mt-2 text-xs text-[var(--faint)]">
        Sleep om te draaien. Het oppervlak is geïnterpoleerd tussen de flanken die je gelopen hebt
        (hoogte {verticalScale}× uitvergroot) — hoe meer sessies over verschillende kanten, hoe
        nauwkeuriger de vorm.
      </p>
    </div>
  )
}
