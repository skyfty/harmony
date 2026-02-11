import type { Address } from '@/types/address';
import { readStorageJson, writeStorageJson } from '@/utils/storage';
import { nowISO, shortId } from '@/mocks/_seed';

const KEY = 'tour:addresses:v1';

const seed: Address[] = [
  {
    id: 'addr-1',
    receiverName: '张三',
    phone: '13800000000',
    region: 'XX省/XX市/XX区',
    detail: '山谷大道 88 号 2 栋 501',
    isDefault: true,
    updatedAt: nowISO(),
  },
];

export function listAddresses(): Address[] {
  const data = readStorageJson<Address[]>(KEY, []);
  if (Array.isArray(data) && data.length) {
    return data;
  }
  writeStorageJson(KEY, seed);
  return seed;
}

export function getAddressById(id: string): Address | undefined {
  return listAddresses().find((a) => a.id === id);
}

export function upsertAddress(input: Omit<Address, 'id' | 'updatedAt'> & { id?: string }): Address {
  const all = listAddresses();
  const id = input.id && input.id.trim() ? input.id : shortId('addr');
  const entry: Address = {
    id,
    receiverName: input.receiverName,
    phone: input.phone,
    region: input.region,
    detail: input.detail,
    isDefault: !!input.isDefault,
    updatedAt: nowISO(),
  };

  let next = all.filter((a) => a.id !== id);
  if (entry.isDefault) {
    next = next.map((a) => ({ ...a, isDefault: false }));
  }
  next = [entry, ...next];
  writeStorageJson(KEY, next);
  return entry;
}

export function removeAddress(id: string): void {
  const all = listAddresses();
  const next = all.filter((a) => a.id !== id);
  writeStorageJson(KEY, next);
}
