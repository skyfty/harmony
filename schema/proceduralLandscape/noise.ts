/**
 * Deterministic hash / value-noise helpers shared by the procedural landscape
 * generator. Everything in this module is pure math so it can run in the
 * editor, the desktop preview and the WeChat mini-program runtime alike.
 */

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return value < min ? min : value > max ? max : value
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1
  }
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function hashUint32(seed: number, x: number, y: number): number {
  let h = (seed >>> 0) ^ Math.imul(x | 0, 0x27d4eb2d)
  h = Math.imul(h ^ (y | 0), 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export function hashUnit(seed: number, x: number, y: number): number {
  return hashUint32(seed, x, y) / 4294967296
}

/** Combines several integer coordinates into a single stable hash key. */
export function hashKey(a: number, b: number, c: number, d: number): number {
  let h = 0x811c9dc5
  h = Math.imul(h ^ (a | 0), 0x01000193)
  h = Math.imul(h ^ (b | 0), 0x01000193)
  h = Math.imul(h ^ (c | 0), 0x01000193)
  h = Math.imul(h ^ (d | 0), 0x01000193)
  h ^= h >>> 13
  return h | 0
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

export function valueNoise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const v00 = hashUnit(seed, xi, yi)
  const v10 = hashUnit(seed, xi + 1, yi)
  const v01 = hashUnit(seed, xi, yi + 1)
  const v11 = hashUnit(seed, xi + 1, yi + 1)
  const u = fade(xf)
  const v = fade(yf)
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v)
}

export function fbm2(
  seed: number,
  x: number,
  y: number,
  octaves = 3,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0
  const octaveCount = Math.max(1, Math.round(octaves))
  for (let i = 0; i < octaveCount; i += 1) {
    sum += amplitude * valueNoise2(seed + i * 7919, x * frequency, y * frequency)
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return norm > 0 ? sum / norm : 0
}

/** Stable FNV-1a hash for arbitrary strings (used to derive default seeds). */
export function hashStringToSeed(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2
  let wrapped = angle % twoPi
  if (wrapped > Math.PI) {
    wrapped -= twoPi
  } else if (wrapped < -Math.PI) {
    wrapped += twoPi
  }
  return wrapped
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}
