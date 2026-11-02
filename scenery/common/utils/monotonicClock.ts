export interface MonotonicClock {
  now: () => number
}

/**
 * Returns a monotonic timestamp when the host exposes a usable performance
 * clock. WeChat app-service does not guarantee a global `performance`, so wall
 * time remains the portable fallback.
 */
export function resolveMonotonicNowMs(
  clock: MonotonicClock | null = typeof performance !== 'undefined' ? performance : null,
  fallbackNow: () => number = Date.now,
): number {
  try {
    const value = clock?.now()
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  } catch {
    // Some host stubs expose a partial performance object that throws on use.
  }
  return fallbackNow()
}
