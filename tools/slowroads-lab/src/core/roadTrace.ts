import type { Heightfield } from './heightfield'
import { clamp, hashUnit, wrapAngle } from './noise'

/**
 * slowroads-style road midline tracing, following the probe formulas from the
 * original `extendMidline`: left/right/ahead height probes build lateral and
 * longitudinal gradients, the steering target comes from `(feelAvg - feelAhead)
 * / feelDif`, the admissible band comes from the slope limit and the per-step
 * change is limited by `0.5 + 0.5 * |gradAvg|`. When a normal step is blocked
 * the probe widens (slowroads' rescue behaviour) before giving up.
 */
export interface RoadTraceOptions {
  startX: number
  startZ: number
  headingRad: number
  stepLength: number
  feelDistance: number
  feelAngleRad: number
  /** Rise/run slope the road refuses to climb. */
  slopeLimit: number
  maxTurnRad: number
  maxLength: number | null
  margin: number
}

export interface RoadNode {
  x: number
  z: number
  y: number
  heading: number
}

export interface RoadTraceResult {
  nodes: RoadNode[]
  length: number
  complete: boolean
  failureReason: string | null
  rescueTurns: number
}

const MAX_STEPS = 4096

export function resolveSeedHeadingRad(seed: number): number {
  return hashUnit(seed >>> 0, 17, 29) * Math.PI * 2
}

export function resolveRoadStart(
  field: Heightfield,
  preferredX: number,
  preferredZ: number,
): { x: number; z: number; y: number } | null {
  const centerX = clamp(preferredX, -field.halfSize, field.halfSize)
  const centerZ = clamp(preferredZ, -field.halfSize, field.halfSize)
  for (let ring = 0; ring <= 16; ring += 1) {
    const radius = ring * 8
    const steps = ring === 0 ? 1 : 12
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2
      const x = centerX + Math.cos(angle) * radius
      const z = centerZ + Math.sin(angle) * radius
      if (!field.inBounds(x, z, 8)) {
        continue
      }
      return { x, z, y: field.sampleHeight(x, z) }
    }
  }
  return null
}

export function traceRoadPath(
  field: Heightfield,
  options: RoadTraceOptions,
): RoadTraceResult {
  const start = resolveRoadStart(field, options.startX, options.startZ)
  if (!start) {
    return { nodes: [], length: 0, complete: false, failureReason: 'start-outside-terrain', rescueTurns: 0 }
  }

  let x = start.x
  let z = start.z
  let y = start.y
  let heading = wrapAngle(options.headingRad)

  const nodes: RoadNode[] = [{ x, z, y, heading }]
  let length = 0
  let complete = false
  let failureReason: string | null = null
  let rescueTurns = 0
  let prevT = 0

  const probeHeight = (angle: number, distance: number): number => {
    const px = x + Math.cos(angle) * distance
    const pz = z + Math.sin(angle) * distance
    return field.sampleHeight(px, pz)
  }

  const evaluateStep = (candidateHeading: number): { x: number; z: number; y: number; slope: number } => {
    const nx = x + Math.cos(candidateHeading) * options.stepLength
    const nz = z + Math.sin(candidateHeading) * options.stepLength
    const ny = field.sampleHeight(nx, nz)
    return { x: nx, z: nz, y: ny, slope: Math.abs(ny - y) / options.stepLength }
  }

  for (let stepIndex = 0; stepIndex < MAX_STEPS; stepIndex += 1) {
    const straightX = x + Math.cos(heading) * options.stepLength
    const straightZ = z + Math.sin(heading) * options.stepLength
    if (!field.inBounds(straightX, straightZ, options.margin)) {
      complete = true
      failureReason = 'reached-terrain-boundary'
      break
    }

    // Probe the three feel points relative to the current heading.
    const feelAhead = probeHeight(heading, options.feelDistance)
    const feelLeft = probeHeight(heading - options.feelAngleRad, options.feelDistance)
    const feelRight = probeHeight(heading + options.feelAngleRad, options.feelDistance)

    const feelDif = (feelRight - feelLeft) / 2
    const feelAvg = (feelLeft + feelRight) / 2
    let bT = feelDif !== 0 ? (feelAvg - feelAhead) / feelDif : 0
    bT = clamp(bT, -1, 1)

    // Gradients normalized so 1.0 equals the configured slope limit
    // (slowroads divides by their slope scale, this is the lab equivalent).
    const scale = options.feelDistance * options.slopeLimit
    const gLeft = (feelLeft - feelAhead) / scale
    const gRight = (feelRight - feelAhead) / scale
    const gLat = (feelLeft - feelRight) / scale
    const gLon = (feelAvg - feelAhead) / scale

    let maxT = 1
    let minT = -1
    if (Math.abs(gLeft) > 1 || Math.abs(gRight) > 1) {
      const gDif = (gLeft - gRight) / 2
      const gAvg = (gLeft + gRight) / 2
      const bothUp = gLeft > 1 && gRight > 1
      const bothDown = gLeft < -1 && gRight < -1
      const absDif = Math.max(1e-4, Math.abs(gDif))
      if (bothUp || bothDown) {
        if (Math.abs(gLeft) < Math.abs(gRight)) {
          maxT = 1
          minT = 1
        } else {
          maxT = -1
          minT = -1
        }
      } else {
        if (Math.abs(gLeft) > 1) {
          maxT = gLeft < 0 ? (1 + gAvg) / absDif : (1 - gAvg) / absDif
        }
        if (Math.abs(gRight) > 1) {
          minT = gRight < 0 ? (1 + gAvg) / absDif : (1 - gAvg) / absDif
          minT = -minT
        }
      }
    }

    const gAvgAbs = (Math.abs(gLat) + Math.abs(gLon)) / 2
    const maxDif = 0.5 + 0.5 * gAvgAbs
    maxT *= 1.5
    minT *= 1.5
    if (maxT > 0) {
      maxT = Math.min(maxT, prevT + maxDif)
    }
    if (minT < 0) {
      minT = Math.max(minT, prevT - maxDif)
    }
    if (minT > maxT) {
      const mid = (minT + maxT) * 0.5
      minT = mid
      maxT = mid
    }
    const t = clamp(bT, minT, maxT)

    let chosenHeading = wrapAngle(heading + t * options.maxTurnRad)
    let step = evaluateStep(chosenHeading)
    let rescued = false
    if (step.slope > options.slopeLimit) {
      // Rescue: widen the scan until some direction is walkable (slowroads also
      // allows larger corrections when a normal step is blocked).
      const maxLevels = Math.max(2, Math.floor((Math.PI * 0.5) / options.maxTurnRad))
      search: for (let level = 1; level <= maxLevels; level += 1) {
        for (const sign of [-1, 1]) {
          const candidateHeading = wrapAngle(heading + sign * level * options.maxTurnRad)
          const candidate = evaluateStep(candidateHeading)
          if (candidate.slope <= options.slopeLimit) {
            chosenHeading = candidateHeading
            step = candidate
            rescued = true
            break search
          }
        }
      }
    }
    if (step.slope > options.slopeLimit) {
      complete = false
      failureReason = 'blocked'
      break
    }

    heading = chosenHeading
    x = step.x
    z = step.z
    y = step.y
    prevT = t
    if (rescued) {
      rescueTurns += 1
    }
    length += options.stepLength
    nodes.push({ x, z, y, heading })

    if (options.maxLength != null && length >= options.maxLength) {
      complete = true
      failureReason = 'reached-length-limit'
      break
    }
  }

  if (nodes.length >= MAX_STEPS) {
    complete = true
    failureReason = 'reached-step-limit'
  }

  // Smooth the road profile without letting it float away from the terrain.
  if (nodes.length > 2) {
    const original = nodes.map((node) => node.y)
    for (let i = 1; i < nodes.length - 1; i += 1) {
      const smoothed = (original[i - 1]! + original[i]! * 2 + original[i + 1]!) / 4
      nodes[i]!.y = clamp(smoothed, original[i]! - 0.75, original[i]! + 0.75)
    }
  }

  return { nodes, length, complete, failureReason, rescueTurns }
}
