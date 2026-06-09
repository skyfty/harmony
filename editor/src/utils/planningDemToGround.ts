import type { GroundHeightMap, GroundLocalEditTileData, GroundLocalEditTileMap, GroundRuntimeDynamicMesh } from '@schema/core'
import {
  GROUND_HEIGHT_UNSET_VALUE,
  GROUND_TERRAIN_CHUNK_SIZE_METERS,
  createGroundHeightMap,
  formatGroundLocalEditTileKey,
  getGroundVertexIndex,
  resolveInfiniteGroundGridOriginMeters,
  resolveGroundEditTileResolution,
  resolveGroundWorldBounds,
  resolveGroundWorkingGridSize,
  type GroundPlanningMetadata,
} from '@schema/core'
import type { PlanningTerrainDemData } from '@/types/planning-scene-data'
import { loadPlanningDemBlobByHash } from '@/utils/planningDemStorage'
import { isPlanningDemHeightmapImageSource, parsePlanningDemBlob } from '@/utils/planningDemImport'

export interface PlanningDemGroundConversionResult {
  terrainHeightMap: GroundHeightMap
  localEditTiles: GroundLocalEditTileMap | null
  planningMetadata: GroundPlanningMetadata
  normalMapDataUrl?: string | null
  normalMapName?: string | null
}

export interface PlanningDemRegionConversionResult {
  region: PlanningDemHeightRegion
  localEditTiles: GroundLocalEditTileMap | null
  planningMetadata: GroundPlanningMetadata
  normalMapDataUrl?: string | null
  normalMapName?: string | null
}

export interface PlanningDemTileConversionResult {
  region: PlanningDemTileHeightRegion
  localEditTiles: GroundLocalEditTileMap | null
  planningMetadata: GroundPlanningMetadata
  normalMapDataUrl?: string | null
  normalMapName?: string | null
}

export interface PlanningDemBuildProgress {
  phase:
    | 'load-source'
    | 'load-orthophoto'
    | 'build-base-texture'
    | 'build-brush-heightmap'
    | 'sample-region'
    | 'build-edit-tiles'
    | 'build-terrain-dataset-fields'
    | 'build-terrain-dataset-meshes'
    | 'build-terrain-dataset-regions'
  loaded: number
  total: number
  label: string
  detail?: string
}

export interface PlanningDemSourceTileLayout {
  tileRows: number
  tileColumns: number
  tileWorldWidth: number
  tileWorldHeight: number
  sourceSamplesPerTileX: number
  sourceSamplesPerTileY: number
  targetSamplesPerTileX: number
  targetSamplesPerTileY: number
}

export interface PlanningDemTargetWorldBounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export interface PlanningDemRasterSource {
  rasterData: ArrayLike<number>
  width: number
  height: number
  targetWorldBounds: PlanningDemTargetWorldBounds
  sourceWorldBounds: PlanningDemTargetWorldBounds
  sampleStepX: number
  sampleStepZ: number
  elevationOffsetMeters: number
  sourceTransform?: PlanningDemSourceTransform | null
}

export interface PlanningDemSourceTransform {
  centerX: number
  centerZ: number
  rotationRadians: number
}

export interface PlanningDemHeightRegion {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  vertexRows: number
  vertexColumns: number
  values: Float64Array
}

export interface PlanningDemTileHeightRegion extends PlanningDemHeightRegion {
  tileRow: number
  tileColumn: number
}

export interface PlanningDemPreparedSource {
  parsed: Awaited<ReturnType<typeof parsePlanningDemBlob>>
  rasterSource: PlanningDemRasterSource
  tileLayout: PlanningDemSourceTileLayout
  planningMetadata: GroundPlanningMetadata
}

export interface PlanningDemLocalEditTileBuildPlan {
  tileSizeMeters: number
  resolution: number
  originX: number
  originZ: number
  startTileRow: number
  endTileRow: number
  startTileColumn: number
  endTileColumn: number
  totalTileRows: number
  totalTileColumns: number
  totalTiles: number
  sourceWidth: number
  sourceHeight: number
  sourceBounds: PlanningDemTargetWorldBounds
  elevationOffsetMeters: number
}

export interface PlanningDemHeightRegionBuildPlan {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  vertexRows: number
  vertexColumns: number
  cellSize: number
  boundsMinX: number
  boundsMinZ: number
  sourceWidth: number
  sourceHeight: number
  sourceBounds: PlanningDemTargetWorldBounds
  elevationOffsetMeters: number
}

const MAX_EAGER_DEM_LOCAL_EDIT_TILE_COUNT = 4096
const MAX_EAGER_DEM_LOCAL_EDIT_SAMPLE_COUNT = 500_000


type PlanningDemLocalEditTileRecord = {
  key: string
  tileRow: number
  tileColumn: number
  tileSizeMeters: number
  resolution: number
  values: number[]
  source: 'dem'
  updatedAt: number
}

type PlanningDemLocalEditTilesWorkerRequest = {
  kind: 'build-planning-dem-local-edit-tiles'
  requestId: number
  plan: PlanningDemLocalEditTileBuildPlan
  rasterData: Float64Array
}

type PlanningDemHeightRegionWorkerRequest = {
  kind: 'build-planning-dem-height-region'
  requestId: number
  plan: PlanningDemHeightRegionBuildPlan
  rasterData: Float64Array
}

type PlanningDemLocalEditTilesWorkerResponse = {
  kind: 'build-planning-dem-local-edit-tiles-result'
  requestId: number
  tiles: PlanningDemLocalEditTileRecord[]
  error?: string
}

type PlanningDemHeightRegionWorkerResponse = {
  kind: 'build-planning-dem-height-region-result'
  requestId: number
  region: {
    startRow: number
    endRow: number
    startColumn: number
    endColumn: number
    vertexRows: number
    vertexColumns: number
    values: ArrayBuffer
  }
  error?: string
}

let planningDemLocalEditTilesWorker: Worker | null = null
let planningDemLocalEditTilesRequestId = 0
const pendingPlanningDemLocalEditTilesRequests = new Map<
  number,
  {
    resolve: (response: PlanningDemLocalEditTilesWorkerResponse) => void
    reject: (error: Error) => void
  }
>()

let planningDemHeightRegionWorker: Worker | null = null
let planningDemHeightRegionRequestId = 0
const pendingPlanningDemHeightRegionRequests = new Map<
  number,
  {
    resolve: (response: PlanningDemHeightRegionWorkerResponse) => void
    reject: (error: Error) => void
  }
>()

interface PlanningDemCoveredGridRegion {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

function nowMs(): number {
  const perf = typeof performance !== 'undefined' ? performance : undefined
  return typeof perf?.now === 'function' ? perf.now() : Date.now()
}

function createThrottledPlanningDemProgressReporter(
  onProgress?: (payload: PlanningDemBuildProgress) => void,
  minIntervalMs = 50,
): (payload: PlanningDemBuildProgress, force?: boolean) => void {
  if (!onProgress) {
    return () => {}
  }
  let lastReportedAt = -Infinity
  return (payload, force = false) => {
    const safeTotal = Number.isFinite(payload.total) && payload.total > 0 ? payload.total : 1
    const safeLoaded = Number.isFinite(payload.loaded) ? Math.max(0, Math.min(payload.loaded, safeTotal)) : 0
    const timestamp = nowMs()
    if (!force && safeLoaded < safeTotal && timestamp - lastReportedAt < minIntervalMs) {
      return
    }
    lastReportedAt = timestamp
    onProgress({
      ...payload,
      loaded: safeLoaded,
      total: safeTotal,
    })
  }
}

function normalizePlanningDemSourceTransform(
  transform: PlanningDemSourceTransform | null | undefined,
): PlanningDemSourceTransform | null {
  if (!transform) {
    return null
  }
  const centerX = Number(transform.centerX)
  const centerZ = Number(transform.centerZ)
  const rotationRadians = Number(transform.rotationRadians)
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ) || !Number.isFinite(rotationRadians)) {
    return null
  }
  return {
    centerX,
    centerZ,
    rotationRadians,
  }
}

function rotatePlanningDemLocalPoint(
  transform: PlanningDemSourceTransform,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const cos = Math.cos(transform.rotationRadians)
  const sin = Math.sin(transform.rotationRadians)
  return {
    x: transform.centerX + localX * cos - localZ * sin,
    z: transform.centerZ + localX * sin + localZ * cos,
  }
}

function resolvePlanningDemWorldPointToSourceLocal(
  source: PlanningDemRasterSource,
  worldX: number,
  worldZ: number,
): { x: number; z: number } {
  const transform = normalizePlanningDemSourceTransform(source.sourceTransform ?? null)
  if (!transform) {
    return { x: worldX, z: worldZ }
  }
  const dx = worldX - transform.centerX
  const dz = worldZ - transform.centerZ
  const cos = Math.cos(transform.rotationRadians)
  const sin = Math.sin(transform.rotationRadians)
  return {
    x: dx * cos + dz * sin,
    z: -dx * sin + dz * cos,
  }
}

function resolvePlanningDemSourceWorldBounds(
  localBounds: PlanningDemTargetWorldBounds,
  sourceTransform: PlanningDemSourceTransform | null | undefined,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const transform = normalizePlanningDemSourceTransform(sourceTransform)
  if (!transform) {
    return {
      minX: localBounds.minX,
      minY: localBounds.minZ,
      maxX: localBounds.maxX,
      maxY: localBounds.maxZ,
    }
  }
  const corners = [
    rotatePlanningDemLocalPoint(transform, localBounds.minX, localBounds.minZ),
    rotatePlanningDemLocalPoint(transform, localBounds.maxX, localBounds.minZ),
    rotatePlanningDemLocalPoint(transform, localBounds.minX, localBounds.maxZ),
    rotatePlanningDemLocalPoint(transform, localBounds.maxX, localBounds.maxZ),
  ]
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const corner of corners) {
    minX = Math.min(minX, corner.x)
    minZ = Math.min(minZ, corner.z)
    maxX = Math.max(maxX, corner.x)
    maxZ = Math.max(maxZ, corner.z)
  }
  return {
    minX,
    minY: minZ,
    maxX,
    maxY: maxZ,
  }
}

function computePlanningDemRasterMinMax(values: ArrayLike<number>): { min: number | null; max: number | null } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index])
    if (!Number.isFinite(value)) {
      continue
    }
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY) {
    return { min: null, max: null }
  }
  return { min, max }
}

function getPlanningDemLocalEditTilesWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  if (planningDemLocalEditTilesWorker) {
    return planningDemLocalEditTilesWorker
  }
  try {
    planningDemLocalEditTilesWorker = new Worker(new URL('@/workers/planningDemLocalEditTiles.worker.ts', import.meta.url), {
      type: 'module',
    })
    planningDemLocalEditTilesWorker.onmessage = (event: MessageEvent<PlanningDemLocalEditTilesWorkerResponse>) => {
      const data = event.data
      if (!data || data.kind !== 'build-planning-dem-local-edit-tiles-result') {
        return
      }
      const pending = pendingPlanningDemLocalEditTilesRequests.get(data.requestId)
      if (!pending) {
        return
      }
      pendingPlanningDemLocalEditTilesRequests.delete(data.requestId)
      pending.resolve(data)
    }
    planningDemLocalEditTilesWorker.onerror = (event) => {
      console.warn('DEM local edit tile Worker 出错：', event)
      const pendingRequests = Array.from(pendingPlanningDemLocalEditTilesRequests.values())
      pendingPlanningDemLocalEditTilesRequests.clear()
      for (const pending of pendingRequests) {
        pending.reject(new Error('DEM local edit tile Worker failed'))
      }
    }
    return planningDemLocalEditTilesWorker
  } catch (error) {
    console.warn('无法初始化 DEM local edit tile Worker，将回退到主线程计算：', error)
    planningDemLocalEditTilesWorker = null
    return null
  }
}

function getPlanningDemHeightRegionWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  if (planningDemHeightRegionWorker) {
    return planningDemHeightRegionWorker
  }
  try {
    planningDemHeightRegionWorker = new Worker(new URL('@/workers/planningDemLocalEditTiles.worker.ts', import.meta.url), {
      type: 'module',
    })
    planningDemHeightRegionWorker.onmessage = (event: MessageEvent<PlanningDemHeightRegionWorkerResponse>) => {
      const data = event.data
      if (!data || data.kind !== 'build-planning-dem-height-region-result') {
        return
      }
      const pending = pendingPlanningDemHeightRegionRequests.get(data.requestId)
      if (!pending) {
        return
      }
      pendingPlanningDemHeightRegionRequests.delete(data.requestId)
      pending.resolve(data)
    }
    planningDemHeightRegionWorker.onerror = (event) => {
      console.warn('DEM height region Worker 出错：', event)
      const pendingRequests = Array.from(pendingPlanningDemHeightRegionRequests.values())
      pendingPlanningDemHeightRegionRequests.clear()
      for (const pending of pendingRequests) {
        pending.reject(new Error('DEM height region Worker failed'))
      }
    }
    return planningDemHeightRegionWorker
  } catch (error) {
    console.warn('无法初始化 DEM height region Worker，将回退到主线程计算：', error)
    planningDemHeightRegionWorker = null
    return null
  }
}

function resolvePlanningDemSourceSpan(options: {
  demWidth: number
  demHeight: number
  worldBounds: { minX: number; minY: number; maxX: number; maxY: number } | null
}): { widthMeters: number; depthMeters: number } {
  const widthFromBounds = options.worldBounds ? Math.abs(options.worldBounds.maxX - options.worldBounds.minX) : 0
  const depthFromBounds = options.worldBounds ? Math.abs(options.worldBounds.maxY - options.worldBounds.minY) : 0
  const widthMeters = widthFromBounds > 0 ? widthFromBounds : Math.max(1, options.demWidth - 1)
  const depthMeters = depthFromBounds > 0 ? depthFromBounds : Math.max(1, options.demHeight - 1)
  return {
    widthMeters: Math.max(widthMeters, Number.EPSILON),
    depthMeters: Math.max(depthMeters, Number.EPSILON),
  }
}

function resolvePlanningDemLocalEditTileOrigin(definition: GroundRuntimeDynamicMesh): { originX: number; originZ: number } {
  if (definition.terrainMode === 'infinite') {
    const origin = resolveInfiniteGroundGridOriginMeters(resolvePlanningDemChunkSizeMeters())
    return { originX: origin, originZ: origin }
  }
  const bounds = resolveGroundWorldBounds(definition)
  return {
    originX: bounds.minX,
    originZ: bounds.minZ,
  }
}

function resolvePlanningDemChunkSizeMeters(): number {
  return GROUND_TERRAIN_CHUNK_SIZE_METERS
}

function resolvePlanningDemLocalEditTileResolution(options: {
  definition: GroundRuntimeDynamicMesh
  sampleStepX?: number | null
  sampleStepZ?: number | null
}): number {
  const explicitConfiguredResolution = Number(options.definition.editTileResolution)
  const configuredResolution = resolveGroundEditTileResolution(options.definition)
  if (Number.isFinite(explicitConfiguredResolution) && explicitConfiguredResolution > 0) {
    return configuredResolution
  }
  const tileSizeMeters = resolvePlanningDemChunkSizeMeters()
  const sourceSteps = [options.sampleStepX, options.sampleStepZ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)

  if (!(tileSizeMeters > 0) || !sourceSteps.length) {
    return configuredResolution
  }

  const sourceLimitedResolution = sourceSteps.reduce((currentMax, step) => {
    const segments = Math.max(1, Math.round(tileSizeMeters / Math.max(step, Number.EPSILON)))
    return Math.max(currentMax, segments)
  }, 1)

  return Math.max(1, Math.min(configuredResolution, sourceLimitedResolution))
}

function shouldBuildPlanningDemLocalEditTiles(options: {
  startTileRow: number
  endTileRow: number
  startTileColumn: number
  endTileColumn: number
  resolution: number
}): boolean {
  const tileRows = Math.max(0, options.endTileRow - options.startTileRow + 1)
  const tileColumns = Math.max(0, options.endTileColumn - options.startTileColumn + 1)
  const tileCount = tileRows * tileColumns
  if (tileCount <= 0) {
    return false
  }
  if (tileCount > MAX_EAGER_DEM_LOCAL_EDIT_TILE_COUNT) {
    return false
  }
  const samplesPerTile = (Math.max(1, options.resolution) + 1) * (Math.max(1, options.resolution) + 1)
  return tileCount * samplesPerTile <= MAX_EAGER_DEM_LOCAL_EDIT_SAMPLE_COUNT
}

function resolvePlanningDemChunkTileRange(options: {
  minWorld: number
  maxWorld: number
  originWorld: number
  chunkSizeMeters: number
}): { startTile: number; endTile: number } {
  const safeChunkSize = Number.isFinite(options.chunkSizeMeters) && options.chunkSizeMeters > 0 ? options.chunkSizeMeters : resolvePlanningDemChunkSizeMeters()
  const epsilon = Math.max(1e-9, safeChunkSize * 1e-9)
  const startTile = Math.floor((options.minWorld - options.originWorld) / safeChunkSize)
  const endTile = Math.max(startTile, Math.floor((options.maxWorld - options.originWorld - epsilon) / safeChunkSize))
  return { startTile, endTile }
}

function resolvePlanningDemCoveredGridRegion(options: {
  definition: GroundRuntimeDynamicMesh
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}): PlanningDemCoveredGridRegion {
  const gridSize = resolveGroundWorkingGridSize(options.definition)
  const rows = Math.max(1, Math.trunc(gridSize.rows))
  const columns = Math.max(1, Math.trunc(gridSize.columns))
  const requestedStartRow = Math.max(0, Math.min(rows, Math.trunc(options.startRow)))
  const requestedEndRow = Math.max(requestedStartRow, Math.min(rows, Math.trunc(options.endRow)))
  const requestedStartColumn = Math.max(0, Math.min(columns, Math.trunc(options.startColumn)))
  const requestedEndColumn = Math.max(requestedStartColumn, Math.min(columns, Math.trunc(options.endColumn)))
  const terrainBounds = resolvePlanningDemTargetWorldBounds(options.definition)
  const overlapMinX = Math.max(terrainBounds.minX, options.source.sourceWorldBounds.minX)
  const overlapMaxX = Math.min(terrainBounds.maxX, options.source.sourceWorldBounds.maxX)
  const overlapMinZ = Math.max(terrainBounds.minZ, options.source.sourceWorldBounds.minZ)
  const overlapMaxZ = Math.min(terrainBounds.maxZ, options.source.sourceWorldBounds.maxZ)
  const cellSize = Number.isFinite(options.definition.cellSize) && options.definition.cellSize > 0 ? options.definition.cellSize : 1
  const epsilon = Math.max(1e-9, cellSize * 1e-9)
  const overlapStartColumn = Math.max(0, Math.min(columns, Math.ceil((overlapMinX - terrainBounds.minX - epsilon) / cellSize)))
  const overlapEndColumn = Math.max(overlapStartColumn, Math.min(columns, Math.floor((overlapMaxX - terrainBounds.minX - epsilon) / cellSize)))
  const overlapStartRow = Math.max(0, Math.min(rows, Math.ceil((overlapMinZ - terrainBounds.minZ - epsilon) / cellSize)))
  const overlapEndRow = Math.max(overlapStartRow, Math.min(rows, Math.floor((overlapMaxZ - terrainBounds.minZ - epsilon) / cellSize)))
  const startRow = Math.max(overlapStartRow, requestedStartRow)
  const endRow = Math.min(overlapEndRow, requestedEndRow)
  const startColumn = Math.max(overlapStartColumn, requestedStartColumn)
  const endColumn = Math.min(overlapEndColumn, requestedEndColumn)
  if (startRow > endRow || startColumn > endColumn) {
    return {
      startRow: rows + 1,
      endRow: rows,
      startColumn: columns + 1,
      endColumn: columns,
    }
  }
  return {
    startRow,
    endRow,
    startColumn,
    endColumn,
  }
}

function resolvePlanningDemHeightRegionBuildPlan(options: {
  definition: GroundRuntimeDynamicMesh
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}): PlanningDemHeightRegionBuildPlan | null {
  const { startRow, endRow, startColumn, endColumn } = resolvePlanningDemCoveredGridRegion({
    definition: options.definition,
    source: options.source,
    startRow: options.startRow,
    endRow: options.endRow,
    startColumn: options.startColumn,
    endColumn: options.endColumn,
  })
  const vertexRows = Math.max(0, endRow - startRow + 1)
  const vertexColumns = Math.max(0, endColumn - startColumn + 1)
  return {
    startRow,
    endRow,
    startColumn,
    endColumn,
    vertexRows,
    vertexColumns,
    cellSize: Number.isFinite(options.definition.cellSize) && options.definition.cellSize > 0 ? options.definition.cellSize : 1,
    boundsMinX: resolveGroundWorldBounds(options.definition).minX,
    boundsMinZ: resolveGroundWorldBounds(options.definition).minZ,
    sourceWidth: options.source.width,
    sourceHeight: options.source.height,
    sourceBounds: options.source.sourceWorldBounds,
    elevationOffsetMeters: options.source.elevationOffsetMeters,
  }
}

function buildPlanningDemHeightRegionSyncFromPlan(
  plan: PlanningDemHeightRegionBuildPlan,
  source: PlanningDemRasterSource,
  onProgress?: (payload: PlanningDemBuildProgress) => void,
): PlanningDemHeightRegion {
  const values = new Float64Array(plan.vertexRows * plan.vertexColumns)
  const reportProgress = createThrottledPlanningDemProgressReporter(onProgress)

  reportProgress({
    phase: 'sample-region',
    loaded: 0,
    total: plan.vertexRows,
    label: 'Sampling terrain heights…',
    detail: plan.vertexRows > 0 ? `0/${plan.vertexRows} rows` : '0 rows',
  }, true)

  for (let row = plan.startRow; row <= plan.endRow; row += 1) {
    const z = plan.boundsMinZ + row * plan.cellSize
    const targetRowOffset = (row - plan.startRow) * plan.vertexColumns
    let x = plan.boundsMinX + plan.startColumn * plan.cellSize
    for (let column = plan.startColumn; column <= plan.endColumn; column += 1) {
      const sampled = samplePlanningDemHeightAtWorld(source, x, z)
      values[targetRowOffset + (column - plan.startColumn)] = Number.isFinite(sampled) ? sampled : 0
      x += plan.cellSize
    }
    const loadedRows = row - plan.startRow + 1
    reportProgress({
      phase: 'sample-region',
      loaded: loadedRows,
      total: plan.vertexRows,
      label: 'Sampling terrain heights…',
      detail: `${loadedRows}/${plan.vertexRows} rows`,
    }, loadedRows === plan.vertexRows)
  }

  return {
    startRow: plan.startRow,
    endRow: plan.endRow,
    startColumn: plan.startColumn,
    endColumn: plan.endColumn,
    vertexRows: plan.vertexRows,
    vertexColumns: plan.vertexColumns,
    values,
  }
}

function buildPlanningDemHeightRegionFromWorkerResult(region: PlanningDemHeightRegionWorkerResponse['region']): PlanningDemHeightRegion {
  return {
    startRow: region.startRow,
    endRow: region.endRow,
    startColumn: region.startColumn,
    endColumn: region.endColumn,
    vertexRows: region.vertexRows,
    vertexColumns: region.vertexColumns,
    values: new Float64Array(region.values),
  }
}

async function buildPlanningDemHeightRegionAsync(options: {
  definition: GroundRuntimeDynamicMesh
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  onProgress?: (payload: PlanningDemBuildProgress) => void
  preferWorker?: boolean
}): Promise<PlanningDemHeightRegion> {
  const plan = resolvePlanningDemHeightRegionBuildPlan(options)
  if (!plan) {
    return {
      startRow: options.startRow,
      endRow: options.endRow,
      startColumn: options.startColumn,
      endColumn: options.endColumn,
      vertexRows: 0,
      vertexColumns: 0,
      values: new Float64Array(0),
    }
  }
  const worker = options.preferWorker === false ? null : getPlanningDemHeightRegionWorker()
  if (!worker) {
    return buildPlanningDemHeightRegionSyncFromPlan(plan, options.source, options.onProgress)
  }

  const reportProgress = createThrottledPlanningDemProgressReporter(options.onProgress)
  reportProgress({
    phase: 'sample-region',
    loaded: 0,
    total: plan.vertexRows,
    label: 'Sampling terrain heights…',
    detail: plan.vertexRows > 0 ? `0/${plan.vertexRows} rows` : '0 rows',
  }, true)

  const rasterData = Float64Array.from(options.source.rasterData)
  const requestId = ++planningDemHeightRegionRequestId
  const response = await new Promise<PlanningDemHeightRegionWorkerResponse>((resolve, reject) => {
    pendingPlanningDemHeightRegionRequests.set(requestId, { resolve, reject })
    try {
      const request: PlanningDemHeightRegionWorkerRequest = {
        kind: 'build-planning-dem-height-region',
        requestId,
        plan,
        rasterData,
      }
      worker.postMessage(request, [rasterData.buffer])
    } catch (error) {
      pendingPlanningDemHeightRegionRequests.delete(requestId)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

  if (response.error) {
    throw new Error(response.error)
  }

  return buildPlanningDemHeightRegionFromWorkerResult(response.region)
}

function resolvePlanningDemLocalEditTileBuildPlan(options: {
  definition: GroundRuntimeDynamicMesh
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}): PlanningDemLocalEditTileBuildPlan | null {
  const tileSizeMeters = resolvePlanningDemChunkSizeMeters()
  const resolution = resolvePlanningDemLocalEditTileResolution({
    definition: options.definition,
    sampleStepX: options.source.sampleStepX,
    sampleStepZ: options.source.sampleStepZ,
  })
  if (!(tileSizeMeters > 0) || !(resolution > 0)) {
    return null
  }
  const cellSize = Number.isFinite(options.definition.cellSize) && options.definition.cellSize > 0 ? options.definition.cellSize : 1
  const { originX, originZ } = resolvePlanningDemLocalEditTileOrigin(options.definition)
  const terrainBounds = resolvePlanningDemTargetWorldBounds(options.definition)
  const regionMinX = terrainBounds.minX + options.startColumn * cellSize
  const regionMaxX = terrainBounds.minX + options.endColumn * cellSize
  const regionMinZ = terrainBounds.minZ + options.startRow * cellSize
  const regionMaxZ = terrainBounds.minZ + options.endRow * cellSize
  const minX = Math.max(regionMinX, options.source.sourceWorldBounds.minX)
  const maxX = Math.min(regionMaxX, options.source.sourceWorldBounds.maxX)
  const minZ = Math.max(regionMinZ, options.source.sourceWorldBounds.minZ)
  const maxZ = Math.min(regionMaxZ, options.source.sourceWorldBounds.maxZ)
  if (!(maxX > minX) || !(maxZ > minZ)) {
    return null
  }
  const { startTile: startTileColumn, endTile: endTileColumn } = resolvePlanningDemChunkTileRange({
    minWorld: minX,
    maxWorld: maxX,
    originWorld: originX,
    chunkSizeMeters: tileSizeMeters,
  })
  const { startTile: startTileRow, endTile: endTileRow } = resolvePlanningDemChunkTileRange({
    minWorld: minZ,
    maxWorld: maxZ,
    originWorld: originZ,
    chunkSizeMeters: tileSizeMeters,
  })
  if (!shouldBuildPlanningDemLocalEditTiles({
    startTileRow,
    endTileRow,
    startTileColumn,
    endTileColumn,
    resolution,
  })) {
    return null
  }
  const totalTileRows = Math.max(0, endTileRow - startTileRow + 1)
  const totalTileColumns = Math.max(0, endTileColumn - startTileColumn + 1)
  const totalTiles = totalTileRows * totalTileColumns

  return {
    tileSizeMeters,
    resolution,
    originX,
    originZ,
    startTileRow,
    endTileRow,
    startTileColumn,
    endTileColumn,
    totalTileRows,
    totalTileColumns,
    totalTiles,
    sourceWidth: options.source.width,
    sourceHeight: options.source.height,
    sourceBounds: options.source.sourceWorldBounds,
    elevationOffsetMeters: options.source.elevationOffsetMeters,
  }
}

function buildPlanningDemLocalEditTilesForRegionSyncFromPlan(
  plan: PlanningDemLocalEditTileBuildPlan,
  source: PlanningDemRasterSource,
  onProgress?: (payload: PlanningDemBuildProgress) => void,
): GroundLocalEditTileMap | null {
  if (!(plan.totalTiles > 0)) {
    return null
  }
  const result: GroundLocalEditTileMap = {}
  const reportProgress = createThrottledPlanningDemProgressReporter(onProgress)
  const samplesPerAxis = plan.resolution + 1
  const sampleStepMeters = plan.tileSizeMeters / plan.resolution

  reportProgress({
    phase: 'build-edit-tiles',
    loaded: 0,
    total: plan.totalTiles,
    label: 'Generating terrain edit tiles…',
    detail: plan.totalTiles > 0 ? `0/${plan.totalTiles} tiles` : '0 tiles',
  }, true)

  for (let tileRow = plan.startTileRow; tileRow <= plan.endTileRow; tileRow += 1) {
    for (let tileColumn = plan.startTileColumn; tileColumn <= plan.endTileColumn; tileColumn += 1) {
      const key = formatGroundLocalEditTileKey(tileRow, tileColumn)
      const tileMinX = plan.originX + tileColumn * plan.tileSizeMeters
      const tileMinZ = plan.originZ + tileRow * plan.tileSizeMeters

      const values = new Array<number>(samplesPerAxis * samplesPerAxis)
      for (let row = 0; row <= plan.resolution; row += 1) {
        const z = tileMinZ + row * sampleStepMeters
        const rowOffset = row * samplesPerAxis
        const rowWithinSourceBounds = z >= plan.sourceBounds.minZ && z <= plan.sourceBounds.maxZ
        for (let column = 0; column <= plan.resolution; column += 1) {
          const x = tileMinX + column * sampleStepMeters
          const withinSourceBounds = rowWithinSourceBounds
            && x >= plan.sourceBounds.minX
            && x <= plan.sourceBounds.maxX
          values[rowOffset + column] = withinSourceBounds
            ? samplePlanningDemHeightAtWorld(source, x, z)
            : GROUND_HEIGHT_UNSET_VALUE
        }
      }
      result[key] = {
        key,
        tileRow,
        tileColumn,
        tileSizeMeters: plan.tileSizeMeters,
        resolution: plan.resolution,
        values,
        source: 'dem',
        updatedAt: Date.now(),
      }
      const loadedTiles = (tileRow - plan.startTileRow) * plan.totalTileColumns + (tileColumn - plan.startTileColumn) + 1
      reportProgress({
        phase: 'build-edit-tiles',
        loaded: loadedTiles,
        total: plan.totalTiles,
        label: 'Generating terrain edit tiles…',
        detail: `${loadedTiles}/${plan.totalTiles} tiles`,
      }, loadedTiles === plan.totalTiles)
    }
  }

  return Object.keys(result).length ? harmonizePlanningDemLocalEditTileBoundaryDerivatives(result) : null
}

function harmonizePlanningDemLocalEditTileBoundaryDerivatives(tiles: GroundLocalEditTileMap): GroundLocalEditTileMap {
  const entries = Object.values(tiles)
  if (!entries.length) {
    return tiles
  }

  const lookup = new Map<string, GroundLocalEditTileData>()
  for (const tile of entries) {
    lookup.set(tile.key, tile)
  }

  const proposals = new Map<string, { tile: GroundLocalEditTileData; index: number; sum: number; count: number }>()
  const propose = (tile: GroundLocalEditTileData, index: number, value: number) => {
    if (!Number.isFinite(value) || index < 0 || index >= tile.values.length) {
      return
    }
    const key = `${tile.key}:${index}`
    const existing = proposals.get(key)
    if (existing) {
      existing.sum += value
      existing.count += 1
      return
    }
    proposals.set(key, { tile, index, sum: value, count: 1 })
  }

  const read = (tile: GroundLocalEditTileData, row: number, column: number, resolution: number): number | null => {
    if (row < 0 || column < 0 || row > resolution || column > resolution) {
      return null
    }
    const value = Number(tile.values[row * (resolution + 1) + column])
    return Number.isFinite(value) ? value : null
  }

  for (const tile of entries) {
    const resolution = Math.max(1, Math.trunc(Number(tile.resolution) || 0))
    if (resolution < 2) {
      continue
    }

    const rightNeighbor = lookup.get(formatGroundLocalEditTileKey(tile.tileRow, tile.tileColumn + 1))
    if (rightNeighbor && rightNeighbor.resolution === tile.resolution && rightNeighbor.tileSizeMeters === tile.tileSizeMeters) {
      for (let row = 0; row <= resolution; row += 1) {
        const edge = read(tile, row, resolution, resolution)
        const leftInner = read(tile, row, resolution - 1, resolution)
        const rightInner = read(rightNeighbor, row, 1, resolution)
        if (!Number.isFinite(edge) || !Number.isFinite(leftInner) || !Number.isFinite(rightInner)) {
          continue
        }
        const averageSlope = (((edge as number) - (leftInner as number)) + ((rightInner as number) - (edge as number))) * 0.5
        propose(tile, row * (resolution + 1) + (resolution - 1), (edge as number) - averageSlope)
        propose(rightNeighbor, row * (resolution + 1) + 1, (edge as number) + averageSlope)
      }
    }

    const downNeighbor = lookup.get(formatGroundLocalEditTileKey(tile.tileRow + 1, tile.tileColumn))
    if (downNeighbor && downNeighbor.resolution === tile.resolution && downNeighbor.tileSizeMeters === tile.tileSizeMeters) {
      for (let column = 0; column <= resolution; column += 1) {
        const edge = read(tile, resolution, column, resolution)
        const topInner = read(tile, resolution - 1, column, resolution)
        const bottomInner = read(downNeighbor, 1, column, resolution)
        if (!Number.isFinite(edge) || !Number.isFinite(topInner) || !Number.isFinite(bottomInner)) {
          continue
        }
        const averageSlope = (((edge as number) - (topInner as number)) + ((bottomInner as number) - (edge as number))) * 0.5
        propose(tile, (resolution - 1) * (resolution + 1) + column, (edge as number) - averageSlope)
        propose(downNeighbor, (resolution + 1) + column, (edge as number) + averageSlope)
      }
    }
  }

  for (const proposal of proposals.values()) {
    proposal.tile.values[proposal.index] = proposal.sum / Math.max(1, proposal.count)
    proposal.tile.updatedAt = Date.now()
  }

  return tiles
}

function buildPlanningDemLocalEditTilesFromWorkerResult(result: PlanningDemLocalEditTilesWorkerResponse['tiles']): GroundLocalEditTileMap | null {
  if (!result.length) {
    return null
  }
  const tiles: GroundLocalEditTileMap = {}
  for (const tile of result) {
    tiles[tile.key] = {
      key: tile.key,
      tileRow: tile.tileRow,
      tileColumn: tile.tileColumn,
      tileSizeMeters: tile.tileSizeMeters,
      resolution: tile.resolution,
      values: tile.values,
      source: tile.source,
      updatedAt: tile.updatedAt,
    }
  }
  return harmonizePlanningDemLocalEditTileBoundaryDerivatives(tiles)
}

async function buildPlanningDemLocalEditTilesForRegionAsync(options: {
  definition: GroundRuntimeDynamicMesh
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  onProgress?: (payload: PlanningDemBuildProgress) => void
  preferWorker?: boolean
}): Promise<GroundLocalEditTileMap | null> {
  const plan = resolvePlanningDemLocalEditTileBuildPlan(options)
  if (!plan) {
    return null
  }
  const worker = options.preferWorker === false ? null : getPlanningDemLocalEditTilesWorker()
  if (!worker) {
    return buildPlanningDemLocalEditTilesForRegionSyncFromPlan(plan, options.source, options.onProgress)
  }
  const reportProgress = createThrottledPlanningDemProgressReporter(options.onProgress)
  reportProgress({
    phase: 'build-edit-tiles',
    loaded: 0,
    total: plan.totalTiles,
    label: 'Generating terrain edit tiles…',
    detail: plan.totalTiles > 0 ? `0/${plan.totalTiles} tiles` : '0 tiles',
  }, true)

  const rasterData = Float64Array.from(options.source.rasterData)
  const requestId = ++planningDemLocalEditTilesRequestId
  const response = await new Promise<PlanningDemLocalEditTilesWorkerResponse>((resolve, reject) => {
    pendingPlanningDemLocalEditTilesRequests.set(requestId, { resolve, reject })
    try {
      const request: PlanningDemLocalEditTilesWorkerRequest = {
        kind: 'build-planning-dem-local-edit-tiles',
        requestId,
        plan,
        rasterData,
      }
      worker.postMessage(request, [rasterData.buffer])
    } catch (error) {
      pendingPlanningDemLocalEditTilesRequests.delete(requestId)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

  if (response.error) {
    throw new Error(response.error)
  }

  reportProgress({
    phase: 'build-edit-tiles',
    loaded: plan.totalTiles,
    total: plan.totalTiles,
    label: 'Generating terrain edit tiles…',
    detail: `${plan.totalTiles}/${plan.totalTiles} tiles`,
  }, true)

  return buildPlanningDemLocalEditTilesFromWorkerResult(response.tiles)
}

export async function buildPlanningDemRegionFromPreparedSource(options: {
  definition: GroundRuntimeDynamicMesh
  prepared: PlanningDemPreparedSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  textureDataUrl?: string | null
  textureName?: string | null
  normalMapDataUrl?: string | null
  normalMapName?: string | null
  onProgress?: (payload: PlanningDemBuildProgress) => void
  preferWorker?: boolean
}): Promise<PlanningDemRegionConversionResult> {
  const reportProgress = createThrottledPlanningDemProgressReporter(options.onProgress)
  const region = await buildPlanningDemHeightRegionAsync({
    definition: options.definition,
    source: options.prepared.rasterSource,
    startRow: options.startRow,
    endRow: options.endRow,
    startColumn: options.startColumn,
    endColumn: options.endColumn,
    onProgress: (payload) => reportProgress(payload),
    preferWorker: options.preferWorker,
  })
  const localEditTiles = await buildPlanningDemLocalEditTilesForRegionAsync({
    definition: options.definition,
    source: options.prepared.rasterSource,
    startRow: region.startRow,
    endRow: region.endRow,
    startColumn: region.startColumn,
    endColumn: region.endColumn,
    onProgress: (payload) => reportProgress(payload),
    preferWorker: options.preferWorker,
  })
  return {
    region,
    localEditTiles,
    planningMetadata: options.prepared.planningMetadata,
  }
}

export function buildPlanningDemLocalEditTilesForRegion(options: {
  definition: GroundRuntimeDynamicMesh
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  onProgress?: (payload: PlanningDemBuildProgress) => void
}): GroundLocalEditTileMap | null {
  // 先根据输入的网格定义、DEM 数据源以及目标行列范围，
  // 解析出本次局部编辑瓦片构建所需的执行计划。
  // 该计划通常会包含需要覆盖的瓦片范围、采样策略以及后续同步构建阶段所需的上下文信息。
  const plan = resolvePlanningDemLocalEditTileBuildPlan(options)
  if (!plan) {
    // 当无法生成有效构建计划时，说明当前给定范围没有可构建内容，
    // 或输入条件不足以支持后续瓦片生成流程。
    // 此时直接返回 null，调用方可据此判断本次区域无需生成局部编辑瓦片。
    return null
  }

  // 若计划解析成功，则基于该计划和原始栅格数据源执行同步构建。
  // onProgress 回调会在构建过程中持续向外部报告进度，
  // 便于界面或任务调度逻辑及时更新状态。
  return buildPlanningDemLocalEditTilesForRegionSyncFromPlan(plan, options.source, options.onProgress)
}

function sampleArrayLikeBilinearFinite(values: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const clampedX = Math.max(0, Math.min(Math.max(0, width - 1), x))
  const clampedY = Math.max(0, Math.min(Math.max(0, height - 1), y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = clampedX - x0
  const ty = clampedY - y0
  let weightedSum = 0
  let totalWeight = 0

  const weight00 = (1 - tx) * (1 - ty)
  const value00 = Number(values[y0 * width + x0])
  if (Number.isFinite(value00)) {
    weightedSum += value00 * weight00
    totalWeight += weight00
  }

  const weight10 = tx * (1 - ty)
  const value10 = Number(values[y0 * width + x1])
  if (Number.isFinite(value10)) {
    weightedSum += value10 * weight10
    totalWeight += weight10
  }

  const weight01 = (1 - tx) * ty
  const value01 = Number(values[y1 * width + x0])
  if (Number.isFinite(value01)) {
    weightedSum += value01 * weight01
    totalWeight += weight01
  }

  const weight11 = tx * ty
  const value11 = Number(values[y1 * width + x1])
  if (Number.isFinite(value11)) {
    weightedSum += value11 * weight11
    totalWeight += weight11
  }
  if (totalWeight > 0) {
    return weightedSum / totalWeight
  }

  return 0
}


function computeDemSampleStepAxis(parsedWidth: number, parsedHeight: number, worldBounds: { minX: number; minY: number; maxX: number; maxY: number } | null, axis: 'x' | 'y'): number | null {
  if (!worldBounds) {
    return null
  }
  const span = axis === 'x'
    ? Math.abs(worldBounds.maxX - worldBounds.minX)
    : Math.abs(worldBounds.maxY - worldBounds.minY)
  const segments = Math.max(1, (axis === 'x' ? parsedWidth : parsedHeight) - 1)
  if (!(span > 0) || !(segments > 0)) {
    return null
  }
  return span / segments
}

export async function resolvePlanningDemPreparedSource(options: {
  definition: GroundRuntimeDynamicMesh
  terrainDem: PlanningTerrainDemData
}): Promise<PlanningDemPreparedSource> {
  const { definition, terrainDem } = options
  if (terrainDem.resolutionMode !== 'auto' && terrainDem.resolutionMode !== 'manual') {
    throw new Error('DEM resolution mode is missing or invalid')
  }
  const appliedSampleStepMeters = Number(terrainDem.appliedSampleStepMeters)
  if (!Number.isFinite(appliedSampleStepMeters) || appliedSampleStepMeters <= 0) {
    throw new Error('DEM applied sample step is missing or invalid')
  }
  const targetChunkResolution = Number(terrainDem.targetChunkResolution)
  if (!Number.isFinite(targetChunkResolution) || targetChunkResolution <= 0) {
    throw new Error('DEM chunk subdivision resolution is missing or invalid')
  }
  const demHash = typeof terrainDem.sourceFileHash === 'string' ? terrainDem.sourceFileHash.trim() : ''
  if (!demHash) {
    throw new Error('DEM source hash is missing')
  }
  const blob = await loadPlanningDemBlobByHash(demHash)
  if (!blob) {
    throw new Error('DEM blob is missing from storage')
  }

  const parsed = await parsePlanningDemBlob(
    blob,
    terrainDem.filename ?? 'DEM',
    (terrainDem.mimeType ?? blob.type) || null,
    {
      heightmapEncoding: terrainDem.heightmapEncoding ?? null,
      minElevation: terrainDem.minElevation ?? null,
      maxElevation: terrainDem.maxElevation ?? null,
      createPreview: false,
      worldBoundsOverride: isPlanningDemHeightmapImageSource(terrainDem.filename ?? '', terrainDem.mimeType ?? null)
        ? (terrainDem.worldBounds ?? null)
        : null,
    },
  )
  const rasterData = parsed.rasterData
  if (!rasterData || !parsed.width || !parsed.height) {
    throw new Error('DEM raster is empty')
  }

  const demWidth = parsed.width
  const demHeight = parsed.height
  const gridSize = resolveGroundWorkingGridSize(definition)
  const targetRows = Math.max(1, Math.trunc(gridSize.rows))
  const targetColumns = Math.max(1, Math.trunc(gridSize.columns))
  const targetCellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const localEditTileSizeMeters = resolvePlanningDemChunkSizeMeters()
  const targetWorldBounds = resolvePlanningDemTargetWorldBounds(definition, {
    demWidth,
    demHeight,
    worldBounds: parsed.worldBounds,
  })
  const tileLayout = resolvePlanningDemSourceTileLayout({
    definition,
    demWidth,
    demHeight,
    worldBounds: parsed.worldBounds,
    targetWorldBounds,
  })
  const elevationOffsetMeters = Number.isFinite(parsed.minElevation) ? Math.max(0, Number(parsed.minElevation)) : 0
  const rasterSource = createPlanningDemRasterSource({
    rasterData,
    width: demWidth,
    height: demHeight,
    targetWorldBounds,
    sourceWorldBounds: targetWorldBounds,
    elevationOffsetMeters,
  })
  const sampleStepX = computeDemSampleStepAxis(demWidth, demHeight, parsed.worldBounds, 'x')
  const sampleStepY = computeDemSampleStepAxis(demWidth, demHeight, parsed.worldBounds, 'y')
  const localEditTileResolution = resolvePlanningDemLocalEditTileResolution({
    definition,
    sampleStepX: rasterSource.sampleStepX,
    sampleStepZ: rasterSource.sampleStepZ,
  })
  const localEditCellSize = localEditTileSizeMeters / localEditTileResolution
  const effectiveSourceStep = [sampleStepX, sampleStepY, parsed.sampleStepMeters]
    .filter((value): value is number => Number.isFinite(value as number) && (value as number) > 0)
    .reduce<number | null>((smallest, value) => smallest === null ? value : Math.min(smallest, value), null)

  return {
    parsed,
    rasterSource,
    tileLayout,
    planningMetadata: {
      contourBounds: null,
      generatedAt: Date.now(),
      demSource: {
        sourceFileHash: parsed.sourceFileHash,
        filename: parsed.filename,
        mimeType: parsed.mimeType,
        width: demWidth,
        height: demHeight,
        minElevation: parsed.minElevation,
        maxElevation: parsed.maxElevation,
        sampleStepMeters: parsed.sampleStepMeters,
        sampleStepX,
        sampleStepY,
        appliedSampleStepMeters,
        elevationOffsetMeters,
        worldBounds: parsed.worldBounds
          ? {
              minX: parsed.worldBounds.minX,
              minY: parsed.worldBounds.minY,
              maxX: parsed.worldBounds.maxX,
              maxY: parsed.worldBounds.maxY,
            }
          : null,
        targetRows,
        targetColumns,
        targetCellSize,
        localEditCellSize,
        localEditTileSizeMeters,
        localEditTileResolution: Math.round(targetChunkResolution),
        tileLayout,
        detailLimitedByGroundGrid: effectiveSourceStep !== null && targetCellSize > effectiveSourceStep,
        detailLimitedByEditResolution: effectiveSourceStep !== null && localEditCellSize > effectiveSourceStep,
      },
    },
  }
}

export function resolvePlanningDemPreparedSourceFromRaster(options: {
  definition: GroundRuntimeDynamicMesh
  rasterData: ArrayLike<number>
  width: number
  height: number
  targetWorldBounds: PlanningDemTargetWorldBounds
  sourceTransform?: PlanningDemSourceTransform | null
  sourceFileHash?: string | null
  filename?: string | null
  mimeType?: string | null
  sampleStepMeters?: number | null
  elevationOffsetMeters?: number | null
}): PlanningDemPreparedSource {
  const parsedWidth = Math.max(1, Math.trunc(options.width))
  const parsedHeight = Math.max(1, Math.trunc(options.height))
  const sampleStepMeters = Number(options.sampleStepMeters)
  const safeSampleStepMeters = Number.isFinite(sampleStepMeters) && sampleStepMeters > 0 ? sampleStepMeters : 1
  const sourceTransform = normalizePlanningDemSourceTransform(options.sourceTransform ?? null)
  const worldBounds = resolvePlanningDemSourceWorldBounds(options.targetWorldBounds, sourceTransform)
  const sourceWorldBounds: PlanningDemTargetWorldBounds = {
    minX: worldBounds.minX,
    minZ: worldBounds.minY,
    maxX: worldBounds.maxX,
    maxZ: worldBounds.maxY,
  }
  const sourceFileHash = typeof options.sourceFileHash === 'string' && options.sourceFileHash.trim().length > 0
    ? options.sourceFileHash.trim()
    : `terrain-tools-brush-dem:${parsedWidth}x${parsedHeight}`
  const gridSize = resolveGroundWorkingGridSize(options.definition)
  const targetRows = Math.max(1, Math.trunc(gridSize.rows))
  const targetColumns = Math.max(1, Math.trunc(gridSize.columns))
  const targetCellSize = Number.isFinite(options.definition.cellSize) && options.definition.cellSize > 0 ? options.definition.cellSize : 1
  const localEditTileSizeMeters = resolvePlanningDemChunkSizeMeters()
  const localEditTileResolution = resolvePlanningDemLocalEditTileResolution({
    definition: options.definition,
    sampleStepX: safeSampleStepMeters,
    sampleStepZ: safeSampleStepMeters,
  })
  const localEditCellSize = localEditTileSizeMeters / localEditTileResolution
  const tileLayout = resolvePlanningDemSourceTileLayout({
    definition: options.definition,
    demWidth: parsedWidth,
    demHeight: parsedHeight,
    worldBounds,
    targetWorldBounds: options.targetWorldBounds,
  })
  const { min, max } = computePlanningDemRasterMinMax(options.rasterData)
  const elevationOffsetMeters = Number.isFinite(Number(options.elevationOffsetMeters))
    ? Math.max(0, Number(options.elevationOffsetMeters))
    : 0
  const rasterSource = createPlanningDemRasterSource({
    rasterData: options.rasterData,
    width: parsedWidth,
    height: parsedHeight,
    targetWorldBounds: options.targetWorldBounds,
    sourceWorldBounds,
    elevationOffsetMeters,
    sourceTransform,
  })

  return {
    parsed: {
      sourceFileHash,
      filename: typeof options.filename === 'string' && options.filename.trim().length > 0
        ? options.filename.trim()
        : 'Terrain Tools Brush DEM',
      mimeType: options.mimeType ?? 'application/x-planning-brush-dem',
      width: parsedWidth,
      height: parsedHeight,
      rasterData: options.rasterData,
      rawMinElevation: min,
      recommendedAppliedMinElevation: min,
      minElevation: min,
      maxElevation: max,
      sampleStepMeters: safeSampleStepMeters,
      projectedCrs: null,
      geographicBounds: null,
      projectedBounds: null,
      worldBounds,
      preview: null,
      orthophoto: null,
    },
    rasterSource,
    tileLayout,
    planningMetadata: {
      contourBounds: null,
      generatedAt: Date.now(),
      demSource: {
        sourceFileHash,
        filename: typeof options.filename === 'string' && options.filename.trim().length > 0
          ? options.filename.trim()
          : 'Terrain Tools Brush DEM',
        mimeType: options.mimeType ?? 'application/x-planning-brush-dem',
        width: parsedWidth,
        height: parsedHeight,
        minElevation: min,
        maxElevation: max,
        elevationOffsetMeters,
        sampleStepMeters: safeSampleStepMeters,
        appliedSampleStepMeters: safeSampleStepMeters,
        sampleStepX: safeSampleStepMeters,
        sampleStepY: safeSampleStepMeters,
        worldBounds,
        targetRows,
        targetColumns,
        targetCellSize,
        localEditCellSize,
        localEditTileSizeMeters,
        localEditTileResolution,
        tileLayout,
        detailLimitedByGroundGrid: targetCellSize > safeSampleStepMeters,
        detailLimitedByEditResolution: localEditCellSize > safeSampleStepMeters,
      },
    },
  }
}

export function resolvePlanningDemTargetWorldBounds(
  definition: GroundRuntimeDynamicMesh,
  source?: {
    demWidth: number
    demHeight: number
    worldBounds: { minX: number; minY: number; maxX: number; maxY: number } | null
  },
): PlanningDemTargetWorldBounds {
  if (!source) {
    const bounds = resolveGroundWorldBounds(definition)
    return {
      minX: bounds.minX,
      minZ: bounds.minZ,
      maxX: bounds.maxX,
      maxZ: bounds.maxZ,
    }
  }
  const sourceSpan = resolvePlanningDemSourceSpan(source)
  return {
    minX: -sourceSpan.widthMeters * 0.5,
    minZ: -sourceSpan.depthMeters * 0.5,
    maxX: sourceSpan.widthMeters * 0.5,
    maxZ: sourceSpan.depthMeters * 0.5,
  }
}

export function createPlanningDemRasterSource(options: {
  rasterData: ArrayLike<number>
  width: number
  height: number
  targetWorldBounds: PlanningDemTargetWorldBounds
  sourceWorldBounds: PlanningDemTargetWorldBounds
  elevationOffsetMeters?: number
  sourceTransform?: PlanningDemSourceTransform | null
}): PlanningDemRasterSource {
  const worldWidth = Math.max(Number.EPSILON, options.targetWorldBounds.maxX - options.targetWorldBounds.minX)
  const worldDepth = Math.max(Number.EPSILON, options.targetWorldBounds.maxZ - options.targetWorldBounds.minZ)
  const widthSegments = Math.max(1, options.width - 1)
  const heightSegments = Math.max(1, options.height - 1)
  return {
    rasterData: options.rasterData,
    width: options.width,
    height: options.height,
    targetWorldBounds: options.targetWorldBounds,
    sourceWorldBounds: options.sourceWorldBounds,
    sampleStepX: worldWidth / widthSegments,
    sampleStepZ: worldDepth / heightSegments,
    elevationOffsetMeters: Number.isFinite(options.elevationOffsetMeters) ? Math.max(0, Number(options.elevationOffsetMeters)) : 0,
    sourceTransform: normalizePlanningDemSourceTransform(options.sourceTransform ?? null),
  }
}

function resolvePlanningDemSampleCoordinate(world: number, minWorld: number, sampleStep: number, maxIndex: number): number {
  if (!(maxIndex > 0)) {
    return 0
  }
  const safeStep = Math.max(Number.EPSILON, sampleStep)
  const rawIndex = (world - minWorld) / safeStep
  const clampedIndex = Math.max(0, Math.min(maxIndex, rawIndex))
  const roundedIndex = Math.round(clampedIndex)
  return Math.abs(clampedIndex - roundedIndex) <= 1e-7 ? roundedIndex : clampedIndex
}

export function samplePlanningDemHeightAtWorld(
  source: PlanningDemRasterSource,
  x: number,
  z: number,
): number {
  const localPoint = resolvePlanningDemWorldPointToSourceLocal(source, x, z)
  const demX = resolvePlanningDemSampleCoordinate(
    localPoint.x,
    source.targetWorldBounds.minX,
    source.sampleStepX,
    Math.max(0, source.width - 1),
  )
  const demY = resolvePlanningDemSampleCoordinate(
    localPoint.z,
    source.targetWorldBounds.minZ,
    source.sampleStepZ,
    Math.max(0, source.height - 1),
  )
  return sampleArrayLikeBilinearFinite(source.rasterData, source.width, source.height, demX, demY) - source.elevationOffsetMeters
}

export function buildPlanningDemHeightRegion(options: {
  definition: GroundRuntimeDynamicMesh
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  onProgress?: (payload: PlanningDemBuildProgress) => void
}): PlanningDemHeightRegion {
  const plan = resolvePlanningDemHeightRegionBuildPlan(options)
  if (!plan) {
    return {
      startRow: options.startRow,
      endRow: options.endRow,
      startColumn: options.startColumn,
      endColumn: options.endColumn,
      vertexRows: 0,
      vertexColumns: 0,
      values: new Float64Array(0),
    }
  }
  return buildPlanningDemHeightRegionSyncFromPlan(plan, options.source, options.onProgress)
}

export function buildPlanningDemTileHeightRegion(options: {
  definition: GroundRuntimeDynamicMesh
  source: PlanningDemRasterSource
  tileLayout: PlanningDemSourceTileLayout
  tileRow: number
  tileColumn: number
}): PlanningDemTileHeightRegion {
  const { definition, source, tileLayout } = options
  const normalizedTileRow = Math.max(0, Math.min(tileLayout.tileRows - 1, Math.trunc(options.tileRow)))
  const normalizedTileColumn = Math.max(0, Math.min(tileLayout.tileColumns - 1, Math.trunc(options.tileColumn)))
  const gridSize = resolveGroundWorkingGridSize(definition)
  const rows = Math.max(1, Math.trunc(gridSize.rows))
  const columns = Math.max(1, Math.trunc(gridSize.columns))
  const startRow = Math.max(0, Math.floor((normalizedTileRow / tileLayout.tileRows) * rows))
  const endRow = normalizedTileRow === tileLayout.tileRows - 1
    ? rows
    : Math.max(startRow, Math.floor(((normalizedTileRow + 1) / tileLayout.tileRows) * rows))
  const startColumn = Math.max(0, Math.floor((normalizedTileColumn / tileLayout.tileColumns) * columns))
  const endColumn = normalizedTileColumn === tileLayout.tileColumns - 1
    ? columns
    : Math.max(startColumn, Math.floor(((normalizedTileColumn + 1) / tileLayout.tileColumns) * columns))
  const region = buildPlanningDemHeightRegion({
    definition,
    source,
    startRow,
    endRow,
    startColumn,
    endColumn,
  })
  return {
    ...region,
    tileRow: normalizedTileRow,
    tileColumn: normalizedTileColumn,
  }
}

export async function buildPlanningDemGroundRegionData(options: {
  definition: GroundRuntimeDynamicMesh
  terrainDem: PlanningTerrainDemData
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  applyOrthophoto?: boolean
  onProgress?: (payload: PlanningDemBuildProgress) => void
}): Promise<PlanningDemRegionConversionResult> {
  const reportProgress = createThrottledPlanningDemProgressReporter(options.onProgress)
  reportProgress({
    phase: 'load-source',
    loaded: 0,
    total: 1,
    label: 'Loading DEM source…',
    detail: '0/1',
  }, true)
  const prepared = await resolvePlanningDemPreparedSource({
    definition: options.definition,
    terrainDem: options.terrainDem,
  })
  reportProgress({
    phase: 'load-source',
    loaded: 1,
    total: 1,
    label: 'Loading DEM source…',
    detail: '1/1',
  }, true)
  reportProgress({
    phase: 'build-base-texture',
    loaded: 1,
    total: 1,
    label: 'Skipping terrain base texture...',
    detail: '1/1',
  }, true)
  const result = await buildPlanningDemRegionFromPreparedSource({
    definition: options.definition,
    prepared,
    startRow: options.startRow,
    endRow: options.endRow,
    startColumn: options.startColumn,
    endColumn: options.endColumn,
    onProgress: (payload) => reportProgress(payload),
  })
  return result
}

export async function buildPlanningDemGroundTileData(options: {
  definition: GroundRuntimeDynamicMesh
  terrainDem: PlanningTerrainDemData
  tileRow: number
  tileColumn: number
  applyOrthophoto?: boolean
}): Promise<PlanningDemTileConversionResult> {
  const prepared = await resolvePlanningDemPreparedSource({
    definition: options.definition,
    terrainDem: options.terrainDem,
  })
  const region = buildPlanningDemTileHeightRegion({
    definition: options.definition,
    source: prepared.rasterSource,
    tileLayout: prepared.tileLayout,
    tileRow: options.tileRow,
    tileColumn: options.tileColumn,
  })
  return {
    region,
    localEditTiles: await buildPlanningDemLocalEditTilesForRegionAsync({
      definition: options.definition,
      source: prepared.rasterSource,
      startRow: region.startRow,
      endRow: region.endRow,
      startColumn: region.startColumn,
      endColumn: region.endColumn,
    }),
    planningMetadata: prepared.planningMetadata,
  }
}

export function buildGroundRegionDataFromRaster(options: {
  definition: GroundRuntimeDynamicMesh
  rasterData: ArrayLike<number>
  width: number
  height: number
  targetWorldBounds: PlanningDemTargetWorldBounds
  sourceTransform?: PlanningDemSourceTransform | null
  sourceFileHash?: string | null
  filename?: string | null
  mimeType?: string | null
  sampleStepMeters?: number | null
  elevationOffsetMeters?: number | null
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  onProgress?: (payload: PlanningDemBuildProgress) => void
}): PlanningDemRegionConversionResult {
  // 先将原始栅格数据整理为内部统一使用的数据源结构。
  const prepared = resolvePlanningDemPreparedSourceFromRaster({
    definition: options.definition,
    rasterData: options.rasterData,
    width: options.width,
    height: options.height,
    targetWorldBounds: options.targetWorldBounds,
    sourceTransform: options.sourceTransform ?? null,
    sourceFileHash: options.sourceFileHash ?? null,
    filename: options.filename ?? 'Terrain Tools Brush DEM',
    mimeType: options.mimeType ?? 'application/x-planning-brush-dem',
    sampleStepMeters: options.sampleStepMeters ?? 1,
    elevationOffsetMeters: options.elevationOffsetMeters ?? 0,
  })
  // 使用节流后的进度回调，避免高频通知影响交互性能。
  const reportProgress = createThrottledPlanningDemProgressReporter(options.onProgress)
  // 根据指定行列范围生成地面高度区域数据。
  const region = buildPlanningDemHeightRegion({
    definition: options.definition,
    source: prepared.rasterSource,
    startRow: options.startRow,
    endRow: options.endRow,
    startColumn: options.startColumn,
    endColumn: options.endColumn,
    onProgress: (payload) => reportProgress(payload),
  })
  // 基于已生成的区域边界，继续构建对应的本地编辑瓦片。
  const localEditTiles = buildPlanningDemLocalEditTilesForRegion({
    definition: options.definition,
    source: prepared.rasterSource,
    startRow: region.startRow,
    endRow: region.endRow,
    startColumn: region.startColumn,
    endColumn: region.endColumn,
    onProgress: (payload) => reportProgress(payload),
  })

  return {
    region,
    localEditTiles,
    planningMetadata: prepared.planningMetadata,
  }
}

export function resolvePlanningDemSourceTileLayout(options: {
  definition: GroundRuntimeDynamicMesh
  demWidth: number
  demHeight: number
  worldBounds: { minX: number; minY: number; maxX: number; maxY: number } | null
  targetWorldBounds: PlanningDemTargetWorldBounds
}): PlanningDemSourceTileLayout {
  const { definition, demWidth, demHeight, targetWorldBounds } = options
  const localEditTileSizeMeters = resolvePlanningDemChunkSizeMeters()
  const worldWidth = Math.max(localEditTileSizeMeters, targetWorldBounds.maxX - targetWorldBounds.minX)
  const worldHeight = Math.max(localEditTileSizeMeters, targetWorldBounds.maxZ - targetWorldBounds.minZ)
  const sourceStepX = worldWidth / Math.max(1, demWidth - 1)
  const sourceStepY = worldHeight / Math.max(1, demHeight - 1)
  const localEditTileResolution = resolvePlanningDemLocalEditTileResolution({
    definition,
    sampleStepX: sourceStepX,
    sampleStepZ: sourceStepY,
  })
  const localEditCellSize = localEditTileSizeMeters / localEditTileResolution
  const { originX, originZ } = resolvePlanningDemLocalEditTileOrigin(definition)
  const tileColumnRange = resolvePlanningDemChunkTileRange({
    minWorld: targetWorldBounds.minX,
    maxWorld: targetWorldBounds.maxX,
    originWorld: originX,
    chunkSizeMeters: localEditTileSizeMeters,
  })
  const tileRowRange = resolvePlanningDemChunkTileRange({
    minWorld: targetWorldBounds.minZ,
    maxWorld: targetWorldBounds.maxZ,
    originWorld: originZ,
    chunkSizeMeters: localEditTileSizeMeters,
  })
  const tileColumns = Math.max(1, tileColumnRange.endTile - tileColumnRange.startTile + 1)
  const tileRows = Math.max(1, tileRowRange.endTile - tileRowRange.startTile + 1)
  const tileWorldWidth = localEditTileSizeMeters
  const tileWorldHeight = localEditTileSizeMeters
  const sourceSamplesPerTileX = Math.max(1, Math.ceil(tileWorldWidth / Math.max(sourceStepX, Number.EPSILON)) + 1)
  const sourceSamplesPerTileY = Math.max(1, Math.ceil(tileWorldHeight / Math.max(sourceStepY, Number.EPSILON)) + 1)
  const targetSamplesPerTileX = Math.max(1, Math.ceil(tileWorldWidth / Math.max(localEditCellSize, Number.EPSILON)) + 1)
  const targetSamplesPerTileY = Math.max(1, Math.ceil(tileWorldHeight / Math.max(localEditCellSize, Number.EPSILON)) + 1)
  return {
    tileRows,
    tileColumns,
    tileWorldWidth,
    tileWorldHeight,
    sourceSamplesPerTileX,
    sourceSamplesPerTileY,
    targetSamplesPerTileX,
    targetSamplesPerTileY,
  }
}

export async function buildPlanningDemGroundData(options: {
  definition: GroundRuntimeDynamicMesh
  terrainDem: PlanningTerrainDemData
  applyOrthophoto?: boolean
}): Promise<PlanningDemGroundConversionResult> {
  const { definition, terrainDem } = options
  const gridSize = resolveGroundWorkingGridSize(definition)
  const rows = Math.max(1, Math.trunc(gridSize.rows))
  const columns = Math.max(1, Math.trunc(gridSize.columns))
  const heightMap = createGroundHeightMap(rows, columns)
  const prepared = await resolvePlanningDemPreparedSource({ definition, terrainDem })
  const fullRegionResult = await buildPlanningDemRegionFromPreparedSource({
    definition,
    prepared,
    startRow: 0,
    endRow: rows,
    startColumn: 0,
    endColumn: columns,
  })
  const fullRegion = fullRegionResult.region
  for (let row = fullRegion.startRow; row <= fullRegion.endRow; row += 1) {
    const sourceOffset = (row - fullRegion.startRow) * fullRegion.vertexColumns
    for (let column = fullRegion.startColumn; column <= fullRegion.endColumn; column += 1) {
      heightMap[getGroundVertexIndex(columns, row, column)] = fullRegion.values[sourceOffset + (column - fullRegion.startColumn)] ?? 0
    }
  }
  const localEditTiles = buildPlanningDemLocalEditTilesForRegion({
    definition,
    source: prepared.rasterSource,
    startRow: 0,
    endRow: rows,
    startColumn: 0,
    endColumn: columns,
  })

  return {
    terrainHeightMap: heightMap,
    localEditTiles,
    planningMetadata: fullRegionResult.planningMetadata,
  }
}

