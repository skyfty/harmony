export function clampToRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  if (min > max) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}
