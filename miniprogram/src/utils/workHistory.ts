export interface WorkHistoryEntry {
  id: string;
  name: string;
  size: string;
  time: string;
  status: string;
  gradient: string;
  createdAt: number;
}

const HISTORY_STORAGE_KEY = 'workHistory';
const LEGACY_STORAGE_KEY = 'uploadHistory';

function readHistory(key: string): WorkHistoryEntry[] {
  try {
    const raw = uni.getStorageSync(key);
    if (!raw) {
      return [];
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadWorkHistory(): WorkHistoryEntry[] {
  const current = readHistory(HISTORY_STORAGE_KEY);
  if (current.length) {
    return current;
  }
  const legacy = readHistory(LEGACY_STORAGE_KEY);
  if (legacy.length) {
    saveWorkHistory(legacy);
    return legacy;
  }
  return [];
}

export function saveWorkHistory(list: WorkHistoryEntry[]): void {
  try {
    uni.setStorageSync(HISTORY_STORAGE_KEY, list);
  } catch {
    // ignore storage failures
  }
}

export function prependWorkHistoryEntry(entry: WorkHistoryEntry, limit = 20): WorkHistoryEntry[] {
  const existing = loadWorkHistory();
  const next = [entry, ...existing].slice(0, limit);
  saveWorkHistory(next);
  return next;
}

export function formatWorkSize(value?: number | string): string {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const mb = value / (1024 * 1024);
    return `${mb.toFixed(mb >= 100 ? 0 : 1)}MB`;
  }
  return '未记录';
}
