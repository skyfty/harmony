export type VehicleStatus = 'owned' | 'available' | 'locked';

export interface Vehicle {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
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
    name: string;
    description: string;
    imageUrl: string;
    isActive: boolean;
  } | null;
}
