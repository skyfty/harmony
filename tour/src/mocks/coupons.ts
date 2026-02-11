import type { Coupon } from '@/types/coupon';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:coupons:v1';

const seed: Coupon[] = [
  {
    id: 'coupon-1',
    title: '景区门票 9 折券',
    description: '适用于任意景区门票购买',
    validUntil: '2026-12-31',
    status: 'unused',
  },
  {
    id: 'coupon-2',
    title: '观光车体验券',
    description: '仅限指定景区使用',
    validUntil: '2026-06-30',
    status: 'used',
  },
];

export function listCoupons(): Coupon[] {
  const data = readStorageJson<Coupon[]>(KEY, []);
  if (Array.isArray(data) && data.length) {
    return data;
  }
  writeStorageJson(KEY, seed);
  return seed;
}
