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
  const mapping: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/tiff': 'tiff',
    'image/x-icon': 'ico',
    'model/gltf+json': 'gltf',
    'model/gltf-binary': 'glb',
    'model/obj': 'obj',
    'model/stl': 'stl',
    'application/octet-stream': 'bin',
  }
  const direct = mapping[normalized]
  if (direct) {
    return direct
  }
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

export function isImageLikeExtension(extension: string | null | undefined): boolean {
  const normalized = normalizeExtension(extension)
  if (!normalized) {
    return false
  }
  return IMAGE_LIKE_EXTENSIONS.has(normalized)
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
