import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

export type SkinSlotKey =
  | 'hatAssetId'
  | 'glassesAssetId'
  | 'hairAssetId'
  | 'topAssetId'
  | 'pantsAssetId'
  | 'shoesAssetId'

export interface SkinSelectionItem {
  id: string
  identifier: string
  name: string
  categoryId: string | null
  categoryName: string | null
  slotKey: SkinSlotKey | null
  sortOrder: number
  description: string
  prefabUrl: string
  isActive: boolean
  productId: string | null
}

export interface UserSkinSelectionEntry {
  categoryId: string
  skin: SkinSelectionItem
}

export async function listUserSkinSelections(): Promise<SkinSelectionItem[]> {
  await ensureMiniAuth()
  const response = await miniRequest<{ selections: UserSkinSelectionEntry[] }>('/user-skin-selections', {
    method: 'GET',
  })
  return Array.isArray(response.selections)
    ? response.selections
        .map((entry) => entry?.skin)
        .filter((skin): skin is SkinSelectionItem => Boolean(skin))
    : []
}

export async function selectSkin(id: string) {
  await ensureMiniAuth()
  return await miniRequest<{ success: boolean; categoryId: string; skin: SkinSelectionItem }>(
    `/skins/${encodeURIComponent(id)}/select`,
    {
      method: 'POST',
      body: {},
    },
  )
}
