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
  const borderWidth = 2

  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    const v = size <= 1 ? 0 : y / (size - 1)
    for (let x = 0; x < size; x += 1) {

      // Base: vertical grayscale gradient from light gray to slightly darker gray.
      const lightGray = 230
      const darkGray = 200
      const gray = clampByte(lightGray - v * (lightGray - darkGray))
      let r = gray
      let g = gray
      let b = gray

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
  const map =getDefaultUvDebugTexture()
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
