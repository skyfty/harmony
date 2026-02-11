export type VehicleStatus = 'owned' | 'available' | 'locked';

export interface Vehicle {
  id: string;
  name: string;
  summary: string;
  coverUrl: string;
  status: VehicleStatus;
}
