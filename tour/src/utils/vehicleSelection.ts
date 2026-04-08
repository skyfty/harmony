import type { Vehicle } from '@/types/vehicle';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

export const VEHICLE_SELECTION_STORAGE_KEY = 'tour:selectedVehicleId';
export const VEHICLE_SELECTION_OBJECT_STORAGE_KEY = 'tour:selectedVehicle';

export function getSelectedVehicleId(): null | string {
  try {
    const value: unknown = uni.getStorageSync(VEHICLE_SELECTION_STORAGE_KEY);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

export function setSelectedVehicleId(id: null | string): void {
  try {
    if (id) {
      uni.setStorageSync(VEHICLE_SELECTION_STORAGE_KEY, id);
    } else {
      uni.removeStorageSync(VEHICLE_SELECTION_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getSelectedVehicle(): null | Vehicle {
  const vehicle = readStorageJson<null | Vehicle>(VEHICLE_SELECTION_OBJECT_STORAGE_KEY, null);
  if (!vehicle || typeof vehicle !== 'object') {
    return null;
  }
  return vehicle;
}

export function setSelectedVehicle(vehicle: null | Vehicle): void {
  try {
    if (vehicle) {
      writeStorageJson(VEHICLE_SELECTION_OBJECT_STORAGE_KEY, vehicle);
    } else {
      uni.removeStorageSync(VEHICLE_SELECTION_OBJECT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getSelectedVehicleIdentifier(): string {
  const vehicle = getSelectedVehicle();
  if (!vehicle) {
    return '';
  }
  return typeof vehicle.identifier === 'string' ? vehicle.identifier.trim() : '';
}