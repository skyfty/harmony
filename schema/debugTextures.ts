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
  const majorStep = 32
  const minorStep = 8

  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    const v = size <= 1 ? 0 : y / (size - 1)
    for (let x = 0; x < size; x += 1) {
      const u = size <= 1 ? 0 : x / (size - 1)

      // Base: U -> Red, V -> Green. Slight blue bias keeps mid-tones visible.
      let r = clampByte(u * 255)
      let g = clampByte(v * 255)
      let b = 48

      const isMajor = x % majorStep === 0 || y % majorStep === 0
      const isMinor = x % minorStep === 0 || y % minorStep === 0

      if (isMajor) {
        // Bright major lines.
        r = 245
        g = 245
        b = 245
      } else if (isMinor) {
        // Subtle minor lines.
        r = clampByte(r * 0.35)
        g = clampByte(g * 0.35)
        b = clampByte(b * 0.35)
      }

      // Emphasize the origin axes.
      if (x < 2 || y < 2) {
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

export function getDefaultGridDebugTexture(): THREE.DataTexture {
  if (cachedGridDebugTexture) {
    return cachedGridDebugTexture
  }

  const size = 512
  const cells = 16
  const minorStep = size / cells
  const majorStep = minorStep * 4
  const minorLineWidth = 1
  const majorLineWidth = 2

  // Grid line shading (applied as a multiplier on top of the gradient).
  const majorMul = 0.40
  const minorMul = 0.68

  // Per-cell radial gradient (cell center -> cell edge). Strong red->blue for readability.
  const inner = { r: 250, g: 85, b: 85 }
  const outer = { r: 55, g: 80, b: 245 }

  const data = new Uint8Array(size * size * 4)

  const cellRadiusInv = 1 / Math.sqrt(0.5 * 0.5 + 0.5 * 0.5)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fx = (x % minorStep) / minorStep
      const fy = (y % minorStep) / minorStep
      const dx = fx - 0.5
      const dy = fy - 0.5
      const d = Math.sqrt(dx * dx + dy * dy) * cellRadiusInv
      const t = Math.min(1, Math.max(0, d))
      // smoothstep for nicer falloff
      const s = t * t * (3 - 2 * t)

      let r = clampByte(inner.r + (outer.r - inner.r) * s)
      let g = clampByte(inner.g + (outer.g - inner.g) * s)
      let b = clampByte(inner.b + (outer.b - inner.b) * s)

      // Stronger sculpting: center brighter, edge darker for better depth perception.
      const shade = 1.15 - 0.32 * s
      r = clampByte(r * shade)
      g = clampByte(g * shade)
      b = clampByte(b * shade)

      const mx = x % majorStep
      const my = y % majorStep
      const nx = x % minorStep
      const ny = y % minorStep

      const onMajor =
        mx < majorLineWidth ||
        mx >= majorStep - majorLineWidth ||
        my < majorLineWidth ||
        my >= majorStep - majorLineWidth
      const onMinor =
        nx < minorLineWidth ||
        nx >= minorStep - minorLineWidth ||
        ny < minorLineWidth ||
        ny >= minorStep - minorLineWidth

      if (onMajor) {
        r = clampByte(r * majorMul)
        g = clampByte(g * majorMul)
        b = clampByte(b * majorMul)
      } else if (onMinor) {
        r = clampByte(r * minorMul)
        g = clampByte(g * minorMul)
        b = clampByte(b * minorMul)
      }

      const offset = (y * size + x) * 4
      data[offset + 0] = r
      data[offset + 1] = g
      data[offset + 2] = b
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
  const style = options.style ?? 'uv'
  const map = style === 'uv' ? getDefaultUvDebugTexture() : getDefaultGridDebugTexture()

  const material = new THREE.MeshStandardMaterial({
    color: options.tint ?? 0xffffff,
    map,
    transparent: options.transparent ?? false,
    opacity: typeof options.opacity === 'number' ? options.opacity : 1,
    metalness: typeof options.metalness === 'number' ? options.metalness : 0.15,
    roughness: typeof options.roughness === 'number' ? options.roughness : 0.65,
  })

  material.side = options.side ?? THREE.DoubleSide
  material.name = style === 'uv' ? 'UV Debug Material' : 'Grid Debug Material'
  material.needsUpdate = true

  return material
}
