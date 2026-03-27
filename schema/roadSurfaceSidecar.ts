import type { RoadSurfaceChunkAssetMap } from './index'

export const ROAD_SURFACE_SIDECAR_FILENAME = 'road-surface.bin'
export const ROAD_SURFACE_SIDECAR_VERSION = 1

const ROAD_SURFACE_SIDECAR_MAGIC = 0x31534452
const ROAD_SURFACE_SIDECAR_HEADER_BYTES = 16

const STRING_ENCODER = new TextEncoder()
const STRING_DECODER = new TextDecoder()

export type RoadSurfaceSidecarPayload = {
  roadNodeId: string
  chunkSizeMeters: number
  sampleSpacingMeters: number
  roadSurfaceChunks?: RoadSurfaceChunkAssetMap | null
}

function normalizeRoadSurfaceChunkAssetMap(
  value: RoadSurfaceChunkAssetMap | null | undefined,
): RoadSurfaceChunkAssetMap {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .map(([chunkKey, chunkRef]) => {
        const normalizedChunkKey = typeof chunkKey === 'string' ? chunkKey.trim() : ''
        if (!normalizedChunkKey || !chunkRef || typeof chunkRef !== 'object') {
          return null
        }
        const revision = Number.isFinite(chunkRef.revision) ? Math.max(0, Math.trunc(chunkRef.revision)) : 0
        const resolution = Number.isFinite(chunkRef.resolution) ? Math.max(1, Math.trunc(chunkRef.resolution)) : 1
        const coverageAssetId = typeof chunkRef.coverageAssetId === 'string' ? chunkRef.coverageAssetId.trim() : ''
        const heightAssetId = typeof chunkRef.heightAssetId === 'string' ? chunkRef.heightAssetId.trim() : ''
        const coverageData = typeof chunkRef.coverageData === 'string' ? chunkRef.coverageData.trim() : ''
        const heightData = typeof chunkRef.heightData === 'string' ? chunkRef.heightData.trim() : ''
        if (!coverageAssetId && !heightAssetId && !coverageData && !heightData) {
          return null
        }
        return [normalizedChunkKey, {
          revision,
          resolution,
          coverageAssetId: coverageAssetId || null,
          heightAssetId: heightAssetId || null,
          coverageData: coverageData || null,
          heightData: heightData || null,
        }] as const
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  )
}

function normalizePayload(payload: RoadSurfaceSidecarPayload): RoadSurfaceSidecarPayload {
  const chunkSizeMeters = Number.isFinite(payload.chunkSizeMeters) ? Math.max(1, payload.chunkSizeMeters) : 32
  const sampleSpacingMeters = Number.isFinite(payload.sampleSpacingMeters)
    ? Math.max(0.05, payload.sampleSpacingMeters)
    : 0.5

  return {
    roadNodeId: typeof payload.roadNodeId === 'string' ? payload.roadNodeId.trim() : '',
    chunkSizeMeters,
    sampleSpacingMeters,
    roadSurfaceChunks: normalizeRoadSurfaceChunkAssetMap(payload.roadSurfaceChunks),
  }
}

export function serializeRoadSurfaceSidecar(rawPayload: RoadSurfaceSidecarPayload): ArrayBuffer {
  const payload = normalizePayload(rawPayload)
  if (!payload.roadNodeId) {
    throw new Error('roadNodeId is required for road surface sidecar')
  }
  const hasRoadSurfaceChunks = Boolean(payload.roadSurfaceChunks && Object.keys(payload.roadSurfaceChunks).length > 0)
  if (!hasRoadSurfaceChunks) {
    throw new Error('road surface sidecar requires roadSurfaceChunks')
  }

  const bodyBytes = STRING_ENCODER.encode(JSON.stringify(payload))
  const result = new Uint8Array(ROAD_SURFACE_SIDECAR_HEADER_BYTES + bodyBytes.byteLength)
  const view = new DataView(result.buffer)
  view.setUint32(0, ROAD_SURFACE_SIDECAR_MAGIC, true)
  view.setUint32(4, ROAD_SURFACE_SIDECAR_VERSION, true)
  view.setUint32(8, bodyBytes.byteLength, true)
  view.setUint32(12, 0, true)
  result.set(bodyBytes, ROAD_SURFACE_SIDECAR_HEADER_BYTES)
  return result.buffer
}

export function deserializeRoadSurfaceSidecar(buffer: ArrayBuffer): RoadSurfaceSidecarPayload {
  if (buffer.byteLength < ROAD_SURFACE_SIDECAR_HEADER_BYTES) {
    throw new Error('Invalid road surface sidecar size')
  }
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  if (magic !== ROAD_SURFACE_SIDECAR_MAGIC || version !== ROAD_SURFACE_SIDECAR_VERSION) {
    throw new Error('Invalid road surface sidecar header')
  }

  const byteLength = view.getUint32(8, true)
  if (ROAD_SURFACE_SIDECAR_HEADER_BYTES + byteLength > buffer.byteLength) {
    throw new Error('Road surface sidecar payload is truncated')
  }

  const payloadBytes = new Uint8Array(buffer, ROAD_SURFACE_SIDECAR_HEADER_BYTES, byteLength)
  const parsed = JSON.parse(STRING_DECODER.decode(payloadBytes)) as RoadSurfaceSidecarPayload
  const normalized = normalizePayload(parsed)
  const hasRoadSurfaceChunks = Boolean(normalized.roadSurfaceChunks && Object.keys(normalized.roadSurfaceChunks).length > 0)
  if (!normalized.roadNodeId || !hasRoadSurfaceChunks) {
    throw new Error('Invalid road surface sidecar payload')
  }
  return normalized
}