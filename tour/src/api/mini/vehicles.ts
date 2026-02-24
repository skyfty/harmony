import type { Vehicle } from '@/types/vehicle'
import type { UserVehicle } from '@/types/vehicle'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

type VehicleApiDto = {
  id: string
  identifier?: number | string
  name: string
  description?: string
  coverUrl?: string
  isActive?: boolean
  owned?: boolean
  isCurrent?: boolean
  productId?: string | null
}

type VehiclesResponse = {
  total: number
  vehicles: VehicleApiDto[]
}

type UserVehicleApiDto = {
  id: string
  vehicleId: string
  ownedAt?: string | null
  vehicle: {
    id: string
    identifier?: number | string
    name: string
    description?: string
    coverUrl?: string
    isActive?: boolean
  } | null
}

type UserVehiclesResponse = {
  total: number
  userVehicles: UserVehicleApiDto[]
}

export async function listVehicles(): Promise<Vehicle[]> {
  await ensureMiniAuth()
  const res = await miniRequest<VehiclesResponse>('/vehicles', {
    method: 'GET',
  })
  const vehicles = Array.isArray(res.vehicles) ? res.vehicles : []
  return vehicles.map((vehicle) => {
    const owned = Boolean(vehicle.owned)
    const status: Vehicle['status'] = owned ? 'owned' : 'locked'
    const coverUrl = vehicle.coverUrl ?? ''
    return {
      id: vehicle.id,
      identifier: String(vehicle.identifier ?? ''),
      name: vehicle.name,
      description: vehicle.description ?? '',
      summary: vehicle.description ?? '',
      coverUrl,
      status,
      owned,
      isCurrent: Boolean(vehicle.isCurrent),
      productId: typeof vehicle.productId === 'string' ? vehicle.productId : null,
    }
  })
}

type PurchaseVehicleResponse = {
  order?: {
    id: string
  }
}

export async function purchaseVehicleByProduct(productId: string): Promise<PurchaseVehicleResponse> {
  await ensureMiniAuth()
  return await miniRequest<PurchaseVehicleResponse>(`/products/${encodeURIComponent(productId)}/purchase`, {
    method: 'POST',
    body: {
      paymentMethod: 'wechat',
      metadata: {
        source: 'tour-vehicles',
      },
    },
  })
}

export async function selectCurrentVehicle(vehicleId: string): Promise<{ currentVehicleId: string }> {
  await ensureMiniAuth()
  return await miniRequest<{ currentVehicleId: string }>(`/vehicles/${encodeURIComponent(vehicleId)}/select`, {
    method: 'POST',
    body: {},
  })
}

export async function listUserVehicles(): Promise<UserVehicle[]> {
  const res = await miniRequest<UserVehiclesResponse>('/user-vehicles', {
    method: 'GET',
  })
  const rows = Array.isArray(res.userVehicles) ? res.userVehicles : []
  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    ownedAt: row.ownedAt ?? null,
    vehicle: row.vehicle
      ? {
          id: row.vehicle.id,
          identifier: String(row.vehicle.identifier ?? ''),
          name: row.vehicle.name,
          description: row.vehicle.description ?? '',
          coverUrl: row.vehicle.coverUrl ?? '',
          isActive: row.vehicle.isActive !== false,
        }
      : null,
  }))
}
