export const BUILTIN_WATER_NORMAL_ASSET_ID = 'builtin://waternormal.jpg'
export const BUILTIN_WATER_NORMAL_FILENAME = 'waternormal.jpg'

export function isBuiltinWaterNormalAsset(assetId: string | null | undefined): boolean {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  return normalized === BUILTIN_WATER_NORMAL_ASSET_ID
}
