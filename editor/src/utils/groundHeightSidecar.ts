import {
  cloneGroundHeightMap,
  getGroundVertexCount,
  type GroundDynamicMesh,
  type GroundRuntimeDynamicMesh,
  type GroundPlanningMetadata,
} from '@schema'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

export const GROUND_HEIGHTMAP_SIDECAR_FILENAME = 'ground-heightmaps.bin'
export const GROUND_HEIGHTMAP_SIDECAR_VERSION = 2

const GROUND_HEIGHTMAP_SIDECAR_MAGIC = 0x48474d32
const GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES = 32
const EMPTY_BOUND = -1

type GroundHeightSidecarHeader = {
  planningMetadata: GroundPlanningMetadata | null
}

export function getGroundHeightSidecarByteLength(definition: GroundDynamicMesh): number {
  return GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + getGroundVertexCount(definition.rows, definition.columns) * Float64Array.BYTES_PER_ELEMENT * 2
}

function normalizePlanningMetadata(metadata: GroundDynamicMesh['planningMetadata']): GroundPlanningMetadata | null {
  if (!metadata || typeof metadata !== 'object') {
    return null
  }
  const contourBounds = metadata.contourBounds
  const generatedAt = Number(metadata.generatedAt)
  const hasBounds = Boolean(
    contourBounds
    && Number.isFinite(contourBounds.minRow)
    && Number.isFinite(contourBounds.maxRow)
    && Number.isFinite(contourBounds.minColumn)
    && Number.isFinite(contourBounds.maxColumn),
  )
  const hasGeneratedAt = Number.isFinite(generatedAt)
  if (!hasBounds && !hasGeneratedAt) {
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
  }
}

function writeSidecarHeader(view: DataView, metadata: GroundPlanningMetadata | null): void {
  const normalized = normalizePlanningMetadata(metadata)
  view.setUint32(0, GROUND_HEIGHTMAP_SIDECAR_MAGIC, true)
  view.setUint32(4, GROUND_HEIGHTMAP_SIDECAR_VERSION, true)
  view.setInt32(8, normalized?.contourBounds?.minRow ?? EMPTY_BOUND, true)
  view.setInt32(12, normalized?.contourBounds?.maxRow ?? EMPTY_BOUND, true)
  view.setInt32(16, normalized?.contourBounds?.minColumn ?? EMPTY_BOUND, true)
  view.setInt32(20, normalized?.contourBounds?.maxColumn ?? EMPTY_BOUND, true)
  view.setFloat64(24, Number.isFinite(normalized?.generatedAt) ? Number(normalized?.generatedAt) : Number.NaN, true)
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
  return {
    planningMetadata: hasBounds || hasGeneratedAt
      ? {
          contourBounds: hasBounds ? { minRow, maxRow, minColumn, maxColumn } : null,
          generatedAt: hasGeneratedAt ? generatedAt : undefined,
        }
      : null,
  }
}

export function serializeGroundHeightSidecar(definition: GroundRuntimeDynamicMesh): ArrayBuffer {
  const vertexCount = getGroundVertexCount(definition.rows, definition.columns)
  const buffer = new ArrayBuffer(getGroundHeightSidecarByteLength(definition))
  const view = new DataView(buffer, 0, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES)
  writeSidecarHeader(view, definition.planningMetadata ?? null)
  const manual = new Float64Array(buffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES, vertexCount)
  const planning = new Float64Array(buffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + vertexCount * Float64Array.BYTES_PER_ELEMENT, vertexCount)
  manual.set(cloneGroundHeightMap(definition.manualHeightMap, definition.rows, definition.columns))
  planning.set(cloneGroundHeightMap(definition.planningHeightMap, definition.rows, definition.columns))
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
    delete groundDynamicMesh.terrainScatter
    delete groundDynamicMesh.legacyTerrainPaint
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
  const expectedByteLength = GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + vertexCount * Float64Array.BYTES_PER_ELEMENT * 2
  if (sidecar.byteLength !== expectedByteLength) {
    throw new Error(`Invalid ${GROUND_HEIGHTMAP_SIDECAR_FILENAME} size: expected ${expectedByteLength}, received ${sidecar.byteLength}`)
  }

  const buffer = sidecar.slice(0)
  const header = readSidecarHeader(new DataView(buffer, 0, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES))
  const manualHeightMap = new Float64Array(buffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES, vertexCount)
  const planningHeightMap = new Float64Array(buffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + vertexCount * Float64Array.BYTES_PER_ELEMENT, vertexCount)
  return {
    ...definition,
    manualHeightMap,
    planningHeightMap,
    planningMetadata: header.planningMetadata,
    surfaceRevision: Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
  }
}