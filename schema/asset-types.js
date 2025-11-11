const AssetTypes = Object.freeze([
  'model',
  'image',
  'texture',
  'material',
  'file',
  'prefab',
  'video',
  'mesh',
])

const DEFAULT_ASSET_TYPE = 'file'

function isAssetType(value) {
  return typeof value === 'string' && AssetTypes.includes(value)
}

function normalizeAssetType(value, fallback = DEFAULT_ASSET_TYPE) {
  if (typeof value !== 'string') {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  return isAssetType(normalized) ? normalized : fallback
}

export { AssetTypes, DEFAULT_ASSET_TYPE, isAssetType, normalizeAssetType }
