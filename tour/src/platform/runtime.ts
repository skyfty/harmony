import type { MiniRuntimeConfig } from '@mini-platform/core';
import { detectMiniPlatform } from '@mini-platform/core';
import { miniRequest } from '@harmony/utils';

const apiBaseUrl = import.meta.env.VITE_MINI_TEST_API_BASE || import.meta.env.VITE_MINI_API_BASE || '';

const runtimeConfigCache = new Map<string, MiniRuntimeConfig>();
const pendingRuntimeConfigMap = new Map<string, Promise<MiniRuntimeConfig>>();

export function getMiniAppKey(): string {
  return String(import.meta.env.VITE_MINI_APP_KEY ?? import.meta.env.VITE_MINI_APP_ID ?? '').trim();
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

  const requestPromise = miniRequest<MiniRuntimeConfig>('/runtime-config', {
    method: 'GET',
    headers: {
      'X-Mini-App-Key': appKey,
      'X-Mini-Platform': platform,
    },
    query: {
      appKey,
      platform,
    },
  }).then((runtimeConfig) => {
    runtimeConfigCache.set(cacheKey, runtimeConfig);
    (globalThis as typeof globalThis & { __miniPlatformRuntime?: { apiBaseUrl?: string; runtimeConfig?: MiniRuntimeConfig } }).__miniPlatformRuntime = {
      apiBaseUrl: getMiniApiBaseUrl(),
      runtimeConfig,
    };
    return runtimeConfig;
  }).finally(() => {
    pendingRuntimeConfigMap.delete(cacheKey);
  });

  pendingRuntimeConfigMap.set(cacheKey, requestPromise);
  return await requestPromise;
}
