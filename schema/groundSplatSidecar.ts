import type { GroundSurfaceChunkTextureMap } from './core'

export const GROUND_SPLAT_SIDECAR_FILENAME = 'ground-splat.bin'
export const GROUND_SPLAT_SIDECAR_VERSION = 1

const GROUND_SPLAT_SIDECAR_MAGIC = 0x31535047
const HEADER_BYTES = 24
const STRING_ENCODER = new TextEncoder()
const STRING_DECODER = new TextDecoder()

export type GroundSplatSidecarPayload = {
  groundNodeId: string
  revision: number
  surfaceLayerTextureAssetIds?: string[] | null
  groundSurfaceChunks: GroundSurfaceChunkTextureMap | null
}

type GroundSplatSidecarJson = {
  groundNodeId: string
  revision: number
  surfaceLayerTextureAssetIds: string[] | null
  groundSurfaceChunks: GroundSurfaceChunkTextureMap | null
}

function normalizeOptionalStringArray(value: string[] | null | undefined): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const next = Array.from(new Set(
    value
      .map((entry) => typeof entry === 'string' ? entry.trim() : '')
      .filter((entry) => entry.length > 0),
  ))
  return next.length > 0 ? next : null
}

function normalizeGroundSurfaceChunks(
  value: GroundSurfaceChunkTextureMap | null | undefined,
): GroundSurfaceChunkTextureMap | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const entries: Array<[string, GroundSurfaceChunkTextureMap[string]]> = []
  Object.entries(value).forEach(([chunkKey, chunk]) => {
    const normalizedChunkKey = typeof chunkKey === 'string' ? chunkKey.trim() : ''
    if (!normalizedChunkKey || !chunk || typeof chunk !== 'object') {
      return
    }
    const splatMapAssetIds = Array.isArray(chunk.splatMapAssetIds)
      ? chunk.splatMapAssetIds
          .map((entry) => typeof entry === 'string' ? entry.trim() : '')
          .filter((entry) => entry.length > 0)
      : null
    const surfaceLayers = Array.isArray(chunk.surfaceLayers)
      ? chunk.surfaceLayers.map((layer) => ({
          albedoSource: typeof layer?.albedoSource === 'string' ? layer.albedoSource : null,
          albedoTextureSettings: layer?.albedoTextureSettings ?? null,
          normalSource: typeof layer?.normalSource === 'string' ? layer.normalSource : null,
          normalTextureSettings: layer?.normalTextureSettings ?? null,
          colorTint: typeof layer?.colorTint === 'string' ? layer.colorTint : null,
          opacity: Number.isFinite(Number(layer?.opacity)) ? Number(layer?.opacity) : 1,
          uvScale: layer?.uvScale ?? null,
          maskChannel: Number.isFinite(Number(layer?.maskChannel)) ? Math.max(0, Math.trunc(Number(layer?.maskChannel))) : 0,
          featherEnabled: layer?.featherEnabled === true,
          featherWidth: Number.isFinite(Number(layer?.featherWidth)) ? Math.max(0, Number(layer?.featherWidth)) : 0,
        }))
      : null
    entries.push([normalizedChunkKey, {
      baseBlendMode: typeof chunk.baseBlendMode === 'string' ? chunk.baseBlendMode : 'shader-splat-v1',
      textureAssetId: typeof chunk.textureAssetId === 'string' ? chunk.textureAssetId : null,
      normalTextureAssetId: typeof chunk.normalTextureAssetId === 'string' ? chunk.normalTextureAssetId : null,
      splatMapAssetIds,
      surfaceLayers,
      revision: Number.isFinite(Number(chunk.revision)) ? Math.max(0, Math.trunc(Number(chunk.revision))) : 0,
    }])
  })
  return entries.length > 0 ? Object.fromEntries(entries) as GroundSurfaceChunkTextureMap : null
}

function normalizePayload(payload: GroundSplatSidecarPayload): GroundSplatSidecarJson {
  const groundNodeId = typeof payload.groundNodeId === 'string' ? payload.groundNodeId.trim() : ''
  if (!groundNodeId) {
    throw new Error('groundNodeId is required for ground splat sidecar')
  }
  return {
    groundNodeId,
    revision: Number.isFinite(Number(payload.revision)) ? Math.max(0, Math.trunc(Number(payload.revision))) : 0,
    surfaceLayerTextureAssetIds: normalizeOptionalStringArray(payload.surfaceLayerTextureAssetIds ?? null),
    groundSurfaceChunks: normalizeGroundSurfaceChunks(payload.groundSurfaceChunks),
  }
}

export function serializeGroundSplatSidecar(payload: GroundSplatSidecarPayload): ArrayBuffer {
  const normalized = normalizePayload(payload)
  const body = STRING_ENCODER.encode(JSON.stringify(normalized))
  const bytes = new Uint8Array(HEADER_BYTES + body.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, GROUND_SPLAT_SIDECAR_MAGIC, true)
  view.setUint32(4, GROUND_SPLAT_SIDECAR_VERSION, true)
  view.setUint32(8, HEADER_BYTES, true)
  view.setUint32(12, body.byteLength, true)
  view.setUint32(16, normalized.revision, true)
  view.setUint32(20, 0, true)
  bytes.set(body, HEADER_BYTES)
  return bytes.buffer
}

export function deserializeGroundSplatSidecar(buffer: ArrayBuffer): GroundSplatSidecarPayload {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error('Invalid ground splat sidecar size')
  }
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  if (magic !== GROUND_SPLAT_SIDECAR_MAGIC || version !== GROUND_SPLAT_SIDECAR_VERSION) {
    throw new Error('Invalid ground splat sidecar header')
  }
  const bodyOffset = view.getUint32(8, true)
  const bodyLength = view.getUint32(12, true)
  if (bodyOffset !== HEADER_BYTES || bodyOffset + bodyLength > buffer.byteLength) {
    throw new Error('Invalid ground splat sidecar body')
  }
  const body = STRING_DECODER.decode(new Uint8Array(buffer, bodyOffset, bodyLength))
  const parsed = JSON.parse(body) as Partial<GroundSplatSidecarJson> | null
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid ground splat sidecar payload')
  }
  return normalizePayload({
    groundNodeId: typeof parsed.groundNodeId === 'string' ? parsed.groundNodeId : '',
    revision: Number(parsed.revision),
    surfaceLayerTextureAssetIds: parsed.surfaceLayerTextureAssetIds ?? null,
    groundSurfaceChunks: parsed.groundSurfaceChunks ?? null,
  })
}
