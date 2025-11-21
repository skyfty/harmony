export type AssetType =
  | 'model'
  | 'image'
  | 'texture'
  | 'hdri'
  | 'material'
  | 'file'
  | 'prefab'
  | 'video'
  | 'mesh'

export const AssetTypes: readonly AssetType[]
export const DEFAULT_ASSET_TYPE: AssetType
export function isAssetType(value: unknown): value is AssetType
export function normalizeAssetType(value: unknown, fallback?: AssetType): AssetType
