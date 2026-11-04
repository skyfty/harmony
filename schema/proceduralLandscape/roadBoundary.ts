import * as THREE from 'three'

import type { StaticBoxCollisionProxy } from '../groundCollisionRuntimeBridge'
import type { LandscapeExclusionCircle } from './exclusion'
import { BARRIER_TUNING, WALL_NODE_SPACING } from './roadStyle'
import type { RoadBandRow } from './roadBandRows'
import type { WallSample, WallSegment } from './walls'

export const ROAD_BOUNDARY_COLLISION_HEIGHT = 3
export const ROAD_BOUNDARY_COLLISION_THICKNESS = 0.2
export const ROAD_BOUNDARY_ROW_SPACING = 4
const ROAD_BOUNDARY_COLLIDER_OVERLAP = 0.35
const ROAD_BOUNDARY_COLLIDER_BOTTOM_MARGIN = 0.75

export interface RoadBoundaryCollisionGeometryOptions {
  rows: ReadonlyArray<RoadBandRow>
  columnHeights?: ReadonlyArray<ReadonlyArray<number>> | null
  halfWidth: number
  closed: boolean
  rowSpacing?: number
  height?: number
  thickness?: number
  lift?: number
  hostInverse?: THREE.Matrix4 | null
  /** World-space keep-out circles that cut matching openings in the boundary. */
  exclusionCircles?: ReadonlyArray<LandscapeExclusionCircle>
}

export interface RoadBoundaryCollisionGeometryResult {
  geometry: THREE.BufferGeometry
  /** World-space convex boxes used by physics backends without box/trimesh contact. */
  colliderBoxes: StaticBoxCollisionProxy[]
  sourceRowCount: number
  rowCount: number
  sideCount: number
  endCapCount: number
  triangleCount: number
}

interface BoundarySample {
  x: number
  z: number
  baseY: number
  outwardX: number
  outwardZ: number
  along: number
}

interface BoundaryPath {
  side: -1 | 1
  distance: number
  samples: BoundarySample[]
}

interface BoundaryPathRun {
  path: BoundaryPath
  samples: BoundarySample[]
}

interface BoundaryRange {
  start: number
  end: number
}

function sampleColumns(
  columns: ReadonlyArray<number> | null | undefined,
  t: number,
  fallback: number,
): number {
  if (!columns || columns.length < 2) {
    return fallback
  }
  const scaled = Math.min(columns.length - 1, Math.max(0, t * (columns.length - 1)))
  const low = Math.floor(scaled)
  const high = Math.min(columns.length - 1, low + 1)
  const fraction = scaled - low
  return columns[low]! + (columns[high]! - columns[low]!) * fraction
}

function selectRowIndices(
  rows: ReadonlyArray<RoadBandRow>,
  rowSpacing: number,
): number[] {
  if (rows.length < 2) {
    return []
  }
  const baseSpacing = Math.max(
    0.1,
    Math.hypot(rows[1]!.x - rows[0]!.x, rows[1]!.z - rows[0]!.z),
  )
  const rowStride = Math.max(1, Math.round(Math.max(0.5, rowSpacing) / baseSpacing))
  const selected: number[] = []
  for (let index = 0; index < rows.length; index += rowStride) {
    selected.push(index)
  }
  const last = rows.length - 1
  if (selected[selected.length - 1] !== last) {
    selected.push(last)
  }
  return selected
}

function assignBoundaryAlong(samples: BoundarySample[]): BoundarySample[] {
  let along = 0
  return samples.map((sample, index) => {
    if (index > 0) {
      const previous = samples[index - 1]!
      along += Math.hypot(sample.x - previous.x, sample.z - previous.z)
    }
    return along === 0 ? sample : { ...sample, along }
  })
}

function buildSideSamples(
  rows: ReadonlyArray<RoadBandRow>,
  columnHeights: RoadBoundaryCollisionGeometryOptions['columnHeights'],
  selectedRows: ReadonlyArray<number>,
  halfWidth: number,
  lift: number,
  side: -1 | 1,
): BoundarySample[] {
  return assignBoundaryAlong(selectedRows.map((rowIndex) => {
    const row = rows[rowIndex]!
    const normalX = -Math.sin(row.heading)
    const normalZ = Math.cos(row.heading)
    const outwardX = normalX * side
    const outwardZ = normalZ * side
    return {
      x: row.x + outwardX * halfWidth,
      z: row.z + outwardZ * halfWidth,
      baseY: sampleColumns(
        columnHeights?.[rowIndex],
        side < 0 ? 0 : 1,
        row.y,
      ) + lift,
      outwardX,
      outwardZ,
      along: 0,
    }
  }))
}

function buildEndCapSamples(
  rows: ReadonlyArray<RoadBandRow>,
  columnHeights: RoadBoundaryCollisionGeometryOptions['columnHeights'],
  rowIndex: number,
  halfWidth: number,
  lift: number,
  atStart: boolean,
): BoundarySample[] {
  const row = rows[rowIndex]!
  const normalX = -Math.sin(row.heading)
  const normalZ = Math.cos(row.heading)
  const tangentX = Math.cos(row.heading)
  const tangentZ = Math.sin(row.heading)
  const columns = columnHeights?.[rowIndex] ?? null
  const count = Math.max(3, columns?.length ?? 3)
  const samples: BoundarySample[] = []
  for (let column = 0; column < count; column += 1) {
    const t = column / (count - 1)
    const lateral = (t * 2 - 1) * halfWidth
    samples.push({
      x: row.x + normalX * lateral,
      z: row.z + normalZ * lateral,
      baseY: sampleColumns(columns, t, row.y) + lift,
      outwardX: atStart ? -tangentX : tangentX,
      outwardZ: atStart ? -tangentZ : tangentZ,
      along: column === 0
        ? 0
        : samples.length === 0
          ? 0
          : samples[samples.length - 1]!.along + Math.hypot(
              row.x + normalX * lateral - samples[samples.length - 1]!.x,
              row.z + normalZ * lateral - samples[samples.length - 1]!.z,
            ),
    })
  }
  return samples
}

function interpolateBoundarySample(
  from: BoundarySample,
  to: BoundarySample,
  t: number,
): BoundarySample {
  if (t <= 1e-9) {
    return from
  }
  if (t >= 1 - 1e-9) {
    return to
  }
  const mix = (a: number, b: number): number => a + (b - a) * t
  let outwardX = mix(from.outwardX, to.outwardX)
  let outwardZ = mix(from.outwardZ, to.outwardZ)
  const outwardLength = Math.hypot(outwardX, outwardZ)
  if (outwardLength > 1e-9) {
    outwardX /= outwardLength
    outwardZ /= outwardLength
  }
  return {
    x: mix(from.x, to.x),
    z: mix(from.z, to.z),
    baseY: mix(from.baseY, to.baseY),
    outwardX,
    outwardZ,
    along: mix(from.along, to.along),
  }
}

function segmentExclusionRange(
  from: BoundarySample,
  to: BoundarySample,
  circle: LandscapeExclusionCircle,
  margin: number,
): BoundaryRange | null {
  const radius = Math.max(0, circle.radius) + Math.max(0, margin)
  if (!Number.isFinite(radius) || radius <= 0) {
    return null
  }
  const dx = to.x - from.x
  const dz = to.z - from.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= 1e-12) {
    const distanceX = from.x - circle.centerX
    const distanceZ = from.z - circle.centerZ
    return distanceX * distanceX + distanceZ * distanceZ <= radius * radius + 1e-9
      ? { start: 0, end: 1 }
      : null
  }
  const centerX = circle.centerX - from.x
  const centerZ = circle.centerZ - from.z
  const centerT = (centerX * dx + centerZ * dz) / lengthSquared
  const closestX = from.x + dx * centerT
  const closestZ = from.z + dz * centerT
  const offsetX = closestX - circle.centerX
  const offsetZ = closestZ - circle.centerZ
  const offsetSquared = offsetX * offsetX + offsetZ * offsetZ
  if (offsetSquared > radius * radius + 1e-9) {
    return null
  }
  const halfRange = Math.sqrt(Math.max(0, radius * radius - offsetSquared))
    / Math.sqrt(lengthSquared)
  const start = Math.max(0, centerT - halfRange)
  const end = Math.min(1, centerT + halfRange)
  return end - start > 1e-9 ? { start, end } : null
}

function mergeBoundaryRanges(ranges: BoundaryRange[]): BoundaryRange[] {
  if (ranges.length < 2) {
    return ranges
  }
  ranges.sort((a, b) => a.start - b.start)
  const merged: BoundaryRange[] = [{ ...ranges[0]! }]
  for (let index = 1; index < ranges.length; index += 1) {
    const current = ranges[index]!
    const last = merged[merged.length - 1]!
    if (current.start <= last.end + 1e-9) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push({ ...current })
    }
  }
  return merged
}

function subtractBoundaryRanges(excluded: BoundaryRange[]): BoundaryRange[] {
  const merged = mergeBoundaryRanges(excluded)
  if (!merged.length) {
    return [{ start: 0, end: 1 }]
  }
  const outside: BoundaryRange[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor + 1e-9) {
      outside.push({ start: cursor, end: Math.min(1, range.start) })
    }
    cursor = Math.max(cursor, range.end)
    if (cursor >= 1 - 1e-9) {
      break
    }
  }
  if (cursor < 1 - 1e-9) {
    outside.push({ start: Math.max(0, cursor), end: 1 })
  }
  return outside.filter((range) => range.end - range.start > 1e-9)
}

function clipBoundarySamples(
  samples: ReadonlyArray<BoundarySample>,
  circles: ReadonlyArray<LandscapeExclusionCircle>,
  margin: number,
): BoundarySample[][] {
  if (samples.length < 2) {
    return []
  }
  if (!circles.length) {
    return [samples.slice()]
  }
  const runs: BoundarySample[][] = []
  let current: BoundarySample[] = []
  const finishRun = (): void => {
    if (current.length >= 2) {
      runs.push(current)
    }
    current = []
  }

  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1]!
    const to = samples[index]!
    const excluded: BoundaryRange[] = []
    for (const circle of circles) {
      const range = segmentExclusionRange(from, to, circle, margin)
      if (range) {
        excluded.push(range)
      }
    }
    for (const range of subtractBoundaryRanges(excluded)) {
      if (range.start > 1e-9) {
        finishRun()
      }
      const start = interpolateBoundarySample(from, to, range.start)
      const end = interpolateBoundarySample(from, to, range.end)
      if (!current.length) {
        current.push(start)
      }
      current.push(end)
      if (range.end < 1 - 1e-9) {
        finishRun()
      }
    }
  }
  finishRun()
  return runs
}

function createBoundaryPathRuns(
  options: RoadBoundaryCollisionGeometryOptions,
  clearance: number,
): {
  runs: BoundaryPathRun[]
  selectedRows: number[]
} | null {
  const rows = options.rows
  if (rows.length < 2) {
    return null
  }
  const selectedRows = selectRowIndices(
    rows,
    options.rowSpacing ?? ROAD_BOUNDARY_ROW_SPACING,
  )
  if (selectedRows.length < 2) {
    return null
  }
  const halfWidth = Math.max(0.05, options.halfWidth)
  const lift = options.lift ?? 0
  const paths: BoundaryPath[] = [
    {
      side: -1,
      distance: -halfWidth,
      samples: buildSideSamples(
        rows,
        options.columnHeights,
        selectedRows,
        halfWidth,
        lift,
        -1,
      ),
    },
    {
      side: 1,
      distance: halfWidth,
      samples: buildSideSamples(
        rows,
        options.columnHeights,
        selectedRows,
        halfWidth,
        lift,
        1,
      ),
    },
  ]
  if (!options.closed) {
    paths.push(
      {
        side: 1,
        distance: 0,
        samples: buildEndCapSamples(
          rows,
          options.columnHeights,
          selectedRows[0]!,
          halfWidth,
          lift,
          true,
        ),
      },
      {
        side: 1,
        distance: 0,
        samples: buildEndCapSamples(
          rows,
          options.columnHeights,
          selectedRows[selectedRows.length - 1]!,
          halfWidth,
          lift,
          false,
        ),
      },
    )
  }
  const circles = options.exclusionCircles ?? []
  const runs = paths.flatMap((path) => clipBoundarySamples(
    path.samples,
    circles,
    Math.max(0, clearance),
  ).map((samples) => ({ path, samples })))
  return { runs, selectedRows }
}

function appendWallStrip(
  positions: number[],
  indices: number[],
  samples: ReadonlyArray<BoundarySample>,
  height: number,
  thickness: number,
): void {
  if (samples.length < 2) {
    return
  }
  const vertexBase = positions.length / 3
  for (const sample of samples) {
    const outerX = sample.x + sample.outwardX * thickness
    const outerZ = sample.z + sample.outwardZ * thickness
    const topY = sample.baseY + height
    positions.push(
      sample.x, sample.baseY, sample.z,
      sample.x, topY, sample.z,
      outerX, sample.baseY, outerZ,
      outerX, topY, outerZ,
    )
  }

  const addQuad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, c, a, c, d)
  }
  for (let index = 0; index + 1 < samples.length; index += 1) {
    const current = vertexBase + index * 4
    const next = current + 4
    // Inner face, outer face and top. The prism is sunk through the road edge,
    // so a bottom face adds triangles without improving containment.
    addQuad(current, next, next + 1, current + 1)
    addQuad(current + 2, current + 3, next + 3, next + 2)
    addQuad(current + 1, next + 1, next + 3, current + 3)
  }
}

const boundaryColliderUp = new THREE.Vector3(0, 1, 0)
const boundaryColliderRotation = new THREE.Quaternion()

function appendBoundaryColliderBoxes(
  boxes: StaticBoxCollisionProxy[],
  samples: ReadonlyArray<BoundarySample>,
  height: number,
  thickness: number,
): void {
  for (let index = 0; index + 1 < samples.length; index += 1) {
    const from = samples[index]!
    const to = samples[index + 1]!
    const dx = to.x - from.x
    const dz = to.z - from.z
    const length = Math.hypot(dx, dz)
    if (!Number.isFinite(length) || length <= 1e-6) {
      continue
    }
    let outwardX = (from.outwardX + to.outwardX) * 0.5
    let outwardZ = (from.outwardZ + to.outwardZ) * 0.5
    const outwardLength = Math.hypot(outwardX, outwardZ)
    if (outwardLength <= 1e-9) {
      outwardX = -dz / length
      outwardZ = dx / length
    } else {
      outwardX /= outwardLength
      outwardZ /= outwardLength
    }
    const halfThickness = thickness * 0.5
    const minBaseY = Math.min(from.baseY, to.baseY)
    const maxBaseY = Math.max(from.baseY, to.baseY)
    const bottomY = minBaseY - ROAD_BOUNDARY_COLLIDER_BOTTOM_MARGIN
    const topY = maxBaseY + height
    const sourceYaw = -Math.atan2(dz, dx)
    boundaryColliderRotation.setFromAxisAngle(boundaryColliderUp, sourceYaw)
    boxes.push({
      center: [
        (from.x + to.x) * 0.5 + outwardX * halfThickness,
        (bottomY + topY) * 0.5,
        (from.z + to.z) * 0.5 + outwardZ * halfThickness,
      ],
      halfExtents: [
        length * 0.5 + ROAD_BOUNDARY_COLLIDER_OVERLAP * 0.5,
        (topY - bottomY) * 0.5,
        halfThickness,
      ],
      rotation: [
        boundaryColliderRotation.x,
        boundaryColliderRotation.y,
        boundaryColliderRotation.z,
        boundaryColliderRotation.w,
      ],
    })
  }
}

/**
 * Continuous collision-only walls at both asphalt edges. Non-loop roads also
 * receive caps across their start and end so a vehicle cannot drive around the
 * open ends. The geometry is decimated along the road and remains independent
 * from the denser rendered road band.
 */
export function createRoadBoundaryCollisionGeometry(
  options: RoadBoundaryCollisionGeometryOptions,
): RoadBoundaryCollisionGeometryResult | null {
  const rows = options.rows
  const height = Math.max(0.1, options.height ?? ROAD_BOUNDARY_COLLISION_HEIGHT)
  const thickness = Math.max(
    0.02,
    options.thickness ?? ROAD_BOUNDARY_COLLISION_THICKNESS,
  )
  const pathRuns = createBoundaryPathRuns(options, thickness)
  if (!pathRuns) {
    return null
  }
  const { runs, selectedRows } = pathRuns
  const positions: number[] = []
  const indices: number[] = []
  const colliderBoxes: StaticBoxCollisionProxy[] = []

  for (const run of runs) {
    appendWallStrip(
      positions,
      indices,
      run.samples,
      height,
      thickness,
    )
    appendBoundaryColliderBoxes(
      colliderBoxes,
      run.samples,
      height,
      thickness,
    )
  }
  if (!indices.length || !colliderBoxes.length) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  )
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1))
  if (options.hostInverse) {
    geometry.applyMatrix4(options.hostInverse)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return {
    geometry,
    colliderBoxes,
    sourceRowCount: rows.length,
    rowCount: selectedRows.length,
    sideCount: 2,
    endCapCount: options.closed ? 0 : 2,
    triangleCount: indices.length / 3,
  }
}

function makeWallPoint(
  x: number,
  z: number,
  y: number,
  nx: number,
  nz: number,
  u: number,
): WallSample {
  return {
    x,
    z,
    roadY: y,
    groundY: y,
    nx,
    nz,
    rotation: -Math.atan2(nz, nx),
    u,
    shadow: 0,
    jitterHeight: 0,
  }
}

function createBoundaryWallSegment(run: BoundaryPathRun): WallSegment {
  const points = run.samples.map((sample) => makeWallPoint(
    sample.x,
    sample.z,
    sample.baseY,
    sample.outwardX,
    sample.outwardZ,
    (sample.along / WALL_NODE_SPACING) * BARRIER_TUNING.uvPerNode,
  ))
  return {
    type: 'barrier',
    side: run.path.side,
    distance: run.path.distance,
    startAlong: run.samples[0]!.along,
    endAlong: run.samples[run.samples.length - 1]!.along,
    points,
  }
}

/** Seasonal visible barrier segments matching the collision-only boundary. */
export function createRoadBoundaryWallSegments(
  options: Omit<RoadBoundaryCollisionGeometryOptions, 'height'>,
): WallSegment[] {
  const thickness = Math.max(
    0.02,
    options.thickness ?? ROAD_BOUNDARY_COLLISION_THICKNESS,
  )
  const pathRuns = createBoundaryPathRuns(options, thickness)
  return pathRuns
    ? pathRuns.runs.map(createBoundaryWallSegment)
    : []
}
