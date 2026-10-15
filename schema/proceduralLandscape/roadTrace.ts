import type { TerrainHeightGrid } from './terrainSampler'
import { clamp, hashUnit, wrapAngle } from './noise'
import type { RoadWaypoint } from './roadWaypoints'

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
  /**
   * Hand-drawn guide waypoints in world XZ (proceduralLandscape road path).
   * Two or more points switch the tracer into guide mode: the road starts at
   * the first point, heads toward the second one and then pursues every
   * following point in order within `waypointTolerance`.
   */
  waypoints?: ReadonlyArray<RoadWaypoint> | null
  /** Guide tolerance in meters (default 12). */
  waypointTolerance?: number
}

export interface RoadTraceNode {
  x: number
  z: number
  y: number
  heading: number
  /**
   * 官方 midline 节点字段（墙体 / 划线判定用，语义与 lab `core/roadTrace.ts` 一致）：
   *  - `index`：节点序号 `i`（起点 = 0）；
   *  - `lateral`：侧向梯度 `g = (feelL - feelR) / feelDist / maxSlope`（1.0 = 坡度上限）；
   *  - `longitudinal`：纵向梯度 `gf = (feelAvg - feelAhead) / feelDist / maxSlope`；
   *  - `turn`：转向需求 `t`（-1..1）；
   *  - `headingDelta`：本节点实际转角 `da`（弧度）。
   */
  index: number
  lateral: number
  longitudinal: number
  turn: number
  headingDelta: number
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
const WAYPOINT_TOLERANCE_DEFAULT = 12
/** In guide mode the tracer may turn up to 45° per step to pursue a waypoint. */
const WAYPOINT_TURN_LIMIT_RAD = Math.PI / 4
/** Weight of the heading-to-waypoint error inside the candidate cost. */
const WAYPOINT_ANGLE_COST_WEIGHT = 2

type Candidate = {
  valid: boolean
  cost: number
  deltaAngle: number
  x: number
  z: number
  y: number
}

function sanitizeTraceWaypoints(
  value: RoadTraceOptions['waypoints'],
): Array<RoadWaypoint> {
  if (!Array.isArray(value)) {
    return []
  }
  const out: Array<RoadWaypoint> = []
  for (const entry of value) {
    const x = Number(entry?.x)
    const z = Number(entry?.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    out.push({ x, z })
  }
  return out
}

/**
 * Guide-mode heading: aim at the second waypoint from the resolved start.
 * Falls back to the caller supplied heading when both points coincide.
 */
function resolveWaypointHeadingRad(
  waypoints: ReadonlyArray<RoadWaypoint>,
  startX: number,
  startZ: number,
  fallbackHeadingRad: number,
): number {
  const second = waypoints[1]
  if (!second) {
    return wrapAngle(fallbackHeadingRad)
  }
  const dx = second.x - startX
  const dz = second.z - startZ
  if (dx * dx + dz * dz < 1e-8) {
    return wrapAngle(fallbackHeadingRad)
  }
  return wrapAngle(Math.atan2(dz, dx))
}

function evaluateCandidate(
  grid: TerrainHeightGrid,
  options: RoadTraceOptions,
  currentX: number,
  currentZ: number,
  currentY: number,
  heading: number,
  deltaAngle: number,
  guidanceHeadingRad: number | null = null,
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
  if (guidanceHeadingRad != null) {
    // Guide mode: steer toward the current waypoint. The weight dominates the
    // slope/feel terms so the road bends only because the terrain forces it.
    const error = Math.abs(wrapAngle(guidanceHeadingRad - nextHeading))
    cost += WAYPOINT_ANGLE_COST_WEIGHT * (error / Math.PI)
  }

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
  const waypoints = sanitizeTraceWaypoints(options.waypoints)
  const waypointMode = waypoints.length >= 2
  const waypointTolerance = Number.isFinite(options.waypointTolerance)
    ? Math.max(1, options.waypointTolerance as number)
    : WAYPOINT_TOLERANCE_DEFAULT
  const start = resolveRoadStart(
    grid,
    waypointMode ? waypoints[0]!.x : options.startX,
    waypointMode ? waypoints[0]!.z : options.startZ,
  )
  if (!start) {
    return { nodes: [], length: 0, complete: false, failureReason: 'start-outside-terrain', rescueTurns: 0 }
  }

  let x = start.x
  let z = start.z
  let y = start.y
  let heading = waypointMode
    ? resolveWaypointHeadingRad(waypoints, start.x, start.z, options.headingRad)
    : wrapAngle(options.headingRad)
  // Index of the waypoint currently pursued (0 is the start itself).
  let targetIndex = waypointMode ? 1 : -1

  const nodes: RoadTraceNode[] = [{
    x,
    z,
    y,
    heading,
    index: 0,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
  }]
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

    const tracking = waypointMode && targetIndex >= 1 && targetIndex < waypoints.length
    const target = tracking ? waypoints[targetIndex]! : null
    const headingToTarget = target ? Math.atan2(target.z - z, target.x - x) : null
    const guidanceHeadingRad = headingToTarget

    let best: Candidate | null = null
    const deltas: number[] = []
    for (const fraction of TURN_FRACTIONS) {
      deltas.push(fraction * options.maxTurnRad)
    }
    if (guidanceHeadingRad != null) {
      // Guide mode adds a direct pursuit pair so the road can actually take
      // the drawn corners instead of only nudging within maxTurnRad.
      const pursuit = clamp(
        wrapAngle(guidanceHeadingRad - heading),
        -WAYPOINT_TURN_LIMIT_RAD,
        WAYPOINT_TURN_LIMIT_RAD,
      )
      deltas.push(pursuit, -pursuit)
    }
    for (const delta of deltas) {
      const candidate = evaluateCandidate(
        grid,
        options,
        x,
        z,
        y,
        heading,
        delta,
        guidanceHeadingRad,
      )
      if (candidate.valid && (!best || candidate.cost < best.cost)) {
        best = candidate
      }
    }

    if (!best) {
      // Rescue scan: slowroads also allows larger corrections when a normal
      // step has no admissible direction. Widening the search keeps the road
      // moving instead of dead-stopping at a single steep patch.
      const rescueLevels = guidanceHeadingRad != null
        ? Math.max(RESCUE_LEVELS, Math.ceil(WAYPOINT_TURN_LIMIT_RAD / Math.max(options.maxTurnRad, 1e-6)))
        : RESCUE_LEVELS
      let rescue: Candidate | null = null
      for (let level = 2; level <= rescueLevels; level += 1) {
        const magnitude = guidanceHeadingRad != null
          ? Math.min(level * options.maxTurnRad, WAYPOINT_TURN_LIMIT_RAD)
          : level * options.maxTurnRad
        for (const sign of [-1, 1]) {
          const candidate = evaluateCandidate(
            grid,
            options,
            x,
            z,
            y,
            heading,
            sign * magnitude,
            guidanceHeadingRad,
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

    const previousHeading = heading
    heading = wrapAngle(heading + best.deltaAngle)
    x = best.x
    z = best.z
    y = best.y
    length += options.stepLength
    nodes.push({
      x,
      z,
      y,
      heading,
      index: nodes.length,
      lateral: 0,
      longitudinal: 0,
      turn: 0,
      headingDelta: wrapAngle(heading - previousHeading),
    })

    if (waypointMode && targetIndex >= 1) {
      // Advance through every waypoint already within the guide tolerance
      // (one step may satisfy several tightly spaced points).
      while (targetIndex < waypoints.length) {
        const waypoint = waypoints[targetIndex]!
        if (Math.hypot(waypoint.x - x, waypoint.z - z) <= waypointTolerance) {
          targetIndex += 1
        } else {
          break
        }
      }
      if (targetIndex >= waypoints.length) {
        // Guide mode ends at the last hand-drawn point: no free tail.
        complete = true
        failureReason = 'reached-waypoint-end'
        break
      }
    }

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

  annotateRoadNodes(grid, options, nodes)

  return { nodes, length, complete, failureReason, rescueTurns }
}

/**
 * 官方 `A.gradLat / A.gradLon / A.bT` 的等价探针（在**轨迹完成后**逐节点计算）：
 * 墙体与划线判定都吃这三个量，它们必须和 lab 一样挂在节点上而不是临时算。
 * 梯度按 `feelDistance × maxSlope` 归一化（1.0 = 该路段坡度上限），与官方
 * `gradLat /= maxGrad` 同口径。
 */
function annotateRoadNodes(
  grid: TerrainHeightGrid,
  options: RoadTraceOptions,
  nodes: RoadTraceNode[],
): void {
  const feel = Math.max(1e-3, options.feelDistance)
  const angle = options.feelAngleRad
  const scale = feel * Math.max(1e-3, options.maxSlope)
  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const ahead = node.y
    const leftY = grid.sampleHeight(
      node.x + Math.cos(node.heading - angle) * feel,
      node.z + Math.sin(node.heading - angle) * feel,
    )
    const rightY = grid.sampleHeight(
      node.x + Math.cos(node.heading + angle) * feel,
      node.z + Math.sin(node.heading + angle) * feel,
    )
    if (leftY == null || rightY == null) {
      continue
    }
    const average = (leftY + rightY) / 2
    const difference = (rightY - leftY) / 2
    node.lateral = (leftY - rightY) / scale
    node.longitudinal = (average - ahead) / scale
    node.turn = difference !== 0 ? clamp((average - ahead) / difference, -1, 1) : 0
  }
}
