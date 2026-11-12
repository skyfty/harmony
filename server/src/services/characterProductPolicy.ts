import { Types } from 'mongoose'
import { AppUserModel } from '@/models/AppUser'
import type { CharacterGender } from '@/types/models'

export type { CharacterGender } from '@/types/models'

type CharacterProductLike = {
  characterGender?: CharacterGender | null
  controllableType?: string | null
}

export function resolveEffectiveCharacterGender(value: unknown): CharacterGender {
  return value === 'female' ? 'female' : 'male'
}

export function isCharacterProduct(product: CharacterProductLike): boolean {
  return product.controllableType === 'character'
}

export function isProductAvailableForCharacterGender(
  product: CharacterProductLike,
  effectiveGender: CharacterGender,
): boolean {
  if (!isCharacterProduct(product)) {
    return true
  }
  return product.characterGender === effectiveGender
}

export async function resolveUserCharacterGender(userId?: string | null): Promise<CharacterGender> {
  if (!userId || !Types.ObjectId.isValid(userId)) {
    return 'male'
  }
  const user = await AppUserModel.findById(userId).select({ gender: 1 }).lean().exec()
  return resolveEffectiveCharacterGender(user?.gender)
}

export function buildMiniProductVisibilityFilter(
  effectiveGender: CharacterGender,
  visibleCategoryIds: Types.ObjectId[],
): Record<string, unknown> {
  return {
    $or: [
      {
        controllableType: 'character',
        characterGender: effectiveGender,
      },
      {
        controllableType: { $ne: 'character' },
        categoryId: { $in: visibleCategoryIds },
      },
    ],
  }
}
