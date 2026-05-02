import type { SceneNode, GroundDynamicMesh } from './index'
import type { RigidbodyPhysicsShape } from './components'
import { resolveGroundEffectiveHeightAtVertex, sampleGroundEffectiveHeightRegion } from './groundMesh'

export type GroundHeightfieldData = {
  matrix: number[][]
  elementSize: number
  width: number
  depth: number
  halfWidth: number
  halfDepth: number
  offset: [number, number, number]
  signature: string
}

export type GroundCollisionSegment = {
  key: string
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  stride: number
  rows: number
  columns: number
  matrix: number[][]
  elementSize: number
  width: number
  depth: number
  offset: [number, number, number]
  signature: string
}

export type GroundCollisionData = {
  signature: string
  segments: GroundCollisionSegment[]
}

export type GroundHeightfieldChunkPlan = {
  signature: string
  elementSize: number
  stride: number
  chunkCells: number
  rows: number
  columns: number
  pointsX: number
  pointsZ: number
  width: number
  depth: number
  halfWidth: number
  halfDepth: number
}

export type GroundHeightfieldChunkData = {
  key: string
  chunkRow: number
  chunkColumn: number
  startRow: number
  startColumn: number
  rows: number
  columns: number
  matrix: number[][]
  elementSize: number
  offset: [number, number, number]
}

export type GroundHeightfieldChunkOptions = {
  maxSamplePoints?: number
  maxStride?: number
  minStride?: number
  chunkCells?: number
}

const MIN_ELEMENT_SIZE = 1e-4
const DEFAULT_MAX_SAMPLE_POINTS = 75_000
const DEFAULT_CHUNK_CELLS = 128
const DEFAULT_MIN_STRIDE = 1
const DEFAULT_MAX_STRIDE = 16
const DEFAULT_ADAPTIVE_PLANAR_TOLERANCE = 0.03
const DEFAULT_ADAPTIVE_MAX_SUBDIVISION_DEPTH = 6
const DEFAULT_ADAPTIVE_MAX_PLANAR_STRIDE = 64
const DEFAULT_ADAPTIVE_MIN_COMPLEX_REGION_CELLS = 16
const DEFAULT_ADAPTIVE_MAX_SEGMENTS = 48
const DEFAULT_ADAPTIVE_SMALL_REGION_CELLS = 32

type GroundRegionSample = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  rowSpan: number
  columnSpan: number
  rowStride: number
  valueOffset: number
  values: Float32Array
}

type GroundAdaptiveRegion = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  depth: number
}

type GroundHorizontalMetrics = {
  baseElementSize: number
  halfWidth: number
  halfDepth: number
}

export function isGroundDynamicMesh(value: SceneNode['dynamicMesh'] | null | undefined): value is GroundDynamicMesh {
  return Boolean(value && value.type === 'Ground')
}

function resolveNodeScaleVector(scaleLike: SceneNode['scale'] | null | undefined): {
  scaleX: number
  scaleY: number
  scaleZ: number
} {
  if (!scaleLike || typeof scaleLike !== 'object') {
    return { scaleX: 1, scaleY: 1, scaleZ: 1 }
  }
  const source = scaleLike as Record<'x' | 'y' | 'z', unknown>
  const scaleX = typeof source.x === 'number' && Number.isFinite(source.x) ? source.x : 1
  const scaleY = typeof source.y === 'number' && Number.isFinite(source.y) ? source.y : 1
  const scaleZ = typeof source.z === 'number' && Number.isFinite(source.z) ? source.z : 1
  return { scaleX, scaleY, scaleZ }
}

function getPositiveNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : NaN
  if (numeric > 0) {
    return numeric
  }
  return fallback > 0 ? fallback : 1
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : NaN
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.max(min, Math.min(max, numeric))
}

function resolveStride(rows: number, columns: number, options: GroundHeightfieldChunkOptions = {}): number {
  const maxSamplePoints = typeof options.maxSamplePoints === 'number' && Number.isFinite(options.maxSamplePoints)
    ? Math.max(1, Math.trunc(options.maxSamplePoints))
    : DEFAULT_MAX_SAMPLE_POINTS
  const minStride = clampInt(options.minStride, DEFAULT_MIN_STRIDE, DEFAULT_MAX_STRIDE, DEFAULT_MIN_STRIDE)
  const maxStride = clampInt(options.maxStride, minStride, 64, DEFAULT_MAX_STRIDE)

  for (let stride = minStride; stride <= maxStride; stride += 1) {
    const physicsRows = Math.ceil(rows / stride)
    const physicsColumns = Math.ceil(columns / stride)
    const points = (physicsRows + 1) * (physicsColumns + 1)
    if (points <= maxSamplePoints) {
      return stride
    }
  }
  return maxStride
}

function mapPhysicsVertexToSourceVertex(physicsVertex: number, stride: number, sourceMaxVertex: number): number {
  return Math.min(sourceMaxVertex, Math.max(0, physicsVertex * stride))
}

function groundChunkKey(chunkRow: number, chunkColumn: number): string {
  return `${chunkRow}:${chunkColumn}`
}

function groundRegionKey(startRow: number, endRow: number, startColumn: number, endColumn: number): string {
  return `${startRow}:${endRow}:${startColumn}:${endColumn}`
}

function getRegionSampleHeight(sample: GroundRegionSample, row: number, column: number): number {
  const localRow = row - sample.startRow
  const localColumn = column - sample.startColumn
  if (localRow < 0 || localColumn < 0 || localRow > sample.rowSpan || localColumn > sample.columnSpan) {
    return 0
  }
  return sample.values[sample.valueOffset + localRow * sample.rowStride + localColumn] ?? 0
}

type GroundRegionPlane = {
  h00: number
  slopeX: number
  slopeZ: number
}

function resolveGroundRegionPlane(sample: GroundRegionSample): GroundRegionPlane {
  const rowSpan = Math.max(1, sample.rowSpan)
  const columnSpan = Math.max(1, sample.columnSpan)
  const h00 = getRegionSampleHeight(sample, sample.startRow, sample.startColumn)
  const h10 = getRegionSampleHeight(sample, sample.startRow, sample.endColumn)
  const h01 = getRegionSampleHeight(sample, sample.endRow, sample.startColumn)
  return {
    h00,
    slopeX: (h10 - h00) / columnSpan,
    slopeZ: (h01 - h00) / rowSpan,
  }
}

function sampleResolvedRegionPlaneHeight(
  sample: GroundRegionSample,
  plane: GroundRegionPlane,
  row: number,
  column: number,
): number {
  return plane.h00 + plane.slopeX * (column - sample.startColumn) + plane.slopeZ * (row - sample.startRow)
}

function regionMatchesPlane(sample: GroundRegionSample, tolerance: number): boolean {
  const plane = resolveGroundRegionPlane(sample)
  const cornerPlane = sampleResolvedRegionPlaneHeight(sample, plane, sample.endRow, sample.endColumn)
  const cornerHeight = getRegionSampleHeight(sample, sample.endRow, sample.endColumn)
  if (Math.abs(cornerHeight - cornerPlane) > tolerance) {
    return false
  }

  const probeRows = [
    sample.startRow + Math.floor(sample.rowSpan * 0.5),
    sample.startRow + Math.floor(sample.rowSpan * 0.25),
    sample.startRow + Math.floor(sample.rowSpan * 0.75),
  ]
  const probeColumns = [
    sample.startColumn + Math.floor(sample.columnSpan * 0.5),
    sample.startColumn + Math.floor(sample.columnSpan * 0.25),
    sample.startColumn + Math.floor(sample.columnSpan * 0.75),
  ]

  for (const row of probeRows) {
    if (row <= sample.startRow || row >= sample.endRow) {
      continue
    }
    for (const column of probeColumns) {
      if (column <= sample.startColumn || column >= sample.endColumn) {
        continue
      }
      const actual = getRegionSampleHeight(sample, row, column)
      const expected = sampleResolvedRegionPlaneHeight(sample, plane, row, column)
      if (Math.abs(actual - expected) > tolerance) {
        return false
      }
    }
  }

  for (let row = sample.startRow; row <= sample.endRow; row += 1) {
    let expected = sampleResolvedRegionPlaneHeight(sample, plane, row, sample.startColumn)
    for (let column = sample.startColumn; column <= sample.endColumn; column += 1) {
      const actual = getRegionSampleHeight(sample, row, column)
      if (Math.abs(actual - expected) > tolerance) {
        return false
      }
      expected += plane.slopeX
    }
  }
  return true
}

function findLargestCommonStride(rowSpan: number, columnSpan: number, maxStride: number): number {
  const boundedMaxStride = Math.max(1, Math.min(maxStride, rowSpan, columnSpan))
  for (let stride = boundedMaxStride; stride >= 2; stride -= 1) {
    if (rowSpan % stride === 0 && columnSpan % stride === 0) {
      return stride
    }
  }
  return 1
}

function buildGroundRegionSampleGrid(node: SceneNode, mesh: GroundDynamicMesh): GroundRegionSample {
  const rows = Math.max(1, Number.isFinite(mesh.rows) ? Math.floor(mesh.rows) : 0)
  const columns = Math.max(1, Number.isFinite(mesh.columns) ? Math.floor(mesh.columns) : 0)
  const { scaleY } = resolveNodeScaleVector(node.scale)
  const sample = sampleGroundEffectiveHeightRegion(
    mesh as GroundDynamicMesh & { manualHeightMap: Float64Array; planningHeightMap: Float64Array },
    0,
    rows,
    0,
    columns,
  )
  const values = sample.values

  if (scaleY !== 1) {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = (values[index] ?? 0) * scaleY
    }
  }

  return {
    startRow: sample.minRow,
    endRow: sample.maxRow,
    startColumn: sample.minColumn,
    endColumn: sample.maxColumn,
    rowSpan: Math.max(1, sample.maxRow - sample.minRow),
    columnSpan: Math.max(1, sample.maxColumn - sample.minColumn),
    rowStride: sample.stride,
    valueOffset: 0,
    values,
  }
}

function createGroundRegionSample(parent: GroundRegionSample, region: GroundAdaptiveRegion): GroundRegionSample {
  return {
    startRow: region.startRow,
    endRow: region.endRow,
    startColumn: region.startColumn,
    endColumn: region.endColumn,
    rowSpan: Math.max(1, region.endRow - region.startRow),
    columnSpan: Math.max(1, region.endColumn - region.startColumn),
    rowStride: parent.rowStride,
    valueOffset: parent.valueOffset
      + (region.startRow - parent.startRow) * parent.rowStride
      + (region.startColumn - parent.startColumn),
    values: parent.values,
  }
}

function resolveGroundHorizontalMetrics(node: SceneNode, mesh: GroundDynamicMesh): GroundHorizontalMetrics {
  const rawCellSize = getPositiveNumber(mesh.cellSize, 1)
  const { scaleX, scaleZ } = resolveNodeScaleVector(node.scale)
  const uniformHorizontalScale = Math.max(MIN_ELEMENT_SIZE, (Math.abs(scaleX) + Math.abs(scaleZ)) * 0.5)
  const baseElementSize = Math.max(MIN_ELEMENT_SIZE, rawCellSize * uniformHorizontalScale)
  const halfWidth = Math.max(MIN_ELEMENT_SIZE, Math.max(1, Math.floor(mesh.columns)) * baseElementSize) * 0.5
  const halfDepth = Math.max(MIN_ELEMENT_SIZE, Math.max(1, Math.floor(mesh.rows)) * baseElementSize) * 0.5
  return { baseElementSize, halfWidth, halfDepth }
}

function buildGroundCollisionSegment(
  sample: GroundRegionSample,
  stride: number,
  metrics: GroundHorizontalMetrics,
): GroundCollisionSegment {
  const safeStride = Math.max(1, stride)
  const rows = Math.max(1, Math.floor(sample.rowSpan / safeStride))
  const columns = Math.max(1, Math.floor(sample.columnSpan / safeStride))
  const elementSize = Math.max(MIN_ELEMENT_SIZE, metrics.baseElementSize * safeStride)
  const matrix: number[][] = []
  let hash = 0

  for (let localColumn = 0; localColumn <= columns; localColumn += 1) {
    const sourceColumn = sample.startColumn + localColumn * safeStride
    const columnValues: number[] = []
    for (let localRow = 0; localRow <= rows; localRow += 1) {
      const sourceRow = sample.startRow + localRow * safeStride
      const height = getRegionSampleHeight(sample, sourceRow, sourceColumn)
      columnValues.push(height)
      const normalized = Math.round(height * 1000)
      hash = (hash * 31 + normalized) >>> 0
    }
    matrix.push(columnValues)
  }

  const width = Math.max(MIN_ELEMENT_SIZE, sample.columnSpan * metrics.baseElementSize)
  const depth = Math.max(MIN_ELEMENT_SIZE, sample.rowSpan * metrics.baseElementSize)
  const offset: [number, number, number] = [
    -metrics.halfWidth + sample.startColumn * metrics.baseElementSize,
    0,
    -metrics.halfDepth + sample.startRow * metrics.baseElementSize,
  ]
  const key = groundRegionKey(sample.startRow, sample.endRow, sample.startColumn, sample.endColumn)
  const signature = `${key}|${safeStride}|${rows}|${columns}|${Math.round(width * 1000)}|${Math.round(depth * 1000)}|${hash.toString(16)}`

  return {
    key,
    startRow: sample.startRow,
    endRow: sample.endRow,
    startColumn: sample.startColumn,
    endColumn: sample.endColumn,
    stride: safeStride,
    rows,
    columns,
    matrix,
    elementSize,
    width,
    depth,
    offset,
    signature,
  }
}

function pushAdaptiveGroundCollisionSegments(
  sample: GroundRegionSample,
  depth: number,
  metrics: GroundHorizontalMetrics,
  segments: GroundCollisionSegment[],
): void {
  const isPlanar = regionMatchesPlane(sample, DEFAULT_ADAPTIVE_PLANAR_TOLERANCE)
  const bestPlanarStride = findLargestCommonStride(sample.rowSpan, sample.columnSpan, DEFAULT_ADAPTIVE_MAX_PLANAR_STRIDE)
  const isSmallRegion = sample.rowSpan <= DEFAULT_ADAPTIVE_SMALL_REGION_CELLS && sample.columnSpan <= DEFAULT_ADAPTIVE_SMALL_REGION_CELLS
  const shouldStop = depth >= DEFAULT_ADAPTIVE_MAX_SUBDIVISION_DEPTH
    || segments.length >= DEFAULT_ADAPTIVE_MAX_SEGMENTS - 1
    || (sample.rowSpan <= DEFAULT_ADAPTIVE_MIN_COMPLEX_REGION_CELLS && sample.columnSpan <= DEFAULT_ADAPTIVE_MIN_COMPLEX_REGION_CELLS)

  if (isPlanar && (bestPlanarStride > 1 || isSmallRegion || shouldStop)) {
    segments.push(buildGroundCollisionSegment(sample, bestPlanarStride, metrics))
    return
  }

  if (shouldStop || (sample.rowSpan <= 1 && sample.columnSpan <= 1)) {
    segments.push(buildGroundCollisionSegment(sample, 1, metrics))
    return
  }

  if (sample.rowSpan >= sample.columnSpan && sample.rowSpan > 1) {
    const middleRow = sample.startRow + Math.floor(sample.rowSpan * 0.5)
    pushAdaptiveGroundCollisionSegments(createGroundRegionSample(sample, {
      startRow: sample.startRow,
      endRow: middleRow,
      startColumn: sample.startColumn,
      endColumn: sample.endColumn,
      depth: depth + 1,
    }), depth + 1, metrics, segments)
    pushAdaptiveGroundCollisionSegments(createGroundRegionSample(sample, {
      startRow: middleRow,
      endRow: sample.endRow,
      startColumn: sample.startColumn,
      endColumn: sample.endColumn,
      depth: depth + 1,
    }), depth + 1, metrics, segments)
    return
  }

  if (sample.columnSpan > 1) {
    const middleColumn = sample.startColumn + Math.floor(sample.columnSpan * 0.5)
    pushAdaptiveGroundCollisionSegments(createGroundRegionSample(sample, {
      startRow: sample.startRow,
      endRow: sample.endRow,
      startColumn: sample.startColumn,
      endColumn: middleColumn,
      depth: depth + 1,
    }), depth + 1, metrics, segments)
    pushAdaptiveGroundCollisionSegments(createGroundRegionSample(sample, {
      startRow: sample.startRow,
      endRow: sample.endRow,
      startColumn: middleColumn,
      endColumn: sample.endColumn,
      depth: depth + 1,
    }), depth + 1, metrics, segments)
    return
  }

  segments.push(buildGroundCollisionSegment(sample, 1, metrics))
}

export function buildAdaptiveGroundCollisionData(
  node: SceneNode,
  mesh: GroundDynamicMesh,
): GroundCollisionData | null {
  const rawRows = Number.isFinite(mesh.rows) ? Math.floor(mesh.rows) : 0
  const rawColumns = Number.isFinite(mesh.columns) ? Math.floor(mesh.columns) : 0
  const rows = Math.max(1, rawRows)
  const columns = Math.max(1, rawColumns)
  if (rows <= 0 || columns <= 0) {
    return null
  }

  const metrics = resolveGroundHorizontalMetrics(node, mesh)
  const segments: GroundCollisionSegment[] = []
  const rootSample = buildGroundRegionSampleGrid(node, mesh)
  pushAdaptiveGroundCollisionSegments(rootSample, 0, metrics, segments)

  if (!segments.length) {
    return null
  }

  const signature = segments.map((segment) => segment.signature).join('||')
  return { signature, segments }
}

function computeChunkSpec(rows: number, columns: number, chunkRow: number, chunkColumn: number, chunkCells: number): {
  startRow: number
  startColumn: number
  rows: number
  columns: number
} {
  const startRow = chunkRow * chunkCells
  const startColumn = chunkColumn * chunkCells
  const rowsRemaining = rows - startRow
  const columnsRemaining = columns - startColumn
  const chunkRows = Math.max(1, Math.min(chunkCells, rowsRemaining))
  const chunkColumns = Math.max(1, Math.min(chunkCells, columnsRemaining))
  return { startRow, startColumn, rows: chunkRows, columns: chunkColumns }
}

export function buildGroundCollisionDebugShapesFromNode(
  node: SceneNode,
): Array<Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>> {
  if (!isGroundDynamicMesh(node.dynamicMesh)) {
    return []
  }
  const data = buildAdaptiveGroundCollisionData(node, node.dynamicMesh)
  if (!data) {
    return []
  }
  return data.segments.map((segment) => ({
    kind: 'heightfield',
    matrix: segment.matrix,
    elementSize: segment.elementSize,
    width: segment.width,
    depth: segment.depth,
    offset: segment.offset,
    applyScale: false,
  }))
}

export function computeGroundHeightfieldChunkHash(
  node: SceneNode,
  mesh: GroundDynamicMesh,
  plan: GroundHeightfieldChunkPlan,
  chunkRow: number,
  chunkColumn: number,
): number {
  const { scaleY } = resolveNodeScaleVector(node.scale)
  const pointsX = plan.columns + 1
  const pointsZ = plan.rows + 1
  const spec = computeChunkSpec(plan.rows, plan.columns, chunkRow, chunkColumn, plan.chunkCells)

  // Sample a small fixed grid inside the chunk to detect edits cheaply.
  const sampleCount = 4
  const sampleStepRow = Math.max(1, Math.floor(spec.rows / sampleCount))
  const sampleStepColumn = Math.max(1, Math.floor(spec.columns / sampleCount))
  let hash = 0

  for (let sr = 0; sr <= spec.rows; sr += sampleStepRow) {
    const physicsRowVertex = Math.min(pointsZ - 1, spec.startRow + sr)
    const sourceRow = mapPhysicsVertexToSourceVertex(physicsRowVertex, plan.stride, mesh.rows)
    for (let sc = 0; sc <= spec.columns; sc += sampleStepColumn) {
      const physicsColumnVertex = Math.min(pointsX - 1, spec.startColumn + sc)
      const sourceColumn = mapPhysicsVertexToSourceVertex(physicsColumnVertex, plan.stride, mesh.columns)
      const baseHeight = resolveGroundEffectiveHeightAtVertex(mesh, sourceRow, sourceColumn)
      const height = baseHeight * scaleY
      const normalized = Math.round(height * 1000)
      hash = (hash * 31 + normalized) >>> 0
    }
  }

  return hash
}

export function buildGroundHeightfieldChunkPlan(
  node: SceneNode,
  mesh: GroundDynamicMesh,
  options: GroundHeightfieldChunkOptions = {},
): GroundHeightfieldChunkPlan | null {
  const rawRows = Number.isFinite(mesh.rows) ? Math.floor(mesh.rows) : 0
  const rawColumns = Number.isFinite(mesh.columns) ? Math.floor(mesh.columns) : 0
  const sourceRows = Math.max(1, rawRows)
  const sourceColumns = Math.max(1, rawColumns)

  const stride = resolveStride(sourceRows, sourceColumns, options)
  const rows = Math.max(1, Math.ceil(sourceRows / stride))
  const columns = Math.max(1, Math.ceil(sourceColumns / stride))
  const pointsX = columns + 1
  const pointsZ = rows + 1
  if (pointsX <= 1 || pointsZ <= 1) {
    return null
  }

  const rawCellSize = getPositiveNumber(mesh.cellSize, 1)
  const { scaleX, scaleZ } = resolveNodeScaleVector(node.scale)
  const uniformHorizontalScale = Math.max(MIN_ELEMENT_SIZE, (Math.abs(scaleX) + Math.abs(scaleZ)) * 0.5)
  const elementSize = Math.max(MIN_ELEMENT_SIZE, rawCellSize * uniformHorizontalScale * stride)

  const width = Math.max(MIN_ELEMENT_SIZE, columns * elementSize)
  const depth = Math.max(MIN_ELEMENT_SIZE, rows * elementSize)
  const halfWidth = Math.max(0, width * 0.5)
  const halfDepth = Math.max(0, depth * 0.5)

  const chunkCells = clampInt(options.chunkCells, 8, 512, DEFAULT_CHUNK_CELLS)
  const signature = `${columns}|${rows}|${stride}|${chunkCells}|${Math.round(rawCellSize * 1000)}|${Math.round(width * 1000)}|${Math.round(depth * 1000)}`

  return {
    signature,
    elementSize,
    stride,
    chunkCells,
    rows,
    columns,
    pointsX,
    pointsZ,
    width,
    depth,
    halfWidth,
    halfDepth,
  }
}

export function buildGroundHeightfieldChunkData(
  node: SceneNode,
  mesh: GroundDynamicMesh,
  plan: GroundHeightfieldChunkPlan,
  chunkRow: number,
  chunkColumn: number,
): GroundHeightfieldChunkData | null {
  const rows = plan.rows
  const columns = plan.columns
  if (rows <= 0 || columns <= 0) {
    return null
  }
  const maxChunkRowIndex = Math.max(0, Math.floor((rows - 1) / plan.chunkCells))
  const maxChunkColumnIndex = Math.max(0, Math.floor((columns - 1) / plan.chunkCells))
  if (chunkRow < 0 || chunkRow > maxChunkRowIndex || chunkColumn < 0 || chunkColumn > maxChunkColumnIndex) {
    return null
  }

  const spec = computeChunkSpec(rows, columns, chunkRow, chunkColumn, plan.chunkCells)
  const pointsX = spec.columns + 1
  const pointsZ = spec.rows + 1
  const { scaleY } = resolveNodeScaleVector(node.scale)

  const matrix: number[][] = []
  for (let localColumnVertex = 0; localColumnVertex < pointsX; localColumnVertex += 1) {
    const physicsColumnVertex = spec.startColumn + localColumnVertex
    const sourceColumnVertex = mapPhysicsVertexToSourceVertex(physicsColumnVertex, plan.stride, mesh.columns)

    const columnValues: number[] = []
    for (let localRowVertex = 0; localRowVertex < pointsZ; localRowVertex += 1) {
      const physicsRowVertex = spec.startRow + localRowVertex
      const sourceRowVertex = mapPhysicsVertexToSourceVertex(physicsRowVertex, plan.stride, mesh.rows)
      const baseHeight = resolveGroundEffectiveHeightAtVertex(mesh, sourceRowVertex, sourceColumnVertex)
      columnValues.push(baseHeight * scaleY)
    }
    matrix.push(columnValues)
  }

  const offset: [number, number, number] = [
    -plan.halfWidth + spec.startColumn * plan.elementSize,
    0,
    -plan.halfDepth + spec.startRow * plan.elementSize,
  ]

  return {
    key: groundChunkKey(chunkRow, chunkColumn),
    chunkRow,
    chunkColumn,
    startRow: spec.startRow,
    startColumn: spec.startColumn,
    rows: spec.rows,
    columns: spec.columns,
    matrix,
    elementSize: plan.elementSize,
    offset,
  }
}

export function buildGroundHeightfieldData(
  node: SceneNode,
  mesh: GroundDynamicMesh,
): GroundHeightfieldData | null {
  const rawRows = Number.isFinite(mesh.rows) ? Math.floor(mesh.rows) : 0
  const rawColumns = Number.isFinite(mesh.columns) ? Math.floor(mesh.columns) : 0
  const rows = Math.max(1, rawRows)
  const columns = Math.max(1, rawColumns)
  const pointsX = columns + 1
  const pointsZ = rows + 1
  if (pointsX <= 1 || pointsZ <= 1) {
    return null
  }

  const rawCellSize = getPositiveNumber(mesh.cellSize, 1)
  const { scaleX, scaleY, scaleZ } = resolveNodeScaleVector(node.scale)
  const uniformHorizontalScale = Math.max(MIN_ELEMENT_SIZE, (Math.abs(scaleX) + Math.abs(scaleZ)) * 0.5)
  const elementSize = Math.max(MIN_ELEMENT_SIZE, rawCellSize * uniformHorizontalScale)
  const matrix: number[][] = []
  let heightHash = 0

  for (let column = 0; column < pointsX; column += 1) {
    const columnValues: number[] = []

    for (let row = 0; row < pointsZ; row += 1) {
      const baseHeight = resolveGroundEffectiveHeightAtVertex(mesh, row, column)
      const height = baseHeight * scaleY
      columnValues.push(height)
      const normalized = Math.round(height * 1000)
      heightHash = (heightHash * 31 + normalized) >>> 0
    }

    matrix.push(columnValues)
  }

  const width = Math.max(MIN_ELEMENT_SIZE, columns * elementSize)
  const depth = Math.max(MIN_ELEMENT_SIZE, rows * elementSize)
  const halfWidth = Math.max(0, width * 0.5)
  const halfDepth = Math.max(0, depth * 0.5)
  const offset: [number, number, number] = [-halfWidth, 0, -halfDepth]
  const signature = `${columns}|${rows}|${Math.round(rawCellSize * 1000)}|${Math.round(width * 1000)}|${Math.round(depth * 1000)}|${heightHash.toString(16)}`

  return {
    matrix,
    elementSize,
    width,
    depth,
    halfWidth,
    halfDepth,
    offset,
    signature,
  }
}

export function buildHeightfieldShapeFromGroundNode(node: SceneNode): RigidbodyPhysicsShape | null {
  if (!isGroundDynamicMesh(node.dynamicMesh)) {
    return null
  }
  const data = buildGroundHeightfieldData(node, node.dynamicMesh)
  if (!data) {
    return null
  }
  return {
    kind: 'heightfield',
    matrix: data.matrix,
    elementSize: data.elementSize,
    width: data.width,
    depth: data.depth,
    offset: data.offset,
    applyScale: false,
  }
}
