import type { AssetSourceMetadata } from '@schema'

export const SERVER_ASSET_PROVIDER_ID = 'server-assets'

export function isServerBackedProviderId(providerId: string | null | undefined): boolean {
  return typeof providerId === 'string' && providerId.trim() === SERVER_ASSET_PROVIDER_ID
}

export function createServerAssetSource(serverAssetId: string | null | undefined): AssetSourceMetadata {
  const normalized = typeof serverAssetId === 'string' ? serverAssetId.trim() : ''
  if (normalized.length > 0) {
    return {
      type: 'server',
      serverAssetId: normalized,
    }
  }
  return { type: 'server' }
}
