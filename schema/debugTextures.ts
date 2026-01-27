import * as THREE from 'three'

let cachedUvDebugTexture: THREE.DataTexture | null = null
let cachedGridDebugTexture: THREE.DataTexture | null = null

function clampByte(value: number): number {
  if (value <= 0) return 0
  if (value >= 255) return 255
  return value | 0
}

export function getDefaultUvDebugTexture(): THREE.DataTexture {
  if (cachedUvDebugTexture) {
    return cachedUvDebugTexture
  }
  const size = 256
  const borderWidth = 2

  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    const v = size <= 1 ? 0 : y / (size - 1)
    for (let x = 0; x < size; x += 1) {
      const u = size <= 1 ? 0 : x / (size - 1)

      // Base: U -> Red, V -> Green. Slight blue bias keeps mid-tones visible.
      let r = clampByte(u * 255)
      let g = clampByte(v * 255)
      let b = 48

      // Only draw the outer border lines; no interior major/minor lines.
      if (x < borderWidth || x >= size - borderWidth || y < borderWidth || y >= size - borderWidth) {
        r = 255
        g = 255
        b = 255
      }

      const offset = (y * size + x) * 4
      data[offset + 0] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = 'Harmony UV Debug Texture'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping

  // Keep the grid readable while reducing shimmer at distance.
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter

  texture.needsUpdate = true

  cachedUvDebugTexture = texture
  return texture
}

// Backward-compatible grid texture producer. Returns a simple neutral tiled texture
// (kept separate in case callers expect a grid-style texture).
export function getDefaultGridDebugTexture(): THREE.DataTexture {
  if (cachedGridDebugTexture) return cachedGridDebugTexture
  // Create a whole-texture radial gray gradient (center -> edge).
  const size = 512

  const data = new Uint8Array(size * size * 4)

  // Stronger sculpt: brighter center, darker edges.
  const inner = 252
  const outer = 70

  const cx = (size - 1) * 0.5
  const cy = (size - 1) * 0.5
  const invRadius = 1 / Math.sqrt(cx * cx + cy * cy)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy) * invRadius
      const t = Math.min(1, Math.max(0, d))
      const s = t * t * (3 - 2 * t)

      // Push contrast toward the edges (more "bevel" feel).
      const s2 = Math.pow(s, 0.75)
      let c = clampByte(inner + (outer - inner) * s2)
      const offset = (y * size + x) * 4
      data[offset + 0] = c
      data[offset + 1] = c
      data[offset + 2] = c
      data[offset + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = 'Harmony Grid Debug Texture'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true

  cachedGridDebugTexture = texture
  return texture
}

export type UvDebugMaterialOptions = {
  style?: 'grid' | 'uv'
  tint?: THREE.ColorRepresentation
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
  metalness?: number
  roughness?: number
}

export function createUvDebugMaterial(options: UvDebugMaterialOptions = {}): THREE.MeshStandardMaterial {
  const style = options.style ?? 'grid'
  const map = style === 'uv' ? getDefaultUvDebugTexture() : getDefaultGridDebugTexture()
  const material = new THREE.MeshStandardMaterial({
    color: options.tint ?? 0xffffff,
    map,
    transparent: options.transparent ?? false,
    opacity: typeof options.opacity === 'number' ? options.opacity : 1,
    metalness: typeof options.metalness === 'number' ? options.metalness : 0.15,
    roughness: typeof options.roughness === 'number' ? options.roughness : 0.55,
  })

  material.side = options.side ?? THREE.DoubleSide
  material.name = style === 'uv' ? 'UV Debug Material' : 'Grid Debug Material'
  material.needsUpdate = true

  return material
}
