export function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = uni.getStorageSync(key);
    if (!raw) {
      return fallback;
    }
    if (typeof raw === 'string') {
      return JSON.parse(raw) as T;
    }
    return raw as T;
  } catch (_err) {
    return fallback;
  }
}

export function writeStorageJson<T>(key: string, value: T): void {
  uni.setStorageSync(key, JSON.stringify(value));
}
