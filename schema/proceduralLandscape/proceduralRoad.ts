import { clamp, hashUnit, wrapAngle } from './noise'
import {
  resolveSeedHeadingRad,
  traceRoadPath,
  type RoadTraceNode,
  type RoadTraceResult,
} from './roadTrace'
import type { RoadWaypoint } from './roadWaypoints'
import type { TerrainHeightGrid } from './terrainSampler'
import {
  resolveNaturalRoadPlan,
  SLOWROADS_SCENIC_ROAD_CONSTRAINTS,
  summarizeScenicRoadTerrain,
  traceOfficialScenicGuidedRoad,
  traceOfficialScenicNaturalRoad,
} from './officialScenicRoad'
import { buildGlobalScenicGuide } from './globalScenicGuide'
import {
  DEFAULT_ROAD_STYLE,
  resolveSlowroadsMidlineProfile,
  type RoadStyleId,
} from './roadStyle'
import {
  validateRoadCenterlineGeometry,
  type RoadGeometryValidation,
} from './roadGeometry'
import {
  smoothPlanarCenterline,
} from './centerlineBezier'
import {
  isPointExcluded,
  segmentIntersectsExclusion,
  type LandscapeExclusionCircle,
} from './exclusion'

export interface WaypointRoadPlanOptions {
  waypoints: RoadWaypoint[]
  strategy: 'seeded' | 'shortest'
  termination: 'loop' | 'boundary' | 'dead-end'
  /**
   * DEM roadbeds can flatten cross-slope and cut/fill the visible terrain.
   * This mode lets authored waypoints define a smooth design centerline first.
   */
  centerlineMode?: 'terrain-following' | 'dem-roadbed-spline'
  seed: number
  waypointTolerance: number
  pathDeviation: number
  stepLength: number
  feelDistance: number
  feelAngleRad: number
  maxSlope: number
  maxTurnRad: number
  margin: number
  routeClearance?: number
  minimumTurnRadius?: number
  maximumHeadingChangeRad?: number
  style?: RoadStyleId
  exclusionCircles?: ReadonlyArray<LandscapeExclusionCircle>
  exclusionMargin?: number
}

export interface WaypointRoadPlanResult extends RoadTraceResult {
  closed: boolean
  waypointCount: number
  waypointsPassed: number
  maxWaypointError: number
  closureHeadingErrorRad: number
  shortestExpandedStates: number
  /** Official Hills midline guard diagnostics (seeded strategy only). */
  officialReverts?: number
  antiTargetTriggers?: number
  turnOverflows?: number
  averageElevationPercentile?: number
  maxElevationPercentile?: number
  maxForwardGrade?: number
  maxCrossSlope?: number
  lowlandCoverageFraction?: number
  steepReplacementSteps?: number
  waypointsSkipped?: number
  skippedWaypointIndices?: number[]
  waypointsAttempted?: number
  plannerMode?: 'official' | 'guided-global' | 'official-natural' | 'waypoint-spline' | 'cached-centerline'
  guideExpandedStates?: number
  maxGuideDeviation?: number
  unreachableWaypointIndex?: number | null
  smoothingFallback?: boolean
  smoothingFallbackReason?: string | null
  detourRadius?: number
  maxDetourDistance?: number
  detourRadiusExpanded?: boolean
  minCenterlineClearance?: number
  minTurnRadius?: number
  maxHeadingChangeRad?: number
  geometryAutoRepaired?: boolean
  autoRepairRoundedCorners?: number
  maxAutoRepairWaypointOffset?: number
  effectiveWaypointTolerance?: number
  naturalTargetLength?: number
  naturalLaps?: number
}

type Vec2 = { x: number; z: number }

export interface CachedCenterlineRoadOptions {
  /** World-space centerline sampled by the editor when the route was generated. */
  centerline: ReadonlyArray<RoadWaypoint>
  termination: 'loop' | 'boundary' | 'dead-end'
  feelDistance: number
  feelAngleRad: number
  maxSlope: number
  waypointCount?: number
}

const AUTO_REPAIR_WAYPOINT_TOLERANCE = 30

const MAX_SHORTEST_EXPANSIONS = 250_000
const MAX_PLANNING_CELLS_PER_AXIS = 768
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

function scoreSeededSegment(
  grid: TerrainHeightGrid,
  points: Vec2[],
  maxSlope: number,
): { cost: number; points: Vec2[] } | null {
  if (points.length < 2) {
    return null
  }
  let cost = 0
  let previousY: number | null = null
  let previousHeading: number | null = null
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!
    if (!grid.contains(point.x, point.z)) {
      return null
    }
    const y = grid.sampleHeight(point.x, point.z)
    if (y == null) {
      return null
    }
    if (index > 0 && previousY != null) {
      const previous = points[index - 1]!
      const segmentLength = Math.max(1e-6, distance(previous, point))
      const slope = Math.abs(y - previousY) / segmentLength
      if (slope > maxSlope * 1.08) {
        return null
      }
      const heading = Math.atan2(point.z - previous.z, point.x - previous.x)
      const lateralX = -Math.sin(heading)
      const lateralZ = Math.cos(heading)
      const leftY = grid.sampleHeight(
        point.x + lateralX * 8,
        point.z + lateralZ * 8,
      )
      const rightY = grid.sampleHeight(
        point.x - lateralX * 8,
        point.z - lateralZ * 8,
      )
      cost += segmentLength + slope * 35
      if (leftY != null && rightY != null) {
        cost += Math.abs(leftY - rightY) * 1.1
      }
      if (previousHeading != null) {
        cost += Math.abs(wrapAngle(heading - previousHeading)) * 22
      }
      previousHeading = heading
    }
    previousY = y
  }
  return { cost, points }
}

function singlePointLoopAnchors(
  grid: TerrainHeightGrid,
  origin: Vec2,
  seed: number,
  stepLength: number,
  maxSlope = 0.55,
): Vec2[] | null {
  const spanX = grid.maxX - grid.minX
  const spanZ = grid.maxZ - grid.minZ
  const diagonal = Math.hypot(spanX, spanZ)
  if (!(diagonal > 1)) {
    return null
  }
  const targetDiameter = diagonal * (0.08 + hashUnit(seed, 23, 41) * 0.12)
  let radius = Math.max(100, targetDiameter * 0.5)
  const heading = resolveSeedHeadingRad(seed)
  const centerNormal = { x: -Math.sin(heading), z: Math.cos(heading) }
  const count = 6 + Math.floor(hashUnit(seed, 29, 43) * 3)
  const margin = Math.max(stepLength * 8, 80)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const center = {
      x: origin.x + centerNormal.x * radius,
      z: origin.z + centerNormal.z * radius,
    }
    const anchors: Vec2[] = [{ ...origin }]
    let valid = true
    for (let index = 1; index < count; index += 1) {
      const angle = heading - Math.PI / 2 + (index / count) * Math.PI * 2
      const jitter = 0.85 + hashUnit(seed, 31 + index * 7, 47) * 0.3
      const point = {
        x: center.x + Math.cos(angle) * radius * jitter,
        z: center.z + Math.sin(angle) * radius * jitter,
      }
      if (
        point.x < grid.minX + margin
        || point.x > grid.maxX - margin
        || point.z < grid.minZ + margin
        || point.z > grid.maxZ - margin
        || grid.sampleHeight(point.x, point.z) == null
      ) {
        valid = false
        break
      }
      const previous = anchors[anchors.length - 1]!
      const segmentLength = Math.max(1e-6, distance(previous, point))
      const previousY = grid.sampleHeight(previous.x, previous.z)
      let routeY = previousY
      for (let sample = 1; sample <= 6; sample += 1) {
        const t = sample / 6
        const x = previous.x + (point.x - previous.x) * t
        const z = previous.z + (point.z - previous.z) * t
        const y = grid.sampleHeight(x, z)
        if (y == null || (routeY != null && Math.abs(y - routeY) / (segmentLength / 6) > maxSlope)) {
          valid = false
          break
        }
        routeY = y
      }
      if (!valid) {
        break
      }
      anchors.push(point)
    }
    if (valid) {
      return anchors
    }
    radius *= 0.8
    if (radius < Math.max(100, diagonal * 0.02)) {
      break
    }
  }
  return null
}

class MinHeap {
  private readonly priorities: number[] = []
  private readonly states: number[] = []

  get size(): number {
    return this.states.length
  }

  push(state: number, priority: number): void {
    let index = this.states.length
    this.states.push(state)
    this.priorities.push(priority)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.priorities[parent]! <= priority) {
        break
      }
      this.states[index] = this.states[parent]!
      this.priorities[index] = this.priorities[parent]!
      index = parent
    }
    this.states[index] = state
    this.priorities[index] = priority
  }

  pop(): { state: number; priority: number } | null {
    if (!this.states.length) {
      return null
    }
    const state = this.states[0]!
    const priority = this.priorities[0]!
    const lastState = this.states.pop()!
    const lastPriority = this.priorities.pop()!
    if (this.states.length) {
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        if (left >= this.states.length) {
          break
        }
        const child = right < this.states.length
          && this.priorities[right]! < this.priorities[left]!
          ? right
          : left
        if (this.priorities[child]! >= lastPriority) {
          break
        }
        this.states[index] = this.states[child]!
        this.priorities[index] = this.priorities[child]!
        index = child
      }
      this.states[index] = lastState
      this.priorities[index] = lastPriority
    }
    return { state, priority }
  }
}

function planShortestLeg(
  grid: TerrainHeightGrid,
  start: Vec2,
  end: Vec2,
  options: WaypointRoadPlanOptions,
): { points: Vec2[] | null; expanded: number } {
  const exclusionCircles = options.exclusionCircles ?? []
  const exclusionMargin = Math.max(0, options.exclusionMargin ?? 0)
  if (
    isPointExcluded(start.x, start.z, exclusionCircles, exclusionMargin)
    || isPointExcluded(end.x, end.z, exclusionCircles, exclusionMargin)
  ) {
    return { points: null, expanded: 0 }
  }
  const spanX = grid.maxX - grid.minX
  const spanZ = grid.maxZ - grid.minZ
  const cellSize = Math.max(
    grid.cellSize,
    Math.ceil(Math.max(spanX, spanZ) / MAX_PLANNING_CELLS_PER_AXIS),
  )
  const cols = Math.max(2, Math.ceil(spanX / cellSize) + 1)
  const rows = Math.max(2, Math.ceil(spanZ / cellSize) + 1)
  const heights = new Float32Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = grid.minX + col * cellSize
      const z = grid.minZ + row * cellSize
      heights[row * cols + col] = grid.sampleHeight(x, z) ?? Number.NaN
    }
  }
  const cellOf = (point: Vec2): { col: number; row: number } => ({
    col: clamp(Math.round((point.x - grid.minX) / cellSize), 0, cols - 1),
    row: clamp(Math.round((point.z - grid.minZ) / cellSize), 0, rows - 1),
  })
  const startCell = cellOf(start)
  const endCell = cellOf(end)
  const startIndex = startCell.row * cols + startCell.col
  const endIndex = endCell.row * cols + endCell.col
  const distances = new Map<number, number>()
  const parents = new Map<number, number>()
  const closedStates = new Set<number>()
  const heap = new MinHeap()
  for (let direction = 0; direction < 8; direction += 1) {
    const state = startIndex * 8 + direction
    distances.set(state, 0)
    heap.push(state, 0)
  }
  let resultState: number | null = null
  let expanded = 0
  while (heap.size && expanded < MAX_SHORTEST_EXPANSIONS) {
    const top = heap.pop()
    if (!top) {
      break
    }
    const currentState = top.state
    if (closedStates.has(currentState)) {
      continue
    }
    closedStates.add(currentState)
    const currentDistance = distances.get(currentState)
    if (currentDistance == null) {
      continue
    }
    const cellIndex = Math.floor(currentState / 8)
    const direction = currentState % 8
    if (cellIndex === endIndex) {
      resultState = currentState
      break
    }
    expanded += 1
    const col = cellIndex % cols
    const row = Math.floor(cellIndex / cols)
    const currentHeight = heights[cellIndex]!
    if (!Number.isFinite(currentHeight)) {
      continue
    }
    for (let nextDirection = 0; nextDirection < 8; nextDirection += 1) {
      const [dx, dz] = DIRECTIONS[nextDirection]!
      const nextCol = col + dx
      const nextRow = row + dz
      if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) {
        continue
      }
      const nextIndex = nextRow * cols + nextCol
      const nextHeight = heights[nextIndex]!
      if (!Number.isFinite(nextHeight)) {
        continue
      }
      const nextX = grid.minX + nextCol * cellSize
      const nextZ = grid.minZ + nextRow * cellSize
      const currentX = grid.minX + col * cellSize
      const currentZ = grid.minZ + row * cellSize
      if (
        isPointExcluded(nextX, nextZ, exclusionCircles, exclusionMargin)
        || segmentIntersectsExclusion(
          currentX,
          currentZ,
          nextX,
          nextZ,
          exclusionCircles,
          exclusionMargin,
        )
      ) {
        continue
      }
      const segmentLength = Math.hypot(dx, dz) * cellSize
      const slope = Math.abs(nextHeight - currentHeight) / segmentLength
      if (slope > options.maxSlope * 1.05) {
        continue
      }
      const turnUnits = Math.min(
        Math.abs(nextDirection - direction),
        8 - Math.abs(nextDirection - direction),
      )
      const turnCost = (turnUnits / 4) * cellSize
      const slopeNorm = slope / Math.max(1e-4, options.maxSlope)
      const leftCol = nextCol - dz
      const leftRow = nextRow + dx
      const rightCol = nextCol + dz
      const rightRow = nextRow - dx
      const leftHeight = leftCol >= 0 && leftCol < cols && leftRow >= 0 && leftRow < rows
        ? heights[leftRow * cols + leftCol]!
        : nextHeight
      const rightHeight = rightCol >= 0 && rightCol < cols && rightRow >= 0 && rightRow < rows
        ? heights[rightRow * cols + rightCol]!
        : nextHeight
      const crossSlope = Number.isFinite(leftHeight) && Number.isFinite(rightHeight)
        ? Math.abs(leftHeight - rightHeight) / (2 * cellSize)
        : 0
      const crossNorm = crossSlope / Math.max(1e-4, options.maxSlope)
      const nextState = nextIndex * 8 + nextDirection
      const nextDistance = currentDistance
        + segmentLength * (1 + slopeNorm * slopeNorm * 2.2 + crossNorm * crossNorm * 0.75)
        + turnCost * 0.9
      if (nextDistance >= (distances.get(nextState) ?? Number.POSITIVE_INFINITY)) {
        continue
      }
      distances.set(nextState, nextDistance)
      parents.set(nextState, currentState)
      const goalX = grid.minX + endCell.col * cellSize
      const goalZ = grid.minZ + endCell.row * cellSize
      heap.push(nextState, nextDistance + Math.hypot(goalX - nextX, goalZ - nextZ))
    }
  }
  if (resultState == null) {
    return { points: null, expanded }
  }
  const cells: number[] = []
  let cursor: number | undefined = resultState
  while (cursor != null) {
    cells.push(Math.floor(cursor / 8))
    cursor = parents.get(cursor)
  }
  cells.reverse()
  const points: Vec2[] = [{ ...start }]
  for (const index of cells) {
    const point = {
      x: grid.minX + (index % cols) * cellSize,
      z: grid.minZ + Math.floor(index / cols) * cellSize,
    }
    if (distance(points[points.length - 1]!, point) > cellSize * 0.2) {
      points.push(point)
    }
  }
  points.push({ ...end })
  return { points, expanded }
}

function smoothPolyline(
  points: ReadonlyArray<Vec2>,
  spacing: number,
  mandatoryPoints: ReadonlyArray<Vec2> = [],
  closed = false,
): Vec2[] {
  if (points.length < 3) {
    return points.map((point) => ({ ...point }))
  }
  const source = closed
    && points.length > 1
    && distance(points[0]!, points[points.length - 1]!) <= 0.01
    ? points.slice(0, -1)
    : points.slice()
  const control: Vec2[] = []
  let accumulated = spacing * 2
  for (let index = 0; index < source.length; index += 1) {
    const point = source[index]!
    const mandatory = mandatoryPoints.some((target) => distance(target, point) <= 0.01)
    if (index === 0 || (!closed && index === source.length - 1) || mandatory) {
      control.push(point)
      accumulated = spacing * 2
      continue
    }
    accumulated += distance(source[index - 1]!, point)
    if (accumulated >= spacing * 3) {
      control.push(point)
      accumulated = 0
    }
  }
  if (!closed && control[control.length - 1] !== source[source.length - 1]) {
    control.push(source[source.length - 1]!)
  }
  if (closed && control.length < 3) {
    return source.map((point) => ({ ...point }))
  }
  const output: Vec2[] = []
  const segmentCount = closed ? control.length : control.length - 1
  for (let index = 0; index < segmentCount; index += 1) {
    const p0 = control[closed ? (index - 1 + control.length) % control.length : Math.max(0, index - 1)]!
    const p1 = control[index]!
    const p2 = control[(index + 1) % control.length]!
    const p3 = control[closed ? (index + 2) % control.length : Math.min(control.length - 1, index + 2)]!
    const segmentLength = distance(p1, p2)
    const count = Math.max(1, Math.ceil(segmentLength / spacing))
    for (let step = 0; step <= count; step += 1) {
      if (index > 0 && step === 0) {
        continue
      }
      if (closed && step === count) {
        continue
      }
      const t = step / count
      const t2 = t * t
      const t3 = t2 * t
      output.push({
        x: 0.5 * (
          2 * p1.x
          + (-p0.x + p2.x) * t
          + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
          + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        ),
        z: 0.5 * (
          2 * p1.z
          + (-p0.z + p2.z) * t
          + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2
          + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
        ),
      })
    }
  }
  output[0] = { ...source[0]! }
  if (closed) {
    output.push({ ...source[0]! })
  } else {
    output[output.length - 1] = { ...source[source.length - 1]! }
  }
  return output
}

type WaypointTerrainOffset = {
  waypointX: number
  waypointZ: number
  offsetX: number
  offsetZ: number
}

/**
 * Mandatory waypoints may sit on a steep sidehill. A smooth line through the
 * exact point would have to cross the fall line, so allow the alignment to
 * settle slightly downhill inside the existing waypoint tolerance disc.
 */
function resolveWaypointTerrainOffsets(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  waypoints: ReadonlyArray<Vec2>,
  waypointTolerance: number,
  anchors: ReadonlyArray<{ waypointIndex: number; nodeIndex: number; distance: number }>,
): WaypointTerrainOffset[] {
  const offsets: WaypointTerrainOffset[] = []
  const crossLimit = SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope * 1.08
  const spacing = Math.max(1, grid.cellSize)
  for (const anchor of anchors) {
    const { waypointIndex, nodeIndex, distance: nodeDistance } = anchor
    const waypoint = waypoints[waypointIndex]!
    const node = nodes[nodeIndex]!
    const previous = nodes[nodeIndex - 1]!
    const next = nodes[Math.min(nodes.length - 1, nodeIndex + 1)]!
    const heading = Math.atan2(next.z - previous.z, next.x - previous.x)
    const sampleGradient = (x: number, z: number): { x: number; z: number } | null => {
      const west = grid.sampleHeight(x - spacing, z)
      const east = grid.sampleHeight(x + spacing, z)
      const north = grid.sampleHeight(x, z - spacing)
      const south = grid.sampleHeight(x, z + spacing)
      return west == null || east == null || north == null || south == null
        ? null
        : {
            x: (east - west) / (spacing * 2),
            z: (south - north) / (spacing * 2),
          }
    }
    const crossSlopeAt = (x: number, z: number): number => {
      const gradient = sampleGradient(x, z)
      return gradient
        ? Math.abs(
            -Math.sin(heading) * gradient.x
            + Math.cos(heading) * gradient.z,
          )
        : Number.POSITIVE_INFINITY
    }
    const currentCrossSlope = crossSlopeAt(node.x, node.z)
    if (currentCrossSlope <= crossLimit) {
      continue
    }
    const gradient = sampleGradient(node.x, node.z)
    if (!gradient) {
      continue
    }
    const normalX = -Math.sin(heading)
    const normalZ = Math.cos(heading)
    const lateralSlope = normalX * gradient.x + normalZ * gradient.z
    if (Math.abs(lateralSlope) <= 1e-6) {
      continue
    }
    const direction = lateralSlope > 0 ? -1 : 1
    const directionX = normalX * direction
    const directionZ = normalZ * direction
    const maxOffset = Math.max(
      0,
      waypointTolerance - nodeDistance - 0.01,
    )
    if (maxOffset <= 0) {
      continue
    }
    const step = Math.max(0.5, waypointTolerance / 10)
    let bestOffset = 0
    let bestCrossSlope = currentCrossSlope
    const sampleOffsets: number[] = []
    for (let offset = Math.min(step, maxOffset); offset < maxOffset - 1e-6; offset += step) {
      sampleOffsets.push(offset)
    }
    sampleOffsets.push(maxOffset)
    for (const offset of sampleOffsets) {
      const candidate = crossSlopeAt(
        node.x + directionX * offset,
        node.z + directionZ * offset,
      )
      if (candidate < bestCrossSlope) {
        bestCrossSlope = candidate
        bestOffset = offset
      }
    }
    if (bestOffset > 0) {
      offsets.push({
        waypointX: waypoint.x,
        waypointZ: waypoint.z,
        offsetX: directionX * bestOffset,
        offsetZ: directionZ * bestOffset,
      })
    }
  }
  return offsets
}

function applyWaypointTerrainOffsets(
  nodes: ReadonlyArray<RoadTraceNode>,
  offsets: ReadonlyArray<WaypointTerrainOffset>,
  innerRadius: number,
): Vec2[] {
  const outerRadius = innerRadius * 1.75
  return nodes.map((node) => {
    let x = node.x
    let z = node.z
    for (const offset of offsets) {
      const distanceToWaypoint = Math.hypot(
        node.x - offset.waypointX,
        node.z - offset.waypointZ,
      )
      if (distanceToWaypoint >= outerRadius) {
        continue
      }
      const weight = distanceToWaypoint <= innerRadius
        ? 1
        : 1 - (distanceToWaypoint - innerRadius)
          / (outerRadius - innerRadius)
      x += offset.offsetX * weight
      z += offset.offsetZ * weight
    }
    return { x, z }
  })
}

type CenterlineSmoothingAttempt = {
  nodes: RoadTraceNode[] | null
  failureReason: string | null
}

type CenterlineSmoothingResult = {
  nodes: RoadTraceNode[]
  smoothingFallback: boolean
  failureReason: string | null
}

function rebuildSmoothedNodeGeometry(
  grid: TerrainHeightGrid,
  points: ReadonlyArray<Vec2>,
  yOffset: number,
  closed = false,
): RoadTraceNode[] | null {
  const nodes: RoadTraceNode[] = []
  for (const point of points) {
    const surfaceY = grid.sampleHeight(point.x, point.z)
    if (surfaceY == null) {
      return null
    }
    nodes.push(makeNode(point, surfaceY + yOffset, 0, nodes.length))
  }
  if (nodes.length < 3) {
    return nodes
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const previous = closed
      ? nodes[(index - 1 + nodes.length) % nodes.length]!
      : nodes[Math.max(0, index - 1)]!
    const current = nodes[index]!
    const following = closed
      ? nodes[(index + 1) % nodes.length]!
      : nodes[Math.min(nodes.length - 1, index + 1)]!
    current.index = index
    current.heading = Math.atan2(
      following.z - previous.z,
      following.x - previous.x,
    )
    current.headingDelta = index === 0
      ? 0
      : wrapAngle(current.heading - previous.heading)
  }
  return nodes
}

function attemptSmoothRoadCenterline(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  waypoints: ReadonlyArray<Vec2>,
  waypointTolerance: number,
  termination: WaypointRoadPlanOptions['termination'],
): CenterlineSmoothingAttempt {
  const anchorIndices: number[] = []
  const waypointAnchors: Array<{
    waypointIndex: number
    nodeIndex: number
    distance: number
  }> = []
  let searchStart = 1
  const lastAnchorWaypoint = termination === 'dead-end'
    ? waypoints.length - 1
    : waypoints.length
  for (let waypointIndex = 1; waypointIndex < lastAnchorWaypoint; waypointIndex += 1) {
    const waypoint = waypoints[waypointIndex]!
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = searchStart; index < nodes.length - 1; index += 1) {
      const node = nodes[index]!
      const candidate = Math.hypot(node.x - waypoint.x, node.z - waypoint.z)
      if (candidate < bestDistance) {
        bestDistance = candidate
        bestIndex = index
      }
    }
    if (bestIndex > 0 && bestDistance <= waypointTolerance) {
      anchorIndices.push(bestIndex)
      waypointAnchors.push({
        waypointIndex,
        nodeIndex: bestIndex,
        distance: bestDistance,
      })
      searchStart = bestIndex + 1
    }
  }
  const firstSurface = grid.sampleHeight(nodes[0]!.x, nodes[0]!.z)
  const yOffset = firstSurface == null ? 0 : nodes[0]!.y - firstSurface
  const waypointOffsets = resolveWaypointTerrainOffsets(
    grid,
    nodes,
    waypoints,
    waypointTolerance,
    waypointAnchors,
  )
  let failureReason: string | null = null
  for (const radius of [30, 24, 18, 12]) {
    const sourcePoints = applyWaypointTerrainOffsets(
      nodes,
      waypointOffsets,
      Math.max(32, radius * 1.25),
    )
    const rounded = smoothPlanarCenterline(
      sourcePoints,
      {
        radius,
        sampleSpacing: 2,
        controlSpacing: Math.max(10, radius * 1.1),
        closed: termination === 'loop',
        anchorIndices,
      },
    )
    const next = rebuildSmoothedNodeGeometry(grid, rounded, yOffset)
    if (!next) {
      failureReason = 'smoothing-outside-terrain'
      continue
    }
    if (next.length < 3) {
      failureReason = 'smoothing-route-too-short'
      continue
    }
    const closedError = termination === 'loop'
      ? distance(next[0]!, next[next.length - 1]!)
      : 0
    const terrain = evaluateRouteTerrain(grid, next)
    const waypointError = waypointPassStats(next, waypoints, waypointTolerance).maxError
    if (
      terrain.valid
      && closedError <= 0.5
      && waypointError <= waypointTolerance + 1e-4
    ) {
      return { nodes: next, failureReason: null }
    }
    failureReason = waypointError > waypointTolerance + 1e-4
      ? 'smoothing-waypoint-tolerance'
      : closedError > 0.5
        ? 'smoothing-loop-closure'
        : terrain.failureReason
  }
  return { nodes: null, failureReason }
}

function attemptSmoothRoadLeg(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  yOffset: number,
): RoadTraceNode[] | null {
  if (nodes.length < 3) {
    return nodes.map((node) => ({ ...node }))
  }
  for (const radius of [30, 24, 18, 12]) {
    const rounded = smoothPlanarCenterline(nodes, {
      radius,
      sampleSpacing: 2,
      controlSpacing: Math.max(10, radius * 1.1),
    })
    const next = rebuildSmoothedNodeGeometry(grid, rounded, yOffset)
    if (!next || next.length < 3) {
      continue
    }
    if (evaluateRouteTerrain(grid, next).valid) {
      return next
    }
  }
  return null
}

function resolveRoadWaypointBoundaries(
  nodes: ReadonlyArray<RoadTraceNode>,
  waypoints: ReadonlyArray<Vec2>,
  waypointTolerance: number,
): number[] | null {
  const boundaries = [0]
  let searchStart = 1
  for (let waypointIndex = 1; waypointIndex < waypoints.length; waypointIndex += 1) {
    const waypoint = waypoints[waypointIndex]!
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = searchStart; index < nodes.length; index += 1) {
      const candidate = distance(nodes[index]!, waypoint)
      if (candidate < bestDistance) {
        bestDistance = candidate
        bestIndex = index
      }
    }
    if (bestIndex < 0 || bestDistance > waypointTolerance + 1e-4) {
      return null
    }
    if (boundaries[boundaries.length - 1] !== bestIndex) {
      boundaries.push(bestIndex)
    }
    searchStart = bestIndex + 1
  }
  if (boundaries[boundaries.length - 1] !== nodes.length - 1) {
    boundaries.push(nodes.length - 1)
  }
  return boundaries
}

function attemptSmoothRoadCenterlineByLegs(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  waypoints: ReadonlyArray<Vec2>,
  waypointTolerance: number,
): CenterlineSmoothingAttempt {
  const boundaries = resolveRoadWaypointBoundaries(
    nodes,
    waypoints,
    waypointTolerance,
  )
  if (!boundaries) {
    return { nodes: null, failureReason: 'smoothing-waypoint-tolerance' }
  }
  const firstSurface = grid.sampleHeight(nodes[0]!.x, nodes[0]!.z)
  const yOffset = firstSurface == null ? 0 : nodes[0]!.y - firstSurface
  const merged: RoadTraceNode[] = []
  let failedLegs = 0
  for (let legIndex = 0; legIndex < boundaries.length - 1; legIndex += 1) {
    const startIndex = boundaries[legIndex]!
    const endIndex = boundaries[legIndex + 1]!
    const slice = nodes.slice(startIndex, endIndex + 1)
    const smoothed = attemptSmoothRoadLeg(grid, slice, yOffset)
    if (!smoothed) {
      failedLegs += 1
    }
    const chosen = smoothed ?? slice
    for (
      let index = merged.length ? 1 : 0;
      index < chosen.length;
      index += 1
    ) {
      merged.push({ ...chosen[index]!, index: merged.length })
    }
  }
  if (merged.length < 3) {
    return { nodes: null, failureReason: 'smoothing-route-too-short' }
  }
  const terrain = evaluateRouteTerrain(grid, merged)
  const waypointError = waypointPassStats(
    merged,
    waypoints,
    waypointTolerance,
  ).maxError
  if (!terrain.valid || waypointError > waypointTolerance + 1e-4) {
    return {
      nodes: null,
      failureReason: waypointError > waypointTolerance + 1e-4
        ? 'smoothing-waypoint-tolerance'
        : terrain.failureReason,
    }
  }
  return {
    nodes: merged,
    failureReason: failedLegs > 0 ? 'smoothing-partial-fallback' : null,
  }
}

/**
 * Smooth the centerline without allowing cosmetic post-processing to reject a
 * terrain-valid road. Global smoothing is attempted first; if any section is
 * too steep, legs are smoothed independently and failed legs keep their
 * original traced nodes.
 */
function smoothRoadCenterline(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  waypoints: ReadonlyArray<Vec2>,
  waypointTolerance: number,
  termination: WaypointRoadPlanOptions['termination'],
): CenterlineSmoothingResult {
  if (nodes.length < 3) {
    return {
      nodes: nodes.map((node) => ({ ...node })),
      smoothingFallback: false,
      failureReason: null,
    }
  }
  const globalAttempt = attemptSmoothRoadCenterline(
    grid,
    nodes,
    waypoints,
    waypointTolerance,
    termination,
  )
  if (globalAttempt.nodes) {
    return {
      nodes: globalAttempt.nodes,
      smoothingFallback: false,
      failureReason: null,
    }
  }
  if (termination !== 'loop') {
    const legAttempt = attemptSmoothRoadCenterlineByLegs(
      grid,
      nodes,
      waypoints,
      waypointTolerance,
    )
    if (legAttempt.nodes) {
      return {
        nodes: legAttempt.nodes,
        smoothingFallback: true,
        failureReason:
          legAttempt.failureReason ?? globalAttempt.failureReason,
      }
    }
  }
  return {
    nodes: nodes.map((node) => ({ ...node })),
    smoothingFallback: true,
    failureReason: globalAttempt.failureReason,
  }
}

function simplifyRoadPoints(
  points: ReadonlyArray<Vec2>,
  epsilon: number,
): Vec2[] {
  if (points.length < 3) {
    return points.map((point) => ({ ...point }))
  }
  const first = points[0]!
  const last = points[points.length - 1]!
  const dx = last.x - first.x
  const dz = last.z - first.z
  const lengthSq = dx * dx + dz * dz
  let maximumDistance = -1
  let splitIndex = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!
    const factor = lengthSq > 1e-9
      ? clamp(
          ((point.x - first.x) * dx + (point.z - first.z) * dz) / lengthSq,
          0,
          1,
        )
      : 0
    const perpendicularDistance = Math.hypot(
      point.x - (first.x + dx * factor),
      point.z - (first.z + dz * factor),
    )
    if (perpendicularDistance > maximumDistance) {
      maximumDistance = perpendicularDistance
      splitIndex = index
    }
  }
  if (maximumDistance <= epsilon) {
    return [{ ...first }, { ...last }]
  }
  return [
    ...simplifyRoadPoints(points.slice(0, splitIndex + 1), epsilon).slice(0, -1),
    ...simplifyRoadPoints(points.slice(splitIndex), epsilon),
  ]
}

function limitRepairedRoadGrade(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  closed = false,
): RoadTraceNode[] | null {
  if (nodes.length < 2) {
    return nodes.map((node) => ({ ...node }))
  }
  const gradeLimit = SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade
  const repeatedClosure = closed
    && nodes.length > 2
    && distance(nodes[0]!, nodes[nodes.length - 1]!) <= 0.5
  const source = repeatedClosure ? nodes.slice(0, -1) : nodes
  if (source.length < 2) {
    return null
  }
  const limited = source.map((node) => ({ ...node }))
  const edgeCount = closed ? limited.length : limited.length - 1
  let converged = false
  for (let iteration = 0; iteration < 32; iteration += 1) {
    for (let edge = 0; edge < edgeCount; edge += 1) {
      const index = (edge + 1) % limited.length
      const previous = limited[edge % limited.length]!
      const current = limited[index]!
      const maxDelta = gradeLimit * Math.max(
        1e-6,
        Math.hypot(current.x - previous.x, current.z - previous.z),
      )
      current.y = clamp(current.y, previous.y - maxDelta, previous.y + maxDelta)
    }
    for (let edge = edgeCount - 1; edge >= 0; edge -= 1) {
      const index = edge % limited.length
      const current = limited[index]!
      const next = limited[(edge + 1) % limited.length]!
      const maxDelta = gradeLimit * Math.max(
        1e-6,
        Math.hypot(next.x - current.x, next.z - current.z),
      )
      current.y = clamp(current.y, next.y - maxDelta, next.y + maxDelta)
    }
    let maximumViolation = 0
    for (let edge = 0; edge < edgeCount; edge += 1) {
      const previous = limited[edge % limited.length]!
      const current = limited[(edge + 1) % limited.length]!
      const segmentLength = Math.max(
        1e-6,
        Math.hypot(current.x - previous.x, current.z - previous.z),
      )
      maximumViolation = Math.max(
        maximumViolation,
        Math.abs(current.y - previous.y) / segmentLength - gradeLimit,
      )
    }
    if (maximumViolation <= 1e-5) {
      converged = true
      break
    }
  }
  if (!converged) {
    return null
  }
  let maximumTerrainOffset = 0
  for (const node of limited) {
    const terrainY = grid.sampleHeight(node.x, node.z)
    if (terrainY == null) {
      return null
    }
    maximumTerrainOffset = Math.max(
      maximumTerrainOffset,
      Math.abs(node.y - terrainY),
    )
  }
  if (maximumTerrainOffset > 12) {
    return null
  }
  if (!closed) {
    return limited.map((node, index) => ({ ...node, index }))
  }
  return [
    ...limited.map((node, index) => ({ ...node, index })),
    {
      ...limited[0]!,
      index: limited.length,
    },
  ]
}

export interface RoadCenterlineRepairResult {
  nodes: RoadTraceNode[]
  maxWaypointOffset: number
  roundedCorners: number
}

export function repairRoadCenterlineGeometry(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  waypoints: ReadonlyArray<Vec2>,
  waypointTolerance: number,
  clearance: number,
  minimumTurnRadius: number,
  maximumHeadingChangeRad: number,
  closed = false,
): RoadCenterlineRepairResult | null {
  if (
    clearance <= 0
    || minimumTurnRadius <= 0
    || nodes.length < 5
  ) {
    return null
  }
  const firstSurface = grid.sampleHeight(nodes[0]!.x, nodes[0]!.z)
  const yOffset = firstSurface == null ? 0 : nodes[0]!.y - firstSurface
  const source = nodes.map((node) => ({ x: node.x, z: node.z }))
  for (const epsilon of [1.5, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24]) {
    const simplified = simplifyRoadPoints(source, epsilon)
    if (simplified.length < 2) {
      continue
    }
    for (const radius of [
      minimumTurnRadius,
      minimumTurnRadius * 1.25,
      minimumTurnRadius * 1.5,
    ]) {
      const rounded = smoothPlanarCenterline(simplified, {
        radius,
        sampleSpacing: 2,
        controlSpacing: Math.max(12, radius),
        smoothingIterations: 72,
        closed,
      })
      const refined = smoothPlanarCenterline(rounded, {
        radius: radius * 1.5,
        sampleSpacing: 2,
        controlSpacing: Math.max(16, radius * 1.5),
        smoothingIterations: 96,
        closed,
      })
      const candidate = rebuildSmoothedNodeGeometry(
        grid,
        refined,
        yOffset,
      )
      if (!candidate || candidate.length < 3) {
        continue
      }
      const gradeLimited = limitRepairedRoadGrade(grid, candidate, closed)
      if (!gradeLimited) {
        continue
      }
      const terrain = evaluateRouteTerrain(
        grid,
        gradeLimited,
        {
          gradeLimit: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
          crossLimit: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
        },
      )
      const waypointStats = waypointPassStats(
        gradeLimited,
        waypoints,
        waypointTolerance,
      )
      const waypointError = waypointStats.maxError
      const geometry = validateRoadCenterlineGeometry(gradeLimited, {
        clearance,
        minimumTurnRadius,
        maximumHeadingChangeRad,
        closed,
      })
      if (
        terrain.valid
        && geometry.valid
        && waypointStats.passed === waypoints.length
        && waypointError <= waypointTolerance + 1e-4
      ) {
        return {
          nodes: gradeLimited,
          maxWaypointOffset: waypointError,
          roundedCorners: Math.max(0, simplified.length - 2),
        }
      }
    }
  }
  return null
}

/**
 * DEM roads own a cut/fill roadbed, so an authored waypoint sequence can be
 * converted directly into a curvature-continuous design centerline. This is
 * deliberately attempted before the terrain-following A* guide: otherwise a
 * guide that only remains slope-safe by using 8-way grid steps becomes the
 * final road geometry.
 */
function attemptRoadbedWaypointSpline(
  grid: TerrainHeightGrid,
  waypoints: ReadonlyArray<Vec2>,
  options: WaypointRoadPlanOptions,
): WaypointRoadPlanResult | null {
  if (
    options.strategy !== 'seeded'
    || options.centerlineMode !== 'dem-roadbed-spline'
    || waypoints.length < 2
  ) {
    return null
  }
  const closed = options.termination === 'loop'
  const source: Vec2[] = waypoints.map((point) => ({ ...point }))
  if (closed) {
    source.push({ ...source[0]! })
  }
  const minimumTurnRadius = Math.max(0, options.minimumTurnRadius ?? 0)
  const maximumHeadingChangeRad = options.maximumHeadingChangeRad ?? Math.PI
  const spline = smoothPlanarCenterline(source, {
    radius: Math.max(20, minimumTurnRadius * 1.2),
    sampleSpacing: 2,
    controlSpacing: Math.max(24, minimumTurnRadius * 1.25),
    smoothingIterations: 72,
    closed,
    anchorIndices: Array.from(
      { length: closed ? source.length - 1 : source.length },
      (_, index) => index,
    ),
  })
  if (spline.length < 2) {
    return null
  }
  let route: RoadTraceResult = {
    nodes: rebuildSmoothedNodeGeometry(grid, spline, 0, closed) ?? [],
    length: 0,
    complete: true,
    failureReason: null,
    rescueTurns: 0,
  }
  if (route.nodes.length < 2) {
    return null
  }
  if (options.termination === 'boundary') {
    route = appendBoundaryTail(grid, route, {
      ...options,
      maxSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
    })
    if (!route.complete || route.nodes.length < 2) {
      return null
    }
  }
  const nodes = limitRepairedRoadGrade(grid, route.nodes, closed)
  if (!nodes || nodes.length < 3) {
    return null
  }
  const clearance = Math.max(0, options.routeClearance ?? 0)
  const geometry = validateRoadCenterlineGeometry(nodes, {
    clearance,
    minimumTurnRadius,
    maximumHeadingChangeRad,
    closed,
  })
  const terrain = summarizeScenicRoadTerrain(grid, nodes, {
    preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
    maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
    maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
  })
  const waypointStats = waypointPassStats(
    nodes,
    waypoints,
    options.waypointTolerance,
  )
  const exclusionBlocked = roadNodesHitExclusion(
    nodes,
    options.exclusionCircles,
    options.exclusionMargin,
  )
  const closedError = closed
    ? distance(nodes[0]!, nodes[nodes.length - 1]!)
    : 0
  const terrainValid = terrain.maxForwardGrade
      <= SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade + 1e-4
    && terrain.maxCrossSlope
      <= SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4
  if (
    exclusionBlocked
    || !geometry.valid
    || !terrainValid
    || waypointStats.passed !== waypoints.length
    || waypointStats.maxError > options.waypointTolerance + 1e-4
    || closedError > 0.5
  ) {
    return null
  }
  let length = 0
  for (let index = 1; index < nodes.length; index += 1) {
    length += distance(nodes[index - 1]!, nodes[index]!)
  }
  const closureHeadingErrorRad = closed
    ? Math.abs(wrapAngle(
        nodes[nodes.length - 1]!.heading - nodes[0]!.heading,
      ))
    : 0
  return {
    nodes,
    length,
    complete: true,
    failureReason: closed
      ? 'reached-route-start'
      : options.termination === 'dead-end'
        ? 'reached-route-end'
        : 'reached-terrain-boundary',
    rescueTurns: 0,
    closed,
    waypointCount: waypoints.length,
    waypointsPassed: waypointStats.passed,
    maxWaypointError: waypointStats.maxError,
    closureHeadingErrorRad,
    shortestExpandedStates: 0,
    plannerMode: 'waypoint-spline',
    guideExpandedStates: 0,
    maxGuideDeviation: 0,
    unreachableWaypointIndex: null,
    waypointsSkipped: 0,
    skippedWaypointIndices: [],
    waypointsAttempted: Math.max(0, waypoints.length - 1),
    detourRadius: 0,
    maxDetourDistance: 0,
    detourRadiusExpanded: false,
    smoothingFallback: false,
    smoothingFallbackReason: null,
    geometryAutoRepaired: false,
    autoRepairRoundedCorners: 0,
    maxAutoRepairWaypointOffset: 0,
    effectiveWaypointTolerance: options.waypointTolerance,
    minCenterlineClearance: geometry.minCenterlineClearance,
    minTurnRadius: geometry.minTurnRadius,
    maxHeadingChangeRad: geometry.maxHeadingChangeRad,
    ...terrain,
  }
}

function evaluateRouteTerrain(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  limits: {
    gradeLimit?: number
    crossLimit?: number
  } = {},
): {
  valid: boolean
  maxForwardGrade: number
  maxCrossSlope: number
  failureReason:
    | 'smoothing-outside-terrain'
    | 'smoothing-forward-grade-limit'
    | 'smoothing-cross-slope-limit'
    | null
} {
  const gradeLimit = limits.gradeLimit
    ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade * 1.08
  const crossLimit = limits.crossLimit
    ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope * 1.08
  const lateralSample = Math.max(8, grid.cellSize)
  let maxForwardGrade = 0
  let maxCrossSlope = 0
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1]!
    const current = nodes[index]!
    const segmentLength = distance(previous, current)
    if (segmentLength <= 1e-6) {
      continue
    }
    if (grid.sampleHeight(current.x, current.z) == null) {
      return {
        valid: false,
        maxForwardGrade,
        maxCrossSlope,
        failureReason: 'smoothing-outside-terrain',
      }
    }
    maxForwardGrade = Math.max(
      maxForwardGrade,
      Math.abs(current.y - previous.y) / segmentLength,
    )
    const heading = Math.atan2(current.z - previous.z, current.x - previous.x)
    const normalX = -Math.sin(heading)
    const normalZ = Math.cos(heading)
    const middleX = (previous.x + current.x) * 0.5
    const middleZ = (previous.z + current.z) * 0.5
    const left = grid.sampleHeight(
      middleX + normalX * lateralSample,
      middleZ + normalZ * lateralSample,
    )
    const right = grid.sampleHeight(
      middleX - normalX * lateralSample,
      middleZ - normalZ * lateralSample,
    )
    if (left != null && right != null) {
      maxCrossSlope = Math.max(
        maxCrossSlope,
        Math.abs(left - right) / (2 * lateralSample),
      )
    }
  }
  return {
    valid: maxForwardGrade <= gradeLimit + 1e-4
      && maxCrossSlope <= crossLimit + 1e-4,
    maxForwardGrade,
    maxCrossSlope,
    failureReason: maxForwardGrade > gradeLimit + 1e-4
      ? 'smoothing-forward-grade-limit'
      : maxCrossSlope > crossLimit + 1e-4
        ? 'smoothing-cross-slope-limit'
        : null,
  }
}

function roadNodesLength(nodes: ReadonlyArray<RoadTraceNode>): number {
  let length = 0
  for (let index = 1; index < nodes.length; index += 1) {
    length += distance(nodes[index - 1]!, nodes[index]!)
  }
  return length
}

function roadNodesHitExclusion(
  nodes: ReadonlyArray<RoadTraceNode>,
  circles: ReadonlyArray<LandscapeExclusionCircle> | undefined,
  margin: number | undefined,
): boolean {
  if (!circles?.length || nodes.length < 2) {
    return false
  }
  const safeMargin = Math.max(0, margin ?? 0)
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1]!
    const current = nodes[index]!
    if (segmentIntersectsExclusion(
      previous.x,
      previous.z,
      current.x,
      current.z,
      circles,
      safeMargin,
    )) {
      return true
    }
  }
  return false
}

function samplePolylineLinear(
  grid: TerrainHeightGrid,
  points: ReadonlyArray<Vec2>,
  spacing: number,
  closed: boolean,
): Vec2[] {
  if (points.length < 2) {
    return points.map((point) => ({ ...point }))
  }
  const source = closed
    && distance(points[0]!, points[points.length - 1]!) <= 0.01
    ? points.slice(0, -1)
    : points.slice()
  const output: Vec2[] = []
  const segmentCount = closed ? source.length : source.length - 1
  for (let index = 0; index < segmentCount; index += 1) {
    const start = source[index]!
    const end = source[(index + 1) % source.length]!
    const segmentLength = distance(start, end)
    const count = Math.max(1, Math.ceil(segmentLength / spacing))
    for (let step = 0; step < count; step += 1) {
      if (index > 0 && step === 0) {
        continue
      }
      const t = step / count
      const point = {
        x: start.x + (end.x - start.x) * t,
        z: start.z + (end.z - start.z) * t,
      }
      const y = grid.sampleHeight(point.x, point.z)
      if (y != null) {
        output.push(point)
      }
    }
  }
  output.push(closed ? { ...source[0]! } : { ...source[source.length - 1]! })
  return output
}

function planShortestGuide(
  grid: TerrainHeightGrid,
  anchors: ReadonlyArray<Vec2>,
  closed: boolean,
  options: WaypointRoadPlanOptions,
): { guide: Vec2[]; expanded: number; error: string | null } {
  const routeAnchors = closed ? [...anchors, anchors[0]!] : [...anchors]
  const route: Vec2[] = []
  let expanded = 0
  for (let index = 0; index < routeAnchors.length - 1; index += 1) {
    const leg = planShortestLeg(
      grid,
      routeAnchors[index]!,
      routeAnchors[index + 1]!,
      options,
    )
    expanded += leg.expanded
    if (!leg.points) {
      return {
        guide: [],
        expanded,
        error: expanded >= MAX_SHORTEST_EXPANSIONS
          ? 'shortest-route-budget-exceeded'
          : 'shortest-route-not-found',
      }
    }
    for (const point of leg.points) {
      if (!route.length || distance(route[route.length - 1]!, point) > 1e-5) {
        route.push(point)
      }
    }
  }
  const spacing = Math.max(8, Math.min(16, options.stepLength))
  const smoothed = smoothPolyline(route, spacing, anchors, closed)
  const smoothedHitsExclusion = roadNodesHitExclusion(
    smoothed.map((point, index) => makeNode(point, 0, 0, index)),
    options.exclusionCircles,
    options.exclusionMargin,
  )
  const guide = !smoothedHitsExclusion
    && scoreSeededSegment(grid, smoothed, options.maxSlope * 0.8)
    ? smoothed
    : samplePolylineLinear(grid, route, spacing, closed)
  return {
    guide,
    expanded,
    error: null,
  }
}

function makeNode(
  point: Vec2,
  y: number,
  heading: number,
  index: number,
  headingDelta = 0,
): RoadTraceNode {
  return {
    x: point.x,
    z: point.z,
    y,
    heading,
    index,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta,
  }
}

/**
 * Rehydrates an editor-authored road centerline on another runtime grid.
 *
 * XZ comes exclusively from the saved snapshot so DEM sample-step changes
 * cannot move the road. Heights and slope metadata are re-sampled locally
 * because preview/viewer intentionally use coarser terrain meshes.
 */
export function createCachedCenterlineRoadRoute(
  grid: TerrainHeightGrid,
  options: CachedCenterlineRoadOptions,
): WaypointRoadPlanResult | null {
  if (options.centerline.length < 2) {
    return null
  }
  const nodes: RoadTraceNode[] = []
  for (let index = 0; index < options.centerline.length; index += 1) {
    const point = options.centerline[index]!
    if (
      !Number.isFinite(point.x)
      || !Number.isFinite(point.z)
      || !grid.contains(point.x, point.z)
    ) {
      continue
    }
    const y = grid.sampleHeight(point.x, point.z)
    if (y == null) {
      continue
    }
    const previous = options.centerline[index - 1] ?? point
    const next = options.centerline[index + 1] ?? point
    const heading = distance(previous, next) > 1e-6
      ? Math.atan2(next.z - previous.z, next.x - previous.x)
      : 0
    nodes.push(makeNode(point, y, heading, nodes.length))
  }
  if (nodes.length < 2) {
    return null
  }
  if (nodes.length > 2) {
    const original = nodes.map((node) => node.y)
    for (let index = 1; index < nodes.length - 1; index += 1) {
      const smoothed = (original[index - 1]! + original[index]! * 2 + original[index + 1]!) / 4
      nodes[index]!.y = clamp(smoothed, original[index]! - 0.75, original[index]! + 0.75)
    }
  }
  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index]!
    node.headingDelta = wrapAngle(node.heading - nodes[index - 1]!.heading)
  }
  const feelScale = Math.max(1e-4, options.feelDistance * options.maxSlope)
  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const leftY = grid.sampleHeight(
      node.x + Math.cos(node.heading - options.feelAngleRad) * options.feelDistance,
      node.z + Math.sin(node.heading - options.feelAngleRad) * options.feelDistance,
    )
    const rightY = grid.sampleHeight(
      node.x + Math.cos(node.heading + options.feelAngleRad) * options.feelDistance,
      node.z + Math.sin(node.heading + options.feelAngleRad) * options.feelDistance,
    )
    if (leftY == null || rightY == null) {
      continue
    }
    const average = (leftY + rightY) * 0.5
    const difference = (rightY - leftY) * 0.5
    node.lateral = (leftY - rightY) / feelScale
    node.longitudinal = (average - node.y) / feelScale
    node.turn = difference !== 0 ? clamp((average - node.y) / difference, -1, 1) : 0
  }
  let length = 0
  for (let index = 1; index < nodes.length; index += 1) {
    length += distance(nodes[index - 1]!, nodes[index]!)
  }
  const waypointCount = Math.max(1, Math.round(options.waypointCount ?? 1))
  const terrain = summarizeScenicRoadTerrain(grid, nodes, {
    preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
    maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
    maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
  })
  return {
    nodes,
    length,
    complete: true,
    failureReason: null,
    rescueTurns: 0,
    closed: options.termination === 'loop',
    waypointCount,
    waypointsPassed: waypointCount,
    maxWaypointError: 0,
    closureHeadingErrorRad: 0,
    shortestExpandedStates: 0,
    plannerMode: 'cached-centerline',
    waypointsSkipped: 0,
    skippedWaypointIndices: [],
    waypointsAttempted: Math.max(0, waypointCount - 1),
    unreachableWaypointIndex: null,
    maxGuideDeviation: 0,
    detourRadius: 0,
    maxDetourDistance: 0,
    detourRadiusExpanded: false,
    ...terrain,
  }
}

function traceGuide(
  grid: TerrainHeightGrid,
  guide: ReadonlyArray<Vec2>,
  requiredWaypoints: ReadonlyArray<Vec2>,
  options: WaypointRoadPlanOptions,
): { result: RoadTraceResult; reachedGuideEnd: boolean } {
  if (guide.length < 2) {
    return {
      result: {
        nodes: [],
        length: 0,
        complete: false,
        failureReason: 'guide-empty',
        rescueTurns: 0,
      },
      reachedGuideEnd: false,
    }
  }
  const cumulative: number[] = [0]
  for (let index = 1; index < guide.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + distance(guide[index - 1]!, guide[index]!))
  }
  const totalLength = cumulative[cumulative.length - 1]!
  if (!(totalLength > 1e-6)) {
    return {
      result: {
        nodes: [],
        length: 0,
        complete: false,
        failureReason: 'guide-empty',
        rescueTurns: 0,
      },
      reachedGuideEnd: false,
    }
  }
  const mandatoryDistances: Array<{ distance: number; point: Vec2 }> = []
  for (const waypoint of requiredWaypoints) {
    let bestDistance = Number.POSITIVE_INFINITY
    let bestGuideDistance = 0
    for (let index = 0; index < guide.length - 1; index += 1) {
      const start = guide[index]!
      const end = guide[index + 1]!
      const dx = end.x - start.x
      const dz = end.z - start.z
      const lengthSq = dx * dx + dz * dz
      const t = lengthSq > 1e-9
        ? clamp(((waypoint.x - start.x) * dx + (waypoint.z - start.z) * dz) / lengthSq, 0, 1)
        : 0
      const projected = { x: start.x + dx * t, z: start.z + dz * t }
      const projectedDistance = distance(projected, waypoint)
      if (projectedDistance < bestDistance) {
        bestDistance = projectedDistance
        bestGuideDistance = cumulative[index]! + Math.sqrt(lengthSq) * t
      }
    }
    if (Number.isFinite(bestDistance) && bestDistance <= options.waypointTolerance) {
      mandatoryDistances.push({
        distance: bestGuideDistance,
        point: { ...waypoint },
      })
    }
  }
  const mandatoryByDistance = new Map(
    mandatoryDistances.map((entry) => [entry.distance, entry.point]),
  )
  const distances = new Set<number>([0, totalLength])
  for (let sample = options.stepLength; sample < totalLength; sample += options.stepLength) {
    distances.add(sample)
  }
  for (const mandatory of mandatoryDistances) {
    distances.add(clamp(mandatory.distance, 0, totalLength))
  }
  const sortedDistances = Array.from(distances).sort((a, b) => a - b)
  const sampledPoints: Vec2[] = []
  let segmentIndex = 1
  for (const targetDistance of sortedDistances) {
    while (
      segmentIndex < cumulative.length - 1
      && cumulative[segmentIndex]! < targetDistance
    ) {
      segmentIndex += 1
    }
    const start = guide[segmentIndex - 1]!
    const end = guide[segmentIndex]!
    const startDistance = cumulative[segmentIndex - 1]!
    const segmentLength = Math.max(1e-9, cumulative[segmentIndex]! - startDistance)
    const t = clamp((targetDistance - startDistance) / segmentLength, 0, 1)
    const mandatory = mandatoryByDistance.get(targetDistance)
    sampledPoints.push(mandatory
      ? { ...mandatory }
      : {
          x: start.x + (end.x - start.x) * t,
          z: start.z + (end.z - start.z) * t,
        })
  }
  sampledPoints[0] = { ...guide[0]! }
  sampledPoints[sampledPoints.length - 1] = { ...guide[guide.length - 1]! }

  const nodes: RoadTraceNode[] = []
  let failureReason: string | null = null
  for (let index = 0; index < sampledPoints.length; index += 1) {
    const point = sampledPoints[index]!
    if (!grid.contains(point.x, point.z)) {
      failureReason = 'reached-terrain-boundary'
      break
    }
    const y = grid.sampleHeight(point.x, point.z)
    if (y == null) {
      failureReason = 'blocked'
      break
    }
    const previous = sampledPoints[index - 1] ?? point
    const next = sampledPoints[index + 1] ?? point
    const heading = distance(previous, next) > 1e-6
      ? Math.atan2(next.z - previous.z, next.x - previous.x)
      : 0
    const node = makeNode(point, y, heading, index)
    if (nodes.length) {
      const prior = nodes[nodes.length - 1]!
      const segmentLength = Math.max(1e-6, distance(prior, node))
      const slope = Math.abs(node.y - prior.y) / segmentLength
      if (slope > options.maxSlope * 1.06) {
        failureReason = 'blocked'
        break
      }
      node.headingDelta = wrapAngle(node.heading - prior.heading)
    }
    nodes.push(node)
  }
  if (nodes.length > 2) {
    const original = nodes.map((node) => node.y)
    for (let index = 1; index < nodes.length - 1; index += 1) {
      const smoothed = (original[index - 1]! + original[index]! * 2 + original[index + 1]!) / 4
      nodes[index]!.y = clamp(smoothed, original[index]! - 0.75, original[index]! + 0.75)
    }
  }
  const feelScale = Math.max(1e-4, options.feelDistance * options.maxSlope)
  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const leftY = grid.sampleHeight(
      node.x + Math.cos(node.heading - options.feelAngleRad) * options.feelDistance,
      node.z + Math.sin(node.heading - options.feelAngleRad) * options.feelDistance,
    )
    const rightY = grid.sampleHeight(
      node.x + Math.cos(node.heading + options.feelAngleRad) * options.feelDistance,
      node.z + Math.sin(node.heading + options.feelAngleRad) * options.feelDistance,
    )
    if (leftY == null || rightY == null) {
      continue
    }
    const average = (leftY + rightY) * 0.5
    const difference = (rightY - leftY) * 0.5
    node.lateral = (leftY - rightY) / feelScale
    node.longitudinal = (average - node.y) / feelScale
    node.turn = difference !== 0 ? clamp((average - node.y) / difference, -1, 1) : 0
  }
  let length = 0
  for (let index = 1; index < nodes.length; index += 1) {
    length += distance(nodes[index - 1]!, nodes[index]!)
  }
  const complete = failureReason == null
  return {
    result: {
      nodes,
      length,
      complete,
      failureReason: failureReason ?? 'reached-guide-end',
      rescueTurns: 0,
    },
    reachedGuideEnd: complete,
  }
}

function appendBoundaryTail(
  grid: TerrainHeightGrid,
  route: RoadTraceResult,
  options: WaypointRoadPlanOptions,
): RoadTraceResult {
  const last = route.nodes[route.nodes.length - 1]
  if (!last) {
    return route
  }
  const previous = route.nodes[route.nodes.length - 2]
  const heading = previous
    ? Math.atan2(last.z - previous.z, last.x - previous.x)
    : last.heading
  const tail = traceRoadPath(grid, {
    startX: last.x,
    startZ: last.z,
    headingRad: heading,
    stepLength: options.stepLength,
    feelDistance: options.feelDistance,
    feelAngleRad: options.feelAngleRad,
    maxSlope: options.maxSlope,
    maxTurnRad: options.maxTurnRad,
    maxLength: null,
    maxSteps: Math.max(
      4096,
      Math.ceil(((grid.maxX - grid.minX + grid.maxZ - grid.minZ) * 1.5) / options.stepLength),
    ),
    margin: options.margin,
  })
  const nodes = [...route.nodes, ...tail.nodes.slice(1)]
  for (let index = 0; index < nodes.length; index += 1) {
    nodes[index]!.index = index
  }
  let length = 0
  for (let index = 1; index < nodes.length; index += 1) {
    const from = nodes[index - 1]!
    const to = nodes[index]!
    length += Math.hypot(to.x - from.x, to.z - from.z)
  }
  return {
    nodes,
    length,
    complete: tail.complete,
    failureReason: tail.failureReason,
    rescueTurns: route.rescueTurns + tail.rescueTurns,
  }
}

function finalizeRouteTermination(
  grid: TerrainHeightGrid,
  route: RoadTraceResult,
  target: Vec2,
  maxGrade: number,
  termination: 'loop' | 'dead-end',
  terminalTolerance: number,
): {
  result: RoadTraceResult
  closed: boolean
  closureHeadingErrorRad: number
  failureReason: string | null
} {
  if (route.nodes.length < 2) {
    return {
      result: route,
      closed: false,
      closureHeadingErrorRad: 0,
      failureReason: 'route-too-short',
    }
  }
  const nodes = route.nodes.map((node) => ({ ...node }))
  const first = nodes[0]!
  const last = nodes[nodes.length - 1]!
  const terminalDistance = Math.hypot(target.x - last.x, target.z - last.z)
  if (terminalDistance > Math.max(20, terminalTolerance)) {
    return {
      result: route,
      closed: false,
      closureHeadingErrorRad: 0,
      failureReason: termination === 'loop'
        ? 'loop-termination-distance'
        : 'waypoint-missed',
    }
  }
  const terminalHeight = grid.sampleHeight(target.x, target.z)
  if (terminalHeight == null) {
    return {
      result: route,
      closed: false,
      closureHeadingErrorRad: 0,
      failureReason: 'blocked',
    }
  }
  if (terminalDistance > 1e-3) {
    const lastSurfaceHeight = grid.sampleHeight(last.x, last.z)
    const roadOffset = lastSurfaceHeight == null ? 0 : last.y - lastSurfaceHeight
    const terminalY = terminalHeight + roadOffset
    const grade = Math.abs(terminalY - last.y) / terminalDistance
    if (grade > maxGrade + 1e-6) {
      return {
        result: route,
        closed: false,
        closureHeadingErrorRad: 0,
        failureReason: termination === 'loop'
          ? 'loop-termination-grade'
          : 'blocked',
      }
    }
    const previous = nodes[Math.max(0, nodes.length - 2)]!
    nodes.push({
      x: target.x,
      z: target.z,
      y: terminalY,
      heading: Math.atan2(target.z - previous.z, target.x - previous.x),
      index: nodes.length,
      lateral: 0,
      longitudinal: 0,
      turn: 0,
      headingDelta: wrapAngle(
        Math.atan2(target.z - previous.z, target.x - previous.x)
          - previous.heading,
      ),
    })
  }
  if (termination === 'loop' && nodes.length >= 2) {
    const previousIndex = nodes.length - 2
    const previous = nodes[previousIndex]!
    const approachDistance = clamp(
      Math.hypot(first.x - previous.x, first.z - previous.z),
      5,
      20,
    )
    const approachX = first.x - Math.cos(first.heading) * approachDistance
    const approachZ = first.z - Math.sin(first.heading) * approachDistance
    const approachHeight = grid.sampleHeight(approachX, approachZ)
    const prior = nodes[Math.max(0, previousIndex - 1)]!
    const priorHeight = grid.sampleHeight(prior.x, prior.z)
    if (
      approachHeight != null
      && priorHeight != null
      && Math.abs(approachHeight - priorHeight)
        / Math.max(1e-6, Math.hypot(approachX - prior.x, approachZ - prior.z))
        <= maxGrade + 1e-6
      && Math.abs(first.y - approachHeight) / approachDistance
        <= maxGrade + 1e-6
    ) {
      previous.x = approachX
      previous.z = approachZ
      previous.y = approachHeight
    }
  }
  const approachPrevious = nodes[Math.max(0, nodes.length - 2)]!
  const approachHeading = Math.atan2(
    first.z - approachPrevious.z,
    first.x - approachPrevious.x,
  )
  const closureHeadingErrorRad = termination === 'loop'
    ? Math.abs(wrapAngle(approachHeading - first.heading))
    : 0
  if (termination === 'loop') {
    const close = nodes[nodes.length - 1]!
    close.x = first.x
    close.z = first.z
    close.y = first.y
    close.heading = first.heading
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    node.index = index
    const previous = nodes[Math.max(0, index - 1)]!
    const next = nodes[Math.min(nodes.length - 1, index + 1)]!
    if (index === 0) {
      node.heading = first.heading
      node.headingDelta = 0
    } else if (termination === 'loop' && index === nodes.length - 1) {
      node.heading = first.heading
      node.headingDelta = wrapAngle(node.heading - previous.heading)
    } else {
      node.heading = Math.atan2(next.z - previous.z, next.x - previous.x)
      node.headingDelta = wrapAngle(node.heading - previous.heading)
    }
  }
  let length = 0
  for (let index = 1; index < nodes.length; index += 1) {
    length += Math.hypot(
      nodes[index]!.x - nodes[index - 1]!.x,
      nodes[index]!.z - nodes[index - 1]!.z,
    )
  }
  const closedError = termination === 'loop'
    ? Math.hypot(
        nodes[0]!.x - nodes[nodes.length - 1]!.x,
        nodes[0]!.z - nodes[nodes.length - 1]!.z,
      )
    : 0
  if (termination === 'loop' && (
    closedError > 0.5
    || closureHeadingErrorRad > Math.PI / 4
  )) {
    return {
      result: route,
      closed: false,
      closureHeadingErrorRad,
      failureReason: closureHeadingErrorRad > Math.PI / 4
        ? 'loop-heading-discontinuity'
        : 'loop-not-closed',
    }
  }
  return {
    result: {
      ...route,
      nodes,
      length,
      complete: true,
      failureReason: termination === 'loop'
        ? 'reached-route-start'
        : 'reached-route-end',
    },
    closed: termination === 'loop',
    closureHeadingErrorRad,
    failureReason: null,
  }
}

function waypointPassStats(
  nodes: ReadonlyArray<RoadTraceNode>,
  required: ReadonlyArray<Vec2>,
  tolerance: number,
): { passed: number; maxError: number } {
  let passed = 0
  let maxError = 0
  let searchStart = 0
  for (const waypoint of required) {
    let nearest = Number.POSITIVE_INFINITY
    let nearestIndex = -1
    for (let index = searchStart; index < nodes.length; index += 1) {
      const node = nodes[index]!
      const error = Math.hypot(node.x - waypoint.x, node.z - waypoint.z)
      if (error < nearest) {
        nearest = error
        nearestIndex = index
      }
    }
    maxError = Math.max(maxError, nearest)
    if (nearestIndex >= 0 && nearest <= tolerance) {
      passed += 1
      searchStart = nearestIndex
    }
  }
  return { passed, maxError }
}

function maxDistanceToGuide(
  nodes: ReadonlyArray<RoadTraceNode>,
  guide: ReadonlyArray<Vec2>,
): number {
  if (!nodes.length || guide.length < 2) {
    return 0
  }
  let maximum = 0
  for (const node of nodes) {
    let nearest = Number.POSITIVE_INFINITY
    for (let index = 1; index < guide.length; index += 1) {
      const start = guide[index - 1]!
      const end = guide[index]!
      const dx = end.x - start.x
      const dz = end.z - start.z
      const lengthSq = dx * dx + dz * dz
      const factor = lengthSq > 1e-9
        ? clamp(
            ((node.x - start.x) * dx + (node.z - start.z) * dz) / lengthSq,
            0,
            1,
          )
        : 0
      nearest = Math.min(
        nearest,
        Math.hypot(
          node.x - (start.x + dx * factor),
          node.z - (start.z + dz * factor),
        ),
      )
    }
    maximum = Math.max(maximum, nearest)
  }
  return maximum
}

function createGuideFallbackRoute(
  grid: TerrainHeightGrid,
  guide: ReadonlyArray<Vec2>,
): RoadTraceResult {
  const nodes: RoadTraceNode[] = []
  for (let index = 0; index < guide.length; index += 1) {
    const point = guide[index]!
    const y = grid.sampleHeight(point.x, point.z)
    if (y == null) {
      return {
        nodes,
        length: 0,
        complete: false,
        failureReason: 'blocked',
        rescueTurns: 0,
      }
    }
    const previous = guide[Math.max(0, index - 1)]!
    const next = guide[Math.min(guide.length - 1, index + 1)]!
    const heading = index === 0
      ? Math.atan2(next.z - point.z, next.x - point.x)
      : Math.atan2(point.z - previous.z, point.x - previous.x)
    nodes.push({
      x: point.x,
      z: point.z,
      y,
      heading,
      index: nodes.length,
      lateral: 0,
      longitudinal: 0,
      turn: 0,
      headingDelta: nodes.length
        ? wrapAngle(heading - nodes[nodes.length - 1]!.heading)
        : 0,
    })
  }
  let length = 0
  for (let index = 1; index < nodes.length; index += 1) {
    length += Math.hypot(
      nodes[index]!.x - nodes[index - 1]!.x,
      nodes[index]!.z - nodes[index - 1]!.z,
    )
  }
  return {
    nodes,
    length,
    complete: nodes.length >= 2,
    failureReason: nodes.length >= 2 ? 'reached-guide-end' : 'guide-empty',
    rescueTurns: 0,
  }
}

/**
 * Unified waypoint road planner. Both strategies pass the same ordered
 * waypoint anchors, use Slow Roads terrain feel constraints for the final
 * centerline, and share loop closure and boundary tail handling.
 */
export function planWaypointRoadRoute(
  grid: TerrainHeightGrid,
  options: WaypointRoadPlanOptions,
): WaypointRoadPlanResult {
  const waypoints = options.waypoints.map((point) => ({ x: point.x, z: point.z }))
  if (!waypoints.length) {
    return {
      nodes: [],
      length: 0,
      complete: false,
      failureReason: 'no-waypoints',
      rescueTurns: 0,
      closed: false,
      waypointCount: 0,
      waypointsPassed: 0,
      maxWaypointError: 0,
      closureHeadingErrorRad: 0,
      shortestExpandedStates: 0,
    }
  }
  if (options.strategy === 'seeded') {
    const origin = waypoints[0]!
    const termination = options.termination
    const style = options.style ?? DEFAULT_ROAD_STYLE
    const midlineProfile = resolveSlowroadsMidlineProfile(style)
    const naturalPlan = termination === 'boundary'
      ? resolveNaturalRoadPlan(
          grid,
          style,
          options.seed,
          Math.max(7, options.routeClearance ?? 0),
          Math.max(0, options.routeClearance ?? 0),
        )
      : null
    let smoothingFallback = false
    let smoothingFailureReason: string | null = null
    let geometryAutoRepaired = false
    let autoRepairRoundedCorners = 0
    let maxAutoRepairWaypointOffset = 0
    let effectiveWaypointTolerance = options.waypointTolerance
    if (termination === 'dead-end' && waypoints.length === 1) {
      return {
        nodes: [],
        length: 0,
        complete: false,
        failureReason: 'route-too-short',
        rescueTurns: 0,
        closed: false,
        waypointCount: 1,
        waypointsPassed: 0,
        maxWaypointError: 0,
        closureHeadingErrorRad: 0,
        shortestExpandedStates: 0,
        waypointsSkipped: 0,
        skippedWaypointIndices: [],
        waypointsAttempted: 0,
        plannerMode: 'guided-global',
        guideExpandedStates: 0,
        maxGuideDeviation: 0,
        unreachableWaypointIndex: null,
      }
    }
    const authoredSpline = attemptRoadbedWaypointSpline(
      grid,
      waypoints,
      options,
    )
    if (authoredSpline) {
      return authoredSpline
    }
    let guideWaypoints = waypoints
    if (termination === 'loop' && waypoints.length === 1) {
      const anchors = singlePointLoopAnchors(
        grid,
        origin,
        options.seed,
        options.stepLength,
        SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
      )
      if (!anchors) {
        return {
          nodes: [],
          length: 0,
          complete: false,
          failureReason: 'single-point-loop-too-small',
          rescueTurns: 0,
          closed: false,
          waypointCount: 1,
          waypointsPassed: 0,
          maxWaypointError: 0,
          closureHeadingErrorRad: 0,
          shortestExpandedStates: 0,
          waypointsSkipped: 0,
          skippedWaypointIndices: [],
          waypointsAttempted: 0,
          plannerMode: 'guided-global',
          guideExpandedStates: 0,
          maxGuideDeviation: 0,
          unreachableWaypointIndex: null,
        }
      }
      guideWaypoints = anchors
    }
    const hasExclusions = (options.exclusionCircles?.length ?? 0) > 0
    const guide = naturalPlan && guideWaypoints.length === 1 && !hasExclusions
      ? null
      : buildGlobalScenicGuide(grid, guideWaypoints, {
          seed: options.seed,
          stepLength: options.stepLength,
          pathDeviation: options.pathDeviation,
          margin: options.margin,
          termination,
          preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
          maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
          maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope * 0.9,
          crossSlopeWeight: 18,
          waypointTolerance: options.waypointTolerance,
          extendToBoundary: naturalPlan == null,
          exclusionCircles: options.exclusionCircles,
          exclusionMargin: options.exclusionMargin,
        })
    if (guide && (guide.failureReason || guide.points.length < 2)) {
      return {
        nodes: [],
        length: 0,
        complete: false,
        failureReason: guide.failureReason ?? 'guided-guide-prepare-failed',
        rescueTurns: 0,
        closed: false,
        waypointCount: waypoints.length,
        waypointsPassed: 0,
        maxWaypointError: 0,
        closureHeadingErrorRad: 0,
        shortestExpandedStates: 0,
        waypointsSkipped: 0,
        skippedWaypointIndices: [],
        waypointsAttempted: guide.unreachableWaypointIndex ?? 0,
        plannerMode: 'guided-global',
        guideExpandedStates: guide.expandedStates,
        maxGuideDeviation: 0,
        unreachableWaypointIndex: guide.unreachableWaypointIndex,
      }
    }
    let traced = guide
      ? traceOfficialScenicGuidedRoad(
          grid,
          origin,
          options.seed,
          options.margin,
          {
            preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
            maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
            maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
            requiredWaypoints: guideWaypoints,
            waypointTolerance: options.waypointTolerance,
            guidePoints: guide.points,
            guideCorridorWidth: guide.corridorWidth,
            guideTermination: termination,
            midlineProfile,
            natural: naturalPlan ?? undefined,
            exclusionCircles: options.exclusionCircles,
            exclusionMargin: options.exclusionMargin,
          },
        )
      : traceOfficialScenicNaturalRoad(
          grid,
          origin,
          options.seed,
          options.margin,
          {
            preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
            maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
            maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
            requiredWaypoints: guideWaypoints,
            waypointTolerance: options.waypointTolerance,
            guideTermination: 'boundary',
            midlineProfile,
            natural: naturalPlan ?? undefined,
            exclusionCircles: options.exclusionCircles,
            exclusionMargin: options.exclusionMargin,
          },
        )
    if (!traced.complete && guide && !naturalPlan) {
      const fallbackTrace = createGuideFallbackRoute(grid, guide.points)
      if (fallbackTrace.complete && fallbackTrace.nodes.length >= 2) {
        const terrain = summarizeScenicRoadTerrain(
          grid,
          fallbackTrace.nodes,
          {
            preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
            maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
            maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
          },
        )
        traced = {
          ...fallbackTrace,
          officialReverts: 0,
          antiTargetTriggers: 0,
          turnOverflows: 0,
          ...terrain,
          steepReplacementSteps: 0,
          waypointsSkipped: 0,
          skippedWaypointIndices: [],
          waypointsAttempted: Math.max(0, guideWaypoints.length - 1),
          maxGuideDeviation: maxDistanceToGuide(
            fallbackTrace.nodes,
            guide.points,
          ),
        }
      }
    }
    if (!traced.complete && guide && naturalPlan) {
      const guideFallback = createGuideFallbackRoute(grid, guide.points)
      const guideTail = guideFallback.nodes[guideFallback.nodes.length - 1]
      const tail = guideTail
        ? traceOfficialScenicNaturalRoad(
            grid,
            { x: guideTail.x, z: guideTail.z },
            options.seed,
            options.margin,
            {
              preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
              maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
              maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
              guideTermination: 'boundary',
              midlineProfile,
              natural: naturalPlan,
              initialHeadingRad: guideTail.heading,
              exclusionCircles: options.exclusionCircles,
              exclusionMargin: options.exclusionMargin,
            },
          )
        : null
      const fullGuide = guideFallback.complete
        ? buildGlobalScenicGuide(grid, guideWaypoints, {
            seed: options.seed,
            stepLength: options.stepLength,
            pathDeviation: options.pathDeviation,
            margin: options.margin,
            termination: 'boundary',
            preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
            maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
            maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope * 0.9,
            crossSlopeWeight: 18,
            waypointTolerance: options.waypointTolerance,
            exclusionCircles: options.exclusionCircles,
            exclusionMargin: options.exclusionMargin,
          })
        : null
      const fullFallback = fullGuide && !fullGuide.failureReason
        ? createGuideFallbackRoute(grid, fullGuide.points)
        : null
      const legacyTail = guideFallback.complete
        ? appendBoundaryTail(grid, guideFallback, {
            ...options,
            maxSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
          })
        : null
      if (
        fullGuide
        && fullFallback?.complete
        && fullFallback.nodes.length >= 2
      ) {
        traced = {
          ...traced,
          nodes: fullFallback.nodes,
          length: fullFallback.length,
          complete: true,
          failureReason: 'reached-terrain-boundary',
          waypointsSkipped: 0,
          skippedWaypointIndices: [],
          maxGuideDeviation: maxDistanceToGuide(fullFallback.nodes, fullGuide.points),
        }
      } else if (legacyTail?.complete && legacyTail.nodes.length >= 2) {
        traced = {
          ...traced,
          nodes: legacyTail.nodes,
          length: legacyTail.length,
          complete: true,
          failureReason: legacyTail.failureReason,
          waypointsSkipped: 0,
          skippedWaypointIndices: [],
          maxGuideDeviation: maxDistanceToGuide(legacyTail.nodes, guide.points),
        }
      } else if (
        guideFallback.complete
        && guideFallback.nodes.length >= 2
        && tail
        && tail.nodes.length >= 2
      ) {
        const nodes = [
          ...guideFallback.nodes,
          ...tail.nodes.slice(1),
        ].map((node, index) => ({ ...node, index }))
        const length = guideFallback.length + tail.length
        traced = {
          ...tail,
          nodes,
          length,
          complete: tail.complete,
          failureReason: tail.failureReason,
          waypointsSkipped: 0,
          skippedWaypointIndices: [],
          maxGuideDeviation: maxDistanceToGuide(nodes, guide.points),
        }
      }
    }
    const naturalTargetLength = traced.naturalTargetLength
    const naturalLaps = traced.naturalLaps
    let terminationResult: {
      result: RoadTraceResult
      closed: boolean
      closureHeadingErrorRad: number
      failureReason: string | null
    } | null = null
    if (traced.complete && termination === 'loop') {
      terminationResult = finalizeRouteTermination(
        grid,
        traced,
        origin,
        SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
        'loop',
        options.waypointTolerance,
      )
    } else if (traced.complete && termination === 'dead-end') {
      terminationResult = finalizeRouteTermination(
        grid,
        traced,
        waypoints[waypoints.length - 1]!,
        SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
        'dead-end',
        options.waypointTolerance,
      )
    }
    let result = terminationResult?.result ?? traced
    if (
      result.complete
      && result.nodes.length >= 3
      && (!naturalPlan || result.nodes.length <= 6_000)
    ) {
      const smoothing = smoothRoadCenterline(
        grid,
        result.nodes,
        waypoints,
        options.waypointTolerance,
        termination,
      )
      smoothingFallback = smoothing.smoothingFallback
      smoothingFailureReason = smoothing.failureReason
      if (roadNodesHitExclusion(
        smoothing.nodes,
        options.exclusionCircles,
        options.exclusionMargin,
      )) {
        smoothingFallback = true
        smoothingFailureReason = 'blocked-by-exclusion-zone'
      } else {
        result = {
          ...result,
          nodes: smoothing.nodes,
          length: roadNodesLength(smoothing.nodes),
        }
      }
    }
    if (
      guide
      && roadNodesHitExclusion(
        result.nodes,
        options.exclusionCircles,
        options.exclusionMargin,
      )
    ) {
      const guideFallback = createGuideFallbackRoute(grid, guide.points)
      if (guideFallback.complete && guideFallback.nodes.length >= 2) {
        result = {
          ...result,
          ...guideFallback,
        }
        smoothingFallback = true
        smoothingFailureReason = 'blocked-by-exclusion-zone'
      }
    }
    let terrain = summarizeScenicRoadTerrain(grid, result.nodes, {
      preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
      maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
      maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
    })
    let geometry: RoadGeometryValidation = validateRoadCenterlineGeometry(
      result.nodes,
      {
        clearance: Math.max(0, options.routeClearance ?? 0),
        minimumTurnRadius: Math.max(
          0,
          options.minimumTurnRadius ?? 0,
        ),
        maximumHeadingChangeRad:
          options.maximumHeadingChangeRad ?? Math.PI,
        closed: termination === 'loop',
      },
    )
    if (
      result.complete
      && (!naturalPlan || result.nodes.length <= 6_000)
      && (
        !geometry.valid
        || terrain.maxForwardGrade
          > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade + 1e-4
        || terrain.maxCrossSlope
          > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4
      )
    ) {
      const repaired = repairRoadCenterlineGeometry(
        grid,
        result.nodes,
        waypoints,
        AUTO_REPAIR_WAYPOINT_TOLERANCE,
        Math.max(0, options.routeClearance ?? 0),
        Math.max(0, options.minimumTurnRadius ?? 0),
        options.maximumHeadingChangeRad ?? Math.PI,
        termination === 'loop',
      )
      if (
        repaired
        && !roadNodesHitExclusion(
          repaired.nodes,
          options.exclusionCircles,
          options.exclusionMargin,
        )
      ) {
        result = {
          ...result,
          nodes: repaired.nodes,
          length: roadNodesLength(repaired.nodes),
        }
        geometryAutoRepaired = true
        autoRepairRoundedCorners = repaired.roundedCorners
        maxAutoRepairWaypointOffset = repaired.maxWaypointOffset
        effectiveWaypointTolerance = Math.max(
          effectiveWaypointTolerance,
          AUTO_REPAIR_WAYPOINT_TOLERANCE,
        )
        geometry = validateRoadCenterlineGeometry(repaired.nodes, {
          clearance: Math.max(0, options.routeClearance ?? 0),
          minimumTurnRadius: Math.max(
            0,
            options.minimumTurnRadius ?? 0,
          ),
          maximumHeadingChangeRad:
            options.maximumHeadingChangeRad ?? Math.PI,
          closed: termination === 'loop',
        })
        terrain = summarizeScenicRoadTerrain(grid, result.nodes, {
          preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
          maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
          maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
        })
      }
    }
    if (result.complete && !geometry.valid) {
      result = {
        ...result,
        complete: false,
        failureReason: 'road-geometry-self-overlap',
      }
    } else if (
      result.complete
      && terrain.maxForwardGrade
        > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade + 1e-4
    ) {
      result = {
        ...result,
        complete: false,
        failureReason: 'road-forward-grade-limit',
      }
    } else if (
      result.complete
      && terrain.maxCrossSlope
        > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4
    ) {
      result = {
        ...result,
        complete: false,
        failureReason: 'road-cross-slope-limit',
      }
    }
    const stats = waypointPassStats(
      result.nodes,
      waypoints,
      effectiveWaypointTolerance,
    )
    const exclusionBlocked = roadNodesHitExclusion(
      result.nodes,
      options.exclusionCircles,
      options.exclusionMargin,
    )
    const failureReason = exclusionBlocked
      ? 'blocked-by-exclusion-zone'
      : (
          stats.passed !== waypoints.length
          || stats.maxError > effectiveWaypointTolerance + 1e-4
            ? 'waypoint-missed'
            : !result.complete && result.failureReason
              ? result.failureReason
              : terminationResult?.failureReason ?? result.failureReason
        )
    const complete = !exclusionBlocked
      && result.complete
      && !terminationResult?.failureReason
      && stats.passed === waypoints.length
      && stats.maxError <= effectiveWaypointTolerance + 1e-4
    return {
      ...result,
      ...terrain,
      complete,
      failureReason,
      closed: terminationResult?.closed ?? false,
      waypointCount: waypoints.length,
      waypointsPassed: stats.passed,
      maxWaypointError: stats.maxError,
      closureHeadingErrorRad: terminationResult?.closureHeadingErrorRad ?? 0,
      shortestExpandedStates: 0,
      waypointsSkipped: 0,
      skippedWaypointIndices: [],
      waypointsAttempted: Math.max(0, waypoints.length - 1),
      plannerMode: naturalPlan
        ? (guide ? 'guided-global' : 'official-natural')
        : 'guided-global',
      guideExpandedStates: guide?.expandedStates ?? 0,
      maxGuideDeviation: guide
        ? maxDistanceToGuide(result.nodes, guide.points)
        : 0,
      smoothingFallback,
      smoothingFallbackReason: smoothingFailureReason,
      detourRadius: guide?.corridorWidth ?? options.pathDeviation,
      maxDetourDistance: guide?.maxDetourDistance ?? 0,
      detourRadiusExpanded: guide?.detourRadiusExpanded ?? false,
      minCenterlineClearance: geometry.minCenterlineClearance,
      minTurnRadius: geometry.minTurnRadius,
      maxHeadingChangeRad: geometry.maxHeadingChangeRad,
      geometryAutoRepaired,
      autoRepairRoundedCorners,
      maxAutoRepairWaypointOffset,
      effectiveWaypointTolerance,
      naturalTargetLength,
      naturalLaps,
      unreachableWaypointIndex: complete
        ? null
        : (stats.passed < waypoints.length
            ? Math.min(waypoints.length - 1, stats.passed + 1)
            : null),
    }
  }
  const closed = options.termination === 'loop'
  let smoothingFallback = false
  let smoothingFailureReason: string | null = null
  let geometryAutoRepaired = false
  let autoRepairRoundedCorners = 0
  let maxAutoRepairWaypointOffset = 0
  let effectiveWaypointTolerance = options.waypointTolerance
  if (closed && waypoints.length === 1) {
    let lastResult: WaypointRoadPlanResult | null = null
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const attemptSeed = (
        options.seed + Math.imul(attempt, 0x9e3779b1)
      ) >>> 0
      const loopAnchors = singlePointLoopAnchors(
        grid,
        waypoints[0]!,
        attemptSeed,
        options.stepLength,
        options.maxSlope,
      )
      if (!loopAnchors) {
        continue
      }
      const nested = planWaypointRoadRoute(grid, {
        ...options,
        seed: attemptSeed,
        waypoints: loopAnchors,
      })
      const pass = waypointPassStats(
        nested.nodes,
        waypoints,
        options.waypointTolerance,
      )
      const adapted: WaypointRoadPlanResult = {
        ...nested,
        waypointCount: 1,
        waypointsPassed: pass.passed,
        maxWaypointError: pass.maxError,
      }
      lastResult = adapted
      if (nested.complete && nested.closed) {
        return adapted
      }
    }
    return lastResult ?? {
      nodes: [],
      length: 0,
      complete: false,
      failureReason: 'single-point-loop-too-small',
      rescueTurns: 0,
      closed: false,
      waypointCount: 1,
      waypointsPassed: 0,
      maxWaypointError: 0,
      closureHeadingErrorRad: 0,
      shortestExpandedStates: 0,
    }
  }
  const anchors: Vec2[] = waypoints.map((point) => ({ ...point }))

  if (anchors.length === 1) {
    if (options.termination === 'dead-end') {
      return {
        nodes: [],
        length: 0,
        complete: false,
        failureReason: 'route-too-short',
        rescueTurns: 0,
        closed: false,
        waypointCount: 1,
        waypointsPassed: 0,
        maxWaypointError: 0,
        closureHeadingErrorRad: 0,
        shortestExpandedStates: 0,
      }
    }
    const tail = traceRoadPath(grid, {
      startX: anchors[0]!.x,
      startZ: anchors[0]!.z,
      headingRad: resolveSeedHeadingRad(options.seed),
      stepLength: options.stepLength,
      feelDistance: options.feelDistance,
      feelAngleRad: options.feelAngleRad,
      maxSlope: options.maxSlope,
      maxTurnRad: options.maxTurnRad,
      maxLength: null,
      maxSteps: Math.max(
        4096,
        Math.ceil(((grid.maxX - grid.minX + grid.maxZ - grid.minZ) * 1.5) / options.stepLength),
      ),
      margin: options.margin,
    })
    const stats = waypointPassStats(tail.nodes, waypoints, options.waypointTolerance)
    return {
      ...tail,
      closed: false,
      waypointCount: waypoints.length,
      waypointsPassed: stats.passed,
      maxWaypointError: stats.maxError,
      closureHeadingErrorRad: 0,
      shortestExpandedStates: 0,
    }
  }

  const shortest = planShortestGuide(grid, anchors, closed, options)
  const shortestExpandedStates = shortest.expanded
  if (shortest.error || !shortest.guide.length) {
    return {
      nodes: [],
      length: 0,
      complete: false,
      failureReason: shortest.error ?? 'shortest-route-not-found',
      rescueTurns: 0,
      closed: false,
      waypointCount: waypoints.length,
      waypointsPassed: 0,
      maxWaypointError: 0,
      closureHeadingErrorRad: 0,
      shortestExpandedStates,
    }
  }
  const guide = shortest.guide

  const traced = traceGuide(grid, guide, waypoints, options)
  let result = traced.result
  if (!traced.reachedGuideEnd) {
    return {
      ...result,
      closed: false,
      waypointCount: waypoints.length,
      waypointsPassed: waypointPassStats(result.nodes, waypoints, options.waypointTolerance).passed,
      maxWaypointError: waypointPassStats(result.nodes, waypoints, options.waypointTolerance).maxError,
      closureHeadingErrorRad: 0,
      shortestExpandedStates,
    }
  }
  if (closed && result.nodes.length > 1) {
    const first = result.nodes[0]!
    const last = result.nodes[result.nodes.length - 1]!
    const closeY = grid.sampleHeight(first.x, first.z)
    if (closeY != null) {
      const previous = result.nodes[result.nodes.length - 2]!
      last.x = first.x
      last.z = first.z
      last.y = closeY
      last.heading = first.heading
      last.headingDelta = wrapAngle(last.heading - previous.heading)
    }
  } else if (options.termination === 'boundary') {
    result = appendBoundaryTail(grid, result, options)
  }
  if (result.complete && result.nodes.length >= 3) {
    const smoothing = smoothRoadCenterline(
      grid,
      result.nodes,
      waypoints,
      options.waypointTolerance,
      options.termination,
    )
    smoothingFallback = smoothing.smoothingFallback
    smoothingFailureReason = smoothing.failureReason
    if (roadNodesHitExclusion(
      smoothing.nodes,
      options.exclusionCircles,
      options.exclusionMargin,
    )) {
      smoothingFallback = true
      smoothingFailureReason = 'blocked-by-exclusion-zone'
    } else {
      result = {
        ...result,
        nodes: smoothing.nodes,
        length: roadNodesLength(smoothing.nodes),
      }
    }
  }
  if (
    roadNodesHitExclusion(
      result.nodes,
      options.exclusionCircles,
      options.exclusionMargin,
    )
  ) {
    const guideFallback = createGuideFallbackRoute(grid, guide)
    if (guideFallback.complete && guideFallback.nodes.length >= 2) {
      result = {
        ...result,
        ...guideFallback,
      }
      smoothingFallback = true
      smoothingFailureReason = 'blocked-by-exclusion-zone'
    }
  }
  let terrain = summarizeScenicRoadTerrain(grid, result.nodes, {
    preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
    maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
    maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
  })
  let geometry = validateRoadCenterlineGeometry(result.nodes, {
    clearance: Math.max(0, options.routeClearance ?? 0),
    minimumTurnRadius: Math.max(
      0,
      options.minimumTurnRadius ?? 0,
    ),
    maximumHeadingChangeRad:
      options.maximumHeadingChangeRad ?? Math.PI,
    closed: options.termination === 'loop',
  })
  if (
    result.complete
    && (
      !geometry.valid
      || terrain.maxForwardGrade
        > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade + 1e-4
      || terrain.maxCrossSlope
        > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4
    )
  ) {
    const repaired = repairRoadCenterlineGeometry(
      grid,
      result.nodes,
      waypoints,
      AUTO_REPAIR_WAYPOINT_TOLERANCE,
      Math.max(0, options.routeClearance ?? 0),
      Math.max(0, options.minimumTurnRadius ?? 0),
      options.maximumHeadingChangeRad ?? Math.PI,
      options.termination === 'loop',
    )
    if (
      repaired
      && !roadNodesHitExclusion(
        repaired.nodes,
        options.exclusionCircles,
        options.exclusionMargin,
      )
    ) {
      result = {
        ...result,
        nodes: repaired.nodes,
        length: roadNodesLength(repaired.nodes),
      }
      geometryAutoRepaired = true
      autoRepairRoundedCorners = repaired.roundedCorners
      maxAutoRepairWaypointOffset = repaired.maxWaypointOffset
      effectiveWaypointTolerance = Math.max(
        effectiveWaypointTolerance,
        AUTO_REPAIR_WAYPOINT_TOLERANCE,
      )
      geometry = validateRoadCenterlineGeometry(repaired.nodes, {
        clearance: Math.max(0, options.routeClearance ?? 0),
        minimumTurnRadius: Math.max(
          0,
          options.minimumTurnRadius ?? 0,
        ),
        maximumHeadingChangeRad:
          options.maximumHeadingChangeRad ?? Math.PI,
        closed: options.termination === 'loop',
      })
      terrain = summarizeScenicRoadTerrain(grid, result.nodes, {
        preferredGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
        maxGrade: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
        maxCrossSlope: SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
      })
    }
  }
  if (result.complete && !geometry.valid) {
    result = {
      ...result,
      complete: false,
      failureReason: 'road-geometry-self-overlap',
    }
  } else if (
    result.complete
    && terrain.maxForwardGrade
      > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade + 1e-4
  ) {
    result = {
      ...result,
      complete: false,
      failureReason: 'road-forward-grade-limit',
    }
  } else if (
    result.complete
    && terrain.maxCrossSlope
      > SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope + 1e-4
  ) {
    result = {
      ...result,
      complete: false,
      failureReason: 'road-cross-slope-limit',
    }
  }
  const stats = waypointPassStats(
    result.nodes,
    waypoints,
    effectiveWaypointTolerance,
  )
  const closedError = closed && result.nodes.length > 1
    ? Math.hypot(
        result.nodes[0]!.x - result.nodes[result.nodes.length - 1]!.x,
        result.nodes[0]!.z - result.nodes[result.nodes.length - 1]!.z,
      )
    : 0
  const closureHeadingErrorRad = closed && result.nodes.length > 1
    ? Math.abs(wrapAngle(result.nodes[result.nodes.length - 1]!.heading - result.nodes[0]!.heading))
    : 0
  let complete = result.complete
    && stats.passed === waypoints.length
    && stats.maxError <= effectiveWaypointTolerance
  let failureReason = result.failureReason
  if (
    stats.passed !== waypoints.length
    || stats.maxError > effectiveWaypointTolerance
  ) {
    complete = false
    failureReason = 'waypoint-missed'
  } else if (closed && closedError > 0.5) {
    complete = false
    failureReason = 'loop-not-closed'
  } else if (complete && closed) {
    failureReason = 'reached-route-start'
  } else if (complete && options.termination === 'dead-end') {
    failureReason = 'reached-route-end'
  }
  if (
    complete
    && roadNodesHitExclusion(
      result.nodes,
      options.exclusionCircles,
      options.exclusionMargin,
    )
  ) {
    complete = false
    failureReason = 'blocked-by-exclusion-zone'
  }
  return {
    ...result,
    ...terrain,
    complete,
    failureReason,
    closed: closed && closedError <= 0.5,
    waypointCount: waypoints.length,
    waypointsPassed: stats.passed,
    maxWaypointError: stats.maxError,
    closureHeadingErrorRad,
    shortestExpandedStates,
    smoothingFallback,
    smoothingFallbackReason: smoothingFailureReason,
    detourRadius: options.pathDeviation,
    maxDetourDistance: 0,
    detourRadiusExpanded: false,
    minCenterlineClearance: geometry.minCenterlineClearance,
    minTurnRadius: geometry.minTurnRadius,
    maxHeadingChangeRad: geometry.maxHeadingChangeRad,
    geometryAutoRepaired,
    autoRepairRoundedCorners,
    maxAutoRepairWaypointOffset,
    effectiveWaypointTolerance,
  }
}

