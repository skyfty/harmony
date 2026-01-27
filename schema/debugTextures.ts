import * as THREE from 'three'

let cachedUvDebugTexture: THREE.DataTexture | null = null

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

export type UvDebugMaterialOptions = {
  tint?: THREE.ColorRepresentation
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
  metalness?: number
  roughness?: number
}

export function createUvDebugMaterial(options: UvDebugMaterialOptions = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.tint ?? 0xffffff,
    map: getDefaultUvDebugTexture(),
    transparent: options.transparent ?? false,
    opacity: typeof options.opacity === 'number' ? options.opacity : 1,
    metalness: typeof options.metalness === 'number' ? options.metalness : 0.1,
    roughness: typeof options.roughness === 'number' ? options.roughness : 0.9,
  })

  material.side = options.side ?? THREE.DoubleSide
  material.name = 'UV Debug Material'
  material.needsUpdate = true

  return material
}
