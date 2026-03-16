export type GroundPaintBrushKernelInput = {
  mask: Uint8Array
  tileResolution: number
  centerX: number
  centerY: number
  radius: number
  strength: number
  feather: number
  erase?: boolean
}

export type GroundPaintBrushKernelOutput = {
  dirty: boolean
  mask: Uint8Array
}

export type GroundPaintBakeKernelInput = {
  width: number
  height: number
  baseColor: Uint8ClampedArray
}

export type GroundPaintBakeKernelOutput = {
  pixels: Uint8ClampedArray
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function computeSoftBrushFalloff(normalizedDistanceSquared: number, feather: number): number {
  if (normalizedDistanceSquared >= 1) {
    return 0
  }
  const normalizedFeather = clamp01(feather)
  if (normalizedFeather <= 0) {
    return 1
  }
  const effectiveFeather = 1 - ((1 - normalizedFeather) * (1 - normalizedFeather))
  const hardRadius = Math.max(0, 1 - effectiveFeather)
  const hardRadiusSquared = hardRadius * hardRadius
  if (normalizedDistanceSquared <= hardRadiusSquared) {
    return 1
  }
  const normalizedDistance = Math.sqrt(Math.max(0, normalizedDistanceSquared))
  const edgeT = clamp01((normalizedDistance - hardRadius) / Math.max(effectiveFeather, 1e-6))
  const smoothstep = edgeT * edgeT * (3 - 2 * edgeT)
  return 1 - smoothstep
}

export function applyGroundPaintBrushFallback(input: GroundPaintBrushKernelInput): GroundPaintBrushKernelOutput {
  const resolution = Math.max(1, Math.trunc(input.tileResolution))
  const mask = input.mask.slice()
  const radius = Math.max(0, input.radius)
  const radiusSq = radius * radius
  const feather = clamp01(input.feather)
  const strength = clamp01(input.strength)
  let dirty = false
  if (mask.length !== resolution * resolution) {
    return { dirty: false, mask }
  }
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const dx = x + 0.5 - input.centerX
      const dy = y + 0.5 - input.centerY
      const distanceSq = dx * dx + dy * dy
      if (distanceSq >= radiusSq) {
        continue
      }
      const falloff = computeSoftBrushFalloff(distanceSq / Math.max(radiusSq, 1e-6), feather)
      const amount = clamp01(falloff) * strength
      if (amount <= 0) {
        continue
      }
      const index = y * resolution + x
      const current = mask[index] ?? 0
      const next = input.erase
        ? Math.max(0, Math.round(current - amount * 255))
        : Math.min(255, Math.round(current + amount * 255))
      if (next !== current) {
        mask[index] = next
        dirty = true
      }
    }
  }
  return { dirty, mask }
}

export function bakeGroundPaintChunkFallback(input: GroundPaintBakeKernelInput): GroundPaintBakeKernelOutput {
  return {
    pixels: input.baseColor.slice(),
  }
}