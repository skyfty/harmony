import * as THREE from 'three'

import { BARRIER_TUNING, WALL_NODE_SPACING } from './roadStyle'
import type { RoadBandRow } from './roadBandRows'
import type { WallSample, WallSegment } from './walls'

export const ROAD_BOUNDARY_COLLISION_HEIGHT = 3
export const ROAD_BOUNDARY_COLLISION_THICKNESS = 0.2
export const ROAD_BOUNDARY_ROW_SPACING = 4

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
}

export interface RoadBoundaryCollisionGeometryResult {
  geometry: THREE.BufferGeometry
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

function buildSideSamples(
  rows: ReadonlyArray<RoadBandRow>,
  columnHeights: RoadBoundaryCollisionGeometryOptions['columnHeights'],
  selectedRows: ReadonlyArray<number>,
  halfWidth: number,
  lift: number,
  side: -1 | 1,
): BoundarySample[] {
  return selectedRows.map((rowIndex) => {
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
    }
  })
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
    })
  }
  return samples
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
  if (rows.length < 2) {
    return null
  }
  const selectedRows = selectRowIndices(rows, options.rowSpacing ?? ROAD_BOUNDARY_ROW_SPACING)
  if (selectedRows.length < 2) {
    return null
  }
  const halfWidth = Math.max(0.05, options.halfWidth)
  const height = Math.max(0.1, options.height ?? ROAD_BOUNDARY_COLLISION_HEIGHT)
  const thickness = Math.max(
    0.02,
    options.thickness ?? ROAD_BOUNDARY_COLLISION_THICKNESS,
  )
  const lift = options.lift ?? 0
  const positions: number[] = []
  const indices: number[] = []

  for (const side of [-1, 1] as const) {
    appendWallStrip(
      positions,
      indices,
      buildSideSamples(
        rows,
        options.columnHeights,
        selectedRows,
        halfWidth,
        lift,
        side,
      ),
      height,
      thickness,
    )
  }

  const endCapCount = options.closed ? 0 : 2
  if (!options.closed) {
    appendWallStrip(
      positions,
      indices,
      buildEndCapSamples(
        rows,
        options.columnHeights,
        selectedRows[0]!,
        halfWidth,
        lift,
        true,
      ),
      height,
      thickness,
    )
    appendWallStrip(
      positions,
      indices,
      buildEndCapSamples(
        rows,
        options.columnHeights,
        selectedRows[selectedRows.length - 1]!,
        halfWidth,
        lift,
        false,
      ),
      height,
      thickness,
    )
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
    sourceRowCount: rows.length,
    rowCount: selectedRows.length,
    sideCount: 2,
    endCapCount,
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

function createSideWallSegment(
  rows: ReadonlyArray<RoadBandRow>,
  columnHeights: RoadBoundaryCollisionGeometryOptions['columnHeights'],
  selectedRows: ReadonlyArray<number>,
  halfWidth: number,
  lift: number,
  side: -1 | 1,
): WallSegment {
  const points: WallSample[] = []
  let along = 0
  let previousX = 0
  let previousZ = 0
  selectedRows.forEach((rowIndex, index) => {
    const row = rows[rowIndex]!
    const normalX = -Math.sin(row.heading)
    const normalZ = Math.cos(row.heading)
    const nx = normalX * side
    const nz = normalZ * side
    const x = row.x + nx * halfWidth
    const z = row.z + nz * halfWidth
    if (index > 0) {
      along += Math.hypot(x - previousX, z - previousZ)
    }
    previousX = x
    previousZ = z
    points.push(makeWallPoint(
      x,
      z,
      sampleColumns(columnHeights?.[rowIndex], side < 0 ? 0 : 1, row.y) + lift,
      nx,
      nz,
      (along / WALL_NODE_SPACING) * BARRIER_TUNING.uvPerNode,
    ))
  })
  return {
    type: 'barrier',
    side,
    distance: halfWidth * side,
    startAlong: 0,
    endAlong: along,
    points,
  }
}

function createEndCapWallSegment(
  rows: ReadonlyArray<RoadBandRow>,
  columnHeights: RoadBoundaryCollisionGeometryOptions['columnHeights'],
  rowIndex: number,
  halfWidth: number,
  lift: number,
  atStart: boolean,
): WallSegment {
  const row = rows[rowIndex]!
  const normalX = -Math.sin(row.heading)
  const normalZ = Math.cos(row.heading)
  const tangentX = Math.cos(row.heading)
  const tangentZ = Math.sin(row.heading)
  const columns = columnHeights?.[rowIndex] ?? null
  const count = Math.max(3, Math.ceil((halfWidth * 2) / 2) + 1)
  const points: WallSample[] = []
  let previousX = 0
  let previousZ = 0
  let along = 0
  for (let column = 0; column < count; column += 1) {
    const t = column / (count - 1)
    const lateral = (t * 2 - 1) * halfWidth
    const x = row.x + normalX * lateral
    const z = row.z + normalZ * lateral
    if (column > 0) {
      along += Math.hypot(x - previousX, z - previousZ)
    }
    previousX = x
    previousZ = z
    points.push(makeWallPoint(
      x,
      z,
      sampleColumns(columns, t, row.y) + lift,
      atStart ? -tangentX : tangentX,
      atStart ? -tangentZ : tangentZ,
      (along / WALL_NODE_SPACING) * BARRIER_TUNING.uvPerNode,
    ))
  }
  return {
    type: 'barrier',
    side: 1,
    distance: 0,
    startAlong: 0,
    endAlong: along,
    points,
  }
}

/** Seasonal visible barrier segments matching the collision-only boundary. */
export function createRoadBoundaryWallSegments(
  options: Omit<RoadBoundaryCollisionGeometryOptions, 'height' | 'thickness'>,
): WallSegment[] {
  const rows = options.rows
  if (rows.length < 2) {
    return []
  }
  const selectedRows = selectRowIndices(rows, options.rowSpacing ?? ROAD_BOUNDARY_ROW_SPACING)
  if (selectedRows.length < 2) {
    return []
  }
  const halfWidth = Math.max(0.05, options.halfWidth)
  const lift = options.lift ?? 0
  const segments = [
    createSideWallSegment(rows, options.columnHeights, selectedRows, halfWidth, lift, -1),
    createSideWallSegment(rows, options.columnHeights, selectedRows, halfWidth, lift, 1),
  ]
  if (!options.closed) {
    segments.push(
      createEndCapWallSegment(
        rows,
        options.columnHeights,
        selectedRows[0]!,
        halfWidth,
        lift,
        true,
      ),
      createEndCapWallSegment(
        rows,
        options.columnHeights,
        selectedRows[selectedRows.length - 1]!,
        halfWidth,
        lift,
        false,
      ),
    )
  }
  return segments
}
