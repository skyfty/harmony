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
      if (distanceSq > radiusSq) {
        continue
      }
      const distance = Math.sqrt(distanceSq)
      const normalizedDistance = radius > 0 ? distance / radius : 0
      const falloffStart = 1 - feather
      const falloff = feather <= 0
        ? 1
        : normalizedDistance <= falloffStart
          ? 1
          : 1 - (normalizedDistance - falloffStart) / Math.max(1e-6, feather)
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