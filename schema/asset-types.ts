const AssetTypesList = [
  'model',
  'image',
  'texture',
  'hdri',
  'material',
  'file',
  'prefab',
  'video',
  'mesh',
  'behavior',
] as const

export type AssetType = (typeof AssetTypesList)[number]

export const AssetTypes: readonly AssetType[] = AssetTypesList
export const DEFAULT_ASSET_TYPE: AssetType = 'file'

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === 'string' && AssetTypes.includes(value as AssetType)
}

export function normalizeAssetType(value: unknown, fallback: AssetType = DEFAULT_ASSET_TYPE): AssetType {
  if (typeof value !== 'string') {
    return fallback
  }
  if (isAssetType(value)) {
    return value
  }
  return fallback
}
