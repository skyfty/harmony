import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

export type ControllableType = 'vehicle' | 'character' | 'ship' | 'aircraft'
export type ControllableAsset = {
  id: string
  identifier: string
  name: string
  type: ControllableType
  sortOrder: number
  description: string
  prefabUrl?: string
  isActive: boolean
  isDefault: boolean
  productId: string | null
  product: { id: string; name: string; price: number; categoryId: string | null } | null
  runtimeConfig?: Record<string, unknown> | null
  owned: boolean
  isSelected: boolean
}

type AssetsResponse = { total: number; assets: ControllableAsset[] }

export async function listControllableAssets(options: { keyword?: string; type?: string; ownedOnly?: boolean } = {}) {
  await ensureMiniAuth()
  const response = await miniRequest<AssetsResponse>('/controllable-assets', {
    method: 'GET',
    query: {
      keyword: options.keyword || undefined,
      type: options.type || undefined,
      ownedOnly: options.ownedOnly ? 'true' : undefined,
    },
  })
  return Array.isArray(response.assets) ? response.assets : []
}

export async function selectControllableAsset(id: string) {
  await ensureMiniAuth()
  return await miniRequest<{ success: boolean; type: ControllableType; asset: ControllableAsset }>(`/controllable-assets/${encodeURIComponent(id)}/select`, {
    method: 'POST', body: {},
  })
}
