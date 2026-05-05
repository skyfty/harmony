import * as THREE from 'three'

export const COMPILED_GROUND_MANIFEST_VERSION = 1 as const
export const COMPILED_GROUND_RENDER_TILE_MAGIC = 0x48474d31
export const COMPILED_GROUND_COLLISION_TILE_MAGIC = 0x48484631
const COMPILED_GROUND_PREFIX_U32_COUNT = 3
const COMPILED_GROUND_PREFIX_BYTES = Uint32Array.BYTES_PER_ELEMENT * COMPILED_GROUND_PREFIX_U32_COUNT
const compiledGroundCoveredChunkKeyCache = new WeakMap<CompiledGroundManifest, string[]>()

export interface CompiledGroundChunkBounds {
  minChunkX: number
  maxChunkX: number
  minChunkZ: number
  maxChunkZ: number
}

export interface CompiledGroundBounds {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export interface CompiledGroundRenderTileRecord {
  key: string
  row: number
  column: number
  centerX: number
  centerZ: number
  sizeMeters: number
  widthMeters: number
  depthMeters: number
  path: string
  bounds: CompiledGroundBounds
  vertexCount: number
  triangleCount: number
}

export interface CompiledGroundCollisionTileRecord {
  key: string
  row: number
  column: number
  centerX: number
  centerZ: number
  sizeMeters: number
  widthMeters: number
  depthMeters: number
  path: string
  bounds: CompiledGroundBounds
  rows: number
  columns: number
  elementSize: number
}

export interface CompiledGroundManifest {
  version: typeof COMPILED_GROUND_MANIFEST_VERSION
  revision: number
  sceneId: string
  groundNodeId: string
  chunkSizeMeters: number
  baseHeight: number
  renderTileSizeMeters: number
  collisionTileSizeMeters: number
  coveredChunkBounds: CompiledGroundChunkBounds
  bounds: CompiledGroundBounds
  renderTiles: CompiledGroundRenderTileRecord[]
  collisionTiles: CompiledGroundCollisionTileRecord[]
}

export interface CompiledGroundRenderTileHeader {
  version: 1
  key: string
  row: number
  column: number
  bounds: CompiledGroundBounds
  vertexCount: number
  triangleCount: number
  indexCount: number
}

export interface CompiledGroundRenderTileData {
  header: CompiledGroundRenderTileHeader
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

export interface CompiledGroundCollisionTileHeader {
  version: 1
  key: string
  row: number
  column: number
  bounds: CompiledGroundBounds
  rows: number
  columns: number
  elementSize: number
  minHeight: number
  maxHeight: number
}

export interface CompiledGroundCollisionTileData {
  header: CompiledGroundCollisionTileHeader
  heights: Float32Array
}

export function formatCompiledGroundTileKey(row: number, column: number): string {
  return `${Math.trunc(row)}:${Math.trunc(column)}`
}

function encodeJsonHeader(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function createPrefixedBuffer(magic: number, header: unknown, payloads: Uint8Array[]): ArrayBuffer {
  const headerBytes = encodeJsonHeader(header)
  const totalBytes = COMPILED_GROUND_PREFIX_BYTES
    + headerBytes.byteLength
    + payloads.reduce((sum, payload) => sum + payload.byteLength, 0)
  const buffer = new ArrayBuffer(totalBytes)
  const prefix = new Uint32Array(buffer, 0, COMPILED_GROUND_PREFIX_U32_COUNT)
  prefix[0] = magic
  prefix[1] = 1
  prefix[2] = headerBytes.byteLength
  let offset = COMPILED_GROUND_PREFIX_BYTES
  new Uint8Array(buffer, offset, headerBytes.byteLength).set(headerBytes)
  offset += headerBytes.byteLength
  for (const payload of payloads) {
    new Uint8Array(buffer, offset, payload.byteLength).set(payload)
    offset += payload.byteLength
  }
  return buffer
}

function parsePrefixedBuffer<T extends object>(
  buffer: ArrayBuffer | null | undefined,
  magic: number,
): { header: T; payloadOffset: number } | null {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < COMPILED_GROUND_PREFIX_BYTES) {
    return null
  }
  const prefix = new Uint32Array(buffer, 0, COMPILED_GROUND_PREFIX_U32_COUNT)
  if ((prefix[0] ?? 0) !== magic || (prefix[1] ?? 0) !== 1) {
    return null
  }
  const headerByteLength = Math.trunc(prefix[2] ?? 0)
  const payloadOffset = COMPILED_GROUND_PREFIX_BYTES + headerByteLength
  if (headerByteLength <= 0 || payloadOffset > buffer.byteLength) {
    return null
  }
  try {
    const headerBytes = new Uint8Array(buffer, COMPILED_GROUND_PREFIX_BYTES, headerByteLength)
    const header = JSON.parse(new TextDecoder().decode(headerBytes)) as T
    if (!header || typeof header !== 'object') {
      return null
    }
    return { header, payloadOffset }
  } catch (_error) {
    return null
  }
}

export function serializeCompiledGroundRenderTile(data: CompiledGroundRenderTileData): ArrayBuffer {
  const positions = data.positions instanceof Float32Array ? data.positions : new Float32Array(data.positions)
  const normals = data.normals instanceof Float32Array ? data.normals : new Float32Array(data.normals)
  const uvs = data.uvs instanceof Float32Array ? data.uvs : new Float32Array(data.uvs)
  const indices = data.indices instanceof Uint32Array ? data.indices : new Uint32Array(data.indices)
  return createPrefixedBuffer(
    COMPILED_GROUND_RENDER_TILE_MAGIC,
    {
      ...data.header,
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      indexCount: indices.length,
    },
    [
      new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength),
      new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength),
      new Uint8Array(uvs.buffer, uvs.byteOffset, uvs.byteLength),
      new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength),
    ],
  )
}

export function deserializeCompiledGroundRenderTile(buffer: ArrayBuffer | null | undefined): CompiledGroundRenderTileData | null {
  const parsed = parsePrefixedBuffer<CompiledGroundRenderTileHeader & { indexCount?: number }>(
    buffer,
    COMPILED_GROUND_RENDER_TILE_MAGIC,
  )
  if (!parsed) {
    return null
  }
  const { header, payloadOffset } = parsed
  const vertexCount = Math.max(0, Math.trunc(Number(header.vertexCount) || 0))
  const indexCount = Math.max(0, Math.trunc(Number(header.indexCount) || (Number(header.triangleCount) || 0) * 3))
  const positionsByteLength = vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT
  const normalsByteLength = positionsByteLength
  const uvsByteLength = vertexCount * 2 * Float32Array.BYTES_PER_ELEMENT
  const indicesByteLength = indexCount * Uint32Array.BYTES_PER_ELEMENT
  const expectedByteLength = payloadOffset + positionsByteLength + normalsByteLength + uvsByteLength + indicesByteLength
  if (expectedByteLength !== buffer!.byteLength) {
    return null
  }
  let offset = payloadOffset
  const positions = new Float32Array(buffer!.slice(offset, offset + positionsByteLength))
  offset += positionsByteLength
  const normals = new Float32Array(buffer!.slice(offset, offset + normalsByteLength))
  offset += normalsByteLength
  const uvs = new Float32Array(buffer!.slice(offset, offset + uvsByteLength))
  offset += uvsByteLength
  const indices = new Uint32Array(buffer!.slice(offset, offset + indicesByteLength))
  return {
    header: {
      version: 1,
      key: String(header.key ?? ''),
      row: Math.trunc(Number(header.row) || 0),
      column: Math.trunc(Number(header.column) || 0),
      bounds: header.bounds,
      vertexCount,
      triangleCount: Math.max(0, Math.trunc(Number(header.triangleCount) || 0)),
      indexCount,
    },
    positions,
    normals,
    uvs,
    indices,
  }
}

export function serializeCompiledGroundCollisionTile(data: CompiledGroundCollisionTileData): ArrayBuffer {
  const heights = data.heights instanceof Float32Array ? data.heights : new Float32Array(data.heights)
  return createPrefixedBuffer(
    COMPILED_GROUND_COLLISION_TILE_MAGIC,
    data.header,
    [new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength)],
  )
}

export function deserializeCompiledGroundCollisionTile(buffer: ArrayBuffer | null | undefined): CompiledGroundCollisionTileData | null {
  const parsed = parsePrefixedBuffer<CompiledGroundCollisionTileHeader>(buffer, COMPILED_GROUND_COLLISION_TILE_MAGIC)
  if (!parsed) {
    return null
  }
  const { header, payloadOffset } = parsed
  const rows = Math.max(1, Math.trunc(Number(header.rows) || 0))
  const columns = Math.max(1, Math.trunc(Number(header.columns) || 0))
  const expectedValueCount = (rows + 1) * (columns + 1)
  const payloadByteLength = expectedValueCount * Float32Array.BYTES_PER_ELEMENT
  if (payloadOffset + payloadByteLength !== buffer!.byteLength) {
    return null
  }
  return {
    header: {
      version: 1,
      key: String(header.key ?? ''),
      row: Math.trunc(Number(header.row) || 0),
      column: Math.trunc(Number(header.column) || 0),
      bounds: header.bounds,
      rows,
      columns,
      elementSize: Number(header.elementSize) || 1,
      minHeight: Number(header.minHeight) || 0,
      maxHeight: Number(header.maxHeight) || 0,
    },
    heights: new Float32Array(buffer!.slice(payloadOffset)),
  }
}

export function collectCompiledGroundCoveredChunkKeys(manifest: CompiledGroundManifest | null | undefined): string[] {
  if (!manifest) {
    return []
  }
  const cached = compiledGroundCoveredChunkKeyCache.get(manifest)
  if (cached) {
    return cached
  }
  const bounds = manifest.coveredChunkBounds
  if (!bounds) {
    return []
  }
  const keys: string[] = []
  for (let chunkZ = bounds.minChunkZ; chunkZ <= bounds.maxChunkZ; chunkZ += 1) {
    for (let chunkX = bounds.minChunkX; chunkX <= bounds.maxChunkX; chunkX += 1) {
      keys.push(`${chunkX}:${chunkZ}`)
    }
  }
  compiledGroundCoveredChunkKeyCache.set(manifest, keys)
  return keys
}

export function computeCompiledGroundManifestRevision(
  manifest: Omit<CompiledGroundManifest, 'revision'> | CompiledGroundManifest,
): number {
  let hash = 2166136261 >>> 0
  const pushNumber = (value: number): void => {
    const normalized = Number.isFinite(value) ? Math.round(value * 1000) : 0
    hash ^= normalized >>> 0
    hash = Math.imul(hash, 16777619) >>> 0
  }
  const pushString = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619) >>> 0
    }
  }

  pushString(String(manifest.sceneId ?? ''))
  pushString(String(manifest.groundNodeId ?? ''))
  pushNumber(Number(manifest.chunkSizeMeters) || 0)
  pushNumber(Number(manifest.baseHeight) || 0)
  pushNumber(Number(manifest.renderTileSizeMeters) || 0)
  pushNumber(Number(manifest.collisionTileSizeMeters) || 0)
  pushNumber(Number(manifest.bounds?.minX) || 0)
  pushNumber(Number(manifest.bounds?.minY) || 0)
  pushNumber(Number(manifest.bounds?.minZ) || 0)
  pushNumber(Number(manifest.bounds?.maxX) || 0)
  pushNumber(Number(manifest.bounds?.maxY) || 0)
  pushNumber(Number(manifest.bounds?.maxZ) || 0)

  for (const record of manifest.renderTiles ?? []) {
    pushString(record.key)
    pushString(record.path)
    pushNumber(record.row)
    pushNumber(record.column)
    pushNumber(record.centerX)
    pushNumber(record.centerZ)
    pushNumber(record.sizeMeters)
    pushNumber(record.widthMeters)
    pushNumber(record.depthMeters)
    pushNumber(record.vertexCount)
    pushNumber(record.triangleCount)
    pushNumber(record.bounds?.minX ?? 0)
    pushNumber(record.bounds?.minY ?? 0)
    pushNumber(record.bounds?.minZ ?? 0)
    pushNumber(record.bounds?.maxX ?? 0)
    pushNumber(record.bounds?.maxY ?? 0)
    pushNumber(record.bounds?.maxZ ?? 0)
  }

  for (const record of manifest.collisionTiles ?? []) {
    pushString(record.key)
    pushString(record.path)
    pushNumber(record.row)
    pushNumber(record.column)
    pushNumber(record.centerX)
    pushNumber(record.centerZ)
    pushNumber(record.sizeMeters)
    pushNumber(record.widthMeters)
    pushNumber(record.depthMeters)
    pushNumber(record.rows)
    pushNumber(record.columns)
    pushNumber(record.elementSize)
    pushNumber(record.bounds?.minX ?? 0)
    pushNumber(record.bounds?.minY ?? 0)
    pushNumber(record.bounds?.minZ ?? 0)
    pushNumber(record.bounds?.maxX ?? 0)
    pushNumber(record.bounds?.maxY ?? 0)
    pushNumber(record.bounds?.maxZ ?? 0)
  }

  return hash >>> 0
}

export function computeCompiledGroundBoundsFromPositions(positions: Float32Array): CompiledGroundBounds {
  const box = new THREE.Box3()
  const vector = new THREE.Vector3()
  for (let index = 0; index < positions.length; index += 3) {
    vector.set(positions[index] ?? 0, positions[index + 1] ?? 0, positions[index + 2] ?? 0)
    box.expandByPoint(vector)
  }
  return {
    minX: box.min.x,
    minY: box.min.y,
    minZ: box.min.z,
    maxX: box.max.x,
    maxY: box.max.y,
    maxZ: box.max.z,
  }
}
