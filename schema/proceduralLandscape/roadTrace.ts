import type { TerrainHeightGrid } from './terrainSampler'
import { clamp, hashUnit, wrapAngle } from './noise'

export interface RoadTraceOptions {
  startX: number
  startZ: number
  headingRad: number
  stepLength: number
  feelDistance: number
  feelAngleRad: number
  maxSlope: number
  maxTurnRad: number
  maxLength: number | null
  margin: number
}

export interface RoadTraceNode {
  x: number
  z: number
  y: number
  heading: number
}

export interface RoadTraceResult {
  nodes: RoadTraceNode[]
  length: number
  complete: boolean
  failureReason: string | null
  rescueTurns: number
}

const MAX_STEPS = 4096
const TURN_FRACTIONS = [0, -0.35, 0.35, -0.7, 0.7, -1, 1]
const RESCUE_LEVELS = 12

type Candidate = {
  valid: boolean
  cost: number
  deltaAngle: number
  x: number
  z: number
  y: number
}

function evaluateCandidate(
  grid: TerrainHeightGrid,
  options: RoadTraceOptions,
  currentX: number,
  currentZ: number,
  currentY: number,
  heading: number,
  deltaAngle: number,
): Candidate {
  const nextHeading = heading + deltaAngle
  const x = currentX + Math.cos(nextHeading) * options.stepLength
  const z = currentZ + Math.sin(nextHeading) * options.stepLength
  const invalid: Candidate = { valid: false, cost: Number.POSITIVE_INFINITY, deltaAngle, x, z, y: currentY }
  if (!grid.contains(x, z)) {
    return invalid
  }
  const y = grid.sampleHeight(x, z)
  if (y == null) {
    return invalid
  }
  const slope = Math.abs(y - currentY) / options.stepLength
  if (slope > options.maxSlope) {
    return invalid
  }

  let cost = slope
  // Penalize rolling sideways across the slope (slowroads' lateral gradient feel).
  const feelDistance = options.feelDistance
  const leftX = x + Math.cos(nextHeading - options.feelAngleRad) * feelDistance
  const leftZ = z + Math.sin(nextHeading - options.feelAngleRad) * feelDistance
  const rightX = x + Math.cos(nextHeading + options.feelAngleRad) * feelDistance
  const rightZ = z + Math.sin(nextHeading + options.feelAngleRad) * feelDistance
  const leftY = grid.sampleHeight(leftX, leftZ)
  const rightY = grid.sampleHeight(rightX, rightZ)
  if (leftY != null && rightY != null) {
    cost += 0.35 * (Math.abs(leftY - rightY) / (2 * feelDistance))
  }
  // Prefer keeping the wheel straight when costs are close.
  cost += 0.004 * (options.maxTurnRad > 0 ? Math.abs(deltaAngle) / options.maxTurnRad : 0)

  return { valid: true, cost, deltaAngle, x, z, y }
}

export function resolveRoadStart(
  grid: TerrainHeightGrid,
  preferredX: number,
  preferredZ: number,
): { x: number; z: number; y: number } | null {
  const centerX = clamp(preferredX, grid.minX, grid.maxX)
  const centerZ = clamp(preferredZ, grid.minZ, grid.maxZ)
  const direct = grid.sampleHeight(centerX, centerZ)
  if (direct != null) {
    return { x: centerX, z: centerZ, y: direct }
  }
  for (let ring = 1; ring <= 12; ring += 1) {
    const radius = grid.cellSize * ring * 2
    for (let step = 0; step < 8; step += 1) {
      const angle = (step / 8) * Math.PI * 2
      const x = clamp(centerX + Math.cos(angle) * radius, grid.minX, grid.maxX)
      const z = clamp(centerZ + Math.sin(angle) * radius, grid.minZ, grid.maxZ)
      const y = grid.sampleHeight(x, z)
      if (y != null) {
        return { x, z, y }
      }
    }
  }
  return null
}

export function resolveSeedHeadingRad(seed: number): number {
  return hashUnit(seed >>> 0, 17, 29) * Math.PI * 2
}

export function traceRoadPath(
  grid: TerrainHeightGrid,
  options: RoadTraceOptions,
): RoadTraceResult {
  const start = resolveRoadStart(grid, options.startX, options.startZ)
  if (!start) {
    return { nodes: [], length: 0, complete: false, failureReason: 'start-outside-terrain', rescueTurns: 0 }
  }

  let x = start.x
  let z = start.z
  let y = start.y
  let heading = wrapAngle(options.headingRad)

  const nodes: RoadTraceNode[] = [{ x, z, y, heading }]
  let length = 0
  let complete = false
  let failureReason: string | null = null
  let rescueTurns = 0

  for (let stepIndex = 0; stepIndex < MAX_STEPS; stepIndex += 1) {
    const straightX = x + Math.cos(heading) * options.stepLength
    const straightZ = z + Math.sin(heading) * options.stepLength
    if (
      straightX < grid.minX + options.margin
      || straightX > grid.maxX - options.margin
      || straightZ < grid.minZ + options.margin
      || straightZ > grid.maxZ - options.margin
    ) {
      complete = true
      failureReason = 'reached-terrain-boundary'
      break
    }

    let best: Candidate | null = null
    for (const fraction of TURN_FRACTIONS) {
      const candidate = evaluateCandidate(
        grid,
        options,
        x,
        z,
        y,
        heading,
        fraction * options.maxTurnRad,
      )
      if (candidate.valid && (!best || candidate.cost < best.cost)) {
        best = candidate
      }
    }

    if (!best) {
      // Rescue scan: slowroads also allows larger corrections when a normal
      // step has no admissible direction. Widening the search keeps the road
      // moving instead of dead-stopping at a single steep patch.
      let rescue: Candidate | null = null
      for (let level = 2; level <= RESCUE_LEVELS; level += 1) {
        for (const sign of [-1, 1]) {
          const candidate = evaluateCandidate(
            grid,
            options,
            x,
            z,
            y,
            heading,
            sign * level * options.maxTurnRad,
          )
          if (candidate.valid && (!rescue || candidate.cost < rescue.cost)) {
            rescue = candidate
          }
        }
        if (rescue) {
          break
        }
      }
      if (rescue) {
        rescueTurns += 1
        best = rescue
      }
    }

    if (!best) {
      complete = false
      failureReason = 'blocked'
      break
    }

    heading = wrapAngle(heading + best.deltaAngle)
    x = best.x
    z = best.z
    y = best.y
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

  // Smooth the profile so the visual flattening does not follow every bump,
  // while never letting the road float far away from the terrain.
  if (nodes.length > 2) {
    const original = nodes.map((node) => node.y)
    for (let i = 1; i < nodes.length - 1; i += 1) {
      const smoothed = (original[i - 1]! + original[i]! * 2 + original[i + 1]!) / 4
      nodes[i]!.y = clamp(smoothed, original[i]! - 0.75, original[i]! + 0.75)
    }
  }

  return { nodes, length, complete, failureReason, rescueTurns }
}
