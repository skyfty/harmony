export type ScatterScaleStats = {
  expectedScaleSq: number
  scaleEq: number
}

export function expectedScaleSqUniform(minScale: number, maxScale: number): ScatterScaleStats {
  const lo = Number.isFinite(minScale) ? minScale : 1
  const hi = Number.isFinite(maxScale) ? maxScale : 1
  const scaleLo = Math.max(0.0001, Math.min(lo, hi))
  const scaleHi = Math.max(scaleLo, Math.max(0.0001, hi))
  // Uniform scale in [a,b]: E[s^2] = (a^2 + ab + b^2)/3
  const expectedScaleSq = (scaleLo * scaleLo + scaleLo * scaleHi + scaleHi * scaleHi) / 3
  const scaleEq = Math.sqrt(Math.max(1e-12, expectedScaleSq))
  return { expectedScaleSq, scaleEq }
}

export type ScatterOccupancyTarget = {
  maxCount: number
  targetCount: number
  perInstanceAreaM2: number
}

export function computeOccupancyTargetCount(options: {
  areaM2: number
  footprintAreaM2: number
  densityPercent: number
  minScale: number
  maxScale: number
  maxCap?: number
}): ScatterOccupancyTarget {
  const areaM2 = Number.isFinite(options.areaM2) ? options.areaM2 : 0
  const footprintAreaM2 = Number.isFinite(options.footprintAreaM2) ? options.footprintAreaM2 : 0
  const densityPercent = Number.isFinite(options.densityPercent) ? options.densityPercent : 0
  const maxCap = Number.isFinite(options.maxCap) ? Number(options.maxCap) : Number.POSITIVE_INFINITY

  const { expectedScaleSq } = expectedScaleSqUniform(options.minScale, options.maxScale)
  const perInstanceAreaM2 = Math.max(1e-6, footprintAreaM2 * expectedScaleSq)
  const maxCount = areaM2 > 0 ? Math.floor(areaM2 / perInstanceAreaM2) : 0
  const clampedDensity = Math.min(100, Math.max(0, densityPercent))
  const rawTarget = Math.round((maxCount * clampedDensity) / 100)
  const cappedTarget = Math.min(maxCap, Math.max(0, rawTarget))
  return { maxCount, targetCount: cappedTarget, perInstanceAreaM2 }
}

export function computeOccupancyMinDistance(options: {
  footprintMaxSizeM: number
  minScale: number
  maxScale: number
  minFloor?: number
}): { minDistance: number; scaleEq: number; expectedScaleSq: number } {
  const base = Number.isFinite(options.footprintMaxSizeM) ? options.footprintMaxSizeM : 0
  const minFloor = Number.isFinite(options.minFloor) ? Number(options.minFloor) : 0.05
  const stats = expectedScaleSqUniform(options.minScale, options.maxScale)
  const minDistance = Math.max(minFloor, Math.max(0.01, base) * stats.scaleEq)
  return { minDistance, scaleEq: stats.scaleEq, expectedScaleSq: stats.expectedScaleSq }
}
