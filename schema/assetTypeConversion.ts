import { DEFAULT_ASSET_TYPE, type AssetType } from './asset-types'

export type InferAssetTypeOptions = {
  mimeType?: string | null | undefined
  nameOrUrl?: string | null | undefined
  fallbackType?: AssetType
}

const ASSET_TYPE_BY_EXTENSION: Readonly<Record<string, AssetType>> = {
  // images
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
  tif: 'image',
  tiff: 'image',
  ico: 'image',

  // textures
  ktx: 'texture',
  ktx2: 'texture',
  dds: 'texture',
  tga: 'texture',

  // models
  gltf: 'model',
  glb: 'model',
  fbx: 'model',
  obj: 'model',
  stl: 'model',

  // prefabs
  prefab: 'prefab',

  // materials
  mtl: 'material',
  material: 'material',
  mat: 'material',
  'material.json': 'material',
  'mat.json': 'material',

  // hdri
  hdr: 'hdri',
  exr: 'hdri',

  // videos
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  ogv: 'video',
  ogg: 'video',
  m4v: 'video',
  mkv: 'video',
  avi: 'video',
}

const IMAGE_LIKE_EXTENSIONS = new Set<string>([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'svg',
  'avif',
  'ico',
  'heic',
  'heif',
  'tga',
  'hdr',
  'exr',
])

const KNOWN_ASSET_EXTENSIONS_DESC = Object.keys(ASSET_TYPE_BY_EXTENSION)
  .slice()
  .sort((a, b) => b.length - a.length)

// Centralized mapping: extension -> mime type. Use this as the single source
// for simple extension-based inference. More complex inference still falls
// back to regex-based parsing below.
const MIME_BY_EXTENSION: Record<string, string> = {
  // images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  avif: 'image/avif',

  // textures / hdri
  hdr: 'image/vnd.radiance',
  exr: 'image/exr',

  // videos
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',

  // models
  gltf: 'model/gltf+json',
  glb: 'model/gltf-binary',
  fbx: 'model/fbx',
  obj: 'model/obj',
  stl: 'model/stl',

  // misc
  json: 'application/json',
  txt: 'text/plain',
}

// Derived reverse map: mime -> preferred extension
const EXTENSION_BY_MIME: Record<string, string> = {}
Object.keys(MIME_BY_EXTENSION).forEach((ext) => {
  const mime = MIME_BY_EXTENSION[ext]
  if (mime && !EXTENSION_BY_MIME[mime]) {
    EXTENSION_BY_MIME[mime] = ext
  }
})

export function normalizeExtension(input: string | null | undefined): string | null {
  if (!input) {
    return null
  }
  const trimmed = input.trim()
  if (!trimmed.length) {
    return null
  }
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed
  const withoutDot = withoutQuery.replace(/^[.]/, '')
  const normalized = withoutDot.toLowerCase()
  return normalized.length ? normalized : null
}

export function getLastExtensionFromFilenameOrUrl(filenameOrUrl: string | null | undefined): string | null {
  if (!filenameOrUrl) {
    return null
  }
  const trimmed = filenameOrUrl.trim()
  if (!trimmed.length) {
    return null
  }
  if (trimmed.startsWith('data:')) {
    return null
  }
  const withoutFragment = trimmed.split(/[?#]/)[0] ?? trimmed
  const match = /\.([a-z0-9]+)$/i.exec(withoutFragment)
  return match ? match[1]!.toLowerCase() : null
}

export function getKnownExtensionFromFilename(
  filenameOrUrl: string | null | undefined,
  knownExtensions: readonly string[],
): string | null {
  if (!filenameOrUrl) {
    return null
  }
  const trimmed = filenameOrUrl.trim()
  if (!trimmed.length) {
    return null
  }
  if (trimmed.startsWith('data:')) {
    return null
  }
  const withoutFragment = trimmed.split(/[?#]/)[0] ?? trimmed
  const lastSegment = withoutFragment.split('/').filter(Boolean).pop() ?? withoutFragment
  const candidate = lastSegment.toLowerCase()

  const sorted = [...knownExtensions].sort((a, b) => b.length - a.length)
  for (const known of sorted) {
    const normalizedKnown = normalizeExtension(known)
    if (!normalizedKnown) {
      continue
    }
    if (candidate === normalizedKnown || candidate.endsWith(`.${normalizedKnown}`)) {
      return normalizedKnown
    }
  }
  return null
}

export function getAssetTypeFromExtension(extension: string | null | undefined): AssetType | null {
  const normalized = normalizeExtension(extension)
  if (!normalized) {
    return null
  }
  return ASSET_TYPE_BY_EXTENSION[normalized] ?? null
}

export function getAssetTypeFromMimeType(mimeType: string | null | undefined): AssetType | null {
  if (!mimeType) {
    return null
  }
  const normalized = mimeType.toLowerCase()
  if (normalized.startsWith('image/')) {
    return 'image'
  }
  if (normalized.startsWith('video/')) {
    return 'video'
  }
  if (normalized.startsWith('model/')) {
    return 'model'
  }
  if (normalized.includes('gltf') || normalized.includes('fbx') || normalized.includes('obj') || normalized.includes('stl')) {
    return 'model'
  }
  if (normalized.includes('ktx') || normalized.includes('texture') || normalized.includes('dds') || normalized.includes('tga')) {
    return 'texture'
  }
  if (normalized.includes('material')) {
    return 'material'
  }
  return null
}

export function getAssetTypeFromFilenameOrUrl(filenameOrUrl: string | null | undefined): AssetType | null {
  const knownExtension = getKnownExtensionFromFilename(filenameOrUrl, KNOWN_ASSET_EXTENSIONS_DESC)
  if (!knownExtension) {
    return null
  }
  return getAssetTypeFromExtension(knownExtension)
}

export function inferAssetTypeOrNull(options: InferAssetTypeOptions): AssetType | null {
  const mimeTypeResult = getAssetTypeFromMimeType(options?.mimeType ?? null)
  if (mimeTypeResult) {
    return mimeTypeResult
  }
  return getAssetTypeFromFilenameOrUrl(options?.nameOrUrl ?? null)
}

export function inferAssetType(options: InferAssetTypeOptions): AssetType {
  const inferred = inferAssetTypeOrNull(options)
  if (inferred) {
    return inferred
  }
  return options?.fallbackType ?? DEFAULT_ASSET_TYPE
}

export function getExtensionFromMimeType(mimeType: string | null | undefined): string | null {
  if (!mimeType) {
    return null
  }
  const normalized = mimeType.toLowerCase()
  // Exact mapping preferred
  const direct = EXTENSION_BY_MIME[normalized]
  if (direct) return direct

  // Fallback: parse subtype from common top-level types and return subtype
  const imageMatch = /^image\/([a-z0-9.+-]+)$/i.exec(normalized)
  if (imageMatch) {
    return imageMatch[1]!.toLowerCase()
  }
  const modelMatch = /^model\/([a-z0-9.+-]+)$/i.exec(normalized)
  if (modelMatch) {
    return modelMatch[1]!.toLowerCase()
  }
  const videoMatch = /^video\/([a-z0-9.+-]+)$/i.exec(normalized)
  if (videoMatch) {
    return videoMatch[1]!.toLowerCase()
  }
  return null
}

/**
 * Infer a MIME type from a filename, URL or asset id.
 * Exported so other packages can reuse the same mapping logic.
 */
export function inferMimeTypeFromAssetId(assetId: string | null | undefined): string | null {
  const ext = getLastExtensionFromFilenameOrUrl(assetId)
  if (!ext) return null
  const lower = ext.toLowerCase()
  return MIME_BY_EXTENSION[lower] ?? null
}

export function isImageLikeExtension(extension: string | null | undefined): boolean {
  const normalized = normalizeExtension(extension)
  if (!normalized) {
    return false
  }
  return IMAGE_LIKE_EXTENSIONS.has(normalized)
}

export function isVideoLikeExtension(extension: string | null | undefined): boolean {
  const normalized = normalizeExtension(extension)
  if (!normalized) {
    return false
  }
  return normalized === 'mp4'
    || normalized === 'webm'
    || normalized === 'ogv'
    || normalized === 'ogg'
    || normalized === 'mov'
    || normalized === 'm4v'
    || normalized === 'mkv'
    || normalized === 'avi'
}

export function isHdriLikeExtension(extension: string | null | undefined): boolean {
  const normalized = normalizeExtension(extension)
  if (!normalized) {
    return false
  }
  return normalized === 'hdr'
    || normalized === 'hdri'
    || normalized === 'rgbe'
    || normalized === 'exr'
}

export function getAssetTypeFromCategoryIdSuffix(categoryId: string | null | undefined): AssetType | null {
  if (!categoryId) {
    return null
  }
  const normalized = categoryId.toLowerCase()
  if (normalized.endsWith('-models')) return 'model'
  if (normalized.endsWith('-meshes')) return 'mesh'
  if (normalized.endsWith('-images')) return 'image'
  if (normalized.endsWith('-textures')) return 'texture'
  if (normalized.endsWith('-materials')) return 'material'
  if (normalized.endsWith('-behaviors')) return 'behavior'
  if (normalized.endsWith('-prefabs')) return 'prefab'
  if (normalized.endsWith('-videos')) return 'video'
  if (normalized.endsWith('-hdri')) return 'hdri'
  return null
}
