import type { MiniPlatformAdapter } from '@mini-platform/core';
import { resolveMiniPlatformAdapter } from '@mini-platform/adapters';

let cachedAdapter: MiniPlatformAdapter | null = null;

export function getMiniPlatformAdapter(): MiniPlatformAdapter {
  if (!cachedAdapter) {
    cachedAdapter = resolveMiniPlatformAdapter();
  }
  return cachedAdapter;
}
