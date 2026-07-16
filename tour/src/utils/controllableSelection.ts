import { readStorageJson, writeStorageJson } from '@/utils/storage';

export type ControllableType = 'vehicle' | 'character' | 'ship' | 'aircraft';
export type StoredControllableAsset = {
  id: string
  identifier?: string
  name?: string
  type: ControllableType
  prefabUrl?: string
  [key: string]: unknown
}

const SELECTION_KEY_PREFIX = 'tour:selectedControllable:';

function key(type: ControllableType) { return `${SELECTION_KEY_PREFIX}${type}`; }

export function getSelectedControllable(type: ControllableType): StoredControllableAsset | null {
  const value = readStorageJson<StoredControllableAsset | null>(key(type), null);
  return value && typeof value === 'object' && value.type === type ? value : null;
}

export function setSelectedControllable(type: ControllableType, asset: StoredControllableAsset | null): void {
  if (!asset) { try { uni.removeStorageSync(key(type)); } catch {} return; }
  writeStorageJson(key(type), { ...asset, type });
}

export function getSelectedControllableId(type: ControllableType): string | null { return getSelectedControllable(type)?.id || null; }
export function getSelectedControllableIdentifier(type: ControllableType): string { return getSelectedControllable(type)?.identifier?.trim() || ''; }
