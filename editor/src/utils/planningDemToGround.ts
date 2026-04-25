import type { GroundHeightMap, GroundLocalEditTileMap, GroundRuntimeDynamicMesh } from '@schema'
import {
  createGroundHeightMap,
  formatGroundLocalEditTileKey,
  getGroundVertexIndex,
  resolveGroundEditCellSize,
  resolveGroundEditTileResolution,
  resolveGroundEditTileSizeMeters,
  type GroundPlanningMetadata,
} from '@schema'
import type { PlanningTerrainDemData } from '@/types/planning-scene-data'
import { loadPlanningDemBlobByHash } from '@/utils/planningDemStorage'
import { parsePlanningDemBlob } from '@/utils/planningDemImport'

export interface PlanningDemGroundConversionResult {
  planningHeightMap: GroundHeightMap
  localEditTiles: GroundLocalEditTileMap | null
  planningMetadata: GroundPlanningMetadata
  textureDataUrl: string | null
  textureName: string | null
}

export interface PlanningDemRegionConversionResult {
  region: PlanningDemHeightRegion
  localEditTiles: GroundLocalEditTileMap | null
  planningMetadata: GroundPlanningMetadata
  textureDataUrl: string | null
  textureName: string | null
}

export interface PlanningDemTileConversionResult {
  region: PlanningDemTileHeightRegion
  localEditTiles: GroundLocalEditTileMap | null
  planningMetadata: GroundPlanningMetadata
  textureDataUrl: string | null
  textureName: string | null
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

function buildPlanningDemRegionFromPreparedSource(options: {
  definition: GroundRuntimeDynamicMesh
  prepared: PlanningDemPreparedSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  textureDataUrl?: string | null
  textureName?: string | null
}): PlanningDemRegionConversionResult {
  const region = buildPlanningDemHeightRegion({
    definition: options.definition,
    source: options.prepared.rasterSource,
    startRow: options.startRow,
    endRow: options.endRow,
    startColumn: options.startColumn,
    endColumn: options.endColumn,
  })
  return {
    region,
    localEditTiles: buildPlanningDemLocalEditTilesForRegion({
      definition: options.definition,
      source: options.prepared.rasterSource,
      startRow: region.startRow,
      endRow: region.endRow,
      startColumn: region.startColumn,
      endColumn: region.endColumn,
    }),
    planningMetadata: options.prepared.planningMetadata,
    textureDataUrl: options.textureDataUrl ?? null,
    textureName: options.textureName ?? null,
  }
}

export function buildPlanningDemLocalEditTilesForRegion(options: {
  definition: Pick<GroundRuntimeDynamicMesh, 'width' | 'depth' | 'editTileSizeMeters' | 'tileSizeMeters' | 'editTileResolution' | 'tileResolution' | 'cellSize'>
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}): GroundLocalEditTileMap | null {
  const tileSizeMeters = resolveGroundEditTileSizeMeters(options.definition)
  const resolution = resolveGroundEditTileResolution(options.definition)
  if (!(tileSizeMeters > 0) || !(resolution > 0)) {
    return null
  }
  const cellSize = Number.isFinite(options.definition.cellSize) && options.definition.cellSize > 0 ? options.definition.cellSize : 1
  const halfWidth = options.definition.width * 0.5
  const halfDepth = options.definition.depth * 0.5
  const minX = -halfWidth + options.startColumn * cellSize
  const maxX = -halfWidth + options.endColumn * cellSize
  const minZ = -halfDepth + options.startRow * cellSize
  const maxZ = -halfDepth + options.endRow * cellSize
  const startTileColumn = Math.max(0, Math.floor((minX + halfWidth) / tileSizeMeters))
  const endTileColumn = Math.max(startTileColumn, Math.floor((maxX + halfWidth) / tileSizeMeters))
  const startTileRow = Math.max(0, Math.floor((minZ + halfDepth) / tileSizeMeters))
  const endTileRow = Math.max(startTileRow, Math.floor((maxZ + halfDepth) / tileSizeMeters))
  const result: GroundLocalEditTileMap = {}

  for (let tileRow = startTileRow; tileRow <= endTileRow; tileRow += 1) {
    for (let tileColumn = startTileColumn; tileColumn <= endTileColumn; tileColumn += 1) {
      const key = formatGroundLocalEditTileKey(tileRow, tileColumn)
      const tileMinX = -halfWidth + tileColumn * tileSizeMeters
      const tileMinZ = -halfDepth + tileRow * tileSizeMeters
      const values = new Array<number>((resolution + 1) * (resolution + 1))
      for (let row = 0; row <= resolution; row += 1) {
        const z = tileMinZ + (row / resolution) * tileSizeMeters
        for (let column = 0; column <= resolution; column += 1) {
          const x = tileMinX + (column / resolution) * tileSizeMeters
          values[row * (resolution + 1) + column] = samplePlanningDemHeightAtWorld(options.source, x, z)
        }
      }
      result[key] = {
        key,
        tileRow,
        tileColumn,
        tileSizeMeters,
        resolution,
        values,
        source: 'dem',
        updatedAt: Date.now(),
      }
    }
  }

  return Object.keys(result).length ? result : null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function sampleArrayLikeBilinear(values: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const clampedX = Math.max(0, Math.min(Math.max(0, width - 1), x))
  const clampedY = Math.max(0, Math.min(Math.max(0, height - 1), y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = clampedX - x0
  const ty = clampedY - y0

  const v00 = Number(values[y0 * width + x0])
  const v10 = Number(values[y0 * width + x1])
  const v01 = Number(values[y1 * width + x0])
  const v11 = Number(values[y1 * width + x1])

  const a = v00 + (v10 - v00) * tx
  const b = v01 + (v11 - v01) * tx
  return a + (b - a) * ty
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as data URL'))
    reader.readAsDataURL(blob)
  })
}

async function resolvePlanningDemOrthophotoTexture(options: {
  terrainDem: PlanningTerrainDemData
  applyOrthophoto?: boolean
}): Promise<{ textureDataUrl: string | null; textureName: string | null }> {
  const orthophoto = options.terrainDem.orthophoto
  if (options.applyOrthophoto === false || !orthophoto?.sourceFileHash) {
    return { textureDataUrl: null, textureName: null }
  }
  const orthoBlob = await loadPlanningDemBlobByHash(orthophoto.sourceFileHash)
  if (!orthoBlob) {
    return { textureDataUrl: null, textureName: null }
  }
  return {
    textureDataUrl: await blobToDataUrl(orthoBlob),
    textureName: orthophoto.filename ?? options.terrainDem.filename ?? 'Orthophoto',
  }
}

function computeDemSampleStepAxis(parsedWidth: number, parsedHeight: number, worldBounds: { minX: number; minY: number; maxX: number; maxY: number } | null, axis: 'x' | 'y'): number | null {
  if (!worldBounds) {
    return null
  }
  const span = axis === 'x'
    ? Math.abs(worldBounds.maxX - worldBounds.minX)
    : Math.abs(worldBounds.maxY - worldBounds.minY)
  const samples = axis === 'x' ? parsedWidth : parsedHeight
  if (!(span > 0) || !(samples > 0)) {
    return null
  }
  return span / Math.max(1, samples)
}

async function resolvePlanningDemPreparedSource(options: {
  definition: GroundRuntimeDynamicMesh
  terrainDem: PlanningTerrainDemData
}): Promise<PlanningDemPreparedSource> {
  const { definition, terrainDem } = options
  const demHash = typeof terrainDem.sourceFileHash === 'string' ? terrainDem.sourceFileHash.trim() : ''
  if (!demHash) {
    throw new Error('DEM source hash is missing')
  }
  const blob = await loadPlanningDemBlobByHash(demHash)
  if (!blob) {
    throw new Error('DEM blob is missing from storage')
  }

  const parsed = await parsePlanningDemBlob(blob, terrainDem.filename ?? 'DEM', (terrainDem.mimeType ?? blob.type) || null)
  const rasterData = parsed.rasterData
  if (!rasterData || !parsed.width || !parsed.height) {
    throw new Error('DEM raster is empty')
  }

  const demWidth = parsed.width
  const demHeight = parsed.height
  const targetRows = Math.max(1, Math.trunc(definition.rows))
  const targetColumns = Math.max(1, Math.trunc(definition.columns))
  const targetCellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const localEditCellSize = resolveGroundEditCellSize(definition)
  const localEditTileSizeMeters = resolveGroundEditTileSizeMeters(definition)
  const localEditTileResolution = resolveGroundEditTileResolution(definition)
  const tileLayout = resolvePlanningDemSourceTileLayout({
    definition,
    demWidth,
    demHeight,
    worldBounds: parsed.worldBounds,
  })
  const rasterSource = createPlanningDemRasterSource({
    rasterData,
    width: demWidth,
    height: demHeight,
    definition,
  })
  const sampleStepX = computeDemSampleStepAxis(demWidth, demHeight, parsed.worldBounds, 'x')
  const sampleStepY = computeDemSampleStepAxis(demWidth, demHeight, parsed.worldBounds, 'y')
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
        localEditTileResolution,
        tileLayout,
        detailLimitedByGroundGrid: effectiveSourceStep !== null && targetCellSize > effectiveSourceStep,
        detailLimitedByEditResolution: effectiveSourceStep !== null && localEditCellSize > effectiveSourceStep,
      },
    },
  }
}

export function resolvePlanningDemTargetWorldBounds(
  definition: Pick<GroundRuntimeDynamicMesh, 'width' | 'depth'>,
): PlanningDemTargetWorldBounds {
  const width = Number.isFinite(definition.width) && definition.width > 0 ? definition.width : 1
  const depth = Number.isFinite(definition.depth) && definition.depth > 0 ? definition.depth : 1
  return {
    minX: -width * 0.5,
    minZ: -depth * 0.5,
    maxX: width * 0.5,
    maxZ: depth * 0.5,
  }
}

export function createPlanningDemRasterSource(options: {
  rasterData: ArrayLike<number>
  width: number
  height: number
  definition: Pick<GroundRuntimeDynamicMesh, 'width' | 'depth'>
}): PlanningDemRasterSource {
  return {
    rasterData: options.rasterData,
    width: options.width,
    height: options.height,
    targetWorldBounds: resolvePlanningDemTargetWorldBounds(options.definition),
  }
}

export function samplePlanningDemHeightAtWorld(
  source: PlanningDemRasterSource,
  x: number,
  z: number,
): number {
  const worldWidth = Math.max(Number.EPSILON, source.targetWorldBounds.maxX - source.targetWorldBounds.minX)
  const worldDepth = Math.max(Number.EPSILON, source.targetWorldBounds.maxZ - source.targetWorldBounds.minZ)
  const tx = clamp01((x - source.targetWorldBounds.minX) / worldWidth)
  const tz = clamp01((z - source.targetWorldBounds.minZ) / worldDepth)
  const demX = tx * Math.max(0, source.width - 1)
  const demY = tz * Math.max(0, source.height - 1)
  return sampleArrayLikeBilinear(source.rasterData, source.width, source.height, demX, demY)
}

export function buildPlanningDemHeightRegion(options: {
  definition: Pick<GroundRuntimeDynamicMesh, 'width' | 'depth' | 'rows' | 'columns' | 'cellSize'>
  source: PlanningDemRasterSource
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}): PlanningDemHeightRegion {
  const { definition, source } = options
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const startRow = Math.max(0, Math.min(rows, Math.trunc(options.startRow)))
  const endRow = Math.max(startRow, Math.min(rows, Math.trunc(options.endRow)))
  const startColumn = Math.max(0, Math.min(columns, Math.trunc(options.startColumn)))
  const endColumn = Math.max(startColumn, Math.min(columns, Math.trunc(options.endColumn)))
  const vertexRows = endRow - startRow + 1
  const vertexColumns = endColumn - startColumn + 1
  const values = new Float64Array(vertexRows * vertexColumns)
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const halfWidth = (Number.isFinite(definition.width) && definition.width > 0 ? definition.width : columns * cellSize) * 0.5
  const halfDepth = (Number.isFinite(definition.depth) && definition.depth > 0 ? definition.depth : rows * cellSize) * 0.5

  for (let row = startRow; row <= endRow; row += 1) {
    const z = -halfDepth + row * cellSize
    const targetRowOffset = (row - startRow) * vertexColumns
    for (let column = startColumn; column <= endColumn; column += 1) {
      const x = -halfWidth + column * cellSize
      const sampled = samplePlanningDemHeightAtWorld(source, x, z)
      values[targetRowOffset + (column - startColumn)] = Number.isFinite(sampled) ? sampled : 0
    }
  }

  return {
    startRow,
    endRow,
    startColumn,
    endColumn,
    vertexRows,
    vertexColumns,
    values,
  }
}

export function buildPlanningDemTileHeightRegion(options: {
  definition: Pick<GroundRuntimeDynamicMesh, 'width' | 'depth' | 'rows' | 'columns' | 'cellSize'>
  source: PlanningDemRasterSource
  tileLayout: PlanningDemSourceTileLayout
  tileRow: number
  tileColumn: number
}): PlanningDemTileHeightRegion {
  const { definition, source, tileLayout } = options
  const normalizedTileRow = Math.max(0, Math.min(tileLayout.tileRows - 1, Math.trunc(options.tileRow)))
  const normalizedTileColumn = Math.max(0, Math.min(tileLayout.tileColumns - 1, Math.trunc(options.tileColumn)))
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
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
}): Promise<PlanningDemRegionConversionResult> {
  const prepared = await resolvePlanningDemPreparedSource({
    definition: options.definition,
    terrainDem: options.terrainDem,
  })
  const texture = await resolvePlanningDemOrthophotoTexture({
    terrainDem: options.terrainDem,
    applyOrthophoto: options.applyOrthophoto,
  })
  return buildPlanningDemRegionFromPreparedSource({
    definition: options.definition,
    prepared,
    startRow: options.startRow,
    endRow: options.endRow,
    startColumn: options.startColumn,
    endColumn: options.endColumn,
    textureDataUrl: texture.textureDataUrl,
    textureName: texture.textureName,
  })
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
  const texture = await resolvePlanningDemOrthophotoTexture({
    terrainDem: options.terrainDem,
    applyOrthophoto: options.applyOrthophoto,
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
    localEditTiles: buildPlanningDemLocalEditTilesForRegion({
      definition: options.definition,
      source: prepared.rasterSource,
      startRow: region.startRow,
      endRow: region.endRow,
      startColumn: region.startColumn,
      endColumn: region.endColumn,
    }),
    planningMetadata: prepared.planningMetadata,
    textureDataUrl: texture.textureDataUrl,
    textureName: texture.textureName,
  }
}

export function resolvePlanningDemSourceTileLayout(options: {
  definition: Pick<GroundRuntimeDynamicMesh, 'width' | 'depth' | 'editTileSizeMeters' | 'tileSizeMeters' | 'editTileResolution' | 'tileResolution' | 'cellSize'>
  demWidth: number
  demHeight: number
  worldBounds: { minX: number; minY: number; maxX: number; maxY: number } | null
}): PlanningDemSourceTileLayout {
  const { definition, demWidth, demHeight, worldBounds } = options
  const localEditCellSize = resolveGroundEditCellSize(definition)
  const localEditTileSizeMeters = resolveGroundEditTileSizeMeters(definition)
  const worldWidth = worldBounds ? Math.abs(worldBounds.maxX - worldBounds.minX) : Math.max(localEditTileSizeMeters, definition.width)
  const worldHeight = worldBounds ? Math.abs(worldBounds.maxY - worldBounds.minY) : Math.max(localEditTileSizeMeters, definition.depth)
  const tileColumns = Math.max(1, Math.ceil(worldWidth / Math.max(localEditTileSizeMeters, Number.EPSILON)))
  const tileRows = Math.max(1, Math.ceil(worldHeight / Math.max(localEditTileSizeMeters, Number.EPSILON)))
  const tileWorldWidth = worldWidth / tileColumns
  const tileWorldHeight = worldHeight / tileRows
  const sourceSamplesPerTileX = Math.max(1, Math.ceil(demWidth / tileColumns))
  const sourceSamplesPerTileY = Math.max(1, Math.ceil(demHeight / tileRows))
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
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const heightMap = createGroundHeightMap(rows, columns)
  const prepared = await resolvePlanningDemPreparedSource({ definition, terrainDem })
  const fullRegionResult = buildPlanningDemRegionFromPreparedSource({
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

  const texture = await resolvePlanningDemOrthophotoTexture({
    terrainDem,
    applyOrthophoto: options.applyOrthophoto,
  })

  return {
    planningHeightMap: heightMap,
    localEditTiles: buildPlanningDemLocalEditTilesForRegion({
      definition,
      source: prepared.rasterSource,
      startRow: 0,
      endRow: rows,
      startColumn: 0,
      endColumn: columns,
    }),
    planningMetadata: fullRegionResult.planningMetadata,
    textureDataUrl: texture.textureDataUrl,
    textureName: texture.textureName ?? (prepared.parsed.orthophoto ? terrainDem.orthophoto?.filename ?? terrainDem.filename ?? 'Orthophoto' : null),
  }
}