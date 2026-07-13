import type { MiniPlatformAdapter } from '@mini-platform/core';
import { detectMiniPlatform } from '@mini-platform/core';
import { resolveMiniPlatformAdapter } from '@mini-platform/adapters';

let cachedAdapter: MiniPlatformAdapter | null = null;

export function getMiniPlatformAdapter(): MiniPlatformAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }
  cachedAdapter = resolveMiniPlatformAdapter(detectMiniPlatform());
  return cachedAdapter;
}
