let lastNav = { url: '', ts: 0 };

export function guardedNavigateTo(url: string, ms = 500): void {
  if (!url) return;
  const now = Date.now();
  // ignore if same url invoked within the debounce window
  if (lastNav.url === url && now - lastNav.ts < ms) {
    return;
  }
  lastNav = { url, ts: now };
  try {
    uni.navigateTo({ url });
  } catch (e) {
    // fallback: attempt direct call but swallow errors
    try {
      // @ts-ignore
      uni.navigateTo({ url });
    } catch (_) {
      // no-op
    }
  }
}

export function resetNavigationGuard(): void {
  lastNav = { url: '', ts: 0 };
}
