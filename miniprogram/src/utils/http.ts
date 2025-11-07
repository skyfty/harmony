const DEFAULT_BASE_URL = 'http://localhost:4000/mini';
const TOKEN_STORAGE_KEY = 'miniapp:authToken';

export function getAuthToken(): string | undefined {
  try {
    const token = uni.getStorageSync(TOKEN_STORAGE_KEY);
    return typeof token === 'string' && token.length ? token : undefined;
  } catch {
    return undefined;
  }
}

export function setAuthToken(token: string): void {
  try {
    uni.setStorageSync(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore storage failures silently
  }
}

export function clearAuthToken(): void {
  try {
    uni.removeStorageSync(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface RequestOptions<TData = any> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: TData;
  headers?: Record<string, string>;
  auth?: boolean;
  timeout?: number;
}

export async function request<TResponse = any, TData = any>(
  url: string,
  options: RequestOptions<TData> = {},
): Promise<TResponse> {
  const baseUrl = import.meta.env?.VITE_MINI_API_BASE || DEFAULT_BASE_URL;
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  const token = options.auth !== false ? getAuthToken() : undefined;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return new Promise<TResponse>((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method: method as UniApp.RequestOptions['method'],
      data: options.data === undefined ? undefined : (options.data as UniApp.RequestOptions['data']),
      header: headers,
      timeout: options.timeout ?? 20000,
      success: (res) => {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          resolve(res.data as TResponse);
        } else if (status === 401) {
          clearAuthToken();
          reject(new Error('未授权，请重新登录'));
        } else {
          const message = (res.data as Record<string, any>)?.message || `请求失败(${status})`;
          reject(new Error(message));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });
}

export async function get<TResponse = any>(url: string, auth = true): Promise<TResponse> {
  return request<TResponse>(url, { method: 'GET', auth });
}

export async function post<TResponse = any, TData = any>(
  url: string,
  data: TData,
  auth = true,
): Promise<TResponse> {
  return request<TResponse, TData>(url, { method: 'POST', data, auth });
}

export async function patch<TResponse = any, TData = any>(
  url: string,
  data: TData,
  auth = true,
): Promise<TResponse> {
  return request<TResponse, TData>(url, { method: 'PATCH', data, auth });
}

export async function del<TResponse = any>(url: string, auth = true): Promise<TResponse> {
  return request<TResponse>(url, { method: 'DELETE', auth });
}
