export type RulerAxis = 'x' | 'y'

export type RulerStepSpec = {
  majorStepMeters: number
  minorStepMeters: number | null
}

export type RulerTick = {
  valueMeters: number
  isMajor: boolean
}

const DEFAULT_TARGET_PX = 90
const DEFAULT_MIN_MAJOR_PX = 55
const DEFAULT_MAX_MAJOR_PX = 160

export function pickMajorStepMeters(ppm: number, options?: { targetPx?: number; minPx?: number; maxPx?: number }): number {
  const targetPx = options?.targetPx ?? DEFAULT_TARGET_PX
  const minPx = options?.minPx ?? DEFAULT_MIN_MAJOR_PX
  const maxPx = options?.maxPx ?? DEFAULT_MAX_MAJOR_PX

  if (!Number.isFinite(ppm) || ppm <= 1e-6) {
    return 1
  }

  const targetMeters = targetPx / ppm
  const targetExp = Math.floor(Math.log10(Math.max(1e-12, targetMeters)))

  const candidates: number[] = []
  for (let exp = targetExp - 3; exp <= targetExp + 3; exp += 1) {
    const base = 10 ** exp
    candidates.push(1 * base, 2 * base, 5 * base)
  }

  let best = candidates[0] ?? 1
  let bestScore = Number.POSITIVE_INFINITY

  for (const step of candidates) {
    if (!Number.isFinite(step) || step <= 0) continue
    const px = step * ppm
    if (!Number.isFinite(px) || px <= 0) continue

    // Prefer candidates inside [minPx, maxPx]; otherwise penalize by distance.
    const rangePenalty = px < minPx ? (minPx - px) * 2 : px > maxPx ? (px - maxPx) * 2 : 0
    const targetPenalty = Math.abs(px - targetPx)
    const score = rangePenalty + targetPenalty

    if (score < bestScore) {
      bestScore = score
      best = step
    }
  }

  return best
}

export function computeRulerSteps(ppm: number): RulerStepSpec {
  const major = pickMajorStepMeters(ppm)
  // Prefer 5 subdivisions when readable; otherwise 2; otherwise none.
  const minor5 = major / 5
  const minor2 = major / 2

  const minor5Px = minor5 * Math.max(1e-6, ppm)
  const minor2Px = minor2 * Math.max(1e-6, ppm)

  let minor: number | null = null
  if (minor5Px >= 8) {
    minor = minor5
  } else if (minor2Px >= 8) {
    minor = minor2
  }

  return { majorStepMeters: major, minorStepMeters: minor }
}

export function formatMetersValue(valueMeters: number, majorStepMeters: number): string {
  if (!Number.isFinite(valueMeters)) {
    return ''
  }
  const step = Math.abs(majorStepMeters)
  let decimals = 0
  if (step < 0.1) {
    decimals = 2
  } else if (step < 1) {
    decimals = 1
  }
  const factor = 10 ** decimals
  const rounded = Math.round(valueMeters * factor) / factor
  return decimals > 0 ? rounded.toFixed(decimals) : String(Math.round(rounded))
}

export function generateTicks(options: {
  visibleMinMeters: number
  visibleMaxMeters: number
  axisMaxMeters: number
  majorStepMeters: number
  minorStepMeters: number | null
}): { major: RulerTick[]; minor: RulerTick[] } {
  const majorStep = options.majorStepMeters
  if (!Number.isFinite(majorStep) || majorStep <= 0) {
    return { major: [], minor: [] }
  }

  const min = Math.max(0, Math.min(options.visibleMinMeters, options.visibleMaxMeters))
  const max = Math.max(0, Math.max(options.visibleMinMeters, options.visibleMaxMeters))
  const clampedMin = Math.max(0, min)
  const clampedMax = Math.min(Math.max(0, options.axisMaxMeters), max)

  if (!(clampedMax > clampedMin)) {
    return { major: [], minor: [] }
  }

  const startMajor = Math.ceil(clampedMin / majorStep) * majorStep
  const endMajor = clampedMax

  const major: RulerTick[] = []
  for (let v = startMajor; v <= endMajor + majorStep * 1e-6; v += majorStep) {
    if (v < 0) continue
    if (v > options.axisMaxMeters) continue
    major.push({ valueMeters: v, isMajor: true })
  }

  const minor: RulerTick[] = []
  const minorStep = options.minorStepMeters
  if (minorStep && Number.isFinite(minorStep) && minorStep > 0) {
    const startMinor = Math.ceil(clampedMin / minorStep) * minorStep
    const endMinor = clampedMax
    for (let v = startMinor; v <= endMinor + minorStep * 1e-6; v += minorStep) {
      if (v < 0) continue
      if (v > options.axisMaxMeters) continue
      // Skip if it coincides with a major tick.
      const mod = v % majorStep
      const isMajor = Math.abs(mod) < 1e-6 || Math.abs(mod - majorStep) < 1e-6
      if (!isMajor) {
        minor.push({ valueMeters: v, isMajor: false })
      }
    }
  }

  return { major, minor }
}
