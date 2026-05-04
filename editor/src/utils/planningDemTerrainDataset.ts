import type { GroundRuntimeDynamicMesh, QuantizedTerrainDatasetBounds, QuantizedTerrainDatasetRootManifest, QuantizedTerrainDatasetTileRef, QuantizedTerrainMeshData, QuantizedTerrainMeshHeader, QuantizedTerrainMeshTileId } from '@schema'
import {
  buildQuantizedTerrainRegionPackPath,
  formatQuantizedTerrainRegionKey,
  formatQuantizedTerrainTileKey,
  getQuantizedTerrainChildMask,
  resolveQuantizedTerrainRegionIdForTile,
  resolveQuantizedTerrainTileBounds,
  serializeQuantizedTerrainMesh,
  serializeQuantizedTerrainPack,
  type QuantizedTerrainDatasetRegionPackIndex,
} from '@schema'
import type { PlanningTerrainDemData } from '@/types/planning-scene-data'
import {
  buildPlanningDemRegionFromPreparedSource,
  resolvePlanningDemTargetWorldBounds,
  resolvePlanningDemPreparedSource,
  resolvePlanningDemOrthophotoTexture,
  type PlanningDemBuildProgress,
  type PlanningDemPreparedSource,
  type PlanningDemRegionConversionResult,
  type PlanningDemRasterSource,
} from '@/utils/planningDemToGround'
import { samplePlanningDemHeightGridFromWorldBounds } from '@/wasm/planningDemSampling'
import { loadPlanningDemBlobByHash } from '@/utils/planningDemStorage'
import { isPlanningDemGeoTiffSource, openPlanningDemWindowedGeoTiffSource } from '@/utils/planningDemImport'

export interface PlanningDemTerrainDatasetBuildOptions {
  definition: GroundRuntimeDynamicMesh
  terrainDem: PlanningTerrainDemData
  datasetId?: string
  leafTileSegments?: number
  regionLevel?: number | null
  preparedSource?: PlanningDemPreparedSource
}

export interface PlanningDemTerrainDatasetBuildResult {
  manifest: QuantizedTerrainDatasetRootManifest
  regionPacks: Record<string, ArrayBuffer>
}

export interface PlanningDemTerrainConversionBuildOptions extends PlanningDemTerrainDatasetBuildOptions {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  applyOrthophoto?: boolean
  onProgress?: (payload: PlanningDemBuildProgress) => void
}

export interface PlanningDemTerrainConversionBuildResult {
  demResult: PlanningDemRegionConversionResult
  dataset: PlanningDemTerrainDatasetBuildResult
}

export type PlanningDemTerrainDatasetWorkerRequest = {
  kind: 'build-planning-dem-terrain-dataset'
  requestId: number
  options: PlanningDemTerrainDatasetBuildOptions
}

export type PlanningDemTerrainConversionWorkerRequest = {
  kind: 'build-planning-dem-terrain-conversion'
  requestId: number
  options: Omit<PlanningDemTerrainConversionBuildOptions, 'onProgress'>
}

export type PlanningDemTerrainDatasetWorkerResponse = {
  kind: 'build-planning-dem-terrain-dataset-result'
  requestId: number
  result: PlanningDemTerrainDatasetBuildResult | null
  error?: string
}

export type PlanningDemTerrainConversionWorkerResponse = {
  kind: 'build-planning-dem-terrain-conversion-result'
  requestId: number
  result: PlanningDemTerrainConversionBuildResult | null
  error?: string
}

export type PlanningDemTerrainConversionWorkerProgressResponse = {
  kind: 'build-planning-dem-terrain-conversion-progress'
  requestId: number
  progress: PlanningDemBuildProgress
}

type TileBuildRecord = {
  tileId: QuantizedTerrainMeshTileId
  tileKey: string
  tileRef: QuantizedTerrainDatasetTileRef
  regionKey: string
  regionPath: string
  serializedMesh: ArrayBuffer
}

const DEFAULT_LEAF_TILE_SEGMENTS = 64
const MIN_TILE_SEGMENTS = 8
const MAX_TILE_SEGMENTS = 128

let planningDemTerrainDatasetWorker: Worker | null = null
let planningDemTerrainDatasetRequestId = 0
const pendingPlanningDemTerrainDatasetRequests = new Map<
  number,
  {
    resolve: (response: PlanningDemTerrainDatasetWorkerResponse | PlanningDemTerrainConversionWorkerResponse) => void
    reject: (error: Error) => void
    onProgress?: (payload: PlanningDemBuildProgress) => void
  }
>()

type RasterSourceMetrics = {
  width: number
  height: number
  targetWorldBounds: {
    minX: number
    minZ: number
    maxX: number
    maxZ: number
  }
  sampleStepX: number
  sampleStepZ: number
}

type TileHeightField = {
  rows: number
  columns: number
  heights: Float64Array
  minHeight: number
  maxHeight: number
  sourceStepX: number
  sourceStepZ: number
}

function clampFiniteInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.trunc(numeric)))
}

function resolveDatasetBounds(prepared: PlanningDemPreparedSource): QuantizedTerrainDatasetBounds {
  const sourceBounds = prepared.rasterSource.targetWorldBounds
  const minHeight = Number.isFinite(prepared.parsed.minElevation) ? Number(prepared.parsed.minElevation) : 0
  const maxHeight = Number.isFinite(prepared.parsed.maxElevation) ? Number(prepared.parsed.maxElevation) : minHeight
  return {
    minX: sourceBounds.minX,
    minY: Math.min(minHeight, maxHeight),
    minZ: sourceBounds.minZ,
    maxX: sourceBounds.maxX,
    maxY: Math.max(minHeight, maxHeight),
    maxZ: sourceBounds.maxZ,
  }
}

function resolveLeafTileLevel(source: Pick<RasterSourceMetrics, 'width' | 'height'>, leafTileSegments: number): number {
  const sourceSegmentsX = Math.max(1, source.width - 1)
  const sourceSegmentsZ = Math.max(1, source.height - 1)
  const tilesX = Math.max(1, Math.ceil(sourceSegmentsX / Math.max(1, leafTileSegments)))
  const tilesZ = Math.max(1, Math.ceil(sourceSegmentsZ / Math.max(1, leafTileSegments)))
  const tilesPerAxis = Math.max(tilesX, tilesZ)
  return Math.max(0, Math.ceil(Math.log2(tilesPerAxis)))
}

function buildHighWaterMarkGridVertexLayout(rows: number, columns: number): {
  indexByRowColumn: number[][]
  vertices: Array<{ row: number; column: number }>
} {
  const indexByRowColumn = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1))
  const vertices: Array<{ row: number; column: number }> = []
  const addVertex = (row: number, column: number): void => {
    indexByRowColumn[row]![column] = vertices.length
    vertices.push({ row, column })
  }

  addVertex(0, 0)
  if (columns >= 1) {
    addVertex(0, 1)
    addVertex(1, 0)
    addVertex(1, 1)
    for (let column = 2; column <= columns; column += 1) {
      addVertex(0, column)
      addVertex(1, column)
    }
  }
  for (let row = 2; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      addVertex(row, column)
    }
  }

  return { indexByRowColumn, vertices }
}

function buildRegularGridIndices(indexByRowColumn: number[][], rows: number, columns: number): Uint32Array {
  const indices = new Uint32Array(rows * columns * 6)
  let cursor = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = indexByRowColumn[row]![column]!
      const topRight = indexByRowColumn[row]![column + 1]!
      const bottomLeft = indexByRowColumn[row + 1]![column]!
      const bottomRight = indexByRowColumn[row + 1]![column + 1]!
      indices[cursor++] = topLeft
      indices[cursor++] = topRight
      indices[cursor++] = bottomLeft
      indices[cursor++] = topRight
      indices[cursor++] = bottomRight
      indices[cursor++] = bottomLeft
    }
  }
  return indices
}

function buildEdgeIndices(indexByRowColumn: number[][], rows: number, columns: number): {
  west: Uint32Array
  south: Uint32Array
  east: Uint32Array
  north: Uint32Array
} {
  const west = new Uint32Array(rows + 1)
  const south = new Uint32Array(columns + 1)
  const east = new Uint32Array(rows + 1)
  const north = new Uint32Array(columns + 1)
  for (let row = 0; row <= rows; row += 1) {
    west[row] = indexByRowColumn[row]![0]!
    east[row] = indexByRowColumn[row]![columns]!
  }
  for (let column = 0; column <= columns; column += 1) {
    south[column] = indexByRowColumn[0]![column]!
    north[column] = indexByRowColumn[rows]![column]!
  }
  return { west, south, east, north }
}

function computeBoundingSphere(
  bounds: QuantizedTerrainDatasetBounds,
  heights: Float64Array,
  rows: number,
  columns: number,
): { center: { x: number; y: number; z: number }; radius: number } {
  const center = {
    x: (bounds.minX + bounds.maxX) * 0.5,
    y: (bounds.minY + bounds.maxY) * 0.5,
    z: (bounds.minZ + bounds.maxZ) * 0.5,
  }
  let radiusSq = 0
  const width = Math.max(0, bounds.maxX - bounds.minX)
  const depth = Math.max(0, bounds.maxZ - bounds.minZ)
  for (let row = 0; row <= rows; row += 1) {
    const z = bounds.minZ + (depth * row) / Math.max(1, rows)
    for (let column = 0; column <= columns; column += 1) {
      const x = bounds.minX + (width * column) / Math.max(1, columns)
      const y = heights[row * (columns + 1) + column] ?? center.y
      const dx = x - center.x
      const dy = y - center.y
      const dz = z - center.z
      radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz)
    }
  }
  return {
    center,
    radius: Math.sqrt(radiusSq),
  }
}

function sampleTileHeightField(tileField: TileHeightField, u: number, v: number): number {
  const clampedU = Math.min(1, Math.max(0, u))
  const clampedV = Math.min(1, Math.max(0, v))
  const x = clampedU * tileField.columns
  const y = clampedV * tileField.rows
  const column0 = Math.max(0, Math.min(tileField.columns, Math.floor(x)))
  const row0 = Math.max(0, Math.min(tileField.rows, Math.floor(y)))
  const column1 = Math.min(tileField.columns, column0 + 1)
  const row1 = Math.min(tileField.rows, row0 + 1)
  const tx = Math.min(1, Math.max(0, x - column0))
  const ty = Math.min(1, Math.max(0, y - row0))
  const index = (row: number, column: number) => row * (tileField.columns + 1) + column
  const h00 = tileField.heights[index(row0, column0)] ?? tileField.minHeight
  const h10 = tileField.heights[index(row0, column1)] ?? tileField.minHeight
  const h01 = tileField.heights[index(row1, column0)] ?? tileField.minHeight
  const h11 = tileField.heights[index(row1, column1)] ?? tileField.minHeight
  const hx0 = h00 + (h10 - h00) * tx
  const hx1 = h01 + (h11 - h01) * tx
  return hx0 + (hx1 - hx0) * ty
}

function buildParentHeightFieldFromChildren(children: [TileHeightField, TileHeightField, TileHeightField, TileHeightField]): TileHeightField {
  const template = children[0]
  const rows = template.rows
  const columns = template.columns
  const heights = new Float64Array((rows + 1) * (columns + 1))
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY

  for (let row = 0; row <= rows; row += 1) {
    const v = row / Math.max(1, rows)
    const childRowIndex = v >= 0.5 ? 1 : 0
    const childV = childRowIndex === 0 ? v * 2 : (v - 0.5) * 2
    for (let column = 0; column <= columns; column += 1) {
      const u = column / Math.max(1, columns)
      const childColumnIndex = u >= 0.5 ? 1 : 0
      const childU = childColumnIndex === 0 ? u * 2 : (u - 0.5) * 2
      const childIndex = childRowIndex * 2 + childColumnIndex
      const child = children[childIndex]!
      const height = sampleTileHeightField(child, childU, childV)
      heights[row * (columns + 1) + column] = height
      minHeight = Math.min(minHeight, height)
      maxHeight = Math.max(maxHeight, height)
    }
  }

  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    minHeight = 0
    maxHeight = 0
  }

  return {
    rows,
    columns,
    heights,
    minHeight,
    maxHeight,
    sourceStepX: template.sourceStepX * 2,
    sourceStepZ: template.sourceStepZ * 2,
  }
}

function buildTileMeshFromHeightField(options: {
  tileField: TileHeightField
  worldBounds: QuantizedTerrainDatasetBounds
  tileId: QuantizedTerrainMeshTileId
  maxLevel: number
}): { data: QuantizedTerrainMeshData; ref: QuantizedTerrainDatasetTileRef } {
  const { tileField, worldBounds, tileId, maxLevel } = options
  const shift = Math.max(0, maxLevel - tileId.level)
  const sourceStepX = Math.max(Number.EPSILON, tileField.sourceStepX)
  const sourceStepZ = Math.max(Number.EPSILON, tileField.sourceStepZ)
  const tileBounds = resolveQuantizedTerrainTileBounds(tileId, worldBounds, worldBounds.minY, worldBounds.maxY)
  const { rows, columns, heights, minHeight, maxHeight } = tileField
  const vertexCount = (rows + 1) * (columns + 1)
  const { indexByRowColumn, vertices } = buildHighWaterMarkGridVertexLayout(rows, columns)

  const u = new Uint16Array(vertexCount)
  const v = new Uint16Array(vertexCount)
  const heightValues = new Uint16Array(vertexCount)
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index]!
    const sourceIndex = vertex.row * (columns + 1) + vertex.column
    u[index] = Math.round((vertex.column / columns) * 32767)
    v[index] = Math.round((vertex.row / rows) * 32767)
    const normalizedHeight = maxHeight - minHeight <= Number.EPSILON
      ? 0
      : ((heights[sourceIndex]! - minHeight) / (maxHeight - minHeight)) * 32767
    heightValues[index] = Math.max(0, Math.min(32767, Math.round(normalizedHeight)))
  }

  const edgeIndices = buildEdgeIndices(indexByRowColumn, rows, columns)
  const indices = buildRegularGridIndices(indexByRowColumn, rows, columns)
  const boundingSphere = computeBoundingSphere({ ...tileBounds, minY: minHeight, maxY: maxHeight }, heights, rows, columns)
  const geometricError = Math.max(sourceStepX, sourceStepZ) * (2 ** shift)

  const header: QuantizedTerrainMeshHeader = {
    format: 'harmony-quantized-terrain-mesh',
    version: 1,
    tileId,
    bounds: {
      minX: tileBounds.minX,
      minZ: tileBounds.minZ,
      maxX: tileBounds.maxX,
      maxZ: tileBounds.maxZ,
    },
    center: boundingSphere.center,
    minHeight,
    maxHeight,
    boundingSphere,
    horizonOcclusionPoint: null,
    geometricError,
    skirtHeight: Math.max(sourceStepX, sourceStepZ),
    vertexCount,
    triangleCount: indices.length / 3,
    hasVertexNormals: false,
    extensions: [],
  }

  const tileKey = formatQuantizedTerrainTileKey(tileId.level, tileId.x, tileId.y)
  const childMask = tileId.level < maxLevel
    ? getQuantizedTerrainChildMask([
        { level: tileId.level + 1, x: tileId.x * 2, y: tileId.y * 2 },
        { level: tileId.level + 1, x: tileId.x * 2 + 1, y: tileId.y * 2 },
        { level: tileId.level + 1, x: tileId.x * 2, y: tileId.y * 2 + 1 },
        { level: tileId.level + 1, x: tileId.x * 2 + 1, y: tileId.y * 2 + 1 },
      ], [
        formatQuantizedTerrainTileKey(tileId.level + 1, tileId.x * 2, tileId.y * 2),
        formatQuantizedTerrainTileKey(tileId.level + 1, tileId.x * 2 + 1, tileId.y * 2),
        formatQuantizedTerrainTileKey(tileId.level + 1, tileId.x * 2, tileId.y * 2 + 1),
        formatQuantizedTerrainTileKey(tileId.level + 1, tileId.x * 2 + 1, tileId.y * 2 + 1),
      ])
    : 0

  const data: QuantizedTerrainMeshData = {
    header,
    u,
    v,
    height: heightValues,
    indices,
    westIndices: edgeIndices.west,
    southIndices: edgeIndices.south,
    eastIndices: edgeIndices.east,
    northIndices: edgeIndices.north,
    octEncodedNormals: null,
  }

  return {
    data,
    ref: {
      tileKey,
      tileId,
      geometricError,
      minHeight,
      maxHeight,
      byteOffset: 0,
      byteLength: 0,
      bounds: {
        minX: tileBounds.minX,
        minY: minHeight,
        minZ: tileBounds.minZ,
        maxX: tileBounds.maxX,
        maxY: maxHeight,
        maxZ: tileBounds.maxZ,
      },
      boundingSphere: {
        centerX: boundingSphere.center.x,
        centerY: boundingSphere.center.y,
        centerZ: boundingSphere.center.z,
        radius: boundingSphere.radius,
      },
      hasNormals: false,
      hasWatermask: false,
      hasOverlay: false,
      childMask,
    },
  }
}

function buildTileHeightFieldFromRasterSource(options: {
  source: PlanningDemRasterSource
  worldBounds: QuantizedTerrainDatasetBounds
  tileId: QuantizedTerrainMeshTileId
  maxLevel: number
}): TileHeightField {
  const { source, worldBounds, tileId, maxLevel } = options
  const shift = Math.max(0, maxLevel - tileId.level)
  const sourceStepX = Math.max(Number.EPSILON, source.sampleStepX * (2 ** shift))
  const sourceStepZ = Math.max(Number.EPSILON, source.sampleStepZ * (2 ** shift))
  const tileBounds = resolveQuantizedTerrainTileBounds(tileId, worldBounds, worldBounds.minY, worldBounds.maxY)
  const columns = Math.max(1, Math.ceil(Math.max(Number.EPSILON, tileBounds.maxX - tileBounds.minX) / sourceStepX))
  const rows = Math.max(1, Math.ceil(Math.max(Number.EPSILON, tileBounds.maxZ - tileBounds.minZ) / sourceStepZ))
  const heights = samplePlanningDemHeightGridFromWorldBounds({
    source,
    startX: tileBounds.minX,
    startZ: tileBounds.minZ,
    endX: tileBounds.maxX,
    endZ: tileBounds.maxZ,
    rows,
    columns,
  })
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  for (const height of heights) {
    minHeight = Math.min(minHeight, height)
    maxHeight = Math.max(maxHeight, height)
  }
  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    minHeight = 0
    maxHeight = 0
  }
  return { rows, columns, heights, minHeight, maxHeight, sourceStepX, sourceStepZ }
}

async function buildTileHeightFieldFromWindowedGeoTiff(options: {
  source: RasterSourceMetrics
  windowedSource: NonNullable<Awaited<ReturnType<typeof openPlanningDemWindowedGeoTiffSource>>>
  worldBounds: QuantizedTerrainDatasetBounds
  tileId: QuantizedTerrainMeshTileId
  maxLevel: number
}): Promise<TileHeightField> {
  const { source, windowedSource, worldBounds, tileId, maxLevel } = options
  const shift = Math.max(0, maxLevel - tileId.level)
  const sourceStepX = Math.max(Number.EPSILON, source.sampleStepX * (2 ** shift))
  const sourceStepZ = Math.max(Number.EPSILON, source.sampleStepZ * (2 ** shift))
  const tileBounds = resolveQuantizedTerrainTileBounds(tileId, worldBounds, worldBounds.minY, worldBounds.maxY)
  const width = Math.max(Number.EPSILON, tileBounds.maxX - tileBounds.minX)
  const depth = Math.max(Number.EPSILON, tileBounds.maxZ - tileBounds.minZ)
  const columns = Math.max(1, Math.ceil(width / sourceStepX))
  const rows = Math.max(1, Math.ceil(depth / sourceStepZ))
  const minPixelX = Math.max(0, Math.floor((tileBounds.minX - source.targetWorldBounds.minX) / source.sampleStepX))
  const minPixelY = Math.max(0, Math.floor((tileBounds.minZ - source.targetWorldBounds.minZ) / source.sampleStepZ))
  const maxPixelX = Math.min(source.width, Math.max(minPixelX + 1, Math.ceil((tileBounds.maxX - source.targetWorldBounds.minX) / source.sampleStepX) + 1))
  const maxPixelY = Math.min(source.height, Math.max(minPixelY + 1, Math.ceil((tileBounds.maxZ - source.targetWorldBounds.minZ) / source.sampleStepZ) + 1))
  const raster = await windowedSource.readWindow({
    window: [minPixelX, minPixelY, maxPixelX, maxPixelY],
    width: columns + 1,
    height: rows + 1,
  })
  const heights = Float64Array.from(Array.from({ length: (rows + 1) * (columns + 1) }, (_unused, index) => {
    const value = Number(raster[index] ?? 0)
    return Number.isFinite(value) ? value : 0
  }))
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  for (const value of heights) {
    minHeight = Math.min(minHeight, value)
    maxHeight = Math.max(maxHeight, value)
  }
  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    minHeight = 0
    maxHeight = 0
  }
  return { rows, columns, heights, minHeight, maxHeight, sourceStepX, sourceStepZ }
}

function buildAvailability(maxLevel: number): QuantizedTerrainDatasetRootManifest['availability'] {
  const availability: QuantizedTerrainDatasetRootManifest['availability'] = []
  for (let level = 0; level <= maxLevel; level += 1) {
    const maxCoord = (2 ** level) - 1
    availability.push({
      level,
      ranges: [{
        startX: 0,
        endX: maxCoord,
        startY: 0,
        endY: maxCoord,
      }],
    })
  }
  return availability
}

function buildRegionIndex(options: {
  regionKey: string
  regionPath: string
  regionTiles: TileBuildRecord[]
}): QuantizedTerrainDatasetRegionPackIndex {
  const { regionKey, regionPath, regionTiles } = options
  const levelValues = regionTiles.map((tile) => tile.tileId.level)
  return {
    regionKey,
    regionId: resolveQuantizedTerrainRegionIdForTile(regionTiles[0]!.tileId, regionTiles[0]!.tileId.level),
    path: regionPath,
    byteLength: null,
    tileCount: regionTiles.length,
    levelRange: {
      min: Math.min(...levelValues),
      max: Math.max(...levelValues),
    },
    bounds: {
      minX: Math.min(...regionTiles.map((tile) => tile.tileRef.bounds.minX)),
      minY: Math.min(...regionTiles.map((tile) => tile.tileRef.bounds.minY)),
      minZ: Math.min(...regionTiles.map((tile) => tile.tileRef.bounds.minZ)),
      maxX: Math.max(...regionTiles.map((tile) => tile.tileRef.bounds.maxX)),
      maxY: Math.max(...regionTiles.map((tile) => tile.tileRef.bounds.maxY)),
      maxZ: Math.max(...regionTiles.map((tile) => tile.tileRef.bounds.maxZ)),
    },
  }
}

function getPlanningDemTerrainDatasetWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  if (planningDemTerrainDatasetWorker) {
    return planningDemTerrainDatasetWorker
  }
  try {
    planningDemTerrainDatasetWorker = new Worker(new URL('@/workers/planningDemTerrainDataset.worker.ts', import.meta.url), {
      type: 'module',
    })
    planningDemTerrainDatasetWorker.onmessage = (event: MessageEvent<PlanningDemTerrainDatasetWorkerResponse | PlanningDemTerrainConversionWorkerResponse | PlanningDemTerrainConversionWorkerProgressResponse>) => {
      const data = event.data
      if (data?.kind === 'build-planning-dem-terrain-conversion-progress') {
        pendingPlanningDemTerrainDatasetRequests.get(data.requestId)?.onProgress?.(data.progress)
        return
      }
      if (!data || (data.kind !== 'build-planning-dem-terrain-dataset-result' && data.kind !== 'build-planning-dem-terrain-conversion-result')) {
        return
      }
      const pending = pendingPlanningDemTerrainDatasetRequests.get(data.requestId)
      if (!pending) {
        return
      }
      pendingPlanningDemTerrainDatasetRequests.delete(data.requestId)
      pending.resolve(data)
    }
    planningDemTerrainDatasetWorker.onerror = (event) => {
      console.warn('[PlanningDEM] Terrain dataset Worker failed', event)
      const pendingRequests = Array.from(pendingPlanningDemTerrainDatasetRequests.values())
      pendingPlanningDemTerrainDatasetRequests.clear()
      for (const pending of pendingRequests) {
        pending.reject(new Error('DEM terrain dataset Worker failed'))
      }
      planningDemTerrainDatasetWorker?.terminate()
      planningDemTerrainDatasetWorker = null
    }
    return planningDemTerrainDatasetWorker
  } catch (error) {
    console.warn('[PlanningDEM] Unable to initialize terrain dataset Worker; falling back to main thread', error)
    planningDemTerrainDatasetWorker = null
    return null
  }
}

function clonePlanningDemTerrainDatasetDefinitionForWorker(definition: GroundRuntimeDynamicMesh): GroundRuntimeDynamicMesh {
  const source = definition as unknown as Record<string, unknown>
  const clone: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'function') {
      continue
    }
    if (key.startsWith('runtime') && key !== 'runtimeHydratedHeightState' && key !== 'runtimeDisableOptimizedChunks' && key !== 'runtimeLoadedTileKeys') {
      continue
    }
    if (key === 'manualHeightMap' || key === 'planningHeightMap' || key === 'localEditTiles') {
      continue
    }
    const clonedValue = clonePlanningDemWorkerValue(value)
    if (clonedValue !== undefined) {
      clone[key] = clonedValue
    }
  }
  return clone as unknown as GroundRuntimeDynamicMesh
}

function clonePlanningDemTerrainDemForWorker(terrainDem: PlanningTerrainDemData): PlanningTerrainDemData {
  return clonePlanningDemWorkerValue(terrainDem) as PlanningTerrainDemData
}

function clonePlanningDemWorkerValue(value: unknown): unknown {
  if (value == null) {
    return value
  }
  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value
  }
  if (valueType === 'bigint' || valueType === 'symbol' || valueType === 'function') {
    return undefined
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0)
  }
  if (ArrayBuffer.isView(value)) {
    return (value as { slice?: () => unknown }).slice?.()
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []
    for (const entry of value) {
      const clonedEntry = clonePlanningDemWorkerValue(entry)
      if (clonedEntry !== undefined) {
        result.push(clonedEntry)
      }
    }
    return result
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const clonedEntry = clonePlanningDemWorkerValue(entry)
      if (clonedEntry !== undefined) {
        result[key] = clonedEntry
      }
    }
    return result
  }
  return undefined
}

function collectPlanningDemTerrainDatasetTransferables(result: PlanningDemTerrainDatasetBuildResult): Transferable[] {
  return Object.values(result.regionPacks).filter((value): value is ArrayBuffer => value instanceof ArrayBuffer)
}

function collectPlanningDemTerrainConversionTransferables(result: PlanningDemTerrainConversionBuildResult): Transferable[] {
  const transferables = collectPlanningDemTerrainDatasetTransferables(result.dataset)
  const valuesBuffer = result.demResult.region.values.buffer
  if (valuesBuffer instanceof ArrayBuffer) {
    transferables.push(valuesBuffer)
  }
  return transferables
}

export function buildPlanningDemTerrainDatasetWorkerResponse(
  requestId: number,
  result: PlanningDemTerrainDatasetBuildResult,
): PlanningDemTerrainDatasetWorkerResponse {
  return {
    kind: 'build-planning-dem-terrain-dataset-result',
    requestId,
    result,
  }
}

export function collectPlanningDemTerrainDatasetWorkerTransferables(
  result: PlanningDemTerrainDatasetBuildResult,
): Transferable[] {
  return collectPlanningDemTerrainDatasetTransferables(result)
}

export function buildPlanningDemTerrainConversionWorkerResponse(
  requestId: number,
  result: PlanningDemTerrainConversionBuildResult,
): PlanningDemTerrainConversionWorkerResponse {
  return {
    kind: 'build-planning-dem-terrain-conversion-result',
    requestId,
    result,
  }
}

export function collectPlanningDemTerrainConversionWorkerTransferables(
  result: PlanningDemTerrainConversionBuildResult,
): Transferable[] {
  return collectPlanningDemTerrainConversionTransferables(result)
}

export async function buildPlanningDemTerrainDatasetInWorker(
  options: PlanningDemTerrainDatasetBuildOptions,
): Promise<PlanningDemTerrainDatasetBuildResult> {
  const worker = getPlanningDemTerrainDatasetWorker()
  if (!worker) {
    return buildPlanningDemTerrainDataset(options)
  }

  const requestId = ++planningDemTerrainDatasetRequestId
  const response = await new Promise<PlanningDemTerrainDatasetWorkerResponse | PlanningDemTerrainConversionWorkerResponse>((resolve, reject) => {
    pendingPlanningDemTerrainDatasetRequests.set(requestId, { resolve, reject })
    try {
      const request: PlanningDemTerrainDatasetWorkerRequest = {
        kind: 'build-planning-dem-terrain-dataset',
        requestId,
        options: {
          ...options,
          definition: clonePlanningDemTerrainDatasetDefinitionForWorker(options.definition),
          terrainDem: clonePlanningDemTerrainDemForWorker(options.terrainDem),
          preparedSource: undefined,
        },
      }
      worker.postMessage(request)
    } catch {
      pendingPlanningDemTerrainDatasetRequests.delete(requestId)
      void buildPlanningDemTerrainDataset(options)
        .then((result) => resolve(buildPlanningDemTerrainDatasetWorkerResponse(requestId, result)))
        .catch((fallbackError) => {
          reject(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)))
        })
    }
  })

  if (response.error) {
    throw new Error(response.error)
  }
  if (response.kind !== 'build-planning-dem-terrain-dataset-result') {
    throw new Error('DEM terrain dataset Worker returned an unexpected response')
  }
  if (!response.result) {
    throw new Error('DEM terrain dataset Worker returned an empty result')
  }
  return response.result
}

export async function buildPlanningDemTerrainConversionInWorker(
  options: PlanningDemTerrainConversionBuildOptions,
): Promise<PlanningDemTerrainConversionBuildResult> {
  const worker = getPlanningDemTerrainDatasetWorker()
  if (!worker) {
    return buildPlanningDemTerrainConversion(options)
  }

  const { onProgress, ...workerOptions } = options
  const requestId = ++planningDemTerrainDatasetRequestId
  const response = await new Promise<PlanningDemTerrainDatasetWorkerResponse | PlanningDemTerrainConversionWorkerResponse>((resolve, reject) => {
    pendingPlanningDemTerrainDatasetRequests.set(requestId, { resolve, reject, onProgress })
    try {
      const request: PlanningDemTerrainConversionWorkerRequest = {
        kind: 'build-planning-dem-terrain-conversion',
        requestId,
        options: {
          ...workerOptions,
          definition: clonePlanningDemTerrainDatasetDefinitionForWorker(options.definition),
          terrainDem: clonePlanningDemTerrainDemForWorker(options.terrainDem),
          preparedSource: undefined,
        },
      }
      worker.postMessage(request)
    } catch {
      pendingPlanningDemTerrainDatasetRequests.delete(requestId)
      void buildPlanningDemTerrainConversion(options)
        .then((result) => resolve(buildPlanningDemTerrainConversionWorkerResponse(requestId, result)))
        .catch((fallbackError) => {
          reject(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)))
        })
    }
  })

  if (response.error) {
    throw new Error(response.error)
  }
  if (response.kind !== 'build-planning-dem-terrain-conversion-result') {
    throw new Error('DEM terrain conversion Worker returned an unexpected response')
  }
  if (!response.result) {
    throw new Error('DEM terrain conversion Worker returned an empty result')
  }
  return response.result
}

export async function buildPlanningDemTerrainConversion(
  options: PlanningDemTerrainConversionBuildOptions,
): Promise<PlanningDemTerrainConversionBuildResult> {
  const reportProgress = options.onProgress
  reportProgress?.({
    phase: 'load-source',
    loaded: 0,
    total: 1,
    label: 'Loading DEM source…',
    detail: '0/1',
  })
  const prepared = await resolvePlanningDemPreparedSource({
    definition: options.definition,
    terrainDem: options.terrainDem,
  })
  reportProgress?.({
    phase: 'load-source',
    loaded: 1,
    total: 1,
    label: 'Loading DEM source…',
    detail: '1/1',
  })
  reportProgress?.({
    phase: 'load-orthophoto',
    loaded: 0,
    total: 1,
    label: 'Loading orthophoto…',
    detail: '0/1',
  })
  const texture = await resolvePlanningDemOrthophotoTexture({
    terrainDem: options.terrainDem,
    applyOrthophoto: options.applyOrthophoto,
  })
  reportProgress?.({
    phase: 'load-orthophoto',
    loaded: 1,
    total: 1,
    label: texture.textureDataUrl ? 'Loading orthophoto…' : 'Skipping orthophoto…',
    detail: '1/1',
  })

  const demResult = await buildPlanningDemRegionFromPreparedSource({
    definition: options.definition,
    prepared,
    startRow: options.startRow,
    endRow: options.endRow,
    startColumn: options.startColumn,
    endColumn: options.endColumn,
    textureDataUrl: texture.textureDataUrl,
    textureName: texture.textureName,
    onProgress: reportProgress,
    preferWorker: false,
  })
  reportProgress?.({
    phase: 'build-edit-tiles',
    loaded: 1,
    total: 1,
    label: 'Building terrain dataset…',
    detail: '1/1',
  })
  const dataset = await buildPlanningDemTerrainDataset({
    definition: options.definition,
    terrainDem: options.terrainDem,
    datasetId: options.datasetId,
    leafTileSegments: options.leafTileSegments,
    regionLevel: options.regionLevel,
    preparedSource: prepared,
  })

  return { demResult, dataset }
}

export async function buildPlanningDemTerrainDataset(
  options: PlanningDemTerrainDatasetBuildOptions,
): Promise<PlanningDemTerrainDatasetBuildResult> {
  const leafTileSegments = clampFiniteInteger(options.leafTileSegments, DEFAULT_LEAF_TILE_SEGMENTS, MIN_TILE_SEGMENTS, MAX_TILE_SEGMENTS)
  const demHash = typeof options.terrainDem.sourceFileHash === 'string' ? options.terrainDem.sourceFileHash.trim() : ''
  const isGeoTiff = isPlanningDemGeoTiffSource(options.terrainDem.filename ?? '', options.terrainDem.mimeType ?? null)
  let prepared: PlanningDemPreparedSource | null = options.preparedSource ?? null
  let windowedGeoTiffSource: NonNullable<Awaited<ReturnType<typeof openPlanningDemWindowedGeoTiffSource>>> | null = null
  let sourceMetrics: RasterSourceMetrics
  let datasetBounds: QuantizedTerrainDatasetBounds

  if (prepared) {
    sourceMetrics = {
      width: prepared.rasterSource.width,
      height: prepared.rasterSource.height,
      targetWorldBounds: prepared.rasterSource.targetWorldBounds,
      sampleStepX: prepared.rasterSource.sampleStepX,
      sampleStepZ: prepared.rasterSource.sampleStepZ,
    }
    datasetBounds = resolveDatasetBounds(prepared)
  } else if (isGeoTiff && demHash) {
    const blob = await loadPlanningDemBlobByHash(demHash)
    if (!blob) {
      throw new Error('DEM blob is missing from storage')
    }
    windowedGeoTiffSource = await openPlanningDemWindowedGeoTiffSource(
      blob,
      options.terrainDem.filename ?? 'DEM',
      (options.terrainDem.mimeType ?? blob.type) || null,
    )
    if (!windowedGeoTiffSource) {
      throw new Error('Unable to open GeoTIFF DEM source')
    }
    const targetWorldBounds = resolvePlanningDemTargetWorldBounds(options.definition, {
      demWidth: windowedGeoTiffSource.width,
      demHeight: windowedGeoTiffSource.height,
      worldBounds: windowedGeoTiffSource.worldBounds,
    })
    sourceMetrics = {
      width: windowedGeoTiffSource.width,
      height: windowedGeoTiffSource.height,
      targetWorldBounds,
      sampleStepX: Math.max(Number.EPSILON, (targetWorldBounds.maxX - targetWorldBounds.minX) / Math.max(1, windowedGeoTiffSource.width - 1)),
      sampleStepZ: Math.max(Number.EPSILON, (targetWorldBounds.maxZ - targetWorldBounds.minZ) / Math.max(1, windowedGeoTiffSource.height - 1)),
    }
    const minHeight = Number.isFinite(options.terrainDem.minElevation) ? Number(options.terrainDem.minElevation) : 0
    const maxHeight = Number.isFinite(options.terrainDem.maxElevation) ? Number(options.terrainDem.maxElevation) : minHeight
    datasetBounds = {
      minX: targetWorldBounds.minX,
      minY: Math.min(minHeight, maxHeight),
      minZ: targetWorldBounds.minZ,
      maxX: targetWorldBounds.maxX,
      maxY: Math.max(minHeight, maxHeight),
      maxZ: targetWorldBounds.maxZ,
    }
  } else {
    prepared = await resolvePlanningDemPreparedSource({
      definition: options.definition,
      terrainDem: options.terrainDem,
    })
    sourceMetrics = {
      width: prepared.rasterSource.width,
      height: prepared.rasterSource.height,
      targetWorldBounds: prepared.rasterSource.targetWorldBounds,
      sampleStepX: prepared.rasterSource.sampleStepX,
      sampleStepZ: prepared.rasterSource.sampleStepZ,
    }
    datasetBounds = resolveDatasetBounds(prepared)
  }

  const maxLevel = resolveLeafTileLevel(sourceMetrics, leafTileSegments)
  const regionLevel = options.regionLevel == null
    ? Math.max(0, maxLevel - 2)
    : clampFiniteInteger(options.regionLevel, Math.max(0, maxLevel - 2), 0, maxLevel)
  const datasetId = typeof options.datasetId === 'string' && options.datasetId.trim().length
    ? options.datasetId.trim()
    : `terrain-${demHash || Date.now()}`

  const tileFieldLevels = new Map<number, Map<string, TileHeightField>>()
  for (let level = maxLevel; level >= 0; level -= 1) {
    const levelFields = new Map<string, TileHeightField>()
    const tileCountPerAxis = 2 ** level
    for (let y = 0; y < tileCountPerAxis; y += 1) {
      for (let x = 0; x < tileCountPerAxis; x += 1) {
        const tileId = { level, x, y }
        const tileKey = formatQuantizedTerrainTileKey(level, x, y)
        let tileField: TileHeightField
        if (level === maxLevel) {
          tileField = windowedGeoTiffSource
            ? await buildTileHeightFieldFromWindowedGeoTiff({
                source: sourceMetrics,
                windowedSource: windowedGeoTiffSource,
                worldBounds: datasetBounds,
                tileId,
                maxLevel,
              })
            : buildTileHeightFieldFromRasterSource({
                source: prepared!.rasterSource,
                worldBounds: datasetBounds,
                tileId,
                maxLevel,
              })
        } else {
          const childLevelFields = tileFieldLevels.get(level + 1)
          if (!childLevelFields) {
            throw new Error(`Missing child terrain fields for level ${level + 1}`)
          }
          const childTileIds: Array<[number, number]> = [
            [x * 2, y * 2],
            [x * 2 + 1, y * 2],
            [x * 2, y * 2 + 1],
            [x * 2 + 1, y * 2 + 1],
          ]
          const children = childTileIds.map(([childX, childY]) => {
            const childKey = formatQuantizedTerrainTileKey(level + 1, childX, childY)
            const childField = childLevelFields.get(childKey)
            if (!childField) {
              throw new Error(`Missing child terrain field ${childKey}`)
            }
            return childField
          }) as [TileHeightField, TileHeightField, TileHeightField, TileHeightField]
          tileField = buildParentHeightFieldFromChildren(children)
        }
        levelFields.set(tileKey, tileField)
      }
    }
    tileFieldLevels.set(level, levelFields)
  }

  const tiles: TileBuildRecord[] = []
  for (let level = 0; level <= maxLevel; level += 1) {
    const tileCountPerAxis = 2 ** level
    const levelFields = tileFieldLevels.get(level)
    if (!levelFields) {
      throw new Error(`Missing terrain fields for level ${level}`)
    }
    for (let y = 0; y < tileCountPerAxis; y += 1) {
      for (let x = 0; x < tileCountPerAxis; x += 1) {
        const tileId = { level, x, y }
        const tileKey = formatQuantizedTerrainTileKey(level, x, y)
        const tileField = levelFields.get(tileKey)
        if (!tileField) {
          throw new Error(`Missing terrain field ${tileKey}`)
        }
        const { data, ref } = buildTileMeshFromHeightField({
          tileField,
          worldBounds: datasetBounds,
          tileId,
          maxLevel,
        })
        const serializedMesh = serializeQuantizedTerrainMesh(data)
        const regionId = resolveQuantizedTerrainRegionIdForTile(tileId, regionLevel)
        const regionKey = formatQuantizedTerrainRegionKey(regionId.level, regionId.x, regionId.y)
        const regionPath = buildQuantizedTerrainRegionPackPath(regionId)
        tiles.push({
          tileId,
          tileKey,
          tileRef: {
            ...ref,
            byteLength: serializedMesh.byteLength,
          },
          regionKey,
          regionPath,
          serializedMesh,
        })
      }
    }
  }

  const regionTileMap = new Map<string, TileBuildRecord[]>()
  for (const tile of tiles) {
    const list = regionTileMap.get(tile.regionKey)
    if (list) {
      list.push(tile)
    } else {
      regionTileMap.set(tile.regionKey, [tile])
    }
  }

  const regions: QuantizedTerrainDatasetRegionPackIndex[] = []
  const regionPacks: Record<string, ArrayBuffer> = {}
  for (const [regionKey, regionTiles] of regionTileMap.entries()) {
    const entries = Object.fromEntries(regionTiles.map((tile) => [tile.tileKey, tile.serializedMesh]))
    const serializedPack = serializeQuantizedTerrainPack({
      header: {
        format: 'harmony-quantized-terrain-pack',
        version: 1,
        datasetId,
        regionKey,
        tileCount: regionTiles.length,
        entries: [],
      },
      entries,
    })
    regionPacks[regionKey] = serializedPack
    const regionPath = regionTiles[0]!.regionPath
    regions.push({
      ...buildRegionIndex({ regionKey, regionPath, regionTiles }),
      regionId: resolveQuantizedTerrainRegionIdForTile(regionTiles[0]!.tileId, regionLevel),
      byteLength: serializedPack.byteLength,
    })
  }

  regions.sort((left, right) => left.regionKey.localeCompare(right.regionKey))

  return {
    manifest: {
      format: 'harmony-quantized-terrain-dataset',
      version: 1,
      datasetId,
      scenePath: '',
      storageMode: 'region-packs',
      tileScheme: 'quadtree',
      rootLevel: 0,
      maxLevel,
      regionLevel,
      geometricError: Math.max(sourceMetrics.sampleStepX, sourceMetrics.sampleStepZ) * (2 ** maxLevel),
      bounds: datasetBounds,
      verticalScale: 1,
      hasNormals: false,
      hasWatermask: false,
      hasOverlayLayers: false,
      rootTiles: [{ level: 0, x: 0, y: 0 }],
      availability: buildAvailability(maxLevel),
      regions,
    },
    regionPacks,
  }
}
