const TOKEN_STORAGE_KEY = 'miniapp:authToken';
const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4000/api/mini';
const DEFAULT_PROD_API_BASE_URL = 'https://v.touchmagic.cn/api/mini';
const DEFAULT_DEV_DOWNLOAD_CDN_BASE = 'http://localhost:4000';
const DEFAULT_PROD_DOWNLOAD_CDN_BASE = 'https://cdn.touchmagic.cn';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export type HttpRequestOptions = {
  method?: HttpMethod;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeoutMs?: number;
  auth?: boolean;
};

export class HttpError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
  }
}

type MiniRequestResponse = {
  statusCode?: number;
  data?: unknown;
};

function resolveModeDefault(devValue: string, prodValue: string): string {
  return import.meta.env?.DEV ? devValue : prodValue;
}

function buildQueryString(query: HttpRequestOptions['query']): string {
  if (!query) return '';

  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]);

  if (params.length === 0) return '';

  const usp = new URLSearchParams(params);
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

function normalizeUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `${getBaseUrl()}${url}`;
}

function getRequestData(body: unknown): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer) return body;
  if (typeof body === 'object') return body as Record<string, unknown>;
  return String(body);
}

function buildHeaders(options: HttpRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };

  if (options.auth !== false) {
    const token = getAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return headers;
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

async function requestWithUni(
  url: string,
  options: { method?: string; data?: any; timeout?: number; headers?: Record<string, string> } = {},
) {
  return new Promise<MiniRequestResponse>((resolve, reject) => {
    const req: any = {
      url,
      method: options.method ?? 'GET',
      timeout: options.timeout ?? 20000,
      header: options.headers,
      success: (res: MiniRequestResponse) => resolve(res),
      fail: (err: any) => reject(err),
    };
    if (options.data !== undefined) {
      req.data = options.data;
    }
    uni.request(req);
  });
}

export async function post<T = any>(url: string, data: any, auth = true): Promise<T> {
  return await httpRequest<T>(url, {
    method: 'POST',
    body: data,
    auth,
  });
}

export async function httpRequest<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const full = `${normalizeUrl(url)}${buildQueryString(options.query)}`;
  const requestData = getRequestData(options.body);
  const headers = buildHeaders(options);

  if (typeof uni !== 'undefined' && typeof uni.request === 'function') {
    const response = await requestWithUni(full, {
      method,
      ...(requestData === undefined ? {} : { data: requestData }),
      timeout: options.timeoutMs ?? 20000,
      headers,
    });

    const statusCode = response.statusCode ?? 0;
    const data = response.data;
    if (statusCode >= 200 && statusCode < 300) {
      return data as T;
    }

    const message = typeof (data as any)?.message === 'string' ? (data as any).message : `HTTP ${statusCode}`;
    throw new HttpError(message, statusCode, data);
  }

  const resp = await fetch(full, {
    method,
    headers,
    ...(requestData === undefined
      ? {}
      : {
          body:
            typeof requestData === 'string' || requestData instanceof ArrayBuffer
              ? (requestData as BodyInit)
              : JSON.stringify(requestData),
        }),
  });

  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await resp.json() : await resp.text();

  if (resp.ok) {
    return data as T;
  }

  const message = typeof (data as any)?.message === 'string' ? (data as any).message : `HTTP ${resp.status}`;
  throw new HttpError(message, resp.status, data);
}
