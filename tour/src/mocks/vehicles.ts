import type { Vehicle } from '@/types/vehicle';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:vehicles:v1';
const KEY_SELECTED = 'tour:selectedVehicleId:v1';

const seed: Vehicle[] = [
  {
    id: 'vehicle-1',
    name: '城市轿车',
    summary: '操控轻便，适合平路。',
    coverUrl: 'https://dummyimage.com/600x360/3f97ff/ffffff&text=%E5%9F%8E%E5%B8%82%E8%BD%BF%E8%BD%A6',
    status: 'available',
  },
  {
    id: 'vehicle-2',
    name: '越野车',
    summary: '通过性更强，适合山地。',
    coverUrl: 'https://dummyimage.com/600x360/1a1f2e/ffffff&text=%E8%B6%8A%E9%87%8E%E8%BD%A6',
    status: 'owned',
  },
  {
    id: 'vehicle-3',
    name: '观光巴士',
    summary: '更舒适的观景体验。',
    coverUrl: 'https://dummyimage.com/600x360/ffb340/ffffff&text=%E8%A7%82%E5%85%89%E5%B7%B4%E5%A3%AB',
    status: 'locked',
  },
];

export function listVehicles(): Vehicle[] {
  const data = readStorageJson<Vehicle[]>(KEY, []);
  if (Array.isArray(data) && data.length) {
    return data;
  }
  writeStorageJson(KEY, seed);
  return seed;
}

export function getSelectedVehicleId(): string {
  const raw = uni.getStorageSync(KEY_SELECTED);
  return typeof raw === 'string' ? raw : '';
}

export function setSelectedVehicleId(id: string): void {
  uni.setStorageSync(KEY_SELECTED, id);
}
