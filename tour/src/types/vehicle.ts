export type VehicleStatus = 'owned' | 'available' | 'locked';

export interface Vehicle {
  id: string;
  identifier: string;
  name: string;
  description: string;
  summary: string;
  coverUrl: string;
  status: VehicleStatus;
}

export interface UserVehicle {
  id: string;
  vehicleId: string;
  ownedAt?: string | null;
  vehicle: {
    id: string;
    identifier: string;
    name: string;
    description: string;
    coverUrl: string;
    isActive: boolean;
  } | null;
}
