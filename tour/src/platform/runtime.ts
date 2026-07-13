import type { MiniRuntimeConfig } from '@mini-platform/core';
import { detectMiniPlatform } from '@mini-platform/core';

const apiBaseUrl = import.meta.env.VITE_MINI_TEST_API_BASE || import.meta.env.VITE_MINI_API_BASE || '';

const runtimeConfigCache = new Map<string, MiniRuntimeConfig>();
const pendingRuntimeConfigMap = new Map<string, Promise<MiniRuntimeConfig>>();

export function getMiniAppKey(): string {
  return String(import.meta.env.VITE_MINI_APP_KEY ?? '').trim();
}

export function getMiniApiBaseUrl(): string {
  return String(apiBaseUrl).replace(/\/$/, '');
}

export function getCachedMiniRuntimeConfig(): MiniRuntimeConfig | null {
  const appKey = getMiniAppKey();
  const platform = detectMiniPlatform();
  return runtimeConfigCache.get(`${appKey}::${platform}`) ?? null;
}

export async function ensureMiniRuntimeConfig(): Promise<MiniRuntimeConfig> {
  const appKey = getMiniAppKey();
  const platform = detectMiniPlatform();
  const cacheKey = `${appKey}::${platform}`;

  const cachedRuntimeConfig = runtimeConfigCache.get(cacheKey);
  if (cachedRuntimeConfig) {
    return cachedRuntimeConfig;
  }

  const pendingRuntimeConfig = pendingRuntimeConfigMap.get(cacheKey);
  if (pendingRuntimeConfig) {
    return await pendingRuntimeConfig;
  }

  const requestPromise = new Promise<MiniRuntimeConfig>((resolve, reject) => {
    uni.request({
      url: `${getMiniApiBaseUrl()}/api/mini/runtime-config`,
      method: 'GET',
      header: {
        'X-Mini-App-Key': appKey,
        'X-Mini-Platform': platform,
      },
      data: {
        appKey,
        platform,
      },
      success: (response) => {
        const runtimeConfig = response.data as MiniRuntimeConfig;
        runtimeConfigCache.set(cacheKey, runtimeConfig);
        pendingRuntimeConfigMap.delete(cacheKey);
        (globalThis as typeof globalThis & { __miniPlatformRuntime?: { apiBaseUrl?: string; runtimeConfig?: MiniRuntimeConfig } }).__miniPlatformRuntime = {
          apiBaseUrl: getMiniApiBaseUrl(),
          runtimeConfig,
        };
        resolve(runtimeConfig);
      },
      fail: (error) => {
        pendingRuntimeConfigMap.delete(cacheKey);
        reject(error);
      },
    });
  });

  pendingRuntimeConfigMap.set(cacheKey, requestPromise);
  return await requestPromise;
}
