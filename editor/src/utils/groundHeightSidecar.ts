import {
  formatGroundLocalEditTileKey,
  getGroundVertexCount,
  type GroundDynamicMesh,
  type GroundLocalEditTileMap,
  type GroundLocalEditTileSource,
  type GroundRuntimeDynamicMesh,
  type GroundPlanningMetadata,
  resolveGroundWorkingGridSize,
} from '@schema'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

export const GROUND_HEIGHTMAP_SIDECAR_FILENAME = 'ground-heightmaps.bin'
export const GROUND_HEIGHTMAP_SIDECAR_VERSION = 5

const GROUND_HEIGHTMAP_SIDECAR_MAGIC = 0x48474d32
const GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES = 40
const EMPTY_BOUND = -1
const FLOAT64_ALIGNMENT_BYTES = Float64Array.BYTES_PER_ELEMENT
const NULL_STRING_BYTE_LENGTH = 0xffffffff
const PLANNING_METADATA_BINARY_FLAGS_WORLD_BOUNDS = 1 << 0
const PLANNING_METADATA_BINARY_FLAGS_TILE_LAYOUT = 1 << 1
const PLANNING_METADATA_BINARY_FLAGS_LIMITED_BY_GROUND_GRID = 1 << 2
const PLANNING_METADATA_BINARY_FLAGS_LIMITED_BY_EDIT_RESOLUTION = 1 << 3
const PLANNING_METADATA_BINARY_FIXED_BYTES = 104
const LOCAL_EDIT_TILE_SECTION_HEADER_BYTES = 8
const LOCAL_EDIT_TILE_BINARY_HEADER_BYTES = 32

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type GroundHeightSidecarHeader = {
  planningMetadata: GroundPlanningMetadata | null
}

type GroundHeightSidecarLayout = {
  metadataByteLength: number
  manualOffset: number
  planningOffset: number
  localEditTilesByteLength: number
  localEditTilesOffset: number
  totalByteLength: number
}

function alignToFloat64Boundary(byteLength: number): number {
  return Math.ceil(byteLength / FLOAT64_ALIGNMENT_BYTES) * FLOAT64_ALIGNMENT_BYTES
}

function resolveGroundHeightSidecarLayout(
  metadataByteLength: number,
  vertexCount: number,
  localEditTilesByteLength = 0,
): GroundHeightSidecarLayout {
  return resolveGroundHeightSidecarLayoutFromHeader(
    GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES,
    metadataByteLength,
    vertexCount,
    localEditTilesByteLength,
  )
}

function resolveGroundHeightSidecarLayoutFromHeader(
  headerByteLength: number,
  metadataByteLength: number,
  vertexCount: number,
  localEditTilesByteLength = 0,
): GroundHeightSidecarLayout {
  const manualOffset = alignToFloat64Boundary(headerByteLength + metadataByteLength)
  const planningOffset = manualOffset + vertexCount * FLOAT64_ALIGNMENT_BYTES
  const localEditTilesOffset = planningOffset + vertexCount * FLOAT64_ALIGNMENT_BYTES
  return {
    metadataByteLength,
    manualOffset,
    planningOffset,
    localEditTilesByteLength,
    localEditTilesOffset,
    totalByteLength: localEditTilesOffset + localEditTilesByteLength,
  }
}

export type GroundHeightSidecarSampler = {
  rows: number
  columns: number
  planningMetadata?: GroundPlanningMetadata | null
  localEditTiles?: GroundLocalEditTileMap | null
  getManualHeight: (row: number, column: number) => number
  getPlanningHeight: (row: number, column: number) => number
  sampleHeightRegion?: (
    kind: 'manual' | 'planning',
    minRowInput: number,
    maxRowInput: number,
    minColumnInput: number,
    maxColumnInput: number,
  ) => {
    minRow: number
    maxRow: number
    minColumn: number
    maxColumn: number
    stride: number
    values: ArrayLike<number>
  }
}

export function getGroundHeightSidecarByteLength(definition: GroundDynamicMesh): number {
  const metadataPayload = encodePlanningMetadataPayload(definition.planningMetadata ?? null)
  const localEditTilesPayload = encodeLocalEditTilesPayload(definition.localEditTiles ?? null)
  const gridSize = resolveGroundWorkingGridSize(definition)
  return resolveGroundHeightSidecarLayout(
    metadataPayload.byteLength,
    getGroundVertexCount(gridSize.rows, gridSize.columns),
    localEditTilesPayload.byteLength,
  ).totalByteLength
}

function normalizeLocalEditTileSource(source: unknown): GroundLocalEditTileSource | null {
  return source === 'manual' || source === 'dem' || source === 'mixed'
    ? source
    : null
}

function normalizeLocalEditTiles(localEditTiles: GroundLocalEditTileMap | null | undefined): GroundLocalEditTileMap | null {
  if (!localEditTiles || typeof localEditTiles !== 'object') {
    return null
  }
  const normalized: GroundLocalEditTileMap = {}
  Object.entries(localEditTiles).forEach(([rawKey, tile]) => {
    if (!tile || typeof tile !== 'object') {
      return
    }
    const resolution = Math.max(1, Math.trunc(Number(tile.resolution) || 0))
    const expectedLength = (resolution + 1) * (resolution + 1)
    const inputValues = Array.isArray(tile.values) ? tile.values : []
    const values = new Array<number>(expectedLength)
    for (let index = 0; index < expectedLength; index += 1) {
      const value = Number(inputValues[index])
      values[index] = Number.isFinite(value) ? value : Number.NaN
    }
    const tileRow = Math.trunc(Number(tile.tileRow) || 0)
    const tileColumn = Math.trunc(Number(tile.tileColumn) || 0)
    const key = typeof tile.key === 'string' && tile.key.trim().length
      ? tile.key.trim()
      : (typeof rawKey === 'string' && rawKey.trim().length ? rawKey.trim() : `${tileRow}:${tileColumn}`)
    normalized[key] = {
      key,
      tileRow,
      tileColumn,
      tileSizeMeters: Number.isFinite(Number(tile.tileSizeMeters)) ? Math.max(0, Number(tile.tileSizeMeters)) : 0,
      resolution,
      values,
      source: normalizeLocalEditTileSource(tile.source),
      updatedAt: Number.isFinite(Number(tile.updatedAt)) ? Number(tile.updatedAt) : undefined,
    }
  })
  return Object.keys(normalized).length ? normalized : null
}

function normalizePlanningDemSourceMetadata(metadata: GroundPlanningMetadata['demSource']): GroundPlanningMetadata['demSource'] {
  if (!metadata || typeof metadata !== 'object') {
    return null
  }
  const width = Math.max(1, Math.trunc(Number(metadata.width) || 0))
  const height = Math.max(1, Math.trunc(Number(metadata.height) || 0))
  const targetRows = Math.max(1, Math.trunc(Number(metadata.targetRows) || 0))
  const targetColumns = Math.max(1, Math.trunc(Number(metadata.targetColumns) || 0))
  const targetCellSize = Number(metadata.targetCellSize)
  return {
    sourceFileHash: typeof metadata.sourceFileHash === 'string' ? metadata.sourceFileHash : null,
    filename: typeof metadata.filename === 'string' ? metadata.filename : null,
    mimeType: typeof metadata.mimeType === 'string' ? metadata.mimeType : null,
    width,
    height,
    minElevation: Number.isFinite(Number(metadata.minElevation)) ? Number(metadata.minElevation) : null,
    maxElevation: Number.isFinite(Number(metadata.maxElevation)) ? Number(metadata.maxElevation) : null,
    elevationOffsetMeters: Number.isFinite(Number(metadata.elevationOffsetMeters)) ? Number(metadata.elevationOffsetMeters) : null,
    sampleStepMeters: Number.isFinite(Number(metadata.sampleStepMeters)) ? Number(metadata.sampleStepMeters) : null,
    appliedSampleStepMeters: Number.isFinite(Number(metadata.appliedSampleStepMeters)) ? Number(metadata.appliedSampleStepMeters) : null,
    sampleStepX: Number.isFinite(Number(metadata.sampleStepX)) ? Number(metadata.sampleStepX) : null,
    sampleStepY: Number.isFinite(Number(metadata.sampleStepY)) ? Number(metadata.sampleStepY) : null,
    worldBounds: metadata.worldBounds
      && Number.isFinite(Number(metadata.worldBounds.minX))
      && Number.isFinite(Number(metadata.worldBounds.minY))
      && Number.isFinite(Number(metadata.worldBounds.maxX))
      && Number.isFinite(Number(metadata.worldBounds.maxY))
      ? {
          minX: Number(metadata.worldBounds.minX),
          minY: Number(metadata.worldBounds.minY),
          maxX: Number(metadata.worldBounds.maxX),
          maxY: Number(metadata.worldBounds.maxY),
        }
      : null,
    targetRows,
    targetColumns,
    targetCellSize: Number.isFinite(targetCellSize) && targetCellSize > 0 ? targetCellSize : 1,
    localEditCellSize: Number.isFinite(Number(metadata.localEditCellSize)) ? Number(metadata.localEditCellSize) : undefined,
    localEditTileSizeMeters: Number.isFinite(Number(metadata.localEditTileSizeMeters)) ? Number(metadata.localEditTileSizeMeters) : undefined,
    localEditTileResolution: Number.isFinite(Number(metadata.localEditTileResolution)) ? Math.max(1, Math.round(Number(metadata.localEditTileResolution))) : undefined,
    tileLayout: metadata.tileLayout
      && Number.isFinite(Number(metadata.tileLayout.tileRows))
      && Number.isFinite(Number(metadata.tileLayout.tileColumns))
      && Number.isFinite(Number(metadata.tileLayout.tileWorldWidth))
      && Number.isFinite(Number(metadata.tileLayout.tileWorldHeight))
      && Number.isFinite(Number(metadata.tileLayout.sourceSamplesPerTileX))
      && Number.isFinite(Number(metadata.tileLayout.sourceSamplesPerTileY))
      && Number.isFinite(Number(metadata.tileLayout.targetSamplesPerTileX))
      && Number.isFinite(Number(metadata.tileLayout.targetSamplesPerTileY))
      ? {
          tileRows: Math.max(1, Math.trunc(Number(metadata.tileLayout.tileRows))),
          tileColumns: Math.max(1, Math.trunc(Number(metadata.tileLayout.tileColumns))),
          tileWorldWidth: Math.max(Number.EPSILON, Number(metadata.tileLayout.tileWorldWidth)),
          tileWorldHeight: Math.max(Number.EPSILON, Number(metadata.tileLayout.tileWorldHeight)),
          sourceSamplesPerTileX: Math.max(1, Math.trunc(Number(metadata.tileLayout.sourceSamplesPerTileX))),
          sourceSamplesPerTileY: Math.max(1, Math.trunc(Number(metadata.tileLayout.sourceSamplesPerTileY))),
          targetSamplesPerTileX: Math.max(1, Math.trunc(Number(metadata.tileLayout.targetSamplesPerTileX))),
          targetSamplesPerTileY: Math.max(1, Math.trunc(Number(metadata.tileLayout.targetSamplesPerTileY))),
        }
      : null,
    detailLimitedByGroundGrid: metadata.detailLimitedByGroundGrid === true,
    detailLimitedByEditResolution: metadata.detailLimitedByEditResolution === true,
  }
}

function normalizePlanningMetadata(metadata: GroundDynamicMesh['planningMetadata']): GroundPlanningMetadata | null {
  if (!metadata || typeof metadata !== 'object') {
    return null
  }
  const contourBounds = metadata.contourBounds
  const generatedAt = Number(metadata.generatedAt)
  const demSource = normalizePlanningDemSourceMetadata(metadata.demSource)
  const hasBounds = Boolean(
    contourBounds
    && Number.isFinite(contourBounds.minRow)
    && Number.isFinite(contourBounds.maxRow)
    && Number.isFinite(contourBounds.minColumn)
    && Number.isFinite(contourBounds.maxColumn),
  )
  const hasGeneratedAt = Number.isFinite(generatedAt)
  if (!hasBounds && !hasGeneratedAt && !demSource) {
    return null
  }
  return {
    contourBounds: hasBounds
      ? {
          minRow: Math.trunc(contourBounds!.minRow),
          maxRow: Math.trunc(contourBounds!.maxRow),
          minColumn: Math.trunc(contourBounds!.minColumn),
          maxColumn: Math.trunc(contourBounds!.maxColumn),
        }
      : null,
    generatedAt: hasGeneratedAt ? generatedAt : undefined,
    demSource,
  }
}

function encodeOptionalString(value: string | null | undefined): Uint8Array | null {
  return typeof value === 'string' ? textEncoder.encode(value) : null
}

function getOptionalStringByteLength(bytes: Uint8Array | null): number {
  return 4 + (bytes?.byteLength ?? 0)
}

function writeOptionalString(target: Uint8Array, view: DataView, offset: number, bytes: Uint8Array | null): number {
  if (!bytes) {
    view.setUint32(offset, NULL_STRING_BYTE_LENGTH, true)
    return offset + 4
  }
  view.setUint32(offset, bytes.byteLength, true)
  target.set(bytes, offset + 4)
  return offset + 4 + bytes.byteLength
}

function readOptionalString(bytes: Uint8Array, view: DataView, offset: number): { value: string | null; offset: number } | null {
  if (offset + 4 > bytes.byteLength) {
    return null
  }
  const byteLength = view.getUint32(offset, true)
  if (byteLength === NULL_STRING_BYTE_LENGTH) {
    return {
      value: null,
      offset: offset + 4,
    }
  }
  const nextOffset = offset + 4 + byteLength
  if (nextOffset > bytes.byteLength) {
    return null
  }
  return {
    value: textDecoder.decode(bytes.subarray(offset + 4, nextOffset)),
    offset: nextOffset,
  }
}

function writeOptionalFloat64(view: DataView, offset: number, value: number | null | undefined): number {
  view.setFloat64(offset, Number.isFinite(value) ? Number(value) : Number.NaN, true)
  return offset + Float64Array.BYTES_PER_ELEMENT
}

function readOptionalFloat64(view: DataView, offset: number): { value: number | undefined; offset: number } {
  const value = view.getFloat64(offset, true)
  return {
    value: Number.isFinite(value) ? value : undefined,
    offset: offset + Float64Array.BYTES_PER_ELEMENT,
  }
}

function encodeLocalEditTileSource(source: GroundLocalEditTileSource | null | undefined): number {
  switch (source) {
    case 'manual':
      return 1
    case 'dem':
      return 2
    case 'mixed':
      return 3
    default:
      return 0
  }
}

function decodeLocalEditTileSource(code: number): GroundLocalEditTileSource | null {
  switch (code) {
    case 1:
      return 'manual'
    case 2:
      return 'dem'
    case 3:
      return 'mixed'
    default:
      return null
  }
}

function encodePlanningMetadataPayload(metadata: GroundPlanningMetadata | null): Uint8Array {
  const normalized = normalizePlanningMetadata(metadata)
  const demSource = normalized?.demSource
  if (!demSource) {
    return new Uint8Array(0)
  }
  const sourceFileHashBytes = encodeOptionalString(demSource.sourceFileHash)
  const filenameBytes = encodeOptionalString(demSource.filename)
  const mimeTypeBytes = encodeOptionalString(demSource.mimeType)
  let flags = 0
  if (demSource.worldBounds) {
    flags |= PLANNING_METADATA_BINARY_FLAGS_WORLD_BOUNDS
  }
  if (demSource.tileLayout) {
    flags |= PLANNING_METADATA_BINARY_FLAGS_TILE_LAYOUT
  }
  if (demSource.detailLimitedByGroundGrid === true) {
    flags |= PLANNING_METADATA_BINARY_FLAGS_LIMITED_BY_GROUND_GRID
  }
  if (demSource.detailLimitedByEditResolution === true) {
    flags |= PLANNING_METADATA_BINARY_FLAGS_LIMITED_BY_EDIT_RESOLUTION
  }
  const totalByteLength = PLANNING_METADATA_BINARY_FIXED_BYTES
    + getOptionalStringByteLength(sourceFileHashBytes)
    + getOptionalStringByteLength(filenameBytes)
    + getOptionalStringByteLength(mimeTypeBytes)
    + ((flags & PLANNING_METADATA_BINARY_FLAGS_WORLD_BOUNDS) !== 0 ? Float64Array.BYTES_PER_ELEMENT * 4 : 0)
    + ((flags & PLANNING_METADATA_BINARY_FLAGS_TILE_LAYOUT) !== 0 ? 40 : 0)
  const buffer = new ArrayBuffer(totalByteLength)
  const view = new DataView(buffer)
  const target = new Uint8Array(buffer)
  let offset = 0
  view.setUint32(offset, flags, true)
  offset += 4
  view.setUint32(offset, demSource.width, true)
  offset += 4
  view.setUint32(offset, demSource.height, true)
  offset += 4
  view.setUint32(offset, demSource.targetRows, true)
  offset += 4
  view.setUint32(offset, demSource.targetColumns, true)
  offset += 4
  view.setUint32(offset, Math.max(0, Math.trunc(Number(demSource.localEditTileResolution) || 0)), true)
  offset += 4
  offset = writeOptionalFloat64(view, offset, demSource.minElevation)
  offset = writeOptionalFloat64(view, offset, demSource.maxElevation)
  offset = writeOptionalFloat64(view, offset, demSource.elevationOffsetMeters)
  offset = writeOptionalFloat64(view, offset, demSource.sampleStepMeters)
  offset = writeOptionalFloat64(view, offset, demSource.appliedSampleStepMeters)
  offset = writeOptionalFloat64(view, offset, demSource.sampleStepX)
  offset = writeOptionalFloat64(view, offset, demSource.sampleStepY)
  offset = writeOptionalFloat64(view, offset, demSource.targetCellSize)
  offset = writeOptionalFloat64(view, offset, demSource.localEditCellSize)
  offset = writeOptionalFloat64(view, offset, demSource.localEditTileSizeMeters)
  offset = writeOptionalString(target, view, offset, sourceFileHashBytes)
  offset = writeOptionalString(target, view, offset, filenameBytes)
  offset = writeOptionalString(target, view, offset, mimeTypeBytes)
  if ((flags & PLANNING_METADATA_BINARY_FLAGS_WORLD_BOUNDS) !== 0 && demSource.worldBounds) {
    view.setFloat64(offset, demSource.worldBounds.minX, true)
    offset += 8
    view.setFloat64(offset, demSource.worldBounds.minY, true)
    offset += 8
    view.setFloat64(offset, demSource.worldBounds.maxX, true)
    offset += 8
    view.setFloat64(offset, demSource.worldBounds.maxY, true)
    offset += 8
  }
  if ((flags & PLANNING_METADATA_BINARY_FLAGS_TILE_LAYOUT) !== 0 && demSource.tileLayout) {
    view.setUint32(offset, demSource.tileLayout.tileRows, true)
    offset += 4
    view.setUint32(offset, demSource.tileLayout.tileColumns, true)
    offset += 4
    view.setFloat64(offset, demSource.tileLayout.tileWorldWidth, true)
    offset += 8
    view.setFloat64(offset, demSource.tileLayout.tileWorldHeight, true)
    offset += 8
    view.setUint32(offset, demSource.tileLayout.sourceSamplesPerTileX, true)
    offset += 4
    view.setUint32(offset, demSource.tileLayout.sourceSamplesPerTileY, true)
    offset += 4
    view.setUint32(offset, demSource.tileLayout.targetSamplesPerTileX, true)
    offset += 4
    view.setUint32(offset, demSource.tileLayout.targetSamplesPerTileY, true)
    offset += 4
  }
  return offset === totalByteLength ? target : target.subarray(0, offset)
}

function decodePlanningMetadataPayload(bytes: Uint8Array): GroundPlanningMetadata | null {
  if (!bytes.byteLength) {
    return null
  }
  try {
    if (bytes.byteLength < PLANNING_METADATA_BINARY_FIXED_BYTES) {
      return null
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    const flags = view.getUint32(offset, true)
    offset += 4
    const width = Math.max(1, view.getUint32(offset, true))
    offset += 4
    const height = Math.max(1, view.getUint32(offset, true))
    offset += 4
    const targetRows = Math.max(1, view.getUint32(offset, true))
    offset += 4
    const targetColumns = Math.max(1, view.getUint32(offset, true))
    offset += 4
    const localEditTileResolutionRaw = view.getUint32(offset, true)
    offset += 4
    const minElevation = readOptionalFloat64(view, offset)
    offset = minElevation.offset
    const maxElevation = readOptionalFloat64(view, offset)
    offset = maxElevation.offset
    const elevationOffsetMeters = readOptionalFloat64(view, offset)
    offset = elevationOffsetMeters.offset
    const sampleStepMeters = readOptionalFloat64(view, offset)
    offset = sampleStepMeters.offset
    const appliedSampleStepMeters = readOptionalFloat64(view, offset)
    offset = appliedSampleStepMeters.offset
    const sampleStepX = readOptionalFloat64(view, offset)
    offset = sampleStepX.offset
    const sampleStepY = readOptionalFloat64(view, offset)
    offset = sampleStepY.offset
    const targetCellSize = readOptionalFloat64(view, offset)
    offset = targetCellSize.offset
    const localEditCellSize = readOptionalFloat64(view, offset)
    offset = localEditCellSize.offset
    const localEditTileSizeMeters = readOptionalFloat64(view, offset)
    offset = localEditTileSizeMeters.offset
    const sourceFileHash = readOptionalString(bytes, view, offset)
    if (!sourceFileHash) {
      return null
    }
    offset = sourceFileHash.offset
    const filename = readOptionalString(bytes, view, offset)
    if (!filename) {
      return null
    }
    offset = filename.offset
    const mimeType = readOptionalString(bytes, view, offset)
    if (!mimeType) {
      return null
    }
    offset = mimeType.offset
    const worldBounds = (flags & PLANNING_METADATA_BINARY_FLAGS_WORLD_BOUNDS) !== 0
      ? {
          minX: view.getFloat64(offset, true),
          minY: view.getFloat64(offset + 8, true),
          maxX: view.getFloat64(offset + 16, true),
          maxY: view.getFloat64(offset + 24, true),
        }
      : null
    if (worldBounds) {
      offset += 32
    }
    const tileLayout = (flags & PLANNING_METADATA_BINARY_FLAGS_TILE_LAYOUT) !== 0
      ? {
          tileRows: Math.max(1, view.getUint32(offset, true)),
          tileColumns: Math.max(1, view.getUint32(offset + 4, true)),
          tileWorldWidth: view.getFloat64(offset + 8, true),
          tileWorldHeight: view.getFloat64(offset + 16, true),
          sourceSamplesPerTileX: Math.max(1, view.getUint32(offset + 24, true)),
          sourceSamplesPerTileY: Math.max(1, view.getUint32(offset + 28, true)),
          targetSamplesPerTileX: Math.max(1, view.getUint32(offset + 32, true)),
          targetSamplesPerTileY: Math.max(1, view.getUint32(offset + 36, true)),
        }
      : null
    if (tileLayout) {
      offset += 40
    }
    if (offset !== bytes.byteLength) {
      return null
    }
    return normalizePlanningMetadata({
      contourBounds: null,
      generatedAt: undefined,
      demSource: {
        sourceFileHash: sourceFileHash.value,
        filename: filename.value,
        mimeType: mimeType.value,
        width,
        height,
        minElevation: minElevation.value ?? null,
        maxElevation: maxElevation.value ?? null,
        elevationOffsetMeters: elevationOffsetMeters.value ?? null,
        sampleStepMeters: sampleStepMeters.value ?? null,
        appliedSampleStepMeters: appliedSampleStepMeters.value ?? null,
        sampleStepX: sampleStepX.value ?? null,
        sampleStepY: sampleStepY.value ?? null,
        worldBounds,
        targetRows,
        targetColumns,
        targetCellSize: targetCellSize.value ?? 1,
        localEditCellSize: localEditCellSize.value,
        localEditTileSizeMeters: localEditTileSizeMeters.value,
        localEditTileResolution: localEditTileResolutionRaw > 0 ? localEditTileResolutionRaw : undefined,
        tileLayout,
        detailLimitedByGroundGrid: (flags & PLANNING_METADATA_BINARY_FLAGS_LIMITED_BY_GROUND_GRID) !== 0,
        detailLimitedByEditResolution: (flags & PLANNING_METADATA_BINARY_FLAGS_LIMITED_BY_EDIT_RESOLUTION) !== 0,
      },
    })
  } catch (_error) {
    return null
  }
}

function encodeLocalEditTilesPayload(localEditTiles: GroundLocalEditTileMap | null | undefined): Uint8Array {
  const normalized = normalizeLocalEditTiles(localEditTiles)
  if (!normalized) {
    return new Uint8Array(0)
  }
  const tiles = Object.values(normalized).sort((left, right) => {
    if (left.tileRow !== right.tileRow) {
      return left.tileRow - right.tileRow
    }
    return left.tileColumn - right.tileColumn
  })
  const totalByteLength = LOCAL_EDIT_TILE_SECTION_HEADER_BYTES + tiles.reduce((sum, tile) => {
    const valueCount = (tile.resolution + 1) * (tile.resolution + 1)
    return sum + LOCAL_EDIT_TILE_BINARY_HEADER_BYTES + valueCount * Float64Array.BYTES_PER_ELEMENT
  }, 0)
  const buffer = new ArrayBuffer(totalByteLength)
  const view = new DataView(buffer)
  let offset = 0
  view.setUint32(offset, tiles.length, true)
  offset += 4
  view.setUint32(offset, 0, true)
  offset += 4
  tiles.forEach((tile) => {
    const valueCount = (tile.resolution + 1) * (tile.resolution + 1)
    view.setInt32(offset, tile.tileRow, true)
    offset += 4
    view.setInt32(offset, tile.tileColumn, true)
    offset += 4
    view.setFloat64(offset, tile.tileSizeMeters, true)
    offset += 8
    view.setUint32(offset, tile.resolution, true)
    offset += 4
    view.setUint8(offset, encodeLocalEditTileSource(tile.source ?? null))
    offset += 4
    view.setFloat64(offset, Number.isFinite(tile.updatedAt) ? Number(tile.updatedAt) : Number.NaN, true)
    offset += 8
    for (let index = 0; index < valueCount; index += 1) {
      const value = Number(tile.values[index])
      view.setFloat64(offset, Number.isFinite(value) ? value : Number.NaN, true)
      offset += 8
    }
  })
  return new Uint8Array(buffer)
}

function decodeLocalEditTilesPayload(bytes: Uint8Array): GroundLocalEditTileMap | null {
  if (!bytes.byteLength) {
    return null
  }
  try {
    if (bytes.byteLength < LOCAL_EDIT_TILE_SECTION_HEADER_BYTES) {
      return null
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    const tileCount = view.getUint32(offset, true)
    offset += 8
    const localEditTiles: GroundLocalEditTileMap = {}
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      if (offset + LOCAL_EDIT_TILE_BINARY_HEADER_BYTES > bytes.byteLength) {
        return null
      }
      const tileRow = view.getInt32(offset, true)
      offset += 4
      const tileColumn = view.getInt32(offset, true)
      offset += 4
      const tileSizeMeters = view.getFloat64(offset, true)
      offset += 8
      const resolution = Math.max(1, view.getUint32(offset, true))
      offset += 4
      const source = decodeLocalEditTileSource(view.getUint8(offset))
      offset += 4
      const updatedAtValue = view.getFloat64(offset, true)
      offset += 8
      const valueCount = (resolution + 1) * (resolution + 1)
      if (offset + valueCount * Float64Array.BYTES_PER_ELEMENT > bytes.byteLength) {
        return null
      }
      const values = new Array<number>(valueCount)
      for (let index = 0; index < valueCount; index += 1) {
        values[index] = view.getFloat64(offset, true)
        offset += 8
      }
      const key = formatGroundLocalEditTileKey(tileRow, tileColumn)
      localEditTiles[key] = {
        key,
        tileRow,
        tileColumn,
        tileSizeMeters: Number.isFinite(tileSizeMeters) ? Math.max(0, tileSizeMeters) : 0,
        resolution,
        values,
        source,
        updatedAt: Number.isFinite(updatedAtValue) ? updatedAtValue : undefined,
      }
    }
    return offset === bytes.byteLength ? normalizeLocalEditTiles(localEditTiles) : null
  } catch (_error) {
    return null
  }
}

function writeSidecarHeader(
  view: DataView,
  metadata: GroundPlanningMetadata | null,
  localEditTilesByteLength: number,
): void {
  const normalized = normalizePlanningMetadata(metadata)
  const metadataPayload = encodePlanningMetadataPayload(normalized)
  view.setUint32(0, GROUND_HEIGHTMAP_SIDECAR_MAGIC, true)
  view.setUint32(4, GROUND_HEIGHTMAP_SIDECAR_VERSION, true)
  view.setInt32(8, normalized?.contourBounds?.minRow ?? EMPTY_BOUND, true)
  view.setInt32(12, normalized?.contourBounds?.maxRow ?? EMPTY_BOUND, true)
  view.setInt32(16, normalized?.contourBounds?.minColumn ?? EMPTY_BOUND, true)
  view.setInt32(20, normalized?.contourBounds?.maxColumn ?? EMPTY_BOUND, true)
  view.setFloat64(24, Number.isFinite(normalized?.generatedAt) ? Number(normalized?.generatedAt) : Number.NaN, true)
  view.setUint32(32, metadataPayload.byteLength, true)
  view.setUint32(36, localEditTilesByteLength, true)
}

function readSidecarHeader(view: DataView): GroundHeightSidecarHeader {
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  if (magic !== GROUND_HEIGHTMAP_SIDECAR_MAGIC || version !== GROUND_HEIGHTMAP_SIDECAR_VERSION) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} header`)
  }
  const minRow = view.getInt32(8, true)
  const maxRow = view.getInt32(12, true)
  const minColumn = view.getInt32(16, true)
  const maxColumn = view.getInt32(20, true)
  const generatedAt = view.getFloat64(24, true)
  const hasBounds = minRow !== EMPTY_BOUND && maxRow !== EMPTY_BOUND && minColumn !== EMPTY_BOUND && maxColumn !== EMPTY_BOUND
  const hasGeneratedAt = Number.isFinite(generatedAt)
  let planningMetadata: GroundPlanningMetadata | null = hasBounds || hasGeneratedAt
    ? {
        contourBounds: hasBounds ? { minRow, maxRow, minColumn, maxColumn } : null,
        generatedAt: hasGeneratedAt ? generatedAt : undefined,
      }
    : null
  const metadataByteLength = view.getUint32(32, true)
  if (metadataByteLength > 0) {
    const metadataBytes = new Uint8Array(view.buffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES, metadataByteLength)
    const payloadMetadata = decodePlanningMetadataPayload(metadataBytes)
    if (payloadMetadata?.demSource) {
      planningMetadata = normalizePlanningMetadata({
        contourBounds: planningMetadata?.contourBounds ?? null,
        generatedAt: planningMetadata?.generatedAt,
        demSource: payloadMetadata.demSource,
      }) ?? planningMetadata
    }
  }
  return {
    planningMetadata,
  }
}

function writeGroundHeightSidecarValues(
  buffer: ArrayBuffer,
  metadataPayload: Uint8Array,
  localEditTilesPayload: Uint8Array,
  sampler: GroundHeightSidecarSampler,
): void {
  const vertexCount = getGroundVertexCount(sampler.rows, sampler.columns)
  const layout = resolveGroundHeightSidecarLayout(metadataPayload.byteLength, vertexCount, localEditTilesPayload.byteLength)
  const view = new DataView(buffer, 0, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES)
  writeSidecarHeader(view, sampler.planningMetadata ?? null, localEditTilesPayload.byteLength)
  new Uint8Array(buffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES, metadataPayload.byteLength).set(metadataPayload)
  const manual = new Float64Array(buffer, layout.manualOffset, vertexCount)
  const planning = new Float64Array(buffer, layout.planningOffset, vertexCount)
  if (localEditTilesPayload.byteLength > 0) {
    new Uint8Array(buffer, layout.localEditTilesOffset, localEditTilesPayload.byteLength).set(localEditTilesPayload)
  }
  const sampleHeightRegion = typeof sampler.sampleHeightRegion === 'function'
    ? sampler.sampleHeightRegion.bind(sampler)
    : null
  const manualRegion = sampleHeightRegion
    ? sampleHeightRegion('manual', 0, sampler.rows, 0, sampler.columns)
    : null
  const planningRegion = sampleHeightRegion
    ? sampleHeightRegion('planning', 0, sampler.rows, 0, sampler.columns)
    : null

  for (let row = 0; row <= sampler.rows; row += 1) {
    for (let column = 0; column <= sampler.columns; column += 1) {
      const index = row * (sampler.columns + 1) + column
      const manualHeight = manualRegion
        ? Number(manualRegion.values[(row - manualRegion.minRow) * manualRegion.stride + (column - manualRegion.minColumn)])
        : Number(sampler.getManualHeight(row, column))
      const planningHeight = planningRegion
        ? Number(planningRegion.values[(row - planningRegion.minRow) * planningRegion.stride + (column - planningRegion.minColumn)])
        : Number(sampler.getPlanningHeight(row, column))
      manual[index] = Number.isFinite(manualHeight) ? manualHeight : Number.NaN
      planning[index] = Number.isFinite(planningHeight) ? planningHeight : Number.NaN
    }
  }
}

export function serializeGroundHeightSidecar(definition: GroundRuntimeDynamicMesh): ArrayBuffer {
  const gridSize = resolveGroundWorkingGridSize(definition)
  return serializeGroundHeightSidecarFromSampler({
    rows: gridSize.rows,
    columns: gridSize.columns,
    planningMetadata: definition.planningMetadata ?? null,
    localEditTiles: definition.localEditTiles ?? null,
    getManualHeight: (row, column) => definition.manualHeightMap[row * (gridSize.columns + 1) + column] ?? Number.NaN,
    getPlanningHeight: (row, column) => definition.planningHeightMap[row * (gridSize.columns + 1) + column] ?? Number.NaN,
  })
}

export function serializeGroundHeightSidecarFromSampler(sampler: GroundHeightSidecarSampler): ArrayBuffer {
  const metadataPayload = encodePlanningMetadataPayload(sampler.planningMetadata ?? null)
  const localEditTilesPayload = encodeLocalEditTilesPayload(sampler.localEditTiles ?? null)
  const buffer = new ArrayBuffer(
    resolveGroundHeightSidecarLayout(
      metadataPayload.byteLength,
      getGroundVertexCount(sampler.rows, sampler.columns),
      localEditTilesPayload.byteLength,
    ).totalByteLength,
  )
  writeGroundHeightSidecarValues(buffer, metadataPayload, localEditTilesPayload, sampler)
  return buffer
}

export function stripGroundHeightMapsFromSceneDocument(document: StoredSceneDocument): StoredSceneDocument {
  const visitNodes = (nodes: Array<{ dynamicMesh?: unknown; children?: unknown[] }>, visitor: (node: { dynamicMesh?: unknown; children?: unknown[] }) => void): void => {
    for (const node of nodes) {
      visitor(node)
      if (Array.isArray(node.children) && node.children.length) {
        visitNodes(node.children as Array<{ dynamicMesh?: unknown; children?: unknown[] }>, visitor)
      }
    }
  }
  visitNodes(document.nodes, (node) => {
    const dynamicMesh = node.dynamicMesh
    if (!dynamicMesh || typeof dynamicMesh !== 'object' || (dynamicMesh as { type?: unknown }).type !== 'Ground') {
      return
    }
    const groundDynamicMesh = dynamicMesh as GroundDynamicMesh & Record<string, unknown>
    delete groundDynamicMesh.manualHeightMap
    delete groundDynamicMesh.planningHeightMap
    delete groundDynamicMesh.planningMetadata
    delete groundDynamicMesh.surfaceRevision
    delete groundDynamicMesh.runtimeHydratedHeightState
    delete groundDynamicMesh.runtimeDisableOptimizedChunks
    delete groundDynamicMesh.terrainScatter
  })
  return document
}

export function createGroundRuntimeMeshFromSidecar(
  definition: GroundDynamicMesh,
  sidecar: ArrayBuffer | null | undefined,
): GroundRuntimeDynamicMesh {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const vertexCount = getGroundVertexCount(gridSize.rows, gridSize.columns)
  if (!sidecar) {
    throw new Error(`Missing ${GROUND_HEIGHTMAP_SIDECAR_FILENAME}`)
  }
  let buffer = sidecar
  if (buffer.byteLength < 8) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} header`)
  }
  const headerByteLength = GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES
  if (buffer.byteLength < headerByteLength) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} header`)
  }
  if (buffer.byteLength < headerByteLength + vertexCount * Float64Array.BYTES_PER_ELEMENT * 2) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} size: received ${buffer.byteLength}`)
  }
  const headerView = new DataView(buffer, 0, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES)
  readSidecarHeader(headerView)
  const metadataByteLength = headerView.getUint32(32, true)
  const localEditTilesByteLength = headerView.getUint32(36, true)
  if (headerByteLength + metadataByteLength > buffer.byteLength) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} header`)
  }
  const layout = resolveGroundHeightSidecarLayoutFromHeader(
    headerByteLength,
    metadataByteLength,
    vertexCount,
    localEditTilesByteLength,
  )
  const expectedByteLength = layout.totalByteLength
  if (buffer.byteLength > expectedByteLength) {
    const trailingBytes = new Uint8Array(buffer, expectedByteLength)
    const hasNonZeroTrailingBytes = trailingBytes.some((byte) => byte !== 0)
    if (hasNonZeroTrailingBytes) {
      throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} size: expected ${expectedByteLength}, received ${buffer.byteLength}`)
    }
    buffer = buffer.slice(0, expectedByteLength)
  } else if (buffer.byteLength !== expectedByteLength) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} size: expected ${expectedByteLength}, received ${buffer.byteLength}`)
  }

  const header = readSidecarHeader(new DataView(buffer, 0, headerByteLength + metadataByteLength))
  const manualHeightMap = new Float64Array(buffer, layout.manualOffset, vertexCount)
  const planningHeightMap = new Float64Array(buffer, layout.planningOffset, vertexCount)
  const localEditTiles = layout.localEditTilesByteLength > 0
    ? decodeLocalEditTilesPayload(new Uint8Array(buffer, layout.localEditTilesOffset, layout.localEditTilesByteLength))
    : null
  return {
    ...definition,
    manualHeightMap,
    planningHeightMap,
    planningMetadata: header.planningMetadata,
    localEditTiles,
    surfaceRevision: Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
    runtimeHydratedHeightState: 'pristine',
    runtimeDisableOptimizedChunks: false,
  }
}