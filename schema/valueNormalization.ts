export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function normalizeInteger(value: unknown, fallback = 0): number {
  return Math.trunc(normalizeFiniteNumber(value, fallback))
}

export type Bounds3D = {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export function normalizeBounds3D(value: unknown): Bounds3D | null {
  if (!isPlainObject(value)) {
    return null
  }
  const minX = normalizeFiniteNumber(value.minX, Number.NaN)
  const minY = normalizeFiniteNumber(value.minY, Number.NaN)
  const minZ = normalizeFiniteNumber(value.minZ, Number.NaN)
  const maxX = normalizeFiniteNumber(value.maxX, Number.NaN)
  const maxY = normalizeFiniteNumber(value.maxY, Number.NaN)
  const maxZ = normalizeFiniteNumber(value.maxZ, Number.NaN)
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    return null
  }
  return { minX, minY, minZ, maxX, maxY, maxZ }
}
