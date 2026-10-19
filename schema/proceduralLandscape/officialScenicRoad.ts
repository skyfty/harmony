import { clamp, hashUnit, smoothstep, wrapAngle } from './noise'
import type { RoadTraceNode, RoadTraceResult } from './roadTrace'
import type { RoadWaypoint } from './roadWaypoints'
import type { TerrainHeightGrid } from './terrainSampler'
import {
  resolveSlowroadsMidlineProfile,
  type RoadStyleId,
  type SlowroadsMidlineProfile,
} from './roadStyle'

/**
 * Slow Roads "Hills" legacy guided profile.
 *
 * Values come from the shipped `DevMidlineGenerator` road-style table. Unguided
 * `seeded` routes pass their selected style explicitly (NORMAL by default);
 * this constant remains CASUAL so existing `shortest` routing keeps its shape.
 */
const SLOWROADS_HILLS_MIDLINE = resolveSlowroadsMidlineProfile('casual')

export const SLOWROADS_HILLS_ROAD_PROFILE = Object.freeze({
  ...SLOWROADS_HILLS_MIDLINE,
  targetRadius: 9_000,
  targetRadiusMin: 5_000,
  targetRadiusMax: 13_000,
  boundaryMargin: 24,
  maxSteps: 32_768,
})

export const SLOWROADS_SCENIC_ROAD_CONSTRAINTS = Object.freeze({
  lowlandStartPercentile: 0.4,
  lowlandPreferenceCeiling: 0.7,
  lowlandCoveragePercentile: 0.65,
  preferredGrade: 0.16,
  maxGrade: 0.28,
  maxCrossSlope: 0.45,
  startGraceDistance: 500,
})

export const SCENIC_WAYPOINT_SNAP_RADIUS = 500
export const ROAD_WAYPOINT_SNAP_RADIUS = 50
const ROAD_WAYPOINT_SNAP_STEP = 10
const ROAD_WAYPOINT_SNAP_DIRECTIONS = 24

export interface ScenicWaypointPlacement {
  x: number
  z: number
  distanceFromClick: number
  elevationPercentile: number
  gradient: number
}

export type RoadWaypointPlacementFailureReason =
  | 'outside-terrain'
  | 'too-steep'
  | 'no-snapped-candidate'

export interface RoadWaypointPlacementOptions {
  /**
   * The lowland preference is a scenic-routing score, not a hard restriction
   * for user-authored waypoints. Lowland-specific callers can opt in here.
   */
  enforceLowlandPreference?: boolean
  lowlandPreferenceCeiling?: number
  maxCrossSlope?: number
}

export type RoadWaypointPlacementResult =
  | {
      ok: true
      placement: ScenicWaypointPlacement
      snapped: boolean
    }
  | {
      ok: false
      failureReason: RoadWaypointPlacementFailureReason
    }

export interface OfficialScenicRoadOptions {
  lowlandStartPercentile?: number
  lowlandPreferenceCeiling?: number
  lowlandCoveragePercentile?: number
  preferredGrade?: number
  maxGrade?: number
  maxCrossSlope?: number
  startGraceDistance?: number
  requiredWaypoints?: ReadonlyArray<RoadWaypoint>
  waypointTolerance?: number
  waypointNoProgressDistance?: number
  waypointAttemptDistance?: number
  /** Optional global slope-feasible guide. Runtime-only; never persisted. */
  guidePoints?: ReadonlyArray<RoadWaypoint>
  guideCorridorWidth?: number
  wiggleScale?: number
  guideTermination?: 'loop' | 'boundary' | 'dead-end'
  /** Official road curve profile (defaults to the legacy Hills profile). */
  midlineProfile?: SlowroadsMidlineProfile
  /** Natural spiral/boundary-extension policy. Omit for legacy guided tracing. */
  natural?: NaturalRoadExtensionConfig
  /** Optional starting tangent; defaults to the official contour tangent. */
  initialHeadingRad?: number | null
}

export interface NaturalRoadExtensionConfig {
  style: RoadStyleId
  center: Vec2
  targetRadius: number
  targetRadiusMin: number
  targetRadiusMax: number
  /** Minimum radial separation added after each completed orbit. */
  lapSpacing: number
  /** Desired total centerline length before the boundary exit ramp. */
  targetLength: number
  /** Distance over which target direction blends toward the nearest boundary. */
  boundaryExitRamp: number
  /** Hard cap for the drifting orbit radius. */
  maxOrbitRadius: number
}

export interface NaturalRoadPlan extends NaturalRoadExtensionConfig {
  diagonal: number
  orbitalHullRadius: number
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
  waypointsSkipped: number
  skippedWaypointIndices: number[]
  waypointsAttempted: number
  maxGuideDeviation?: number
  naturalTargetLength?: number
  naturalLaps?: number
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

function resolveTerrainConstraints(
  options: OfficialScenicRoadOptions,
): ResolvedTerrainConstraints {
  return {
    lowlandStartPercentile: clamp(
      options.lowlandStartPercentile
        ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandStartPercentile,
      0,
      0.95,
    ),
    lowlandPreferenceCeiling: clamp(
      options.lowlandPreferenceCeiling
        ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandPreferenceCeiling,
      0.05,
      1,
    ),
    lowlandCoveragePercentile: clamp(
      options.lowlandCoveragePercentile
        ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandCoveragePercentile,
      0.05,
      1,
    ),
    preferredGrade: Math.max(
      0.01,
      options.preferredGrade ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.preferredGrade,
    ),
    maxGrade: Math.max(
      0.01,
      options.maxGrade ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade,
    ),
    maxCrossSlope: Math.max(
      0.01,
      options.maxCrossSlope ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
    ),
    startGraceDistance: Math.max(
      0,
      options.startGraceDistance ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.startGraceDistance,
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
  // Grade belongs to the drivable design centerline. Raw terrain can be
  // steeper where the repair has already applied a valid cut/fill profile.
  for (let index = 0; index < nodes.length - 1; index += 1) {
    let cursor = index + 1
    let span = 0
    while (cursor < nodes.length && span < gradeLookahead) {
      span += Math.max(1e-3, distance(nodes[cursor - 1]!, nodes[cursor]!))
      cursor += 1
    }
    const startHeight = nodes[index]?.y
    const endHeight = nodes[Math.max(index, cursor - 1)]?.y
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

function resolveWaypointPassIndices(
  nodes: ReadonlyArray<RoadTraceNode>,
  waypoints: ReadonlyArray<Vec2>,
  tolerance: number,
): Set<number> {
  const passed = new Set<number>()
  for (let waypointIndex = 1; waypointIndex < waypoints.length; waypointIndex += 1) {
    const waypoint = waypoints[waypointIndex]!
    for (let nodeIndex = 1; nodeIndex < nodes.length; nodeIndex += 1) {
      const previous = nodes[nodeIndex - 1]!
      const node = nodes[nodeIndex]!
      const capture = projectWaypointCapture(previous, node, waypoint, tolerance)
      if (
        capture
        || distance(previous, waypoint) <= tolerance
        || distance(node, waypoint) <= tolerance
      ) {
        passed.add(waypointIndex)
        break
      }
    }
  }
  return passed
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

/**
 * Closest projection of a waypoint onto one road segment. Used to insert a
 * centreline node when a 10m trace step crosses the waypoint tolerance disc.
 */
export function projectWaypointCapture(
  start: Vec2,
  end: Vec2,
  waypoint: Vec2,
  tolerance: number,
): { x: number; z: number; distance: number; t: number } | null {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSq = dx * dx + dz * dz
  if (lengthSq <= 1e-9) {
    return null
  }
  const t = clamp(
    ((waypoint.x - start.x) * dx + (waypoint.z - start.z) * dz) / lengthSq,
    0,
    1,
  )
  const x = start.x + dx * t
  const z = start.z + dz * t
  const projectedDistance = Math.hypot(x - waypoint.x, z - waypoint.z)
  return projectedDistance <= tolerance + 1e-6
    ? { x, z, distance: projectedDistance, t }
    : null
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
    waypointsSkipped: 0,
    skippedWaypointIndices: [],
    waypointsAttempted: 0,
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
      ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandStartPercentile,
    lowlandPreferenceCeiling:
      options.lowlandPreferenceCeiling
      ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandPreferenceCeiling,
    lowlandCoveragePercentile:
      options.lowlandCoveragePercentile
      ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandCoveragePercentile,
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

export function summarizeScenicRoadTerrain(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  options: OfficialScenicRoadOptions = {},
): Pick<
  OfficialScenicRoadResult,
  | 'averageElevationPercentile'
  | 'maxElevationPercentile'
  | 'maxForwardGrade'
  | 'maxCrossSlope'
  | 'lowlandCoverageFraction'
> {
  return summarizeScenicRoute(
    grid,
    nodes.map((node) => ({ ...node })),
    buildScenicTerrainElevationProfile(grid, options),
    resolveTerrainConstraints(options),
  )
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

type WaypointCandidateEvaluation =
  | {
      ok: true
      placement: ScenicWaypointPlacement
    }
  | {
      ok: false
      failureReason: RoadWaypointPlacementFailureReason | 'elevation-preference'
    }

/**
 * Resolve a user-authored waypoint against physical terrain constraints.
 *
 * Elevation percentile is intentionally not a hard requirement here: a
 * gentle hillside remains buildable even when it is above the scenic lowland
 * preference ceiling. If the clicked point is invalid, search a small local
 * ring for the nearest feasible point.
 */
export function resolveRoadWaypointPlacement(
  grid: TerrainHeightGrid,
  preferredX: number,
  preferredZ: number,
  maxRadius = ROAD_WAYPOINT_SNAP_RADIUS,
  options: RoadWaypointPlacementOptions = {},
): RoadWaypointPlacementResult {
  const lowlandProfile = options.enforceLowlandPreference
    ? buildScenicTerrainElevationProfile(grid)
    : null
  const lowlandCeiling = clamp(
    options.lowlandPreferenceCeiling
      ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.lowlandPreferenceCeiling,
    0,
    1,
  )
  const maxCrossSlope = Math.max(
    0.01,
    options.maxCrossSlope ?? SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope,
  )
  const margin = Math.max(
    SLOWROADS_HILLS_ROAD_PROFILE.boundaryMargin,
    grid.cellSize * 2,
  )
  const evaluate = (x: number, z: number): WaypointCandidateEvaluation => {
    if (
      x < grid.minX + margin
      || x > grid.maxX - margin
      || z < grid.minZ + margin
      || z > grid.maxZ - margin
    ) {
      return { ok: false, failureReason: 'outside-terrain' }
    }
    const height = grid.sampleHeight(x, z)
    const gradient = sampleTerrainGradient(grid, x, z)
    if (height == null || !gradient) {
      return { ok: false, failureReason: 'outside-terrain' }
    }
    if (gradient.magnitude > maxCrossSlope + 1e-6) {
      return { ok: false, failureReason: 'too-steep' }
    }
    const elevationPercentile = lowlandProfile
      ? lowlandProfile.percentileAtHeight(height)
      : 0
    if (
      lowlandProfile
      && elevationPercentile > lowlandCeiling + 1e-6
    ) {
      return { ok: false, failureReason: 'elevation-preference' }
    }
    return {
      ok: true,
      placement: {
        x,
        z,
        distanceFromClick: distance({ x: preferredX, z: preferredZ }, { x, z }),
        elevationPercentile,
        gradient: gradient.magnitude,
      },
    }
  }
  const direct = evaluate(preferredX, preferredZ)
  if (direct.ok) {
    return {
      ok: true,
      placement: direct.placement,
      snapped: false,
    }
  }
  const radiusLimit = Math.max(0, maxRadius)
  const radialStep = lowlandProfile
    ? Math.max(30, grid.cellSize)
    : ROAD_WAYPOINT_SNAP_STEP
  const rings = Math.ceil(radiusLimit / radialStep)
  for (let ring = 1; ring <= rings; ring += 1) {
    const radius = Math.min(radiusLimit, ring * radialStep)
    let best: ScenicWaypointPlacement | null = null
    let bestLowlandScore = Number.POSITIVE_INFINITY
    for (let index = 0; index < ROAD_WAYPOINT_SNAP_DIRECTIONS; index += 1) {
      const angle = (index / ROAD_WAYPOINT_SNAP_DIRECTIONS) * Math.PI * 2
      const candidate = evaluate(
        preferredX + Math.cos(angle) * radius,
        preferredZ + Math.sin(angle) * radius,
      )
      if (!candidate.ok) {
        continue
      }
      if (lowlandProfile) {
        const lowlandScore =
          candidate.placement.elevationPercentile * 0.6
          + candidate.placement.gradient * 0.4
        if (lowlandScore < bestLowlandScore) {
          best = candidate.placement
          bestLowlandScore = lowlandScore
        }
        continue
      }
      if (
        !best
        || candidate.placement.distanceFromClick < best.distanceFromClick
        || (
          candidate.placement.distanceFromClick === best.distanceFromClick
          && candidate.placement.gradient < best.gradient
        )
      ) {
        best = candidate.placement
      }
    }
    if (best) {
      return {
        ok: true,
        placement: best,
        snapped: best.distanceFromClick > 1e-6,
      }
    }
  }
  return {
    ok: false,
    failureReason:
      direct.failureReason === 'outside-terrain'
        ? 'outside-terrain'
        : direct.failureReason === 'too-steep'
          ? 'too-steep'
          : 'no-snapped-candidate',
  }
}

/**
 * Compatibility entry point for scenic lowland callers. Explicit road
 * waypoint placement should use `resolveRoadWaypointPlacement` instead.
 */
export function resolveLowlandScenicWaypoint(
  grid: TerrainHeightGrid,
  preferredX: number,
  preferredZ: number,
  maxRadius = SCENIC_WAYPOINT_SNAP_RADIUS,
  options: OfficialScenicRoadOptions = {},
): ScenicWaypointPlacement | null {
  const result = resolveRoadWaypointPlacement(
    grid,
    preferredX,
    preferredZ,
    maxRadius,
    {
      enforceLowlandPreference: true,
      lowlandPreferenceCeiling: options.lowlandPreferenceCeiling,
      maxCrossSlope: options.maxCrossSlope,
    },
  )
  return result.ok ? result.placement : null
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

/**
 * Map the official infinite-world orbit to a finite terrain extent. The
 * 0.55 inradius centre and 5/9..13/9 band preserve the shipped 9km / 5km /
 * 13km proportions while leaving room for a full boundary exit ramp.
 */
export function resolveNaturalRoadPlan(
  grid: TerrainHeightGrid,
  style: RoadStyleId,
  seed: number,
  roadWidth: number,
  routeClearance: number,
): NaturalRoadPlan {
  const spanX = Math.max(1, grid.maxX - grid.minX)
  const spanZ = Math.max(1, grid.maxZ - grid.minZ)
  const diagonal = Math.hypot(spanX, spanZ)
  const inradius = Math.max(1, Math.min(spanX, spanZ) * 0.5)
  const targetRadius = Math.max(120, inradius * 0.55)
  const targetMargin = targetRadius * (4 / 9)
  const profile = resolveSlowroadsMidlineProfile(style)
  const lapSpacing = Math.max(
    80,
    (roadWidth + routeClearance) * 4,
  )
  const randomLength = 2 + hashUnit(seed >>> 0, 73, 79) * 2
  const nodeBudgetLength = profile.stepLength * 32_768 * 0.9
  return {
    style,
    center: {
      x: (grid.minX + grid.maxX) * 0.5,
      z: (grid.minZ + grid.maxZ) * 0.5,
    },
    targetRadius,
    targetRadiusMin: Math.max(80, targetRadius - targetMargin),
    targetRadiusMax: targetRadius + targetMargin,
    lapSpacing,
    targetLength: Math.min(diagonal * randomLength, nodeBudgetLength),
    boundaryExitRamp: clamp(diagonal * 0.25, 2_000, 12_000),
    maxOrbitRadius: Math.max(targetRadius + targetMargin, inradius * 0.92),
    diagonal,
    orbitalHullRadius: Math.max(targetRadius + targetMargin, inradius * 0.92),
  }
}

function updateTargetDirection(
  target: Vec2,
  heading: number,
  centerX: number,
  centerZ: number,
  targetRadius: number = SLOWROADS_HILLS_ROAD_PROFILE.targetRadius,
  targetRadiusMin: number = SLOWROADS_HILLS_ROAD_PROFILE.targetRadiusMin,
  targetRadiusMax: number = SLOWROADS_HILLS_ROAD_PROFILE.targetRadiusMax,
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
  if (radius < targetRadius) {
    if (radius < targetRadiusMin) {
      factor = 1
    } else {
      const margin = targetRadius - targetRadiusMin
      factor = 1 - (radius - targetRadiusMin) / margin
    }
    factor *= factor
    const direction = normalize(
      tangent.x + inward.x * factor,
      tangent.z + inward.z * factor,
    )
    return direction
  }
  if (radius > targetRadiusMax) {
    factor = 1
  } else {
    const margin = targetRadiusMax - targetRadius
    factor = (radius - targetRadius) / margin
  }
  factor *= factor
  return normalize(
    tangent.x + outward.x * factor,
    tangent.z + outward.z * factor,
  )
}

function nearestBoundaryDirection(
  grid: TerrainHeightGrid,
  x: number,
  z: number,
): Vec2 {
  const distances = [
    { distance: x - grid.minX, x: -1, z: 0 },
    { distance: grid.maxX - x, x: 1, z: 0 },
    { distance: z - grid.minZ, x: 0, z: -1 },
    { distance: grid.maxZ - z, x: 0, z: 1 },
  ]
  distances.sort((a, b) => a.distance - b.distance)
  return { x: distances[0]!.x, z: distances[0]!.z }
}

function naturalTargetDirection(
  grid: TerrainHeightGrid,
  position: Vec2,
  heading: number,
  length: number,
  laps: number,
  config: NaturalRoadExtensionConfig,
  profile: SlowroadsMidlineProfile,
): Vec2 {
  if (!profile.spiralise) {
    return { x: Math.cos(heading), z: Math.sin(heading) }
  }
  const radiusDrift = Math.min(
    laps * config.lapSpacing,
    Math.max(0, config.maxOrbitRadius - config.targetRadiusMax),
  )
  const targetRadiusMin = config.targetRadiusMin + radiusDrift
  const targetRadiusMax = config.targetRadiusMax + radiusDrift
  const radius = Math.hypot(
    position.x - config.center.x,
    position.z - config.center.z,
  )
  let direction: Vec2
  if (radius > 1e-6 && radius < targetRadiusMin) {
    const outward = normalize(
      position.x - config.center.x,
      position.z - config.center.z,
    )
    const tangent = { x: -outward.z, z: outward.x }
    const outwardWeight = 0.65
      + 0.35 * clamp(1 - radius / Math.max(1, targetRadiusMin), 0, 1)
    direction = normalize(
      tangent.x + outward.x * outwardWeight,
      tangent.z + outward.z * outwardWeight,
    )
  } else if (radius <= targetRadiusMax) {
    if (radius > 1e-6) {
      const outward = normalize(
        position.x - config.center.x,
        position.z - config.center.z,
      )
      direction = { x: -outward.z, z: outward.x }
    } else {
      direction = { x: Math.cos(heading), z: Math.sin(heading) }
    }
  } else {
    const outward = normalize(
      position.x - config.center.x,
      position.z - config.center.z,
    )
    const tangent = { x: -outward.z, z: outward.x }
    const inwardWeight = clamp(
      (radius - targetRadiusMax) / Math.max(1, targetRadiusMax),
      0,
      1,
    )
    direction = normalize(
      tangent.x - outward.x * inwardWeight,
      tangent.z - outward.z * inwardWeight,
    )
  }

  const exitWeight = smoothstep(
    config.targetLength - config.boundaryExitRamp,
    config.targetLength,
    length,
  )
  const edgeMargin = Math.min(
    grid.maxX - grid.minX,
    grid.maxZ - grid.minZ,
  ) * 0.05
  const nearBoundary = position.x <= grid.minX + edgeMargin
    || position.x >= grid.maxX - edgeMargin
    || position.z <= grid.minZ + edgeMargin
    || position.z >= grid.maxZ - edgeMargin
  const lengthProgress = config.targetLength > 1e-6
    ? length / config.targetLength
    : 1
  const nearBoundaryWeight = nearBoundary
    ? smoothstep(0.35, 0.55, lengthProgress)
    : 0
  const boundaryWeight = Math.max(exitWeight, nearBoundaryWeight)
  if (boundaryWeight > 0) {
    const boundary = nearestBoundaryDirection(grid, position.x, position.z)
    direction = normalize(
      direction.x * (1 - boundaryWeight) + boundary.x * boundaryWeight,
      direction.z * (1 - boundaryWeight) + boundary.z * boundaryWeight,
    )
  }
  return direction
}

function compensateProfile(
  nodes: RoadTraceNode[],
  profile: Pick<SlowroadsMidlineProfile, 'smoothWindow' | 'smoothFactor'>,
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

type GuideData = {
  points: Vec2[]
  cumulative: number[]
  totalLength: number
  corridorWidth: number
}

type GuideProjection = {
  index: number
  distanceAlong: number
  crossTrack: number
  target: Vec2
  heading: number
}

function buildGuideData(
  points: ReadonlyArray<Vec2>,
  corridorWidth: number,
): GuideData | null {
  if (points.length < 2) {
    return null
  }
  const cleaned: Vec2[] = []
  for (const point of points) {
    if (
      !cleaned.length
      || distance(cleaned[cleaned.length - 1]!, point) > 1e-5
    ) {
      cleaned.push({ x: point.x, z: point.z })
    }
  }
  if (cleaned.length < 2) {
    return null
  }
  const cumulative: number[] = [0]
  for (let index = 1; index < cleaned.length; index += 1) {
    cumulative.push(
      cumulative[index - 1]! + distance(cleaned[index - 1]!, cleaned[index]!),
    )
  }
  return {
    points: cleaned,
    cumulative,
    totalLength: cumulative[cumulative.length - 1]!,
    corridorWidth: Math.max(20, corridorWidth),
  }
}

function sampleGuideAtDistance(
  guide: GuideData,
  targetDistance: number,
): Vec2 {
  const distanceAlong = clamp(targetDistance, 0, guide.totalLength)
  let low = 1
  let high = guide.cumulative.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (guide.cumulative[mid]! < distanceAlong) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  const index = Math.max(1, low)
  const start = guide.points[index - 1]!
  const end = guide.points[index]!
  const startDistance = guide.cumulative[index - 1]!
  const segmentLength = Math.max(
    1e-6,
    guide.cumulative[index]! - startDistance,
  )
  const factor = clamp((distanceAlong - startDistance) / segmentLength, 0, 1)
  return {
    x: start.x + (end.x - start.x) * factor,
    z: start.z + (end.z - start.z) * factor,
  }
}

function locateOnGuide(
  guide: GuideData,
  x: number,
  z: number,
  previousIndex: number,
  lookahead: number,
): GuideProjection {
  const startIndex = Math.max(0, previousIndex - 4)
  const endIndex = Math.min(guide.points.length - 2, previousIndex + 96)
  let bestIndex = startIndex
  let bestDistance = Number.POSITIVE_INFINITY
  let bestFactor = 0
  for (let index = startIndex; index <= endIndex; index += 1) {
    const start = guide.points[index]!
    const end = guide.points[index + 1]!
    const dx = end.x - start.x
    const dz = end.z - start.z
    const lengthSq = dx * dx + dz * dz
    const factor = lengthSq > 1e-9
      ? clamp(
          ((x - start.x) * dx + (z - start.z) * dz) / lengthSq,
          0,
          1,
        )
      : 0
    const projectedX = start.x + dx * factor
    const projectedZ = start.z + dz * factor
    const projectedDistance = Math.hypot(x - projectedX, z - projectedZ)
    if (projectedDistance < bestDistance) {
      bestDistance = projectedDistance
      bestIndex = index
      bestFactor = factor
    }
  }
  const start = guide.points[bestIndex]!
  const end = guide.points[bestIndex + 1]!
  const segmentLength = Math.max(1e-6, distance(start, end))
  const directionX = (end.x - start.x) / segmentLength
  const directionZ = (end.z - start.z) / segmentLength
  const crossTrack = (
    (x - (start.x + (end.x - start.x) * bestFactor)) * -directionZ
    + (z - (start.z + (end.z - start.z) * bestFactor)) * directionX
  )
  const distanceAlong = (
    guide.cumulative[bestIndex]!
    + segmentLength * bestFactor
  )
  const target = sampleGuideAtDistance(
    guide,
    Math.min(guide.totalLength, distanceAlong + lookahead),
  )
  return {
    index: bestIndex,
    distanceAlong,
    crossTrack,
    target,
    heading: Math.atan2(target.z - z, target.x - x),
  }
}

function distanceToGuide(
  guide: GuideData,
  x: number,
  z: number,
  previousIndex: number,
): number {
  const startIndex = Math.max(
    0,
    previousIndex - 8,
  )
  const endIndex = Math.min(
    guide.points.length - 2,
    previousIndex + 48,
  )
  let best = Number.POSITIVE_INFINITY
  for (let index = startIndex; index <= endIndex; index += 1) {
    const start = guide.points[index]!
    const end = guide.points[index + 1]!
    const dx = end.x - start.x
    const dz = end.z - start.z
    const lengthSq = dx * dx + dz * dz
    const factor = lengthSq > 1e-9
      ? clamp(
          ((x - start.x) * dx + (z - start.z) * dz) / lengthSq,
          0,
          1,
        )
      : 0
    best = Math.min(
      best,
      Math.hypot(
        x - (start.x + dx * factor),
        z - (start.z + dz * factor),
      ),
    )
  }
  return best
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
  terrainProfile: ScenicTerrainElevationProfile,
  constraints: ResolvedTerrainConstraints,
  requiredWaypoints: ReadonlyArray<Vec2>,
  waypointTolerance: number,
  waypointNoProgressDistance: number,
  waypointAttemptDistance: number,
  guide: GuideData | null = null,
  wiggleScale = 1,
  requireAllWaypoints = false,
  guideTermination: 'loop' | 'boundary' | 'dead-end' = 'boundary',
  natural: NaturalRoadExtensionConfig | null = null,
  midlineProfile: SlowroadsMidlineProfile = SLOWROADS_HILLS_ROAD_PROFILE,
  initialHeadingRad: number | null = null,
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

  const profile = {
    ...SLOWROADS_HILLS_ROAD_PROFILE,
    ...midlineProfile,
  }
  const effectiveMaxSteps = guide
    ? Math.min(
        profile.maxSteps,
        Math.max(
          512,
          Math.ceil(
            (guide.totalLength + (natural?.targetLength ?? 0))
              / profile.stepLength * 1.35,
          ) + 512,
        ),
      )
    : natural
      ? Math.min(
          profile.maxSteps,
          Math.max(
            512,
            Math.ceil(natural.targetLength / profile.stepLength * 1.35) + 512,
          ),
        )
      : profile.maxSteps
  let x = origin.x
  let z = origin.z
  let y = startY - profile.roadSink
  let heading = initialHeadingRad ?? resolveOfficialScenicStartHeading(grid, x, z)
  let targetDirection = natural
    ? naturalTargetDirection(
        grid,
        { x, z },
        heading,
        0,
        0,
        natural,
        profile,
      )
    : updateTargetDirection({ x, z }, heading, centerX, centerZ)
  if (natural && initialHeadingRad == null) {
    heading = Math.atan2(targetDirection.z, targetDirection.x)
    targetDirection = naturalTargetDirection(
      grid,
      { x, z },
      heading,
      0,
      0,
      natural,
      profile,
    )
  }
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
  let waypointIndex = requiredWaypoints.length > 1 ? 1 : -1
  let bestWaypointDistance = waypointIndex > 0
    ? distance({ x, z }, requiredWaypoints[waypointIndex]!)
    : Number.POSITIVE_INFINITY
  let waypointAttemptTravelled = 0
  let waypointProgressTravelled = 0
  let waypointsAttempted = waypointIndex > 0 ? 1 : 0
  let guideIndex = 0
  let maxGuideDeviation = 0
  let failureReason: string | null = null
  let complete = false
  let naturalActive = Boolean(natural && !guide)
  let lastOrbitAngle = natural
    ? Math.atan2(z - natural.center.z, x - natural.center.x)
    : 0
  let orbitProgress = 0
  let naturalLaps = 0
  let naturalStartLength = 0
  const hadGuide = Boolean(guide)

  const advanceWaypointTarget = (): void => {
    waypointIndex += 1
    waypointAttemptTravelled = 0
    waypointProgressTravelled = 0
    prevT = 0
    targetOverflow = 0
    accumulatedOverflow = 0
    antiTarget = null
    antiTargetRange = 0
    antiTargetTriggerCount = 0
    if (waypointIndex < requiredWaypoints.length) {
      bestWaypointDistance = distance(
        { x, z },
        requiredWaypoints[waypointIndex]!,
      )
      waypointsAttempted = Math.max(waypointsAttempted, waypointIndex)
    } else {
      waypointIndex = -1
      bestWaypointDistance = Number.POSITIVE_INFINITY
    }
  }

  for (let stepIndex = 0; stepIndex < effectiveMaxSteps; stepIndex += 1) {
    const tail = nodes[nodes.length - 1]!
    while (
      waypointIndex >= 1
      && waypointIndex < requiredWaypoints.length
      && distance({ x, z }, requiredWaypoints[waypointIndex]!) <= waypointTolerance
    ) {
      advanceWaypointTarget()
    }
    const guideProjection = guide
      ? locateOnGuide(
          guide,
          x,
          z,
          guideIndex,
          profile.feelDistance * 3,
        )
      : null
    if (guideProjection) {
      guideIndex = guideProjection.index
      maxGuideDeviation = Math.max(
        maxGuideDeviation,
        Math.abs(guideProjection.crossTrack),
      )
    }
    if (
      guide
      && guideIndex >= guide.points.length - 2
      && distance(
        { x, z },
        guide.points[guide.points.length - 1]!,
      ) <= Math.max(profile.stepLength * 2, waypointTolerance)
    ) {
      if (natural && guideTermination === 'boundary') {
        guide = null
        naturalActive = true
        prevT = 0
        targetOverflow = 0
        accumulatedOverflow = 0
        antiTarget = null
        antiTargetRange = 0
        antiTargetTriggerCount = 0
        lastOrbitAngle = Math.atan2(
          z - natural.center.z,
          x - natural.center.x,
        )
        orbitProgress = 0
        naturalStartLength = length
      } else {
        complete = true
        failureReason = guideTermination === 'loop'
          ? 'reached-route-start'
          : guideTermination === 'dead-end'
            ? 'reached-route-end'
            : 'reached-terrain-boundary'
        break
      }
    }
    const straightX = x + Math.cos(heading) * profile.stepLength
    const straightZ = z + Math.sin(heading) * profile.stepLength
    if (
      straightX < grid.minX + margin
      || straightX > grid.maxX - margin
      || straightZ < grid.minZ + margin
      || straightZ > grid.maxZ - margin
    ) {
      const guidancePoint = waypointIndex >= 1
        && waypointIndex < requiredWaypoints.length
        ? requiredWaypoints[waypointIndex]!
        : guideProjection?.target ?? null
      const guidanceInside = guidancePoint != null
        && guidancePoint.x >= grid.minX + margin
        && guidancePoint.x <= grid.maxX - margin
        && guidancePoint.z >= grid.minZ + margin
        && guidancePoint.z <= grid.maxZ - margin
      if (!guidanceInside || naturalActive) {
        complete = true
        failureReason = 'reached-terrain-boundary'
        break
      }
    }

    if (naturalActive && natural) {
      const radius = Math.hypot(
        x - natural.center.x,
        z - natural.center.z,
      )
      if (radius > 1e-6) {
        const orbitAngle = Math.atan2(
          z - natural.center.z,
          x - natural.center.x,
        )
        orbitProgress += wrapAngle(orbitAngle - lastOrbitAngle)
        lastOrbitAngle = orbitAngle
        naturalLaps = Math.abs(orbitProgress) / (Math.PI * 2)
      }
    }
    targetDirection = naturalActive && natural
      ? naturalTargetDirection(
          grid,
          tail,
          heading,
          length - naturalStartLength,
          naturalLaps,
          natural,
          profile,
        )
      : updateTargetDirection(tail, heading, centerX, centerZ)
    let lowlandWeight = 0
    if (!naturalActive) {
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
    const activeWaypoint = waypointIndex >= 1 && waypointIndex < requiredWaypoints.length
      ? requiredWaypoints[waypointIndex]!
      : null
    const activeWaypointDistance = activeWaypoint
      ? distance({ x, z }, activeWaypoint)
      : Number.POSITIVE_INFINITY
    const dockingToWaypoint = activeWaypoint != null
      && activeWaypointDistance <= Math.max(600, profile.stepLength * 20)
    if (activeWaypoint) {
      const waypoint = activeWaypoint
      const toWaypoint = normalize(waypoint.x - x, waypoint.z - z)
      const waypointWeight = 0.92
        + 0.07 * (1 - smoothstep(500, 3_000, activeWaypointDistance))
      targetDirection = normalize(
        targetDirection.x * (1 - waypointWeight) + toWaypoint.x * waypointWeight,
        targetDirection.z * (1 - waypointWeight) + toWaypoint.z * waypointWeight,
      )
    }
    if (guideProjection && guide) {
      const guideDirection = normalize(
        guideProjection.target.x - x,
        guideProjection.target.z - z,
      )
      const corridorCorrection = clamp(
        Math.abs(guideProjection.crossTrack) / guide.corridorWidth,
        0,
        1,
      )
      const guideWeight = dockingToWaypoint
        ? 0
        : 0.82 + corridorCorrection * 0.16
      targetDirection = normalize(
        targetDirection.x * (1 - guideWeight)
          + guideDirection.x * guideWeight,
        targetDirection.z * (1 - guideWeight)
          + guideDirection.z * guideWeight,
      )
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

    const waypointNavigationActive =
      waypointIndex >= 1 && waypointIndex < requiredWaypoints.length
    const violatedOverflow = !guide
      && !waypointNavigationActive
      && (accumulatedOverflow > 150 || targetOverflow > 3)
    let violatedTracker: TurnTracker | null = null
    if (!guide && !waypointNavigationActive) {
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
        if (waypointIndex >= 1 && waypointIndex < requiredWaypoints.length) {
          advanceWaypointTarget()
          prevT = 0
          targetOverflow = 0
          accumulatedOverflow = 0
          antiTarget = null
          antiTargetRange = 0
          antiTargetTriggerCount = 0
          continue
        }
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

    const smoothedB = bT * profile.smoothFactor * wiggleScale
    const officialHeading = wrapAngle(heading - smoothedB * profile.feelAngleRad)
    let chosenHeading = officialHeading
    let nextX = x + Math.cos(chosenHeading) * profile.stepLength
    let nextZ = z + Math.sin(chosenHeading) * profile.stepLength
    let nextY = grid.sampleHeight(nextX, nextZ)
    let chosenBT = smoothedB
    {
      const candidateMaxGrade = guide
        ? constraints.maxGrade
        : Math.min(constraints.maxGrade, constraints.preferredGrade)
      const candidateMaxCrossSlope = constraints.maxCrossSlope * 0.85
      const evaluateHeading = (
        candidateHeading: number,
        referenceHeading: number,
      ): {
        heading: number
        x: number
        z: number
        y: number
        valid: boolean
        invalidReason: 'forward-grade' | 'cross-slope' | 'guide-corridor' | null
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
        const stepGrade = Math.abs(candidateY - feelCurrent) / profile.stepLength
        const candidateGradient = sampleTerrainGradient(grid, candidateX, candidateZ)
        const crossSlope = crossSlopeForHeading(candidateGradient, candidateHeading)
        const forwardValid = forwardGrade <= candidateMaxGrade + 1e-6
          && (!guide || stepGrade <= candidateMaxGrade + 1e-6)
        const crossValid = crossSlope <= candidateMaxCrossSlope + 1e-6
        const guideDeviation = guide && guideProjection
          ? distanceToGuide(guide, candidateX, candidateZ, guideProjection.index)
          : 0
        const guideValid = !guide
          || dockingToWaypoint
          || guideDeviation <= guide.corridorWidth + 1e-6
        const valid = forwardValid && crossValid && guideValid
        const headingError = Math.abs(wrapAngle(candidateHeading - referenceHeading))
        const turnScore = headingError / profile.feelAngleRad
        const crossExcess = Math.max(
          0,
          (crossSlope - constraints.preferredGrade)
            / Math.max(1e-4, constraints.maxCrossSlope - constraints.preferredGrade),
        )
        const gradeExcess = guide
          ? Math.max(
              0,
              (forwardGrade - constraints.preferredGrade)
                / Math.max(1e-4, constraints.maxGrade - constraints.preferredGrade),
            )
          : 0
        const stepGradeExcess = guide
          ? Math.max(
              0,
              (stepGrade - constraints.preferredGrade)
                / Math.max(1e-4, constraints.maxGrade - constraints.preferredGrade),
            )
          : 0
        const guideExcess = guide && !dockingToWaypoint
          ? Math.max(
              0,
              (guideDeviation - guide.corridorWidth * 0.65)
                / Math.max(1e-4, guide.corridorWidth * 0.35),
            )
          : 0
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
              : !crossValid
                ? 'cross-slope'
                : 'guide-corridor',
          score:
            turnScore * 1.5
            + (forwardGrade / Math.max(1e-4, constraints.preferredGrade)) ** 2 * 1.5
            + gradeExcess * gradeExcess * 3
            + stepGradeExcess * stepGradeExcess * 3
            + crossExcess * crossExcess * 2
            + guideExcess * guideExcess * 5
            + elevationScore * lowlandWeight * 2,
        }
      }
      const dockTarget = activeWaypoint
      const docking = dockingToWaypoint
      const referenceHeading = docking && dockTarget
        ? Math.atan2(dockTarget.z - z, dockTarget.x - x)
        : guideProjection
          ? guideProjection.heading
          : officialHeading
      let chosen = evaluateHeading(referenceHeading, referenceHeading)
      let sawForwardGradeFailure = chosen?.invalidReason === 'forward-grade'
      let sawCrossSlopeFailure = chosen?.invalidReason === 'cross-slope'
      let sawGuideFailure = chosen?.invalidReason === 'guide-corridor'
      if (!chosen?.valid) {
        let rescued: ReturnType<typeof evaluateHeading> = null
        for (let level = 1; level <= 36; level += 1) {
          const offset = (level * 5 * Math.PI) / 180
          for (const sign of [-1, 1]) {
            const candidate = evaluateHeading(
              wrapAngle(referenceHeading + sign * offset),
              referenceHeading,
            )
            if (candidate?.invalidReason === 'forward-grade') {
              sawForwardGradeFailure = true
            } else if (candidate?.invalidReason === 'cross-slope') {
              sawCrossSlopeFailure = true
            } else if (candidate?.invalidReason === 'guide-corridor') {
              sawGuideFailure = true
            }
            if (candidate?.valid && (!rescued || candidate.score < rescued.score)) {
              rescued = candidate
            }
          }
        }
        chosen = rescued
      }
      if (!chosen?.valid) {
        if (waypointIndex >= 1 && waypointIndex < requiredWaypoints.length) {
          if (requireAllWaypoints) {
            failureReason = 'waypoint-unreachable'
            break
          }
          advanceWaypointTarget()
          continue
        }
        failureReason = sawForwardGradeFailure
          ? 'blocked-by-forward-grade'
          : sawCrossSlopeFailure
            ? 'blocked-by-cross-slope'
            : sawGuideFailure
              ? 'blocked-by-guide-corridor'
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
      if (waypointIndex >= 1 && waypointIndex < requiredWaypoints.length) {
        if (requireAllWaypoints) {
          failureReason = 'waypoint-unreachable'
          break
        }
        advanceWaypointTarget()
        continue
      }
      failureReason = 'blocked'
      break
    }
    if (waypointIndex >= 1 && waypointIndex < requiredWaypoints.length) {
      const waypoint = requiredWaypoints[waypointIndex]!
      const currentDistance = distance({ x, z }, waypoint)
      const nextDistance = distance({ x: nextX, z: nextZ }, waypoint)
      if (currentDistance > waypointTolerance && nextDistance > waypointTolerance) {
        const capture = projectWaypointCapture(
          { x, z },
          { x: nextX, z: nextZ },
          waypoint,
          waypointTolerance,
        )
        if (capture && capture.t > 1e-6 && capture.t < 1 - 1e-6) {
          const captureY = grid.sampleHeight(capture.x, capture.z)
          if (captureY != null) {
            nextX = capture.x
            nextZ = capture.z
            nextY = captureY
          }
        }
      }
    }
    prevT = chosenBT
    const headingDelta = wrapAngle(chosenHeading - heading)
    const segmentLength = Math.hypot(nextX - x, nextZ - z)
    heading = chosenHeading
    x = nextX
    z = nextZ
    y = nextY - profile.roadSink
    length += segmentLength
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
    if (waypointIndex >= 1 && waypointIndex < requiredWaypoints.length) {
      const waypoint = requiredWaypoints[waypointIndex]!
      const currentDistance = distance({ x, z }, waypoint)
      waypointAttemptTravelled += segmentLength
      if (currentDistance <= waypointTolerance) {
        advanceWaypointTarget()
      } else {
        if (currentDistance < bestWaypointDistance - 2) {
          bestWaypointDistance = currentDistance
          waypointProgressTravelled = 0
        } else {
          waypointProgressTravelled += segmentLength
        }
        if (
          waypointProgressTravelled >= waypointNoProgressDistance
          || waypointAttemptTravelled >= waypointAttemptDistance
        ) {
          if (requireAllWaypoints) {
            failureReason = 'waypoint-unreachable'
            break
          }
          advanceWaypointTarget()
        }
      }
    }
  }

  if (!failureReason && nodes.length >= effectiveMaxSteps) {
    complete = false
    failureReason = 'reached-step-limit'
  }
  compensateProfile(
    nodes,
    profile,
    grid,
    constraints,
  )
  length = 0
  for (let index = 0; index < nodes.length; index += 1) {
    nodes[index]!.index = index
    if (index > 0) {
      length += distance(nodes[index - 1]!, nodes[index]!)
    }
  }
  const elevationStats = summarizeScenicRoute(grid, nodes, terrainProfile, constraints)
  const passedWaypointIndices = resolveWaypointPassIndices(
    nodes,
    requiredWaypoints,
    waypointTolerance,
  )
  const skippedWaypointIndices: number[] = []
  for (let index = 1; index < requiredWaypoints.length; index += 1) {
    if (!passedWaypointIndices.has(index)) {
      skippedWaypointIndices.push(index)
    }
  }
  if (requireAllWaypoints && skippedWaypointIndices.length > 0) {
    complete = false
    failureReason = failureReason ?? 'waypoint-unreachable'
  }
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
      waypointsSkipped: skippedWaypointIndices.length,
      skippedWaypointIndices,
      waypointsAttempted: Math.min(
        Math.max(0, requiredWaypoints.length - 1),
        waypointsAttempted,
      ),
      maxGuideDeviation: hadGuide ? maxGuideDeviation : undefined,
      naturalTargetLength: natural?.targetLength,
      naturalLaps,
    },
    restart: false,
  }
}

/**
 * Guided scenic tracer. A slope-feasible global guide supplies the route
 * topology, while the Hills probe/turn model still produces the final nodes.
 * Every waypoint is mandatory and the wiggle amplitude is reduced only when
 * the full-strength curve cannot satisfy the hard terrain limits.
 */
export function traceOfficialScenicGuidedRoad(
  grid: TerrainHeightGrid,
  origin: Vec2,
  seed: number,
  margin: number,
  options: OfficialScenicRoadOptions = {},
): OfficialScenicRoadResult {
  const guide = buildGuideData(
    options.guidePoints ?? [],
    options.guideCorridorWidth ?? 60,
  )
  if (!guide) {
    return emptyResult('guide-empty')
  }
  const centerX = (grid.minX + grid.maxX) * 0.5
  const centerZ = (grid.minZ + grid.maxZ) * 0.5
  const profile = buildScenicTerrainElevationProfile(grid, options)
  const constraints = resolveTerrainConstraints(options)
  const requiredWaypoints = (options.requiredWaypoints ?? [origin])
    .map((point) => ({ x: point.x, z: point.z }))
  if (!requiredWaypoints.length) {
    requiredWaypoints.push({ x: origin.x, z: origin.z })
  }
  const waypointTolerance = Math.max(1, options.waypointTolerance ?? 4)
  const requestedScale = clamp(
    options.wiggleScale ?? 1,
    0,
    1,
  )
  const scales = [requestedScale, 0.7, 0.4, 0]
    .filter((value, index, values) => (
      values.findIndex((candidate) => Math.abs(candidate - value) < 1e-6)
      === index
    ))
  let last: OfficialScenicRoadResult = emptyResult('guided-official-blocked')
  for (const wiggleScale of scales) {
    const traced = traceOnce(
      grid,
      origin,
      centerX,
      centerZ,
      seed,
      margin,
      profile,
      constraints,
      requiredWaypoints,
      waypointTolerance,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      guide,
      wiggleScale,
      true,
      options.guideTermination ?? 'boundary',
      options.natural ?? null,
      options.midlineProfile ?? SLOWROADS_HILLS_ROAD_PROFILE,
      options.initialHeadingRad ?? null,
    )
    last = traced.result
    if (
      last.complete
      && last.waypointsSkipped === 0
      && last.maxForwardGrade <= constraints.maxGrade + 1e-4
      && last.maxCrossSlope <= constraints.maxCrossSlope + 1e-4
    ) {
      return last
    }
  }
  return {
    ...last,
    complete: false,
    failureReason: last.failureReason ?? 'guided-official-blocked',
  }
}

/**
 * Natural (unguided) official tracer. This is the shipped slowroads behaviour
 * for `spiralise` styles: terrain probes shape the curve while a tangential
 * virtual orbit supplies the long-range extension.
 */
export function traceOfficialScenicNaturalRoad(
  grid: TerrainHeightGrid,
  origin: Vec2,
  seed: number,
  margin: number,
  options: OfficialScenicRoadOptions = {},
): OfficialScenicRoadResult {
  const natural = options.natural
  if (!natural) {
    return emptyResult('natural-config-missing')
  }
  const profile = buildScenicTerrainElevationProfile(grid, options)
  const constraints = resolveTerrainConstraints(options)
  const traced = traceOnce(
    grid,
    origin,
    natural.center.x,
    natural.center.z,
    seed,
    margin,
    profile,
    constraints,
    [{ x: origin.x, z: origin.z }],
    Math.max(1, options.waypointTolerance ?? 4),
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    null,
    1,
    false,
    'boundary',
    natural,
    options.midlineProfile ?? SLOWROADS_HILLS_ROAD_PROFILE,
    options.initialHeadingRad ?? null,
  )
  return traced.result
}
