export const QUANTIZED_TERRAIN_MESH_FORMAT = 'harmony-quantized-terrain-mesh' as const
export const QUANTIZED_TERRAIN_MESH_VERSION = 1 as const

const QUANTIZED_TERRAIN_MESH_MAGIC = 0x4851544d // HQTM
const QUANTIZED_TERRAIN_MESH_PREFIX_BYTES = Uint32Array.BYTES_PER_ELEMENT * 3
const QUANTIZED_AXIS_MAX = 32767
const QUANTIZED_HEIGHT_MAX = 32767
const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

export type QuantizedTerrainMeshVec3 = {
  x: number
  y: number
  z: number
}

export type QuantizedTerrainMeshBoundingSphere = {
  center: QuantizedTerrainMeshVec3
  radius: number
}

export type QuantizedTerrainMeshTileId = {
  level: number
  x: number
  y: number
}

export type QuantizedTerrainMeshTileBounds = {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export type QuantizedTerrainMeshHeader = {
  format: typeof QUANTIZED_TERRAIN_MESH_FORMAT
  version: typeof QUANTIZED_TERRAIN_MESH_VERSION
  tileId: QuantizedTerrainMeshTileId
  bounds: QuantizedTerrainMeshTileBounds
  center: QuantizedTerrainMeshVec3
  minHeight: number
  maxHeight: number
  boundingSphere: QuantizedTerrainMeshBoundingSphere
  horizonOcclusionPoint: QuantizedTerrainMeshVec3 | null
  geometricError: number
  skirtHeight: number
  vertexCount: number
  triangleCount: number
  hasVertexNormals: boolean
  extensions: string[]
}

export type QuantizedTerrainMeshData = {
  header: QuantizedTerrainMeshHeader
  u: Uint16Array
  v: Uint16Array
  height: Uint16Array
  indices: Uint32Array
  westIndices: Uint32Array
  southIndices: Uint32Array
  eastIndices: Uint32Array
  northIndices: Uint32Array
  /** Optional oct-encoded normals, two bytes per vertex. */
  octEncodedNormals?: Uint8Array | null
}

export type QuantizedTerrainMeshDecodedVertex = {
  x: number
  y: number
  z: number
}

export type QuantizedTerrainMeshDecodedGeometry = {
  positions: Float32Array
  indices: Uint32Array
}

export function clampQuantizedTerrainValue(value: number, max = QUANTIZED_AXIS_MAX): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(max, Math.round(value)))
}

export function quantizeTerrainAxis(value: number, min: number, max: number): number {
  const span = Math.max(Number.EPSILON, max - min)
  return clampQuantizedTerrainValue(((value - min) / span) * QUANTIZED_AXIS_MAX)
}

export function quantizeTerrainHeight(value: number, minHeight: number, maxHeight: number): number {
  const span = Math.max(Number.EPSILON, maxHeight - minHeight)
  return clampQuantizedTerrainValue(((value - minHeight) / span) * QUANTIZED_HEIGHT_MAX, QUANTIZED_HEIGHT_MAX)
}

export function dequantizeTerrainAxis(value: number, min: number, max: number): number {
  const normalized = clampQuantizedTerrainValue(value) / QUANTIZED_AXIS_MAX
  return min + (max - min) * normalized
}

export function dequantizeTerrainHeight(value: number, minHeight: number, maxHeight: number): number {
  const normalized = clampQuantizedTerrainValue(value, QUANTIZED_HEIGHT_MAX) / QUANTIZED_HEIGHT_MAX
  return minHeight + (maxHeight - minHeight) * normalized
}

function zigZagEncode(value: number): number {
  const integer = Math.trunc(value)
  return integer >= 0 ? integer * 2 : (-integer * 2) - 1
}

function zigZagDecode(value: number): number {
  const integer = Math.trunc(value)
  return (integer & 1) === 0 ? integer / 2 : -((integer + 1) / 2)
}

function pushVarUint32(out: number[], value: number): void {
  let next = Math.max(0, Math.trunc(value)) >>> 0
  while (next >= 0x80) {
    out.push((next & 0x7f) | 0x80)
    next >>>= 7
  }
  out.push(next)
}

function readVarUint32(bytes: Uint8Array, cursor: { offset: number }): number {
  let result = 0
  let shift = 0
  while (cursor.offset < bytes.length) {
    const byte = bytes[cursor.offset++]!
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return result >>> 0
    }
    shift += 7
    if (shift > 35) {
      throw new Error('Invalid quantized terrain varuint stream')
    }
  }
  throw new Error('Unexpected end of quantized terrain varuint stream')
}

function encodeDeltaZigZag(values: Uint16Array): Uint8Array {
  const out: number[] = []
  let previous = 0
  pushVarUint32(out, values.length)
  for (const raw of values) {
    const value = Math.max(0, Math.min(0xffff, Math.trunc(raw)))
    pushVarUint32(out, zigZagEncode(value - previous))
    previous = value
  }
  return Uint8Array.from(out)
}

function decodeDeltaZigZag(bytes: Uint8Array, expectedLength: number): Uint16Array {
  const cursor = { offset: 0 }
  const length = readVarUint32(bytes, cursor)
  if (length !== expectedLength) {
    throw new Error('Quantized terrain vertex stream length mismatch')
  }
  const out = new Uint16Array(length)
  let previous = 0
  for (let index = 0; index < length; index += 1) {
    const delta = zigZagDecode(readVarUint32(bytes, cursor))
    const value = previous + delta
    out[index] = clampQuantizedTerrainValue(value, 0xffff)
    previous = value
  }
  if (cursor.offset !== bytes.length) {
    throw new Error('Quantized terrain vertex stream has trailing bytes')
  }
  return out
}

function encodeHighWaterMarkIndices(indices: Uint32Array): Uint8Array {
  const out: number[] = []
  let highest = 0
  pushVarUint32(out, indices.length)
  for (const raw of indices) {
    const index = Math.max(0, Math.trunc(raw)) >>> 0
    const code = highest - index
    if (code < 0) {
      throw new Error('Quantized terrain indices must reference vertices in high-water-mark order')
    }
    pushVarUint32(out, code)
    if (code === 0) {
      highest += 1
    }
  }
  return Uint8Array.from(out)
}

function decodeHighWaterMarkIndices(bytes: Uint8Array, expectedLength: number): Uint32Array {
  const cursor = { offset: 0 }
  const length = readVarUint32(bytes, cursor)
  if (length !== expectedLength) {
    throw new Error('Quantized terrain index stream length mismatch')
  }
  const out = new Uint32Array(length)
  let highest = 0
  for (let index = 0; index < length; index += 1) {
    const code = readVarUint32(bytes, cursor)
    if (code > highest) {
      throw new Error('Invalid high-water-mark terrain index stream')
    }
    out[index] = highest - code
    if (code === 0) {
      highest += 1
    }
  }
  if (cursor.offset !== bytes.length) {
    throw new Error('Quantized terrain index stream has trailing bytes')
  }
  return out
}

function encodeUint32List(values: Uint32Array): Uint8Array {
  const out: number[] = []
  pushVarUint32(out, values.length)
  for (const value of values) {
    pushVarUint32(out, value)
  }
  return Uint8Array.from(out)
}

function decodeUint32List(bytes: Uint8Array): Uint32Array {
  const cursor = { offset: 0 }
  const length = readVarUint32(bytes, cursor)
  const out = new Uint32Array(length)
  for (let index = 0; index < length; index += 1) {
    out[index] = readVarUint32(bytes, cursor)
  }
  if (cursor.offset !== bytes.length) {
    throw new Error('Quantized terrain uint32 list has trailing bytes')
  }
  return out
}

function normalizeHeader(input: QuantizedTerrainMeshHeader, data: Pick<QuantizedTerrainMeshData, 'u' | 'indices' | 'octEncodedNormals'>): QuantizedTerrainMeshHeader {
  const vertexCount = data.u.length
  const triangleCount = Math.floor(data.indices.length / 3)
  return {
    ...input,
    format: QUANTIZED_TERRAIN_MESH_FORMAT,
    version: QUANTIZED_TERRAIN_MESH_VERSION,
    vertexCount,
    triangleCount,
    hasVertexNormals: Boolean(data.octEncodedNormals?.length),
    extensions: Array.isArray(input.extensions) ? [...new Set(input.extensions)] : [],
  }
}

function validateQuantizedTerrainMeshData(data: QuantizedTerrainMeshData): QuantizedTerrainMeshHeader {
  const vertexCount = data.u.length
  if (data.v.length !== vertexCount || data.height.length !== vertexCount) {
    throw new Error('Quantized terrain vertex attribute lengths must match')
  }
  if (data.indices.length % 3 !== 0) {
    throw new Error('Quantized terrain index count must be divisible by 3')
  }
  for (const index of data.indices) {
    if (index >= vertexCount) {
      throw new Error('Quantized terrain index references an out-of-range vertex')
    }
  }
  if (data.octEncodedNormals && data.octEncodedNormals.length !== vertexCount * 2) {
    throw new Error('Quantized terrain oct-encoded normals must contain two bytes per vertex')
  }
  return normalizeHeader(data.header, data)
}

function writeSection(target: Uint8Array, offset: number, bytes: Uint8Array): number {
  const view = new DataView(target.buffer, target.byteOffset + offset, Uint32Array.BYTES_PER_ELEMENT)
  view.setUint32(0, bytes.byteLength, true)
  target.set(bytes, offset + Uint32Array.BYTES_PER_ELEMENT)
  return offset + Uint32Array.BYTES_PER_ELEMENT + bytes.byteLength
}

function readSection(source: Uint8Array, cursor: { offset: number }): Uint8Array {
  if (cursor.offset + Uint32Array.BYTES_PER_ELEMENT > source.byteLength) {
    throw new Error('Quantized terrain payload is truncated')
  }
  const view = new DataView(source.buffer, source.byteOffset + cursor.offset, Uint32Array.BYTES_PER_ELEMENT)
  const byteLength = view.getUint32(0, true)
  cursor.offset += Uint32Array.BYTES_PER_ELEMENT
  if (cursor.offset + byteLength > source.byteLength) {
    throw new Error('Quantized terrain section is truncated')
  }
  const bytes = source.slice(cursor.offset, cursor.offset + byteLength)
  cursor.offset += byteLength
  return bytes
}

export function serializeQuantizedTerrainMesh(data: QuantizedTerrainMeshData): ArrayBuffer {
  const header = validateQuantizedTerrainMeshData(data)
  const headerBytes = TEXT_ENCODER.encode(JSON.stringify(header))
  const sections = [
    encodeDeltaZigZag(data.u),
    encodeDeltaZigZag(data.v),
    encodeDeltaZigZag(data.height),
    encodeHighWaterMarkIndices(data.indices),
    encodeUint32List(data.westIndices),
    encodeUint32List(data.southIndices),
    encodeUint32List(data.eastIndices),
    encodeUint32List(data.northIndices),
    data.octEncodedNormals ?? new Uint8Array(0),
  ]
  const sectionBytes = sections.reduce((sum, section) => sum + Uint32Array.BYTES_PER_ELEMENT + section.byteLength, 0)
  const totalBytes = QUANTIZED_TERRAIN_MESH_PREFIX_BYTES + headerBytes.byteLength + sectionBytes
  const buffer = new ArrayBuffer(totalBytes)
  const prefix = new Uint32Array(buffer, 0, 3)
  prefix[0] = QUANTIZED_TERRAIN_MESH_MAGIC
  prefix[1] = QUANTIZED_TERRAIN_MESH_VERSION
  prefix[2] = headerBytes.byteLength
  const target = new Uint8Array(buffer)
  target.set(headerBytes, QUANTIZED_TERRAIN_MESH_PREFIX_BYTES)
  let offset = QUANTIZED_TERRAIN_MESH_PREFIX_BYTES + headerBytes.byteLength
  for (const section of sections) {
    offset = writeSection(target, offset, section)
  }
  return buffer
}

function parseQuantizedTerrainMeshHeader(raw: unknown): QuantizedTerrainMeshHeader | null {
  const candidate = raw as Partial<QuantizedTerrainMeshHeader>
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  if (candidate.format !== QUANTIZED_TERRAIN_MESH_FORMAT || candidate.version !== QUANTIZED_TERRAIN_MESH_VERSION) {
    return null
  }
  if (!candidate.tileId || !candidate.bounds || !candidate.center || !candidate.boundingSphere) {
    return null
  }
  return candidate as QuantizedTerrainMeshHeader
}

export function deserializeQuantizedTerrainMesh(buffer: ArrayBuffer | null | undefined): QuantizedTerrainMeshData | null {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < QUANTIZED_TERRAIN_MESH_PREFIX_BYTES) {
    return null
  }
  const prefix = new Uint32Array(buffer, 0, 3)
  if (prefix[0] !== QUANTIZED_TERRAIN_MESH_MAGIC || prefix[1] !== QUANTIZED_TERRAIN_MESH_VERSION) {
    return null
  }
  const headerLength = prefix[2] ?? 0
  if (QUANTIZED_TERRAIN_MESH_PREFIX_BYTES + headerLength > buffer.byteLength) {
    return null
  }
  const source = new Uint8Array(buffer)
  const headerText = TEXT_DECODER.decode(source.slice(QUANTIZED_TERRAIN_MESH_PREFIX_BYTES, QUANTIZED_TERRAIN_MESH_PREFIX_BYTES + headerLength))
  const header = parseQuantizedTerrainMeshHeader(JSON.parse(headerText))
  if (!header) {
    return null
  }
  const cursor = { offset: QUANTIZED_TERRAIN_MESH_PREFIX_BYTES + headerLength }
  const vertexCount = Math.max(0, Math.trunc(header.vertexCount))
  const indexCount = Math.max(0, Math.trunc(header.triangleCount) * 3)
  const u = decodeDeltaZigZag(readSection(source, cursor), vertexCount)
  const v = decodeDeltaZigZag(readSection(source, cursor), vertexCount)
  const height = decodeDeltaZigZag(readSection(source, cursor), vertexCount)
  const indices = decodeHighWaterMarkIndices(readSection(source, cursor), indexCount)
  const westIndices = decodeUint32List(readSection(source, cursor))
  const southIndices = decodeUint32List(readSection(source, cursor))
  const eastIndices = decodeUint32List(readSection(source, cursor))
  const northIndices = decodeUint32List(readSection(source, cursor))
  const normals = readSection(source, cursor)
  if (cursor.offset !== source.byteLength) {
    throw new Error('Quantized terrain mesh has trailing bytes')
  }
  return {
    header,
    u,
    v,
    height,
    indices,
    westIndices,
    southIndices,
    eastIndices,
    northIndices,
    octEncodedNormals: normals.length ? normals : null,
  }
}

export function decodeQuantizedTerrainMeshGeometry(data: QuantizedTerrainMeshData): QuantizedTerrainMeshDecodedGeometry {
  const { bounds, minHeight, maxHeight } = data.header
  const vertexCount = data.u.length
  const positions = new Float32Array(vertexCount * 3)
  for (let index = 0; index < vertexCount; index += 1) {
    positions[index * 3 + 0] = dequantizeTerrainAxis(data.u[index] ?? 0, bounds.minX, bounds.maxX)
    positions[index * 3 + 1] = dequantizeTerrainHeight(data.height[index] ?? 0, minHeight, maxHeight)
    positions[index * 3 + 2] = dequantizeTerrainAxis(data.v[index] ?? 0, bounds.minZ, bounds.maxZ)
  }
  return {
    positions,
    indices: data.indices,
  }
}
