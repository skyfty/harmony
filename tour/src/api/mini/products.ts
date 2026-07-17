import type { MiniPaymentAction } from '@mini-platform/core'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'
import type { ControllableAsset, ControllableType } from './controllableAssets'

export interface ProductCategoryItem {
  id: string
  name: string
  description: string | null
  sortOrder: number
  enabled: boolean
  purchasable: boolean
  isBuiltin: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface ProductListItem {
  id: string
  slug: string
  categoryId: string | null
  name: string
  price: number
  coverUrl?: string
  description?: string
  tags?: string[]
  purchased: boolean
  purchasedAt?: string
  state?: 'locked' | 'unused' | 'used' | 'expired'
  controllableAsset?: (Pick<ControllableAsset, 'id' | 'identifier' | 'name' | 'type' | 'prefabUrl'> & {
    selected?: boolean
  }) | null
}

type ProductCategoriesResponse = {
  categories: ProductCategoryItem[]
}

type ProductsResponse = {
  total: number
  products: ProductListItem[]
}

type PurchaseProductResponse = {
  order?: {
    id: string
    orderNumber: string
    paymentStatus?: string
  }
  payParams?: MiniPaymentAction
  product?: ProductListItem | null
}

export async function listProductCategories(): Promise<ProductCategoryItem[]> {
  await ensureMiniAuth()
  const response = await miniRequest<ProductCategoriesResponse>('/product-categories', {
    method: 'GET',
  })
  return Array.isArray(response.categories) ? response.categories : []
}

export async function listProducts(options: { keyword?: string; categoryId?: string } = {}): Promise<ProductListItem[]> {
  await ensureMiniAuth()
  const response = await miniRequest<ProductsResponse>('/products', {
    method: 'GET',
    query: {
      keyword: options.keyword || undefined,
      categoryId: options.categoryId || undefined,
    },
  })
  return Array.isArray(response.products) ? response.products : []
}

export async function purchaseProductById(productId: string): Promise<PurchaseProductResponse> {
  await ensureMiniAuth()
  return await miniRequest<PurchaseProductResponse>(`/products/${encodeURIComponent(productId)}/purchase`, {
    method: 'POST',
    body: {
      paymentMethod: 'wechat',
    },
  })
}

export function resolveControllableLabel(type: ControllableType): string {
  switch (type) {
    case 'vehicle':
      return '车辆'
    case 'character':
      return '人物'
    case 'ship':
      return '船舶'
    case 'aircraft':
      return '飞行器'
    default:
      return type
  }
}
