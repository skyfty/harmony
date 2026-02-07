import * as THREE from 'three'

export const SKY_CUBE_FACE_KEYS = [
  'positiveX',
  'negativeX',
  'positiveY',
  'negativeY',
  'positiveZ',
  'negativeZ',
] as const

export type SkyCubeFaceKey = (typeof SKY_CUBE_FACE_KEYS)[number]

export const SKY_CUBE_FACE_ORDER: ReadonlyArray<SkyCubeFaceKey> = SKY_CUBE_FACE_KEYS

export const SKY_CUBE_FACE_LABELS: Record<SkyCubeFaceKey, { label: string; description: string }> = {
  positiveX: { label: '+X', description: 'Right' },
  negativeX: { label: '-X', description: 'Left' },
  positiveY: { label: '+Y', description: 'Top' },
  negativeY: { label: '-Y', description: 'Bottom' },
  positiveZ: { label: '+Z', description: 'Front' },
  negativeZ: { label: '-Z', description: 'Back' },
}

export interface SkyCubeTextureLoadResult {
  texture: THREE.CubeTexture | null
  missingFaces: SkyCubeFaceKey[]
  failedFaces: SkyCubeFaceKey[]
  error?: string
}

export interface SkyCubeTextureLoadOptions {
  /**
   * Passed to the underlying ImageLoader via CubeTextureLoader.
   * Defaults to 'anonymous'.
   */
  crossOrigin?: string
  /**
   * A valid URL used for missing faces. Defaults to a 1x1 black PNG data URL.
   * Using a placeholder allows partial face selection without failing the entire load.
   */
  placeholderUrl?: string
  /**
   * If true, sets texture.colorSpace = THREE.SRGBColorSpace (recommended for LDR images).
   * Defaults to true.
   */
  assumeSrgb?: boolean

  /**
   * If true, flips the cube texture vertically.
   * Defaults to true to match typical image asset orientation in this repo.
   */
  flipY?: boolean
}

const DEFAULT_PLACEHOLDER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X9o0wAAAAASUVORK5CYII='

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function normalizeSkyCubeUrls(
  urlsInOrder: ReadonlyArray<string | null | undefined>,
): Array<string | null> {
  const result: Array<string | null> = []
  for (let i = 0; i < SKY_CUBE_FACE_KEYS.length; i += 1) {
    result.push(normalizeUrl(urlsInOrder[i]) ?? null)
  }
  return result
}

export async function loadSkyCubeTexture(
  urlsInOrder: ReadonlyArray<string | null | undefined>,
  options: SkyCubeTextureLoadOptions = {},
): Promise<SkyCubeTextureLoadResult> {
  const normalized = normalizeSkyCubeUrls(urlsInOrder)
  const missingFaces: SkyCubeFaceKey[] = []

  const placeholderUrl = normalizeUrl(options.placeholderUrl) ?? DEFAULT_PLACEHOLDER_PNG
  const resolvedUrls = normalized.map((url, index) => {
    if (url) {
      return url
    }
    missingFaces.push(SKY_CUBE_FACE_KEYS[index]!)
    return placeholderUrl
  })

  if (missingFaces.length === SKY_CUBE_FACE_KEYS.length) {
    return {
      texture: null,
      missingFaces,
      failedFaces: [],
    }
  }

  const loader = new THREE.CubeTextureLoader()
  loader.setCrossOrigin(options.crossOrigin ?? 'anonymous')

  try {
    const texture = await loader.loadAsync(resolvedUrls)
    texture.flipY = options.flipY ?? true
    if (options.assumeSrgb !== false) {
      texture.colorSpace = THREE.SRGBColorSpace
    }
    texture.needsUpdate = true
    return {
      texture,
      missingFaces,
      failedFaces: [],
    }
  } catch (error) {
    return {
      texture: null,
      missingFaces,
      failedFaces: [...SKY_CUBE_FACE_KEYS],
      error: (error as Error)?.message ?? String(error),
    }
  }
}

export function disposeSkyCubeTexture(texture: THREE.CubeTexture | null | undefined): void {
  if (!texture) {
    return
  }
  texture.dispose()
}
