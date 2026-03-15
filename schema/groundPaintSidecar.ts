import {
  normalizeGroundSurfaceChunkTextureMap,
  type GroundSurfaceChunkTextureMap,
} from './index'

export const GROUND_PAINT_SIDECAR_FILENAME = 'ground-paint.bin'
export const GROUND_PAINT_SIDECAR_VERSION = 3

const GROUND_PAINT_SIDECAR_MAGIC = 0x32545047
const GROUND_PAINT_SIDECAR_HEADER_BYTES = 16

const STRING_ENCODER = new TextEncoder()
const STRING_DECODER = new TextDecoder()

export type GroundPaintSidecarPayload = {
  groundNodeId: string
  groundSurfaceChunks?: GroundSurfaceChunkTextureMap | null
}

function normalizePayload(payload: GroundPaintSidecarPayload): GroundPaintSidecarPayload {
  return {
    groundNodeId: typeof payload.groundNodeId === 'string' ? payload.groundNodeId.trim() : '',
    groundSurfaceChunks: normalizeGroundSurfaceChunkTextureMap(payload.groundSurfaceChunks),
  }
}

export function serializeGroundPaintSidecar(rawPayload: GroundPaintSidecarPayload): ArrayBuffer {
  const payload = normalizePayload(rawPayload)
  if (!payload.groundNodeId) {
    throw new Error('groundNodeId is required for ground paint sidecar')
  }
  const hasGroundSurfaceChunks = Boolean(payload.groundSurfaceChunks && Object.keys(payload.groundSurfaceChunks).length > 0)
  if (!hasGroundSurfaceChunks) {
    throw new Error('ground paint sidecar requires groundSurfaceChunks')
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
  if (magic !== GROUND_PAINT_SIDECAR_MAGIC || (version !== 2 && version !== GROUND_PAINT_SIDECAR_VERSION)) {
    throw new Error('Invalid ground paint sidecar header')
  }

  const byteLength = view.getUint32(8, true)
  if (GROUND_PAINT_SIDECAR_HEADER_BYTES + byteLength > buffer.byteLength) {
    throw new Error('Ground paint sidecar payload is truncated')
  }

  const payloadBytes = new Uint8Array(buffer, GROUND_PAINT_SIDECAR_HEADER_BYTES, byteLength)
  const parsed = JSON.parse(STRING_DECODER.decode(payloadBytes)) as GroundPaintSidecarPayload
  const normalized = normalizePayload(parsed)
  const hasGroundSurfaceChunks = Boolean(normalized.groundSurfaceChunks && Object.keys(normalized.groundSurfaceChunks).length > 0)
  if (!normalized.groundNodeId || !hasGroundSurfaceChunks) {
    throw new Error('Invalid ground paint sidecar payload')
  }
  return normalized
}