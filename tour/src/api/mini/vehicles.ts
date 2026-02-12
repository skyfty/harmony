import type { Vehicle } from '@/types/vehicle'
import { miniRequest } from './client'

type ProductApiDto = {
  id: string
  name: string
  category: string
  summary?: string
  coverUrl?: string
  purchased?: boolean
  locked?: boolean
}

type ProductsResponse = {
  total: number
  products: ProductApiDto[]
}

export async function listVehicles(): Promise<Vehicle[]> {
  const res = await miniRequest<ProductsResponse>('/products', {
    method: 'GET',
    query: { category: 'vehicle' },
  })
  const products = Array.isArray(res.products) ? res.products : []
  return products.map((product) => {
    const owned = Boolean(product.purchased)
    const locked = Boolean(product.locked)
    const status: Vehicle['status'] = owned ? 'owned' : locked ? 'locked' : 'available'
    return {
      id: product.id,
      name: product.name,
      summary: product.summary ?? '',
      coverUrl: product.coverUrl ?? '',
      status,
    }
  })
}
