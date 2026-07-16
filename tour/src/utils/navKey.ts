export type NavKey = 'scenic' | 'coupon' | 'achievement' | 'products' | 'profile';

export function resolveNavUrl(key: NavKey): string {
  switch (key) {
    case 'scenic':
      return '/pages/home/index';
    case 'coupon':
      return '/pages/coupons/index';
    case 'achievement':
      return '/pages/achievements/index';
    case 'products':
      return '/pages/products/index';
    case 'profile':
      return '/pages/profile/index';
    default:
      return '/pages/home/index';
  }
}

export function redirectToNav(key: NavKey): void {
  const url = resolveNavUrl(key);
  uni.redirectTo({ url });
}
