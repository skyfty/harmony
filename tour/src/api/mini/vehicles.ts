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
  prefabUrl?: string
  isActive?: boolean
  owned?: boolean
  isCurrent?: boolean
  productId?: string | null
  maxSpeed?: number
  acceleration?: number
  braking?: number
  handling?: number
  mass?: number
  drag?: number
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
    prefabUrl?: string
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
      prefabUrl: vehicle.prefabUrl ?? '',
      status,
      owned,
      isCurrent: Boolean(vehicle.isCurrent),
      productId: typeof vehicle.productId === 'string' ? vehicle.productId : null,
      maxSpeed: typeof vehicle.maxSpeed === 'number' ? vehicle.maxSpeed : undefined,
      acceleration: typeof vehicle.acceleration === 'number' ? vehicle.acceleration : undefined,
      braking: typeof vehicle.braking === 'number' ? vehicle.braking : undefined,
      handling: typeof vehicle.handling === 'number' ? vehicle.handling : undefined,
      mass: typeof vehicle.mass === 'number' ? vehicle.mass : undefined,
      drag: typeof vehicle.drag === 'number' ? vehicle.drag : undefined,
    }
  })
}

type PurchaseVehicleResponse = {
  order?: {
    id: string
    orderNumber?: string
    paymentStatus?: string
  }
  payParams?: {
    appId: string
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
  }
}

export async function purchaseVehicleByProduct(productId: string): Promise<PurchaseVehicleResponse> {
  await ensureMiniAuth()
  const order = await miniRequest<{ id: string; orderNumber: string }>(`/orders`, {
    method: 'POST',
    body: {
      paymentMethod: 'wechat',
      items: [
        {
          productId,
          itemType: 'product',
          quantity: 1,
        },
      ],
      metadata: {
        source: 'tour-vehicles',
      },
    },
  })
  const payment = await miniRequest<{ payParams?: PurchaseVehicleResponse['payParams']; paymentStatus?: string }>(
    `/orders/${encodeURIComponent(order.id)}/pay`,
    {
      method: 'POST',
      body: {},
    },
  )
  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      paymentStatus: payment.paymentStatus,
    },
    payParams: payment.payParams,
  }
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
          prefabUrl: row.vehicle.prefabUrl ?? '',
          isActive: row.vehicle.isActive !== false,
          maxSpeed: typeof row.vehicle.maxSpeed === 'number' ? row.vehicle.maxSpeed : undefined,
          acceleration: typeof row.vehicle.acceleration === 'number' ? row.vehicle.acceleration : undefined,
          braking: typeof row.vehicle.braking === 'number' ? row.vehicle.braking : undefined,
          handling: typeof row.vehicle.handling === 'number' ? row.vehicle.handling : undefined,
          mass: typeof row.vehicle.mass === 'number' ? row.vehicle.mass : undefined,
          drag: typeof row.vehicle.drag === 'number' ? row.vehicle.drag : undefined,
        }
      : null,
  }))
}
