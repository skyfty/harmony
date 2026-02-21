const TOKEN_STORAGE_KEY = 'miniapp:authToken';
const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4000/api/mini';
const DEFAULT_PROD_API_BASE_URL = 'https://v.touchmagic.cn/api/mini';
const DEFAULT_DEV_DOWNLOAD_CDN_BASE = 'http://localhost:4000';
const DEFAULT_PROD_DOWNLOAD_CDN_BASE = 'https://cdn.touchmagic.cn';

function resolveModeDefault(devValue: string, prodValue: string): string {
  return import.meta.env?.DEV ? devValue : prodValue;
}

export function getBaseUrl(): string {
  const envBase = (import.meta as any)?.env?.VITE_MINI_TEST_API_BASE || (import.meta as any)?.env?.VITE_MINI_API_BASE;
  const raw = typeof envBase === 'string' && envBase.length
    ? envBase
    : resolveModeDefault(DEFAULT_DEV_API_BASE_URL, DEFAULT_PROD_API_BASE_URL);
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export function getDownloadCdnBaseUrl(): string {
  const envBase = (import.meta as any)?.env?.VITE_MINI_DOWNLOAD_CDN_BASE;
  const raw = typeof envBase === 'string' && envBase.length
    ? envBase
    : resolveModeDefault(DEFAULT_DEV_DOWNLOAD_CDN_BASE, DEFAULT_PROD_DOWNLOAD_CDN_BASE);
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export function getApiOrigin(): string {
  const baseUrl = getBaseUrl();
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    const match = (baseUrl as string).match(/^(https?:\/\/[^/]+)/);
    return match ? match[1] : baseUrl;
  }
}

export function getAuthToken(): string | undefined {
  try {
    const token = (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') ? uni.getStorageSync(TOKEN_STORAGE_KEY) : undefined;
    return typeof token === 'string' && token.length ? token : undefined;
  } catch {
    return undefined;
  }
}

export function setAuthToken(token: string): void {
  try {
    if (typeof uni !== 'undefined' && typeof uni.setStorageSync === 'function') {
      uni.setStorageSync(TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // ignore
  }
}

export function clearAuthToken(): void {
  try {
    if (typeof uni !== 'undefined' && typeof uni.removeStorageSync === 'function') {
      uni.removeStorageSync(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

async function requestWithUni(url: string, options: { method?: string; data?: any; timeout?: number } = {}) {
  return new Promise<any>((resolve, reject) => {
    const req: any = {
      url,
      method: options.method ?? 'GET',
      timeout: options.timeout ?? 20000,
      success: (res: any) => resolve(res.data),
      fail: (err: any) => reject(err),
    };
    if (options.data !== undefined) {
      req.data = options.data;
    }
    uni.request(req);
  });
}

export async function post<T = any>(url: string, data: any, auth = true): Promise<T> {
  const base = getBaseUrl();
  const full = url.startsWith('http') ? url : `${base}${url}`;

  // Try uni.request first (mini program), fall back to fetch
  if (typeof uni !== 'undefined' && typeof uni.request === 'function') {
    const result = await requestWithUni(full, { method: 'POST', data });
    return result as T;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = auth ? getAuthToken() : undefined;
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(full, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
  return (await resp.json()) as T;
}
