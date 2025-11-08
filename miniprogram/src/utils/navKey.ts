export type NavKey = 'home' | 'work' | 'exhibition' | 'profile' | 'optimize';

export const NAV_ROUTE_MAP: Readonly<Record<NavKey, string>> = Object.freeze({
  home: '/pages/home/index',
  work: '/pages/works/indite',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  optimize: '/pages/optimize/index',
});

export function getNavRoute(key: NavKey): string {
  return NAV_ROUTE_MAP[key];
}

type NavOptions = {
  current?: NavKey;
  allowSame?: boolean;
};

export function redirectToNav(key: NavKey, options: NavOptions = {}): void {
  const url = NAV_ROUTE_MAP[key];
  if (!url) {
    return;
  }
  if (!options.allowSame && options.current && options.current === key) {
    return;
  }
  uni.redirectTo({ url });
}

export function navigateToNav(key: NavKey, options: NavOptions = {}): void {
  const url = NAV_ROUTE_MAP[key];
  if (!url) {
    return;
  }
  if (!options.allowSame && options.current && options.current === key) {
    return;
  }
  uni.navigateTo({ url });
}
