import {
  clampTerrainPaintLayerDefinition,
  TERRAIN_PAINT_VERSION,
  type TerrainPaintSettings,
} from './index'

export const GROUND_PAINT_SIDECAR_FILENAME = 'ground-paint.bin'
export const GROUND_PAINT_SIDECAR_VERSION = 2

const GROUND_PAINT_SIDECAR_MAGIC = 0x32545047
const GROUND_PAINT_SIDECAR_HEADER_BYTES = 16

const STRING_ENCODER = new TextEncoder()
const STRING_DECODER = new TextDecoder()

export type GroundPaintSidecarPayload = {
  groundNodeId: string
  terrainPaint: TerrainPaintSettings | null
}

function normalizePayload(payload: GroundPaintSidecarPayload): GroundPaintSidecarPayload {
  const terrainPaint = payload.terrainPaint
  if (!terrainPaint) {
    return {
      groundNodeId: typeof payload.groundNodeId === 'string' ? payload.groundNodeId.trim() : '',
      terrainPaint: null,
    }
  }

  return {
    groundNodeId: typeof payload.groundNodeId === 'string' ? payload.groundNodeId.trim() : '',
    terrainPaint: {
      version: TERRAIN_PAINT_VERSION,
      weightmapResolution: Number.isFinite(terrainPaint.weightmapResolution)
        ? Math.max(8, Math.min(2048, Math.round(terrainPaint.weightmapResolution)))
        : 256,
      layers: Array.isArray(terrainPaint.layers)
        ? terrainPaint.layers
            .map((layer) => clampTerrainPaintLayerDefinition(layer))
            .filter((layer) => layer.id.length > 0 && layer.textureAssetId.length > 0)
        : [],
      chunks: Object.fromEntries(
        Object.entries(terrainPaint.chunks ?? {})
          .map(([chunkKey, chunkValue]) => {
            const normalizedKey = typeof chunkKey === 'string' ? chunkKey.trim() : ''
            const pages = Array.isArray(chunkValue?.pages)
              ? chunkValue.pages
                  .map((page) => ({ logicalId: typeof page?.logicalId === 'string' ? page.logicalId.trim() : '' }))
                  .filter((page) => page.logicalId.length > 0)
              : []
            return [normalizedKey, { pages }] as const
          })
          .filter(([chunkKey]) => chunkKey.length > 0),
      ),
    },
  }
}

export function serializeGroundPaintSidecar(rawPayload: GroundPaintSidecarPayload): ArrayBuffer {
  const payload = normalizePayload(rawPayload)
  if (!payload.groundNodeId) {
    throw new Error('groundNodeId is required for ground paint sidecar')
  }
  if (!payload.terrainPaint) {
    throw new Error('terrainPaint is required for ground paint sidecar')
  }

  const bodyBytes = STRING_ENCODER.encode(JSON.stringify(payload))
  const result = new Uint8Array(GROUND_PAINT_SIDECAR_HEADER_BYTES + bodyBytes.byteLength)
  const view = new DataView(result.buffer)
  view.setUint32(0, GROUND_PAINT_SIDECAR_MAGIC, true)
  view.setUint32(4, GROUND_PAINT_SIDECAR_VERSION, true)
  view.setUint32(8, bodyBytes.byteLength, true)
  view.setUint32(12, 0, true)
  result.set(bodyBytes, GROUND_PAINT_SIDECAR_HEADER_BYTES)
  return result.buffer
}

export function deserializeGroundPaintSidecar(buffer: ArrayBuffer): GroundPaintSidecarPayload {
  if (buffer.byteLength < GROUND_PAINT_SIDECAR_HEADER_BYTES) {
    throw new Error('Invalid ground paint sidecar size')
  }
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  if (magic !== GROUND_PAINT_SIDECAR_MAGIC || version !== GROUND_PAINT_SIDECAR_VERSION) {
    throw new Error('Invalid ground paint sidecar header')
  }

  const byteLength = view.getUint32(8, true)
  if (GROUND_PAINT_SIDECAR_HEADER_BYTES + byteLength > buffer.byteLength) {
    throw new Error('Ground paint sidecar payload is truncated')
  }

  const payloadBytes = new Uint8Array(buffer, GROUND_PAINT_SIDECAR_HEADER_BYTES, byteLength)
  const parsed = JSON.parse(STRING_DECODER.decode(payloadBytes)) as GroundPaintSidecarPayload
  const normalized = normalizePayload(parsed)
  if (!normalized.groundNodeId || !normalized.terrainPaint) {
    throw new Error('Invalid ground paint sidecar payload')
  }
  return normalized
}