export type VehicleStatus = 'owned' | 'available' | 'locked';

export interface Vehicle {
  id: string;
  identifier: string;
  name: string;
  description: string;
  summary: string;
  coverUrl: string;
  status: VehicleStatus;
  owned: boolean;
  isCurrent: boolean;
  productId?: string | null;
  // Performance attributes
  maxSpeed?: number;
  acceleration?: number;
  braking?: number;
  handling?: number;
  mass?: number;
  drag?: number;
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
    maxSpeed?: number;
    acceleration?: number;
    braking?: number;
    handling?: number;
    mass?: number;
    drag?: number;
  } | null;
}
