import { clamp, hashUnit, smoothstep, wrapAngle } from './noise'
import type { RoadTraceNode, RoadTraceResult } from './roadTrace'
import type { TerrainHeightGrid } from './terrainSampler'

/**
 * Slow Roads "Hills" midline profile.
 *
 * Values come from the shipped `DevMidlineGenerator` road-style table. The
 * editor keeps this profile fixed for the natural scenic strategy so the road
 * follows the same steering model as the reference scene instead of inheriting
 * the legacy lab candidate search.
 */
export const SLOWROADS_HILLS_ROAD_PROFILE = Object.freeze({
  stepLength: 10,
  feelDistance: 30,
  feelAngleRad: 0.463,
  maxGrad: 0.16,
  maxTurnDelta: 0.1,
  smoothFactor: 0.5,
  smoothWindow: 9,
  curvatureHeightFactor: 3,
  roadSink: 0.2,
  targetRadius: 9_000,
  targetRadiusMin: 5_000,
  targetRadiusMax: 13_000,
  boundaryMargin: 24,
  maxSteps: 32_768,
})

export const SLOWROADS_LOWLAND_ROAD_CONSTRAINTS = Object.freeze({
  lowlandStartPercentile: 0.4,
  lowlandPreferenceCeiling: 0.7,
  lowlandCoveragePercentile: 0.65,
  preferredGrade: 0.16,
  maxGrade: 0.22,
  maxCrossSlope: 0.35,
  startGraceDistance: 500,
})

export interface OfficialScenicRoadOptions {
  algorithmVersion?: number
  lowlandStartPercentile?: number
  lowlandPreferenceCeiling?: number
  lowlandCoveragePercentile?: number
  preferredGrade?: number
  maxGrade?: number
  maxCrossSlope?: number
  startGraceDistance?: number
}

export interface ScenicTerrainElevationProfile {
  minY: number
  maxY: number
  lowlandHeight: number
  lowlandCoverageHeight: number
  preferenceCeilingHeight: number
  percentileAtHeight(height: number): number
}

export interface OfficialScenicRoadResult extends RoadTraceResult {
  /** Times the official cumulative-turn/overflow guard retracted the road. */
  officialReverts: number
  /** Times an anti-target was installed to stop the road doubling back. */
  antiTargetTriggers: number
  /** Times the target-direction overflow guard fired. */
  turnOverflows: number
  averageElevationPercentile: number
  maxElevationPercentile: number
  maxForwardGrade: number
  maxCrossSlope: number
  lowlandCoverageFraction: number
  steepReplacementSteps: number
}

type Vec2 = { x: number; z: number }

type ResolvedTerrainConstraints = {
  lowlandStartPercentile: number
  lowlandPreferenceCeiling: number
  lowlandCoveragePercentile: number
  preferredGrade: number
  maxGrade: number
  maxCrossSlope: number
  startGraceDistance: number
}

type TurnTracker = {
  window: number
  revert: number
  limit: number
}

const TURN_TRACKERS: ReadonlyArray<TurnTracker> = [
  { window: 15, revert: 15, limit: 3.3 },
  { window: 30, revert: 10, limit: 3.3 },
  { window: 60, revert: 15, limit: 3.4 },
  { window: 120, revert: 20, limit: 3.6 },
]

const TRACKER_TOLERANCE_FACTOR = 1
const MAX_RESTART_ATTEMPTS = 4

function resolveTerrainConstraints(
  options: OfficialScenicRoadOptions,
): ResolvedTerrainConstraints {
  return {
    lowlandStartPercentile: clamp(
      options.lowlandStartPercentile
        ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.lowlandStartPercentile,
      0,
      0.95,
    ),
    lowlandPreferenceCeiling: clamp(
      options.lowlandPreferenceCeiling
        ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.lowlandPreferenceCeiling,
      0.05,
      1,
    ),
    lowlandCoveragePercentile: clamp(
      options.lowlandCoveragePercentile
        ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.lowlandCoveragePercentile,
      0.05,
      1,
    ),
    preferredGrade: Math.max(
      0.01,
      options.preferredGrade ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.preferredGrade,
    ),
    maxGrade: Math.max(
      0.01,
      options.maxGrade ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.maxGrade,
    ),
    maxCrossSlope: Math.max(
      0.01,
      options.maxCrossSlope ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.maxCrossSlope,
    ),
    startGraceDistance: Math.max(
      0,
      options.startGraceDistance ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.startGraceDistance,
    ),
  }
}

type TerrainGradient = {
  dx: number
  dz: number
  magnitude: number
}

function sampleTerrainGradient(
  grid: TerrainHeightGrid,
  x: number,
  z: number,
): TerrainGradient | null {
  const spacing = Math.max(1, grid.cellSize)
  const west = grid.sampleHeight(x - spacing, z)
  const east = grid.sampleHeight(x + spacing, z)
  const north = grid.sampleHeight(x, z - spacing)
  const south = grid.sampleHeight(x, z + spacing)
  if (west == null || east == null || north == null || south == null) {
    return null
  }
  const dx = (east - west) / (spacing * 2)
  const dz = (south - north) / (spacing * 2)
  return {
    dx,
    dz,
    magnitude: Math.hypot(dx, dz),
  }
}

function crossSlopeForHeading(
  gradient: TerrainGradient | null,
  heading: number,
): number {
  if (!gradient) {
    return 0
  }
  return Math.abs(-Math.sin(heading) * gradient.dx + Math.cos(heading) * gradient.dz)
}

function downhillDirection(
  grid: TerrainHeightGrid,
  x: number,
  z: number,
): Vec2 | null {
  const distance = Math.max(60, SLOWROADS_HILLS_ROAD_PROFILE.feelDistance * 2)
  const west = grid.sampleHeight(x - distance, z)
  const east = grid.sampleHeight(x + distance, z)
  const north = grid.sampleHeight(x, z - distance)
  const south = grid.sampleHeight(x, z + distance)
  if (west == null || east == null || north == null || south == null) {
    return null
  }
  const dx = (east - west) / (distance * 2)
  const dz = (south - north) / (distance * 2)
  const magnitude = Math.hypot(dx, dz)
  return magnitude > 1e-7 ? { x: -dx / magnitude, z: -dz / magnitude } : null
}

function summarizeScenicRoute(
  grid: TerrainHeightGrid,
  nodes: RoadTraceNode[],
  profile: ScenicTerrainElevationProfile,
  constraints: ResolvedTerrainConstraints,
): Pick<
  OfficialScenicRoadResult,
  | 'averageElevationPercentile'
  | 'maxElevationPercentile'
  | 'maxForwardGrade'
  | 'maxCrossSlope'
  | 'lowlandCoverageFraction'
> {
  if (nodes.length < 2) {
    return {
      averageElevationPercentile: 0,
      maxElevationPercentile: 0,
      maxForwardGrade: 0,
      maxCrossSlope: 0,
      lowlandCoverageFraction: 0,
    }
  }
  const heights: number[] = []
  const percentiles: number[] = []
  let totalLength = 0
  let weightedPercentile = 0
  let lowlandLength = 0
  let maxElevationPercentile = 0
  let maxForwardGrade = 0
  let maxCrossSlope = 0
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const height = grid.sampleHeight(node.x, node.z)
    if (height == null) {
      continue
    }
    heights[index] = height
    const percentile = profile.percentileAtHeight(height)
    percentiles[index] = percentile
    maxElevationPercentile = Math.max(maxElevationPercentile, percentile)
    if (index > 0) {
      const gradient = sampleTerrainGradient(grid, node.x, node.z)
      maxCrossSlope = Math.max(
        maxCrossSlope,
        crossSlopeForHeading(gradient, node.heading),
      )
    }
  }
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1]!
    const node = nodes[index]!
    const segmentLength = Math.max(1, distance(previous, node))
    totalLength += segmentLength
    const previousPercentile = percentiles[index - 1] ?? 0
    const currentPercentile = percentiles[index] ?? 0
    weightedPercentile += (previousPercentile + currentPercentile) * 0.5 * segmentLength
    if (
      previousPercentile <= constraints.lowlandCoveragePercentile
      && currentPercentile <= constraints.lowlandCoveragePercentile
    ) {
      lowlandLength += segmentLength
    }
  }
  const gradeLookahead = 50
  for (let index = 0; index < nodes.length - 1; index += 1) {
    let cursor = index + 1
    let span = 0
    while (cursor < nodes.length && span < gradeLookahead) {
      span += Math.max(1e-3, distance(nodes[cursor - 1]!, nodes[cursor]!))
      cursor += 1
    }
    const startHeight = heights[index]
    const endHeight = heights[Math.max(index, cursor - 1)]
    if (startHeight != null && endHeight != null && span > 1e-3) {
      maxForwardGrade = Math.max(
        maxForwardGrade,
        Math.abs(endHeight - startHeight) / span,
      )
    }
  }
  return {
    averageElevationPercentile: totalLength > 0 ? weightedPercentile / totalLength : 0,
    maxElevationPercentile,
    maxForwardGrade,
    maxCrossSlope,
    lowlandCoverageFraction: totalLength > 0 ? lowlandLength / totalLength : 0,
  }
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

function normalize(x: number, z: number): Vec2 {
  const length = Math.hypot(x, z)
  return length > 1e-9 ? { x: x / length, z: z / length } : { x: 1, z: 0 }
}

function emptyResult(
  failureReason: string,
  options: { reverts?: number; antiTargetTriggers?: number; overflows?: number } = {},
): OfficialScenicRoadResult {
  return {
    nodes: [],
    length: 0,
    complete: false,
    failureReason,
    rescueTurns: 0,
    officialReverts: options.reverts ?? 0,
    antiTargetTriggers: options.antiTargetTriggers ?? 0,
    turnOverflows: options.overflows ?? 0,
    averageElevationPercentile: 0,
    maxElevationPercentile: 0,
    maxForwardGrade: 0,
    maxCrossSlope: 0,
    lowlandCoverageFraction: 0,
    steepReplacementSteps: 0,
  }
}

/**
 * Build a coverage-weighted elevation profile once for a route build. The
 * percentile lookup uses the DEM distribution rather than assuming elevation
 * is uniformly distributed between min/max.
 */
export function buildScenicTerrainElevationProfile(
  grid: TerrainHeightGrid,
  options: OfficialScenicRoadOptions = {},
): ScenicTerrainElevationProfile {
  const constraints = {
    lowlandStartPercentile:
      options.lowlandStartPercentile
      ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.lowlandStartPercentile,
    lowlandPreferenceCeiling:
      options.lowlandPreferenceCeiling
      ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.lowlandPreferenceCeiling,
    lowlandCoveragePercentile:
      options.lowlandCoveragePercentile
      ?? SLOWROADS_LOWLAND_ROAD_CONSTRAINTS.lowlandCoveragePercentile,
  }
  const sampleCount = grid.cols * grid.rows
  const histogram = new Uint32Array(512)
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let count = 0
  for (let index = 0; index < sampleCount; index += 1) {
    if (!grid.coverage[index]) {
      continue
    }
    const height = grid.heights[index]!
    if (!Number.isFinite(height)) {
      continue
    }
    minY = Math.min(minY, height)
    maxY = Math.max(maxY, height)
    count += 1
  }
  if (!count || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minY = grid.minY
    maxY = grid.maxY
  }
  const range = Math.max(1e-6, maxY - minY)
  for (let index = 0; index < sampleCount; index += 1) {
    if (!grid.coverage[index]) {
      continue
    }
    const height = grid.heights[index]!
    if (!Number.isFinite(height)) {
      continue
    }
    const bin = clamp(Math.floor(((height - minY) / range) * histogram.length), 0, histogram.length - 1)
    histogram[bin] = (histogram[bin] ?? 0) + 1
  }
  const cumulative = new Uint32Array(histogram.length)
  let running = 0
  for (let index = 0; index < histogram.length; index += 1) {
    running += histogram[index] ?? 0
    cumulative[index] = running
  }
  const percentileAtHeight = (height: number): number => {
    if (!(maxY > minY)) {
      return 0
    }
    const normalized = clamp((height - minY) / range, 0, 1)
    const scaled = normalized * histogram.length
    const bin = clamp(Math.floor(scaled), 0, histogram.length - 1)
    const below = bin > 0 ? cumulative[bin - 1]! : 0
    const within = (histogram[bin] ?? 0) * clamp(scaled - bin, 0, 1)
    return clamp((below + within) / Math.max(1, running), 0, 1)
  }
  const percentileHeight = (percentile: number): number => {
    if (!(maxY > minY)) {
      return minY
    }
    const target = clamp(percentile, 0, 1) * Math.max(1, running)
    let bin = 0
    while (bin < cumulative.length - 1 && cumulative[bin]! < target) {
      bin += 1
    }
    const below = bin > 0 ? cumulative[bin - 1]! : 0
    const inBin = Math.max(1, histogram[bin] ?? 0)
    const fraction = clamp((target - below) / inBin, 0, 1)
    return minY + ((bin + fraction) / histogram.length) * range
  }
  return {
    minY,
    maxY,
    lowlandHeight: percentileHeight(constraints.lowlandStartPercentile),
    lowlandCoverageHeight: percentileHeight(constraints.lowlandCoveragePercentile),
    preferenceCeilingHeight: percentileHeight(constraints.lowlandPreferenceCeiling),
    percentileAtHeight,
  }
}

/**
 * Pick an automatic start near the preferred point when the user has not
 * placed P1 yet. The search is deterministic and favours low, locally gentle
 * terrain while keeping the start reasonably close to the terrain centre.
 */
export function resolveLowlandScenicStart(
  grid: TerrainHeightGrid,
  preferredX: number,
  preferredZ: number,
  margin = SLOWROADS_HILLS_ROAD_PROFILE.boundaryMargin,
): Vec2 | null {
  const profile = buildScenicTerrainElevationProfile(grid)
  const spanX = Math.max(1, grid.maxX - grid.minX)
  const spanZ = Math.max(1, grid.maxZ - grid.minZ)
  const diagonal = Math.hypot(spanX, spanZ)
  const searchRadius = Math.min(5_000, diagonal * 0.15)
  const step = Math.max(200, grid.cellSize * 4)
  const safeMargin = Math.max(margin, grid.cellSize * 2)
  let best: Vec2 | null = null
  let bestScore = Number.POSITIVE_INFINITY
  const rings = Math.max(1, Math.ceil(searchRadius / step))
  for (let ring = 0; ring <= rings; ring += 1) {
    const radius = ring * step
    const samples = ring === 0 ? 1 : 24
    for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
      const angle = (sampleIndex / samples) * Math.PI * 2
      const x = preferredX + Math.cos(angle) * radius
      const z = preferredZ + Math.sin(angle) * radius
      if (
        x < grid.minX + safeMargin
        || x > grid.maxX - safeMargin
        || z < grid.minZ + safeMargin
        || z > grid.maxZ - safeMargin
      ) {
        continue
      }
      const height = grid.sampleHeight(x, z)
      if (height == null) {
        continue
      }
      const gradient = sampleTerrainGradient(grid, x, z)
      if (!gradient) {
        continue
      }
      const elevationPercentile = profile.percentileAtHeight(height)
      const distancePenalty = radius / Math.max(1, searchRadius)
      const score =
        elevationPercentile * 3
        + gradient.magnitude * 2.5
        + distancePenalty * 0.35
      if (score < bestScore) {
        bestScore = score
        best = { x, z }
      }
    }
  }
  return best
}

/**
 * Official start heading: derive the contour tangent from four height probes
 * around the start. The shipped generator falls back to the near-east heading
 * when the terrain is locally flat.
 */
export function resolveOfficialScenicStartHeading(
  grid: TerrainHeightGrid,
  x: number,
  z: number,
): number {
  const center = grid.sampleHeight(x, z)
  const south = grid.sampleHeight(x, z - 10)
  const east = grid.sampleHeight(x + 10, z)
  const north = grid.sampleHeight(x, z + 10)
  if (center == null) {
    return 0.01
  }
  if (south != null && east != null && north != null) {
    const eastDelta = east - south
    const northDelta = north - east
    if (Math.abs(eastDelta) > 1e-8 && Math.abs(northDelta) > 1e-8) {
      const xRatio = (center - south) / eastDelta
      const zRatio = (center - east) / northDelta
      if (xRatio >= 0 && xRatio <= 1) {
        const vector = normalize(xRatio, -(1 - xRatio))
        return Math.atan2(vector.z, vector.x)
      }
      if (zRatio >= 0 && zRatio <= 1) {
        const vector = normalize(1 - zRatio, zRatio)
        return Math.atan2(vector.z, vector.x)
      }
    }
  }
  return Math.atan2(0.01, 0.99)
}

function updateTargetDirection(
  target: Vec2,
  heading: number,
  centerX: number,
  centerZ: number,
): Vec2 {
  const dx = target.x - centerX
  const dz = target.z - centerZ
  const radius = Math.hypot(dx, dz)
  if (radius < 1e-6) {
    return { x: Math.cos(heading), z: Math.sin(heading) }
  }
  const outward = { x: dx / radius, z: dz / radius }
  const inward = { x: -outward.x, z: -outward.z }
  const tangent = { x: -inward.z, z: inward.x }
  let factor = 0
  if (radius < SLOWROADS_HILLS_ROAD_PROFILE.targetRadius) {
    if (radius < SLOWROADS_HILLS_ROAD_PROFILE.targetRadiusMin) {
      factor = 1
    } else {
      const margin = SLOWROADS_HILLS_ROAD_PROFILE.targetRadius
        - SLOWROADS_HILLS_ROAD_PROFILE.targetRadiusMin
      factor = 1 - (radius - SLOWROADS_HILLS_ROAD_PROFILE.targetRadiusMin) / margin
    }
    factor *= factor
    const direction = normalize(
      tangent.x + inward.x * factor,
      tangent.z + inward.z * factor,
    )
    return direction
  }
  if (radius > SLOWROADS_HILLS_ROAD_PROFILE.targetRadiusMax) {
    factor = 1
  } else {
    const margin = SLOWROADS_HILLS_ROAD_PROFILE.targetRadiusMax
      - SLOWROADS_HILLS_ROAD_PROFILE.targetRadius
    factor = (radius - SLOWROADS_HILLS_ROAD_PROFILE.targetRadius) / margin
  }
  factor *= factor
  return normalize(
    tangent.x + outward.x * factor,
    tangent.z + outward.z * factor,
  )
}

function compensateProfile(
  nodes: RoadTraceNode[],
  profile: typeof SLOWROADS_HILLS_ROAD_PROFILE,
  grid: TerrainHeightGrid,
  constraints: ResolvedTerrainConstraints | null,
): void {
  if (nodes.length < 3) {
    return
  }
  const originalY = nodes.map((node) => node.y)
  const heightRadius = 3
  for (let index = heightRadius; index < nodes.length - heightRadius; index += 1) {
    let sum = 0
    for (let offset = -heightRadius; offset <= heightRadius; offset += 1) {
      sum += originalY[index + offset]!
    }
    nodes[index]!.y = sum / (heightRadius * 2 + 1)
  }

  const source = nodes.map((node) => ({ x: node.x, z: node.z, headingDelta: node.headingDelta }))
  const halfWindow = Math.max(1, Math.floor(profile.smoothWindow / 2))
  for (let index = 1; index < nodes.length - 1; index += 1) {
    const previous = source[index - 1]!
    const current = source[index]!
    const next = source[index + 1]!
    const averageX = (previous.x + next.x) * 0.5
    const averageZ = (previous.z + next.z) * 0.5
    let deltaSum = 0
    let deltaCount = 0
    for (
      let sample = Math.max(0, index - halfWindow);
      sample <= Math.min(source.length - 1, index + halfWindow);
      sample += 1
    ) {
      deltaSum += source[sample]!.headingDelta
      deltaCount += 1
    }
    const averageDelta = deltaCount ? deltaSum / deltaCount : 0
    const strength = 1 - Math.max(0.25, Math.min(1, Math.abs(averageDelta) / 0.4))
    // Terrain-constrained routes keep the node positions produced by the
    // grade-aware tracer. Moving them afterwards can create a new steep cut
    // through a ridge even when the original candidate was admissible.
    const blend = constraints ? 0 : strength * profile.smoothFactor
    const candidateX = current.x * (1 - blend) + averageX * blend
    const candidateZ = current.z * (1 - blend) + averageZ * blend
    let accepted = true
    if (constraints) {
      const candidateHeight = grid.sampleHeight(candidateX, candidateZ)
      const previousHeight = grid.sampleHeight(previous.x, previous.z)
      const nextHeight = grid.sampleHeight(next.x, next.z)
      if (candidateHeight == null || previousHeight == null || nextHeight == null) {
        accepted = false
      } else {
        const previousLength = Math.max(1e-3, Math.hypot(candidateX - previous.x, candidateZ - previous.z))
        const nextLength = Math.max(1e-3, Math.hypot(next.x - candidateX, next.z - candidateZ))
        const previousGrade = Math.abs(candidateHeight - previousHeight) / previousLength
        const nextGrade = Math.abs(nextHeight - candidateHeight) / nextLength
        const candidateHeading = Math.atan2(
          next.z - previous.z,
          next.x - previous.x,
        )
        const crossSlope = crossSlopeForHeading(
          sampleTerrainGradient(grid, candidateX, candidateZ),
          candidateHeading,
        )
        accepted = previousGrade <= constraints.maxGrade + 1e-6
          && nextGrade <= constraints.maxGrade + 1e-6
          && crossSlope <= constraints.maxCrossSlope + 1e-6
      }
    }
    if (accepted) {
      nodes[index]!.x = candidateX
      nodes[index]!.z = candidateZ
    }
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const previous = nodes[Math.max(0, index - 1)]!
    const next = nodes[Math.min(nodes.length - 1, index + 1)]!
    const dx = next.x - previous.x
    const dz = next.z - previous.z
    if (dx * dx + dz * dz > 1e-9) {
      nodes[index]!.heading = Math.atan2(dz, dx)
    }
    if (index > 0) {
      nodes[index]!.headingDelta = wrapAngle(nodes[index]!.heading - nodes[index - 1]!.heading)
    }
  }
}

type TraceOnceResult = {
  result: OfficialScenicRoadResult
  restart: boolean
}

function traceOnce(
  grid: TerrainHeightGrid,
  origin: Vec2,
  centerX: number,
  centerZ: number,
  seed: number,
  margin: number,
  algorithmVersion: number,
  terrainProfile: ScenicTerrainElevationProfile,
  constraints: ResolvedTerrainConstraints,
): TraceOnceResult {
  const startY = grid.sampleHeight(origin.x, origin.z)
  if (startY == null) {
    return { result: emptyResult('start-outside-terrain'), restart: false }
  }
  if (
    origin.x < grid.minX + margin
    || origin.x > grid.maxX - margin
    || origin.z < grid.minZ + margin
    || origin.z > grid.maxZ - margin
  ) {
    return { result: emptyResult('start-too-close-to-boundary'), restart: false }
  }

  const profile = SLOWROADS_HILLS_ROAD_PROFILE
  let x = origin.x
  let z = origin.z
  let y = startY - profile.roadSink
  let heading = resolveOfficialScenicStartHeading(grid, x, z)
  let targetDirection = updateTargetDirection({ x, z }, heading, centerX, centerZ)
  const outwardDirection = Math.hypot(origin.x - centerX, origin.z - centerZ) > 1e-3
    ? normalize(origin.x - centerX, origin.z - centerZ)
    : { x: Math.cos(heading), z: Math.sin(heading) }

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
  let prevT = 0
  let prevTargetSide = Math.sign(
    (-Math.sin(heading) * targetDirection.x + Math.cos(heading) * targetDirection.z) * -1,
  ) || 1
  let targetOverflow = 0
  let accumulatedOverflow = 0
  let antiTarget: Vec2 | null = null
  let antiTargetRange = 0
  let antiTargetRevert = 40
  let antiTargetTriggerCount = 0
  let officialReverts = 0
  let antiTargetTriggers = 0
  let turnOverflows = 0
  let steepReplacementSteps = 0
  let failureReason: string | null = null
  let complete = false

  for (let stepIndex = 0; stepIndex < profile.maxSteps; stepIndex += 1) {
    const tail = nodes[nodes.length - 1]!
    const straightX = x + Math.cos(heading) * profile.stepLength
    const straightZ = z + Math.sin(heading) * profile.stepLength
    if (
      straightX < grid.minX + margin
      || straightX > grid.maxX - margin
      || straightZ < grid.minZ + margin
      || straightZ > grid.maxZ - margin
    ) {
      complete = true
      failureReason = 'reached-terrain-boundary'
      break
    }

    targetDirection = updateTargetDirection(tail, heading, centerX, centerZ)
    let lowlandWeight = 0
    if (algorithmVersion >= 3) {
      const boundaryWeight = 0.35 + 0.5 * smoothstep(5_000, 15_000, length)
      targetDirection = normalize(
        targetDirection.x * (1 - boundaryWeight) + outwardDirection.x * boundaryWeight,
        targetDirection.z * (1 - boundaryWeight) + outwardDirection.z * boundaryWeight,
      )
      const currentPreferenceHeight = grid.sampleHeight(x, z)
      if (currentPreferenceHeight != null) {
        const elevationPercentile = terrainProfile.percentileAtHeight(currentPreferenceHeight)
        const elevationWeight = smoothstep(
          constraints.lowlandStartPercentile,
          constraints.lowlandPreferenceCeiling,
          elevationPercentile,
        )
        const graceWeight = constraints.startGraceDistance > 0
          ? smoothstep(0, constraints.startGraceDistance, length)
          : 1
        lowlandWeight = elevationWeight * graceWeight
        if (lowlandWeight > 0) {
          const downhill = downhillDirection(grid, x, z)
          if (downhill) {
            const lowlandShare = lowlandWeight * (1 - boundaryWeight)
            targetDirection = normalize(
              targetDirection.x * (1 - lowlandShare) + downhill.x * lowlandShare,
              targetDirection.z * (1 - lowlandShare) + downhill.z * lowlandShare,
            )
          }
        }
      }
    }
    const feelLX = x + Math.cos(heading - profile.feelAngleRad) * profile.feelDistance
    const feelLZ = z + Math.sin(heading - profile.feelAngleRad) * profile.feelDistance
    const feelRX = x + Math.cos(heading + profile.feelAngleRad) * profile.feelDistance
    const feelRZ = z + Math.sin(heading + profile.feelAngleRad) * profile.feelDistance
    if (
      !grid.contains(feelLX, feelLZ)
      || !grid.contains(feelRX, feelRZ)
    ) {
      complete = true
      failureReason = 'reached-terrain-boundary'
      break
    }
    const feelL = grid.sampleHeight(feelLX, feelLZ)
    const feelR = grid.sampleHeight(feelRX, feelRZ)
    if (feelL == null || feelR == null) {
      failureReason = 'blocked'
      break
    }
    const feelCurrent = grid.sampleHeight(x, z)
    if (feelCurrent == null) {
      failureReason = 'blocked'
      break
    }
    const feelDif = (feelR - feelL) / 2
    const feelAverage = (feelL + feelR) / 2
    let bT = feelDif !== 0 ? (feelAverage - feelCurrent) / feelDif : 0
    bT = clamp(bT, -1, 1)
    const gradLat = (feelL - feelR) / profile.feelDistance / profile.maxGrad
    const gradLon = (feelAverage - feelCurrent) / profile.feelDistance / profile.maxGrad

    const midlineDir = { x: Math.cos(heading), z: Math.sin(heading) }
    const midlineOrth = { x: -midlineDir.z, z: midlineDir.x }
    let targetDot = clamp(
      midlineDir.x * targetDirection.x + midlineDir.z * targetDirection.z,
      -1,
      1,
    )
    let targetSide = Math.sign(
      (midlineOrth.x * targetDirection.x + midlineOrth.z * targetDirection.z) * -1,
    ) || prevTargetSide
    if (targetSide === prevTargetSide && targetOverflow > 1.5) {
      targetSide = targetSide > 0 ? -2 : 2
    }
    if (targetSide !== prevTargetSide) {
      if (targetSide > prevTargetSide) {
        if (prevT < 0) {
          targetOverflow += prevT
          if (targetOverflow > 0) {
            targetSide = prevTargetSide
            targetDot = -1
          } else {
            targetOverflow = 0
          }
        } else {
          targetOverflow += prevT
          targetSide = prevTargetSide
          targetDot = -1
        }
      } else if (prevT > 0) {
        targetOverflow -= prevT
        if (targetOverflow > 0) {
          targetSide = prevTargetSide
          targetDot = -1
        } else {
          targetOverflow = 0
        }
      } else {
        targetOverflow -= prevT
        targetSide = prevTargetSide
        targetDot = -1
      }
      accumulatedOverflow += targetOverflow
    } else {
      targetOverflow = 0
      if (accumulatedOverflow > 0) {
        accumulatedOverflow = Math.max(0, accumulatedOverflow - 3)
      }
    }
    prevTargetSide = targetSide
    const targetAngle = Math.acos(targetDot)

    const gradLeft = (feelL - feelCurrent) / profile.feelDistance / profile.maxGrad
    const gradRight = (feelR - feelCurrent) / profile.feelDistance / profile.maxGrad
    let maxT = 1
    let minT = -1
    const gradLeftAbs = Math.abs(gradLeft)
    const gradRightAbs = Math.abs(gradRight)
    if (gradLeftAbs > 1 || gradRightAbs > 1) {
      const gradDif = (gradLeft - gradRight) / 2
      const gradAverage = (gradLeft + gradRight) / 2
      if (
        (gradLeft > 1 && gradRight > 1)
        || (gradLeft < -1 && gradRight < -1)
      ) {
        if (gradLeftAbs < gradRightAbs) {
          maxT = 1
          minT = 1
        } else {
          maxT = -1
          minT = -1
        }
      } else {
        if (gradLeftAbs > 1) {
          maxT = gradLeft < 0
            ? (1 + gradAverage) / Math.abs(gradDif)
            : (1 - gradAverage) / Math.abs(gradDif)
        }
        if (gradRightAbs > 1) {
          minT = gradRight < 0
            ? (1 + gradAverage) / Math.abs(gradDif)
            : (1 - gradAverage) / Math.abs(gradDif)
          minT *= -1
        }
      }
    }

    const gradAverageAbs = (Math.abs(gradLat) + Math.abs(gradLon)) / 2
    const maxDif = profile.maxTurnDelta + Math.abs(gradAverageAbs) * 0.5
    maxT = maxT > prevT
      ? Math.min(maxT, prevT + maxDif)
      : Math.max(maxT, prevT - maxDif)
    minT = minT < prevT
      ? Math.max(minT, prevT - maxDif)
      : Math.min(minT, prevT + maxDif)

    const gradLonSquared = gradLon * gradLon
    if (gradLonSquared <= 1) {
      bT *= gradLonSquared
    } else {
      bT = bT < 0 ? minT : maxT
    }
    bT = clamp(bT, minT, maxT)

    let antiWeight = 0
    if (antiTarget) {
      const antiDistance = distance(tail, antiTarget)
      const antiDir = normalize(antiTarget.x - x, antiTarget.z - z)
      const antiDot = midlineDir.x * antiDir.x + midlineDir.z * antiDir.z
      if (antiDistance < antiTargetRange) {
        antiWeight = 1 - antiDistance / Math.max(1e-6, antiTargetRange)
        const antiSide = midlineOrth.x * antiDir.x + midlineOrth.z * antiDir.z
        const antiAdjust = (antiDot + 1) / 2
        antiWeight *= antiAdjust
        const antiRedirect = clamp(profile.feelAngleRad * 2 * antiSide, minT, maxT)
        bT = antiWeight * antiRedirect + (1 - antiWeight) * bT
      } else if (antiDot < -0.707) {
        antiTarget = null
        antiTargetRange = 0
        antiTargetTriggerCount = 0
      }
    }

    const targetAdjust = (1 - (targetDot + 1) / 2) * (1 - antiWeight)
    const targetRedirect = clamp(
      targetAngle * targetSide / profile.feelAngleRad,
      minT,
      maxT,
    )
    bT = targetAdjust * targetRedirect + (1 - targetAdjust) * bT

    const violatedOverflow = accumulatedOverflow > 150 || targetOverflow > 3
    let violatedTracker: TurnTracker | null = null
    for (const tracker of TURN_TRACKERS) {
      const startIndex = Math.max(0, nodes.length - 1 - tracker.window)
      let accumulatedTurn = 0
      for (let index = startIndex + 1; index < nodes.length; index += 1) {
        accumulatedTurn += nodes[index]!.headingDelta
      }
      if (Math.abs(accumulatedTurn) <= tracker.limit) {
        continue
      }
      const start = nodes[startIndex]!
      const trackerDir = normalize(x - start.x, z - start.z)
      const trackerDot = trackerDir.x * targetDirection.x + trackerDir.z * targetDirection.z
      const tolerance = (trackerDot + targetDot) / 2
      const threshold = tracker.limit
        + Math.max(0, tolerance) * Math.max(0, tolerance) * TRACKER_TOLERANCE_FACTOR
      if (Math.abs(accumulatedTurn) > threshold) {
        violatedTracker = tracker
        break
      }
    }

    if (violatedTracker || violatedOverflow) {
      officialReverts += 1
      if (violatedOverflow) {
        turnOverflows += 1
      }
      let revertDistance = violatedTracker
        ? violatedTracker.revert
        : Math.max(50, antiTargetRevert)
      if (antiTargetTriggerCount > 0 && violatedTracker) {
        revertDistance = Math.max(
          violatedTracker.revert,
          antiTargetRevert + violatedTracker.revert * (antiTargetTriggerCount + 1),
        )
      }
      const resetIndex = Math.max(0, nodes.length - 1 - revertDistance)
      if (resetIndex < 2) {
        return {
          result: {
            ...emptyResult('official-generator-restart', {
              reverts: officialReverts,
              antiTargetTriggers,
              overflows: turnOverflows,
            }),
            length,
          },
          restart: true,
        }
      }
      const triggerPoint = { x, z }
      nodes.length = resetIndex + 1
      const resetNode = nodes[nodes.length - 1]!
      x = resetNode.x
      z = resetNode.z
      y = resetNode.y
      heading = resetNode.heading
      length = 0
      for (let index = 1; index < nodes.length; index += 1) {
        length += distance(nodes[index - 1]!, nodes[index]!)
      }
      const antiTargetFraction = antiTargetTriggerCount > 0
        ? 0.5 + hashUnit(seed, nodes.length, 131) * 0.5
        : 0.5
      antiTarget = {
        x: resetNode.x + (triggerPoint.x - resetNode.x) * antiTargetFraction,
        z: resetNode.z + (triggerPoint.z - resetNode.z) * antiTargetFraction,
      }
      antiTargetRevert = Math.min(500, Math.max(40, revertDistance))
      antiTargetRange = distance(resetNode, antiTarget) ** 2 * 4
      antiTargetTriggerCount += 1
      antiTargetTriggers += 1
      prevT = 0
      targetOverflow = 0
      accumulatedOverflow = 0
      continue
    }

    const smoothedB = bT * profile.smoothFactor
    const officialHeading = wrapAngle(heading - smoothedB * profile.feelAngleRad)
    let chosenHeading = officialHeading
    let nextX = x + Math.cos(chosenHeading) * profile.stepLength
    let nextZ = z + Math.sin(chosenHeading) * profile.stepLength
    let nextY = grid.sampleHeight(nextX, nextZ)
    let chosenBT = smoothedB
    if (algorithmVersion >= 3) {
      const candidateMaxGrade = Math.min(
        constraints.maxGrade,
        constraints.preferredGrade,
      )
      const candidateMaxCrossSlope = constraints.maxCrossSlope * 0.85
      const evaluateHeading = (candidateHeading: number): {
        heading: number
        x: number
        z: number
        y: number
        valid: boolean
        invalidReason: 'forward-grade' | 'cross-slope' | null
        score: number
      } | null => {
        const candidateX = x + Math.cos(candidateHeading) * profile.stepLength
        const candidateZ = z + Math.sin(candidateHeading) * profile.stepLength
        const candidateY = grid.sampleHeight(candidateX, candidateZ)
        if (candidateY == null) {
          return null
        }
        const gradeLookahead = Math.max(profile.stepLength * 5, 50)
        const gradeX = x + Math.cos(candidateHeading) * gradeLookahead
        const gradeZ = z + Math.sin(candidateHeading) * gradeLookahead
        const gradeY = grid.sampleHeight(gradeX, gradeZ)
        const forwardGrade = gradeY == null
          ? Math.abs(candidateY - feelCurrent) / profile.stepLength
          : Math.abs(gradeY - feelCurrent) / gradeLookahead
        const candidateGradient = sampleTerrainGradient(grid, candidateX, candidateZ)
        const crossSlope = crossSlopeForHeading(candidateGradient, candidateHeading)
        const forwardValid = forwardGrade <= candidateMaxGrade + 1e-6
        const crossValid = crossSlope <= candidateMaxCrossSlope + 1e-6
        const valid = forwardValid && crossValid
        const headingError = Math.abs(wrapAngle(candidateHeading - officialHeading))
        const turnScore = headingError / profile.feelAngleRad
        const crossExcess = Math.max(
          0,
          (crossSlope - constraints.preferredGrade)
            / Math.max(1e-4, constraints.maxCrossSlope - constraints.preferredGrade),
        )
        const elevationPercentile = terrainProfile.percentileAtHeight(candidateY)
        const elevationScore = smoothstep(
          constraints.lowlandStartPercentile,
          constraints.lowlandPreferenceCeiling,
          elevationPercentile,
        )
        return {
          heading: candidateHeading,
          x: candidateX,
          z: candidateZ,
          y: candidateY,
          valid,
          invalidReason: valid
            ? null
            : !forwardValid
              ? 'forward-grade'
              : 'cross-slope',
          score:
            turnScore * 1.5
            + (forwardGrade / Math.max(1e-4, candidateMaxGrade)) ** 2 * 1.5
            + crossExcess * crossExcess * 2
            + elevationScore * lowlandWeight * 2,
        }
      }
      let chosen = evaluateHeading(officialHeading)
      let sawForwardGradeFailure = chosen?.invalidReason === 'forward-grade'
      let sawCrossSlopeFailure = chosen?.invalidReason === 'cross-slope'
      if (!chosen?.valid) {
        let rescued: ReturnType<typeof evaluateHeading> = null
        for (let level = 1; level <= 36; level += 1) {
          const offset = (level * 5 * Math.PI) / 180
          for (const sign of [-1, 1]) {
            const candidate = evaluateHeading(wrapAngle(officialHeading + sign * offset))
            if (candidate?.invalidReason === 'forward-grade') {
              sawForwardGradeFailure = true
            } else if (candidate?.invalidReason === 'cross-slope') {
              sawCrossSlopeFailure = true
            }
            if (candidate?.valid && (!rescued || candidate.score < rescued.score)) {
              rescued = candidate
            }
          }
        }
        chosen = rescued
      }
      if (!chosen?.valid) {
        failureReason = sawForwardGradeFailure
          ? 'blocked-by-forward-grade'
          : sawCrossSlopeFailure
            ? 'blocked-by-cross-slope'
            : 'blocked-by-grade'
        break
      }
      if (Math.abs(wrapAngle(chosen.heading - officialHeading)) > 1e-6) {
        steepReplacementSteps += 1
      }
      chosenHeading = chosen.heading
      nextX = chosen.x
      nextZ = chosen.z
      nextY = chosen.y
      chosenBT = clamp(
        wrapAngle(heading - chosenHeading) / profile.feelAngleRad,
        -1,
        1,
      )
    }
    if (nextY == null) {
      failureReason = 'blocked'
      break
    }
    prevT = chosenBT
    const headingDelta = wrapAngle(chosenHeading - heading)
    heading = chosenHeading
    x = nextX
    z = nextZ
    y = nextY - profile.roadSink
    length += profile.stepLength
    nodes.push({
      x,
      z,
      y,
      heading,
      index: nodes.length,
      lateral: gradLat,
      longitudinal: gradLon,
      turn: chosenBT,
      headingDelta,
    })
  }

  if (!failureReason && nodes.length >= profile.maxSteps) {
    complete = algorithmVersion < 3
    failureReason = 'reached-step-limit'
  }
  compensateProfile(
    nodes,
    profile,
    grid,
    algorithmVersion >= 3 ? constraints : null,
  )
  length = 0
  for (let index = 0; index < nodes.length; index += 1) {
    nodes[index]!.index = index
    if (index > 0) {
      length += distance(nodes[index - 1]!, nodes[index]!)
    }
  }
  const elevationStats = summarizeScenicRoute(grid, nodes, terrainProfile, constraints)
  return {
    result: {
      nodes,
      length,
      complete,
      failureReason,
      rescueTurns: 0,
      officialReverts,
      antiTargetTriggers,
      turnOverflows,
      ...elevationStats,
      steepReplacementSteps,
    },
    restart: false,
  }
}

/**
 * Trace the official Hills midline from a required start point. The terrain
 * center acts as the generator's world origin/target ring. Version 2 is the
 * pure official trace; version 3 adds the relative lowland and grade limits.
 */
export function traceOfficialScenicRoad(
  grid: TerrainHeightGrid,
  origin: Vec2,
  seed: number,
  margin: number = SLOWROADS_HILLS_ROAD_PROFILE.boundaryMargin,
  options: OfficialScenicRoadOptions = {},
): OfficialScenicRoadResult {
  const centerX = (grid.minX + grid.maxX) * 0.5
  const centerZ = (grid.minZ + grid.maxZ) * 0.5
  const algorithmVersion = Math.max(2, Math.round(options.algorithmVersion ?? 2))
  const profile = buildScenicTerrainElevationProfile(grid, options)
  const constraints = resolveTerrainConstraints(options)
  let last: OfficialScenicRoadResult = emptyResult('official-generator-restart')
  for (let attempt = 0; attempt < MAX_RESTART_ATTEMPTS; attempt += 1) {
    const attemptSeed = (
      seed
      + Math.imul(attempt + 1, 0x9e3779b1)
      + Math.floor(hashUnit(seed, attempt, 73) * 0xffff)
    ) >>> 0
    const traced = traceOnce(
      grid,
      origin,
      centerX,
      centerZ,
      attemptSeed,
      margin,
      algorithmVersion,
      profile,
      constraints,
    )
    last = traced.result
    if (!traced.restart) {
      return last
    }
  }
  return last
}
