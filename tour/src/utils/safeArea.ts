export interface TopSafeAreaMetrics {
  statusBarHeight: number;
  topInset: number;
  navBarHeight: number;
  contentTopInset: number;
}

import { getStatusBarHeight } from './systemInfo';

const DEFAULT_STATUS_BAR_HEIGHT = 24;
const DEFAULT_CAPSULE_GAP = 8;
const DEFAULT_CAPSULE_HEIGHT = 32;

function resolveMenuButtonGap(statusBarHeight: number): number {
  const menuRect = (uni as { getMenuButtonBoundingClientRect?: () => { top?: number; bottom?: number; height?: number } })
    .getMenuButtonBoundingClientRect?.();
  if (!menuRect || typeof menuRect.top !== 'number') {
    return DEFAULT_CAPSULE_GAP;
  }

  const gap = menuRect.top - statusBarHeight;
  if (!Number.isFinite(gap) || gap <= 0) {
    return DEFAULT_CAPSULE_GAP;
  }

  return gap;
}

function resolveMenuButtonHeight(): number {
  const menuRect = (uni as { getMenuButtonBoundingClientRect?: () => { height?: number } })
    .getMenuButtonBoundingClientRect?.();
  if (!menuRect || typeof menuRect.height !== 'number' || menuRect.height <= 0) {
    return DEFAULT_CAPSULE_HEIGHT;
  }

  return menuRect.height;
}

export function getTopSafeAreaMetrics(): TopSafeAreaMetrics {
  try {
    const statusBarHeight = getStatusBarHeight(DEFAULT_STATUS_BAR_HEIGHT);
    const menuButtonGap = resolveMenuButtonGap(statusBarHeight);
    const menuButtonHeight = resolveMenuButtonHeight();
    const navBarHeight = Math.max(40, menuButtonHeight + menuButtonGap * 2);

    return {
      statusBarHeight,
      topInset: statusBarHeight,
      navBarHeight,
      contentTopInset: statusBarHeight + navBarHeight,
    };
  } catch {
    const navBarHeight = 44;

    return {
      statusBarHeight: DEFAULT_STATUS_BAR_HEIGHT,
      topInset: DEFAULT_STATUS_BAR_HEIGHT,
      navBarHeight,
      contentTopInset: DEFAULT_STATUS_BAR_HEIGHT + navBarHeight,
    };
  }
}

export function applyLightNavigationBar() {
  const config = {
    frontColor: '#000000' as const,
    backgroundColor: '#F8F8F8',
    animation: {
      duration: 0,
      timingFunc: 'linear' as const,
    },
  };

  const wechatApi = (globalThis as { wx?: { setNavigationBarColor?: (options: typeof config) => void } }).wx;
  if (wechatApi?.setNavigationBarColor) {
    wechatApi.setNavigationBarColor(config);
    return;
  }

  if (typeof uni.setNavigationBarColor === 'function') {
    void uni.setNavigationBarColor(config);
  }
}