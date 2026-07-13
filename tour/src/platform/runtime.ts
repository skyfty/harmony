import type { MiniRuntimeConfig } from '@mini-platform/core';
import { detectMiniPlatform } from '@mini-platform/core';

const apiBaseUrl = import.meta.env.VITE_MINI_TEST_API_BASE || import.meta.env.VITE_MINI_API_BASE || '';

let cachedRuntimeConfig: MiniRuntimeConfig | null = null;
let pendingRuntimeConfig: MiniRuntimeConfig | null | Promise<MiniRuntimeConfig> = null;

export function getMiniAppKey(): string {
  return String(import.meta.env.VITE_MINI_APP_KEY ?? '').trim();
}

export function getMiniApiBaseUrl(): string {
  return String(apiBaseUrl).replace(/\/$/, '');
}

export function getCachedMiniRuntimeConfig(): MiniRuntimeConfig | null {
  return cachedRuntimeConfig;
}

export async function ensureMiniRuntimeConfig(): Promise<MiniRuntimeConfig> {
  if (cachedRuntimeConfig) {
    return cachedRuntimeConfig;
  }
  if (pendingRuntimeConfig && !(pendingRuntimeConfig instanceof Promise)) {
    return pendingRuntimeConfig;
  }

  const appKey = getMiniAppKey();
  const platform = detectMiniPlatform();
  pendingRuntimeConfig = new Promise<MiniRuntimeConfig>((resolve, reject) => {
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
        cachedRuntimeConfig = response.data as MiniRuntimeConfig;
        pendingRuntimeConfig = cachedRuntimeConfig;
        (globalThis as typeof globalThis & { __miniPlatformRuntime?: { apiBaseUrl?: string; runtimeConfig?: MiniRuntimeConfig } }).__miniPlatformRuntime = {
          apiBaseUrl: getMiniApiBaseUrl(),
          runtimeConfig: cachedRuntimeConfig,
        };
        resolve(cachedRuntimeConfig);
      },
      fail: (error) => {
        pendingRuntimeConfig = null;
        reject(error);
      },
    });
  });

  return await pendingRuntimeConfig;
}
