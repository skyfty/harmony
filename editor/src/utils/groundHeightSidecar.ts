import {
  getGroundVertexCount,
  type GroundDynamicMesh,
  type GroundRuntimeDynamicMesh,
  type GroundPlanningMetadata,
} from '@schema'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

export const GROUND_HEIGHTMAP_SIDECAR_FILENAME = 'ground-heightmaps.bin'
export const GROUND_HEIGHTMAP_SIDECAR_VERSION = 3

const GROUND_HEIGHTMAP_SIDECAR_MAGIC = 0x48474d32
const GROUND_HEIGHTMAP_SIDECAR_V2_HEADER_BYTES = 32
const GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES = 40
const EMPTY_BOUND = -1

type GroundHeightSidecarHeader = {
  planningMetadata: GroundPlanningMetadata | null
}

export function getGroundHeightSidecarByteLength(definition: GroundDynamicMesh): number {
  const metadataPayload = encodePlanningMetadataPayload(definition.planningMetadata ?? null)
  return GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + metadataPayload.byteLength + getGroundVertexCount(definition.rows, definition.columns) * Float64Array.BYTES_PER_ELEMENT * 2
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
    sampleStepMeters: Number.isFinite(Number(metadata.sampleStepMeters)) ? Number(metadata.sampleStepMeters) : null,
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

function encodePlanningMetadataPayload(metadata: GroundPlanningMetadata | null): Uint8Array {
  const normalized = normalizePlanningMetadata(metadata)
  if (!normalized) {
    return new Uint8Array(0)
  }
  const payload = JSON.stringify(normalized)
  return payload.length ? new TextEncoder().encode(payload) : new Uint8Array(0)
}

function decodePlanningMetadataPayload(bytes: Uint8Array): GroundPlanningMetadata | null {
  if (!bytes.byteLength) {
    return null
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as GroundPlanningMetadata | null
    return normalizePlanningMetadata(parsed)
  } catch (_error) {
    return null
  }
}

function writeSidecarHeader(view: DataView, metadata: GroundPlanningMetadata | null): void {
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
  view.setUint32(36, 0, true)
}

function readSidecarHeader(view: DataView): GroundHeightSidecarHeader {
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  if (magic !== GROUND_HEIGHTMAP_SIDECAR_MAGIC || (version !== 2 && version !== GROUND_HEIGHTMAP_SIDECAR_VERSION)) {
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
  if (version === GROUND_HEIGHTMAP_SIDECAR_VERSION) {
    const metadataByteLength = view.getUint32(32, true)
    if (metadataByteLength > 0) {
      const metadataBytes = new Uint8Array(view.buffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES, metadataByteLength)
      planningMetadata = decodePlanningMetadataPayload(metadataBytes) ?? planningMetadata
    }
  }
  return {
    planningMetadata,
  }
}

export function serializeGroundHeightSidecar(definition: GroundRuntimeDynamicMesh): ArrayBuffer {
  const metadataPayload = encodePlanningMetadataPayload(definition.planningMetadata ?? null)
  const vertexCount = getGroundVertexCount(definition.rows, definition.columns)
  const buffer = new ArrayBuffer(GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + metadataPayload.byteLength + vertexCount * Float64Array.BYTES_PER_ELEMENT * 2)
  const view = new DataView(buffer, 0, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES)
  writeSidecarHeader(view, definition.planningMetadata ?? null)
  new Uint8Array(buffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES, metadataPayload.byteLength).set(metadataPayload)
  const manualOffset = GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + metadataPayload.byteLength
  const planningOffset = manualOffset + vertexCount * Float64Array.BYTES_PER_ELEMENT
  const manual = new Float64Array(buffer, manualOffset, vertexCount)
  const planning = new Float64Array(buffer, planningOffset, vertexCount)
  manual.set(definition.manualHeightMap)
  planning.set(definition.planningHeightMap)
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
  const vertexCount = getGroundVertexCount(definition.rows, definition.columns)
  if (!sidecar) {
    throw new Error(`Missing ${GROUND_HEIGHTMAP_SIDECAR_FILENAME}`)
  }
  const buffer = sidecar
  const version = new DataView(buffer, 0, 8).getUint32(4, true)
  const headerByteLength = version === 2 ? GROUND_HEIGHTMAP_SIDECAR_V2_HEADER_BYTES : GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES
  if (buffer.byteLength < headerByteLength + vertexCount * Float64Array.BYTES_PER_ELEMENT * 2) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} size: received ${buffer.byteLength}`)
  }
  const metadataByteLength = version === GROUND_HEIGHTMAP_SIDECAR_VERSION ? new DataView(buffer, 0, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES).getUint32(32, true) : 0
  const expectedByteLength = headerByteLength + metadataByteLength + vertexCount * Float64Array.BYTES_PER_ELEMENT * 2
  if (buffer.byteLength !== expectedByteLength) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} size: expected ${expectedByteLength}, received ${buffer.byteLength}`)
  }

  const header = readSidecarHeader(new DataView(buffer, 0, headerByteLength + metadataByteLength))
  const manualOffset = headerByteLength + metadataByteLength
  const planningOffset = manualOffset + vertexCount * Float64Array.BYTES_PER_ELEMENT
  const manualHeightMap = new Float64Array(buffer, manualOffset, vertexCount)
  const planningHeightMap = new Float64Array(buffer, planningOffset, vertexCount)
  return {
    ...definition,
    manualHeightMap,
    planningHeightMap,
    planningMetadata: header.planningMetadata,
    surfaceRevision: Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
    runtimeHydratedHeightState: 'pristine',
    runtimeDisableOptimizedChunks: false,
  }
}