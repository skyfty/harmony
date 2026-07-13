import type { MiniRuntimeConfig } from '@mini-platform/core';
import { detectMiniPlatform } from '@mini-platform/core';

const apiBaseUrl = import.meta.env.VITE_MINI_TEST_API_BASE || import.meta.env.VITE_MINI_API_BASE || '';

let cachedRuntimeConfig: MiniRuntimeConfig | null = null;
let pendingRuntimeConfig: MiniRuntimeConfig | null | Promise<MiniRuntimeConfig | null> = null;

export function getMiniAppKey(): string {
  return String(import.meta.env.VITE_MINI_APP_KEY ?? '').trim();
}

export function getMiniApiBaseUrl(): string {
  return String(apiBaseUrl).replace(/\/$/, '');
}

export async function ensureMiniRuntimeConfig(): Promise<MiniRuntimeConfig | null> {
  if (cachedRuntimeConfig) {
    return cachedRuntimeConfig;
  }
  if (pendingRuntimeConfig && !(pendingRuntimeConfig instanceof Promise)) {
    return pendingRuntimeConfig;
  }

  const appKey = getMiniAppKey();
  if (!appKey || !apiBaseUrl) {
    return null;
  }

  const platform = detectMiniPlatform();
  pendingRuntimeConfig = new Promise((resolve) => {
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
        resolve(cachedRuntimeConfig);
      },
      fail: () => {
        pendingRuntimeConfig = null;
        resolve(null);
      },
    });
  });

  return await pendingRuntimeConfig;
}
