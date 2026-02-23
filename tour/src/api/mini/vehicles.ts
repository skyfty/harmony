import type { Vehicle } from '@/types/vehicle'
import type { UserVehicle } from '@/types/vehicle'
import { miniRequest } from '@harmony/utils'

type VehicleApiDto = {
  id: string
  name: string
  description?: string
  coverUrl?: string
  isActive?: boolean
  owned?: boolean
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
  const res = await miniRequest<VehiclesResponse>('/vehicles', {
    method: 'GET',
  })
  const vehicles = Array.isArray(res.vehicles) ? res.vehicles : []
  return vehicles.map((vehicle) => {
    const owned = Boolean(vehicle.owned)
    const locked = vehicle.isActive === false
    const status: Vehicle['status'] = owned ? 'owned' : locked ? 'locked' : 'available'
    const coverUrl = vehicle.coverUrl ?? ''
    return {
      id: vehicle.id,
      name: vehicle.name,
      description: vehicle.description ?? '',
      summary: vehicle.description ?? '',
      coverUrl,
      status,
    }
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
          name: row.vehicle.name,
          description: row.vehicle.description ?? '',
          coverUrl: row.vehicle.coverUrl ?? '',
          isActive: row.vehicle.isActive !== false,
        }
      : null,
  }))
}
