import {
  clampTerrainPaintSettings,
  cloneTerrainPaintSettings,
  TERRAIN_PAINT_PAGE_COUNT,
  type TerrainPaintSettings,
} from './index'

export const GROUND_PAINT_SIDECAR_FILENAME = 'ground-paint.bin'
export const GROUND_PAINT_SIDECAR_VERSION = 2

const GROUND_PAINT_SIDECAR_MAGIC = 0x32545047
const STRING_ENCODER = new TextEncoder()
const STRING_DECODER = new TextDecoder()

export type GroundPaintSidecarPayload = {
  groundNodeId: string
  terrainPaint: TerrainPaintSettings | null
}

type SerializedGroundPaintSidecarPayload = {
  groundNodeId: string
  terrainPaint: TerrainPaintSettings
}

function normalizePayload(payload: GroundPaintSidecarPayload): GroundPaintSidecarPayload {
  const groundNodeId = typeof payload.groundNodeId === 'string' ? payload.groundNodeId.trim() : ''
  return {
    groundNodeId,
    terrainPaint: payload.terrainPaint ? cloneTerrainPaintSettings(clampTerrainPaintSettings(payload.terrainPaint)) : null,
  }
}

function encodePayloadJson(payload: SerializedGroundPaintSidecarPayload): Uint8Array {
  return STRING_ENCODER.encode(JSON.stringify(payload))
}

export function serializeGroundPaintSidecar(rawPayload: GroundPaintSidecarPayload): ArrayBuffer {
  const payload = normalizePayload(rawPayload)
  if (!payload.groundNodeId) {
    throw new Error('groundNodeId is required for ground paint sidecar')
  }
  if (!payload.terrainPaint) {
    throw new Error('terrainPaint is required for ground paint sidecar')
  }

  const encodedPayload = encodePayloadJson({
    groundNodeId: payload.groundNodeId,
    terrainPaint: payload.terrainPaint,
  })
  const bytes = new Uint8Array(12 + encodedPayload.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, GROUND_PAINT_SIDECAR_MAGIC, true)
  view.setUint32(4, GROUND_PAINT_SIDECAR_VERSION, true)
  view.setUint32(8, encodedPayload.byteLength, true)
  bytes.set(encodedPayload, 12)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export function deserializeGroundPaintSidecar(buffer: ArrayBuffer): GroundPaintSidecarPayload {
  if (buffer.byteLength < 12) {
    throw new Error('Invalid ground paint sidecar size')
  }
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  if (magic !== GROUND_PAINT_SIDECAR_MAGIC || version !== GROUND_PAINT_SIDECAR_VERSION) {
    throw new Error('Invalid ground paint sidecar header')
  }
  const payloadByteLength = view.getUint32(8, true)
  if (payloadByteLength !== buffer.byteLength - 12) {
    throw new Error('Invalid ground paint sidecar payload length')
  }

  const payloadBytes = new Uint8Array(buffer, 12, payloadByteLength)
  const parsed = JSON.parse(STRING_DECODER.decode(payloadBytes)) as Partial<SerializedGroundPaintSidecarPayload> | null
  const groundNodeId = typeof parsed?.groundNodeId === 'string' ? parsed.groundNodeId.trim() : ''
  const terrainPaint = parsed?.terrainPaint ? clampTerrainPaintSettings(parsed.terrainPaint) : null
  if (!groundNodeId) {
    throw new Error('Ground paint sidecar is missing groundNodeId')
  }
  if (!terrainPaint) {
    throw new Error('Ground paint sidecar is missing terrainPaint payload')
  }

  const normalizedPages = terrainPaint.layers.some((layer) => layer.slotIndex < 0 || layer.slotIndex >= TERRAIN_PAINT_PAGE_COUNT * 4)
  if (normalizedPages) {
    throw new Error('Ground paint sidecar contains an out-of-range slotIndex')
  }

  return {
    groundNodeId,
    terrainPaint,
  }
}