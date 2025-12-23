import type { SceneNode, GroundDynamicMesh } from '@harmony/schema'
import type { RigidbodyPhysicsShape } from './components'

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

export function computeGroundHeightfieldChunkHash(
  node: SceneNode,
  mesh: GroundDynamicMesh,
  plan: GroundHeightfieldChunkPlan,
  chunkRow: number,
  chunkColumn: number,
): number {
  const heightMap = mesh.heightMap ?? {}
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
    const flippedPhysicsRowVertex = (pointsZ - 1) - physicsRowVertex
    const sourceRow = mapPhysicsVertexToSourceVertex(flippedPhysicsRowVertex, plan.stride, mesh.rows)
    for (let sc = 0; sc <= spec.columns; sc += sampleStepColumn) {
      const physicsColumnVertex = Math.min(pointsX - 1, spec.startColumn + sc)
      const sourceColumn = mapPhysicsVertexToSourceVertex(physicsColumnVertex, plan.stride, mesh.columns)
      const key = `${sourceRow}:${sourceColumn}`
      const rawHeight = heightMap[key]
      const baseHeight = typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : 0
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
  const heightMap = mesh.heightMap ?? {}
  const { scaleY } = resolveNodeScaleVector(node.scale)

  const matrix: number[][] = []
  for (let localColumnVertex = 0; localColumnVertex < pointsX; localColumnVertex += 1) {
    const physicsColumnVertex = spec.startColumn + localColumnVertex
    const sourceColumnVertex = mapPhysicsVertexToSourceVertex(physicsColumnVertex, plan.stride, mesh.columns)

    const columnValues: number[] = []
    for (let localRowVertex = pointsZ - 1; localRowVertex >= 0; localRowVertex -= 1) {
      const physicsRowVertex = spec.startRow + localRowVertex
      const flippedPhysicsRowVertex = (plan.pointsZ - 1) - physicsRowVertex
      const sourceRowVertex = mapPhysicsVertexToSourceVertex(flippedPhysicsRowVertex, plan.stride, mesh.rows)
      const key = `${sourceRowVertex}:${sourceColumnVertex}`
      const rawHeight = heightMap[key]
      const baseHeight = typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : 0
      columnValues.push(baseHeight * scaleY)
    }
    matrix.push(columnValues)
  }

  const offset: [number, number, number] = [
    -plan.halfWidth + spec.startColumn * plan.elementSize,
    -plan.halfDepth + spec.startRow * plan.elementSize,
    0,
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
  const heightMap = mesh.heightMap ?? {}
  const matrix: number[][] = []
  let heightHash = 0

  for (let column = 0; column < pointsX; column += 1) {
    const columnValues: number[] = []

    // Cannon heightfields use the first index for the X axis and the second for Y.
    // Our ground grid increases Z when row increases, so we need to flip the row
    // order to keep the physics heightfield aligned with the rendered geometry.
    for (let row = pointsZ - 1; row >= 0; row -= 1) {
      const key = `${row}:${column}`
      const rawHeight = heightMap[key]
      const baseHeight = typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : 0
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
  const offset: [number, number, number] = [-halfWidth, -halfDepth, 0]
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
  }
}
