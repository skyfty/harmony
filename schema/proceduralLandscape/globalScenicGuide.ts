import { clamp, smoothstep } from './noise'
import {
  buildScenicTerrainElevationProfile,
  SLOWROADS_SCENIC_ROAD_CONSTRAINTS,
} from './officialScenicRoad'
import type { RoadWaypoint } from './roadWaypoints'
import type { TerrainHeightGrid } from './terrainSampler'

const MAX_PLANNING_CELLS_PER_AXIS = 2048
const MIN_PLANNING_CELL_SIZE = 10
const MAX_PLANNING_CELL_SIZE = 30
const DEFAULT_MAX_EXPANDED_STATES = 6_000_000

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

type Vec2 = { x: number; z: number }

export interface GlobalScenicGuideOptions {
  seed: number
  stepLength: number
  pathDeviation: number
  margin: number
  termination?: 'loop' | 'boundary' | 'dead-end'
  preferredGrade?: number
  maxGrade?: number
  maxCrossSlope?: number
  crossSlopeWeight?: number
  maxExpandedStates?: number
}

export interface GlobalScenicGuideResult {
  points: Vec2[]
  expandedStates: number
  corridorWidth: number
  failureReason: string | null
  unreachableWaypointIndex: number | null
}

type PlanningGrid = {
  minX: number
  minZ: number
  cellSize: number
  cols: number
  rows: number
  heights: Float32Array
  gradientX: Float32Array
  gradientZ: Float32Array
}

type AnchoredCell = {
  col: number
  row: number
  index: number
}

type GuideProfile = ReturnType<typeof buildScenicTerrainElevationProfile>

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

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

function createPlanningGrid(grid: TerrainHeightGrid): PlanningGrid {
  const spanX = Math.max(1, grid.maxX - grid.minX)
  const spanZ = Math.max(1, grid.maxZ - grid.minZ)
  const baseCellSize = clamp(
    grid.cellSize,
    MIN_PLANNING_CELL_SIZE,
    MAX_PLANNING_CELL_SIZE,
  )
  const cellSize = Math.max(
    baseCellSize,
    Math.ceil(Math.max(spanX, spanZ) / MAX_PLANNING_CELLS_PER_AXIS),
  )
  const cols = Math.max(2, Math.ceil(spanX / cellSize) + 1)
  const rows = Math.max(2, Math.ceil(spanZ / cellSize) + 1)
  const heights = new Float32Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    const z = grid.minZ + row * cellSize
    for (let col = 0; col < cols; col += 1) {
      const x = grid.minX + col * cellSize
      heights[row * cols + col] = grid.sampleHeight(x, z) ?? Number.NaN
    }
  }
  const gradientX = new Float32Array(cols * rows)
  const gradientZ = new Float32Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      const left = heights[row * cols + Math.max(0, col - 1)]!
      const right = heights[row * cols + Math.min(cols - 1, col + 1)]!
      const down = heights[Math.max(0, row - 1) * cols + col]!
      const up = heights[Math.min(rows - 1, row + 1) * cols + col]!
      gradientX[index] = Number.isFinite(left) && Number.isFinite(right)
        ? (right - left) / (2 * cellSize)
        : 0
      gradientZ[index] = Number.isFinite(down) && Number.isFinite(up)
        ? (up - down) / (2 * cellSize)
        : 0
    }
  }
  return {
    minX: grid.minX,
    minZ: grid.minZ,
    cellSize,
    cols,
    rows,
    heights,
    gradientX,
    gradientZ,
  }
}

function cellPoint(planning: PlanningGrid, col: number, row: number): Vec2 {
  return {
    x: planning.minX + col * planning.cellSize,
    z: planning.minZ + row * planning.cellSize,
  }
}

function crossSlopeForDirection(
  planning: PlanningGrid,
  index: number,
  dx: number,
  dz: number,
): number {
  const gradientX = planning.gradientX[index]!
  const gradientZ = planning.gradientZ[index]!
  return Math.abs(-gradientX * dz + gradientZ * dx)
}

function resolveAnchorCell(
  planning: PlanningGrid,
  point: Vec2,
  maxGrade: number,
): AnchoredCell | null {
  const centerCol = Math.round((point.x - planning.minX) / planning.cellSize)
  const centerRow = Math.round((point.z - planning.minZ) / planning.cellSize)
  let best: AnchoredCell | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let radius = 0; radius <= 2; radius += 1) {
    for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
      for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
        if (
          radius > 0
          && Math.abs(rowOffset) !== radius
          && Math.abs(colOffset) !== radius
        ) {
          continue
        }
        const col = centerCol + colOffset
        const row = centerRow + rowOffset
        if (
          col < 0
          || row < 0
          || col >= planning.cols
          || row >= planning.rows
        ) {
          continue
        }
        const index = row * planning.cols + col
        const height = planning.heights[index]!
        if (!Number.isFinite(height)) {
          continue
        }
        const candidate = cellPoint(planning, col, row)
        const connectorLength = distance(point, candidate)
        if (
          connectorLength > 1e-6
          && Math.abs(height - heightAtPoint(planning, point)) / connectorLength
            > maxGrade + 1e-6
        ) {
          continue
        }
        if (connectorLength < bestDistance) {
          bestDistance = connectorLength
          best = { col, row, index }
        }
      }
    }
  }
  return best
}

function heightAtPoint(planning: PlanningGrid, point: Vec2): number {
  const gx = (point.x - planning.minX) / planning.cellSize
  const gz = (point.z - planning.minZ) / planning.cellSize
  if (
    !Number.isFinite(gx)
    || !Number.isFinite(gz)
    || gx < 0
    || gz < 0
    || gx > planning.cols - 1
    || gz > planning.rows - 1
  ) {
    return Number.NaN
  }
  const col = clamp(Math.floor(gx), 0, planning.cols - 2)
  const row = clamp(Math.floor(gz), 0, planning.rows - 2)
  const tx = clamp(gx - col, 0, 1)
  const tz = clamp(gz - row, 0, 1)
  const h00 = planning.heights[row * planning.cols + col]!
  const h10 = planning.heights[row * planning.cols + col + 1]!
  const h01 = planning.heights[(row + 1) * planning.cols + col]!
  const h11 = planning.heights[(row + 1) * planning.cols + col + 1]!
  return tz >= tx
    ? h00 + (h01 - h00) * tz + (h11 - h01) * tx
    : h00 + (h10 - h00) * tx + (h11 - h10) * tz
}

function reconstructPath(
  parents: Int32Array,
  resultIndex: number,
  planning: PlanningGrid,
): Vec2[] {
  const indices: number[] = []
  let cursor = resultIndex
  while (cursor >= 0) {
    indices.push(cursor)
    cursor = parents[cursor]!
  }
  indices.reverse()
  return indices.map((index) => (
    cellPoint(
      planning,
      index % planning.cols,
      Math.floor(index / planning.cols),
    )
  ))
}

function searchGuideLeg(
  planning: PlanningGrid,
  profile: GuideProfile,
  start: Vec2,
  end: Vec2 | null,
  options: GlobalScenicGuideOptions,
  remainingBudget: number,
  avoidMask: Uint8Array | null = null,
): {
  points: Vec2[] | null
  expanded: number
  budgetExceeded: boolean
  unreachable: boolean
} {
  const maxGrade = options.maxGrade ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade
  const maxCrossSlope = options.maxCrossSlope
    ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope
  const preferredGrade = options.preferredGrade
    ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade
  const startCell = resolveAnchorCell(planning, start, maxGrade)
  const endCell = end
    ? resolveAnchorCell(planning, end, maxGrade)
    : null
  if (!startCell || (end && !endCell)) {
    return {
      points: null,
      expanded: 0,
      budgetExceeded: false,
      unreachable: true,
    }
  }
  const total = planning.cols * planning.rows
  const distances = new Float64Array(total)
  distances.fill(Number.POSITIVE_INFINITY)
  const parents = new Int32Array(total)
  parents.fill(-1)
  const closed = new Uint8Array(total)
  const heap = new MinHeap()
  const startIndex = startCell.index
  const endIndex = endCell?.index ?? -1
  const marginCells = Math.max(
    1,
    Math.ceil(options.margin / planning.cellSize),
  )
  const reachesBoundary = (col: number, row: number): boolean => (
    col <= marginCells
    || row <= marginCells
    || col >= planning.cols - 1 - marginCells
    || row >= planning.rows - 1 - marginCells
  )
  const goalDistance = (col: number, row: number): number => {
    if (endCell) {
      return Math.hypot(
        (endCell.col - col) * planning.cellSize,
        (endCell.row - row) * planning.cellSize,
      )
    }
    return Math.min(
      col,
      row,
      planning.cols - 1 - col,
      planning.rows - 1 - row,
    ) * planning.cellSize
  }
  let resultIndex = -1
  let expanded = 0
  distances[startIndex] = 0
  heap.push(
    startIndex,
    goalDistance(startCell.col, startCell.row),
  )
  while (heap.size) {
    if (expanded >= remainingBudget) {
      return {
        points: null,
        expanded,
        budgetExceeded: true,
        unreachable: false,
      }
    }
    const top = heap.pop()
    if (!top || closed[top.state]) {
      continue
    }
    const state = top.state
    closed[state] = 1
    expanded += 1
    const col = state % planning.cols
    const row = Math.floor(state / planning.cols)
    if (
      endCell
        ? state === endIndex
        : reachesBoundary(col, row)
    ) {
      resultIndex = state
      break
    }
    const currentHeight = planning.heights[state]!
    if (!Number.isFinite(currentHeight)) {
      continue
    }
    for (const [dx, dz] of DIRECTIONS) {
      const nextCol = col + dx
      const nextRow = row + dz
      if (
        nextCol < 0
        || nextRow < 0
        || nextCol >= planning.cols
        || nextRow >= planning.rows
      ) {
        continue
      }
      const nextIndex = nextRow * planning.cols + nextCol
      if (closed[nextIndex]) {
        continue
      }
      const nextHeight = planning.heights[nextIndex]!
      if (!Number.isFinite(nextHeight)) {
        continue
      }
      const length = Math.hypot(dx, dz) * planning.cellSize
      const grade = Math.abs(nextHeight - currentHeight) / length
      if (grade > maxGrade + 1e-6) {
        continue
      }
      const crossSlope = crossSlopeForDirection(
        planning,
        nextIndex,
        dx / Math.hypot(dx, dz),
        dz / Math.hypot(dx, dz),
      )
      if (crossSlope > maxCrossSlope + 1e-6) {
        continue
      }
      const gradeNorm = grade / Math.max(1e-5, maxGrade)
      const crossNorm = crossSlope / Math.max(1e-5, maxCrossSlope)
      const preferredNorm = grade / Math.max(1e-5, preferredGrade)
      const elevationPercentile = profile.percentileAtHeight(nextHeight)
      const lowlandPenalty = smoothstep(
        SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandStartPercentile,
        SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandPreferenceCeiling,
        elevationPercentile,
      )
      const overlapPenalty = avoidMask?.[nextIndex] ? 2.5 : 0
      const stepCost = length * (
        1
        + gradeNorm * gradeNorm * 8
        + Math.max(0, preferredNorm - 1) ** 2 * 2
        + crossNorm * crossNorm * (options.crossSlopeWeight ?? 2.5)
        + lowlandPenalty * 0.45
        + overlapPenalty
      )
      const nextDistance = distances[state]! + stepCost
      if (nextDistance >= distances[nextIndex]!) {
        continue
      }
      distances[nextIndex] = nextDistance
      parents[nextIndex] = state
      heap.push(
        nextIndex,
        nextDistance + goalDistance(nextCol, nextRow),
      )
    }
  }
  if (resultIndex < 0) {
    return {
      points: null,
      expanded,
      budgetExceeded: false,
      unreachable: true,
    }
  }
  const points = [{ ...start }, ...reconstructPath(parents, resultIndex, planning)]
  if (end) {
    points.push({ ...end })
  }
  return {
    points,
    expanded,
    budgetExceeded: false,
    unreachable: false,
  }
}

function appendUnique(points: Vec2[], point: Vec2): void {
  if (!points.length || distance(points[points.length - 1]!, point) > 1e-4) {
    points.push({ ...point })
  }
}

function buildGuideCorridorMask(
  planning: PlanningGrid,
  legs: ReadonlyArray<ReadonlyArray<Vec2>>,
  radiusMeters: number,
): Uint8Array {
  const mask = new Uint8Array(planning.cols * planning.rows)
  const radiusCells = Math.max(
    1,
    Math.ceil(radiusMeters / planning.cellSize),
  )
  const mark = (x: number, z: number): void => {
    const centerCol = Math.round((x - planning.minX) / planning.cellSize)
    const centerRow = Math.round((z - planning.minZ) / planning.cellSize)
    for (let rowOffset = -radiusCells; rowOffset <= radiusCells; rowOffset += 1) {
      for (let colOffset = -radiusCells; colOffset <= radiusCells; colOffset += 1) {
        if (colOffset * colOffset + rowOffset * rowOffset > radiusCells * radiusCells) {
          continue
        }
        const col = centerCol + colOffset
        const row = centerRow + rowOffset
        if (
          col >= 0
          && row >= 0
          && col < planning.cols
          && row < planning.rows
        ) {
          mask[row * planning.cols + col] = 1
        }
      }
    }
  }
  for (const leg of legs) {
    for (let index = 1; index < leg.length; index += 1) {
      const start = leg[index - 1]!
      const end = leg[index]!
      const length = distance(start, end)
      const count = Math.max(1, Math.ceil(length / (planning.cellSize * 0.5)))
      for (let step = 0; step <= count; step += 1) {
        const t = step / count
        mark(
          start.x + (end.x - start.x) * t,
          start.z + (end.z - start.z) * t,
        )
      }
    }
  }
  return mask
}

function chaikin(points: ReadonlyArray<Vec2>, iterations: number): Vec2[] {
  let current = points.map((point) => ({ ...point }))
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (current.length < 3) {
      break
    }
    const next: Vec2[] = [{ ...current[0]! }]
    for (let index = 0; index < current.length - 1; index += 1) {
      const start = current[index]!
      const end = current[index + 1]!
      next.push({
        x: start.x * 0.75 + end.x * 0.25,
        z: start.z * 0.75 + end.z * 0.25,
      })
      next.push({
        x: start.x * 0.25 + end.x * 0.75,
        z: start.z * 0.25 + end.z * 0.75,
      })
    }
    next.push({ ...current[current.length - 1]! })
    current = next
  }
  return current
}

function resampleGuide(
  grid: TerrainHeightGrid,
  points: ReadonlyArray<Vec2>,
  spacing: number,
): Vec2[] {
  if (points.length < 2) {
    return points.map((point) => ({ ...point }))
  }
  const result: Vec2[] = [{ ...points[0]! }]
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!
    const end = points[index]!
    const length = distance(start, end)
    const count = Math.max(1, Math.ceil(length / spacing))
    for (let step = 1; step <= count; step += 1) {
      const t = step / count
      const point = {
        x: start.x + (end.x - start.x) * t,
        z: start.z + (end.z - start.z) * t,
      }
      if (grid.sampleHeight(point.x, point.z) == null) {
        continue
      }
      appendUnique(result, point)
    }
  }
  return result
}

function guideSegmentValid(
  grid: TerrainHeightGrid,
  start: Vec2,
  end: Vec2,
  maxGrade: number,
  maxCrossSlope: number,
): boolean {
  const length = distance(start, end)
  if (length <= 1e-6) {
    return true
  }
  const startHeight = grid.sampleHeight(start.x, start.z)
  const endHeight = grid.sampleHeight(end.x, end.z)
  if (startHeight == null || endHeight == null) {
    return false
  }
  if (Math.abs(endHeight - startHeight) / length > maxGrade + 1e-6) {
    return false
  }
  const sampleSize = Math.max(grid.cellSize, 10)
  const directionX = (end.x - start.x) / length
  const directionZ = (end.z - start.z) / length
  const crossA = grid.sampleHeight(
    (start.x + end.x) * 0.5 - directionZ * sampleSize,
    (start.z + end.z) * 0.5 + directionX * sampleSize,
  )
  const crossB = grid.sampleHeight(
    (start.x + end.x) * 0.5 + directionZ * sampleSize,
    (start.z + end.z) * 0.5 - directionX * sampleSize,
  )
  return crossA == null || crossB == null
    || Math.abs(crossA - crossB) / (2 * sampleSize) <= maxCrossSlope + 1e-6
}

function guideValid(
  grid: TerrainHeightGrid,
  points: ReadonlyArray<Vec2>,
  maxGrade: number,
  maxCrossSlope: number,
): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (!guideSegmentValid(
      grid,
      points[index - 1]!,
      points[index]!,
      maxGrade,
      maxCrossSlope,
    )) {
      return false
    }
  }
  return true
}

function prepareGuide(
  grid: TerrainHeightGrid,
  rawLegs: ReadonlyArray<ReadonlyArray<Vec2>>,
  options: GlobalScenicGuideOptions,
): Vec2[] | null {
  const maxGrade = options.maxGrade ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade
  const maxCrossSlope = options.maxCrossSlope
    ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope
  const spacing = Math.max(4, Math.min(16, options.stepLength))
  for (const iterations of [4, 3, 2, 1, 0]) {
    const points: Vec2[] = []
    for (const leg of rawLegs) {
      const smoothed = resampleGuide(grid, chaikin(leg, iterations), spacing)
      for (const point of smoothed) {
        appendUnique(points, point)
      }
    }
    if (guideValid(
      grid,
      points,
      maxGrade * 1.08,
      maxCrossSlope * 1.08,
    )) {
      return points
    }
  }
  const raw: Vec2[] = []
  for (const leg of rawLegs) {
    for (const point of resampleGuide(grid, leg, spacing)) {
      appendUnique(raw, point)
    }
  }
  return raw.length >= 2 ? raw : null
}

/**
 * Build a deterministic, slope-feasible guide through every waypoint and out
 * to the terrain boundary. The guide is intentionally separate from the final
 * centerline: the Hills tracer follows it while producing the rendered curve.
 */
export function buildGlobalScenicGuide(
  grid: TerrainHeightGrid,
  waypoints: ReadonlyArray<RoadWaypoint>,
  options: GlobalScenicGuideOptions,
): GlobalScenicGuideResult {
  const corridorWidth = Math.max(20, options.pathDeviation)
  const termination = options.termination ?? 'boundary'
  if (!waypoints.length) {
    return {
      points: [],
      expandedStates: 0,
      corridorWidth,
      failureReason: 'no-waypoints',
      unreachableWaypointIndex: null,
    }
  }
  if (waypoints.length === 1 && termination === 'dead-end') {
    return {
      points: [],
      expandedStates: 0,
      corridorWidth,
      failureReason: 'route-too-short',
      unreachableWaypointIndex: null,
    }
  }
  if (waypoints.length === 1 && termination === 'loop') {
    return {
      points: [],
      expandedStates: 0,
      corridorWidth,
      failureReason: 'single-point-loop-too-small',
      unreachableWaypointIndex: null,
    }
  }
  const planning = createPlanningGrid(grid)
  const profile = buildScenicTerrainElevationProfile(grid)
  const maxExpandedStates = Math.max(
    1,
    Math.round(
      options.maxExpandedStates ?? DEFAULT_MAX_EXPANDED_STATES,
    ),
  )
  let expandedStates = 0
  const legs: Vec2[][] = []
  for (let index = 1; index < waypoints.length; index += 1) {
    const leg = searchGuideLeg(
      planning,
      profile,
      { x: waypoints[index - 1]!.x, z: waypoints[index - 1]!.z },
      { x: waypoints[index]!.x, z: waypoints[index]!.z },
      options,
      maxExpandedStates - expandedStates,
    )
    expandedStates += leg.expanded
    if (!leg.points) {
      return {
        points: [],
        expandedStates,
        corridorWidth,
        failureReason: leg.budgetExceeded
          ? 'global-guide-budget-exceeded'
          : 'waypoint-unreachable',
        unreachableWaypointIndex: index,
      }
    }
    legs.push(leg.points)
  }
  const last = waypoints[waypoints.length - 1]!
  if (termination === 'loop') {
    const origin = { x: waypoints[0]!.x, z: waypoints[0]!.z }
    let returnEnd = origin
    const firstLeg = legs[0]
    if (firstLeg && firstLeg.length >= 2) {
      const first = firstLeg[0]!
      const next = firstLeg.find((point) => distance(first, point) > 1) ?? null
      if (next) {
        const heading = Math.atan2(next.z - first.z, next.x - first.x)
        const closureLength = Math.max(60, options.stepLength * 6)
        const approach = {
          x: origin.x - Math.cos(heading) * closureLength,
          z: origin.z - Math.sin(heading) * closureLength,
        }
        const approachHeight = grid.sampleHeight(approach.x, approach.z)
        const originHeight = grid.sampleHeight(origin.x, origin.z)
        if (
          approachHeight != null
          && originHeight != null
          && Math.abs(originHeight - approachHeight) / closureLength
            <= (options.maxGrade ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade)
        ) {
          returnEnd = approach
        }
      }
    }
    const corridorRadius = Math.max(
      30,
      Math.min(60, corridorWidth * 0.5),
    )
    const avoidMask = buildGuideCorridorMask(
      planning,
      legs,
      corridorRadius,
    )
    const returnLeg = searchGuideLeg(
      planning,
      profile,
      { x: last.x, z: last.z },
      returnEnd,
      options,
      maxExpandedStates - expandedStates,
      avoidMask,
    )
    expandedStates += returnLeg.expanded
    if (!returnLeg.points) {
      return {
        points: [],
        expandedStates,
        corridorWidth,
        failureReason: returnLeg.budgetExceeded
          ? 'global-guide-budget-exceeded'
          : 'loop-not-closed',
        unreachableWaypointIndex: null,
      }
    }
    appendUnique(returnLeg.points, origin)
    legs.push(returnLeg.points)
  } else if (termination === 'boundary') {
    const boundary = searchGuideLeg(
      planning,
      profile,
      { x: last.x, z: last.z },
      null,
      options,
      maxExpandedStates - expandedStates,
    )
    expandedStates += boundary.expanded
    if (!boundary.points) {
      return {
        points: [],
        expandedStates,
        corridorWidth,
        failureReason: boundary.budgetExceeded
          ? 'global-guide-budget-exceeded'
          : 'boundary-unreachable',
        unreachableWaypointIndex: null,
      }
    }
    legs.push(boundary.points)
  }
  const points = prepareGuide(grid, legs, options)
  if (!points) {
    return {
      points: [],
      expandedStates,
      corridorWidth,
      failureReason: 'guided-guide-prepare-failed',
      unreachableWaypointIndex: null,
    }
  }
  return {
    points,
    expandedStates,
    corridorWidth,
    failureReason: null,
    unreachableWaypointIndex: null,
  }
}
