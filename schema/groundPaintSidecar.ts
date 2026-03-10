import type { TerrainPaintChannel, TerrainPaintSettings } from './index'

export const GROUND_PAINT_SIDECAR_FILENAME = 'ground-paint.bin'
export const GROUND_PAINT_SIDECAR_VERSION = 1

const GROUND_PAINT_SIDECAR_MAGIC = 0x31545047
const GROUND_PAINT_SIDECAR_HEADER_BYTES = 32
const NULL_INDEX = 0xffffffff

const enum SectionType {
  PaintMeta = 1,
  PaintLayers = 2,
  PaintChunks = 3,
}

const enum PaintChannelCode {
  R = 0,
  G = 1,
  B = 2,
  A = 3,
}

const STRING_ENCODER = new TextEncoder()
const STRING_DECODER = new TextDecoder()

export type GroundPaintSidecarPayload = {
  groundNodeId: string
  terrainPaint: TerrainPaintSettings | null
}

function encodePaintChannel(channel: TerrainPaintChannel): number {
  switch (channel) {
    case 'r':
      return PaintChannelCode.R
    case 'g':
      return PaintChannelCode.G
    case 'b':
      return PaintChannelCode.B
    case 'a':
      return PaintChannelCode.A
    default:
      return PaintChannelCode.G
  }
}

function decodePaintChannel(code: number): TerrainPaintChannel {
  switch (code) {
    case PaintChannelCode.R:
      return 'r'
    case PaintChannelCode.G:
      return 'g'
    case PaintChannelCode.B:
      return 'b'
    case PaintChannelCode.A:
      return 'a'
    default:
      return 'g'
  }
}

function writeNullableStringIndex(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value === NULL_INDEX ? NULL_INDEX : value, true)
}

function readStringIndex(view: DataView, offset: number, strings: string[]): string | null {
  const index = view.getUint32(offset, true)
  if (index === NULL_INDEX) {
    return null
  }
  return strings[index] ?? null
}

class StringTableBuilder {
  private readonly values: string[] = []
  private readonly indexByValue = new Map<string, number>()

  add(value: string | null | undefined): number {
    if (typeof value !== 'string') {
      return NULL_INDEX
    }
    const normalized = value.trim()
    if (!normalized.length) {
      return NULL_INDEX
    }
    const existing = this.indexByValue.get(normalized)
    if (existing !== undefined) {
      return existing
    }
    const index = this.values.length
    this.values.push(normalized)
    this.indexByValue.set(normalized, index)
    return index
  }

  toBytes(): Uint8Array {
    const encoded = this.values.map((value) => STRING_ENCODER.encode(value))
    const totalBytes = encoded.reduce((sum, entry) => sum + 4 + entry.byteLength, 0)
    const bytes = new Uint8Array(totalBytes)
    const view = new DataView(bytes.buffer)
    let offset = 0
    encoded.forEach((entry) => {
      view.setUint32(offset, entry.byteLength, true)
      offset += 4
      bytes.set(entry, offset)
      offset += entry.byteLength
    })
    return bytes
  }

  get count(): number {
    return this.values.length
  }
}

function readStringTable(buffer: ArrayBuffer, offset: number, count: number): string[] {
  const view = new DataView(buffer)
  const strings: string[] = []
  let cursor = offset
  for (let index = 0; index < count; index += 1) {
    const byteLength = view.getUint32(cursor, true)
    cursor += 4
    const bytes = new Uint8Array(buffer, cursor, byteLength)
    cursor += byteLength
    strings.push(STRING_DECODER.decode(bytes))
  }
  return strings
}

function normalizePayload(payload: GroundPaintSidecarPayload): GroundPaintSidecarPayload {
  return {
    groundNodeId: typeof payload.groundNodeId === 'string' ? payload.groundNodeId.trim() : '',
    terrainPaint: payload.terrainPaint ?? null,
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

  const strings = new StringTableBuilder()
  const groundNodeIdIndex = strings.add(payload.groundNodeId)
  const layers = Array.isArray(payload.terrainPaint.layers) ? payload.terrainPaint.layers : []
  const chunks = Object.entries(payload.terrainPaint.chunks ?? {})

  const metaBytes = new Uint8Array(8)
  const metaView = new DataView(metaBytes.buffer)
  metaView.setUint32(0, Number.isFinite(payload.terrainPaint.version) ? Math.trunc(payload.terrainPaint.version) : 1, true)
  metaView.setUint32(4, Number.isFinite(payload.terrainPaint.weightmapResolution) ? Math.trunc(payload.terrainPaint.weightmapResolution) : 256, true)

  const layerBytes = new Uint8Array(layers.length * 8)
  const layerView = new DataView(layerBytes.buffer)
  layers.forEach((layer, index) => {
    const offset = index * 8
    layerView.setUint32(offset, encodePaintChannel(layer.channel), true)
    writeNullableStringIndex(layerView, offset + 4, strings.add(layer.textureAssetId))
  })

  const chunkBytes = new Uint8Array(chunks.length * 8)
  const chunkView = new DataView(chunkBytes.buffer)
  chunks.forEach(([chunkKey, ref], index) => {
    const offset = index * 8
    writeNullableStringIndex(chunkView, offset, strings.add(chunkKey))
    writeNullableStringIndex(chunkView, offset + 4, strings.add(ref?.logicalId ?? null))
  })

  const stringBytes = strings.toBytes()
  const directoryOffset = GROUND_PAINT_SIDECAR_HEADER_BYTES
  const stringOffset = directoryOffset + 3 * 16
  let sectionOffset = stringOffset + stringBytes.byteLength
  const totalBytes = sectionOffset + metaBytes.byteLength + layerBytes.byteLength + chunkBytes.byteLength
  const result = new Uint8Array(totalBytes)
  const view = new DataView(result.buffer)

  view.setUint32(0, GROUND_PAINT_SIDECAR_MAGIC, true)
  view.setUint32(4, GROUND_PAINT_SIDECAR_VERSION, true)
  view.setUint32(8, stringOffset, true)
  view.setUint32(12, strings.count, true)
  view.setUint32(16, directoryOffset, true)
  view.setUint32(20, 3, true)
  view.setUint32(24, groundNodeIdIndex, true)
  view.setUint32(28, 0, true)
  result.set(stringBytes, stringOffset)

  const sections = [
    { type: SectionType.PaintMeta, bytes: metaBytes, count: 1 },
    { type: SectionType.PaintLayers, bytes: layerBytes, count: layers.length },
    { type: SectionType.PaintChunks, bytes: chunkBytes, count: chunks.length },
  ]
  sections.forEach((section, index) => {
    const dirOffset = directoryOffset + index * 16
    view.setUint32(dirOffset, section.type, true)
    view.setUint32(dirOffset + 4, sectionOffset, true)
    view.setUint32(dirOffset + 8, section.bytes.byteLength, true)
    view.setUint32(dirOffset + 12, section.count, true)
    result.set(section.bytes, sectionOffset)
    sectionOffset += section.bytes.byteLength
  })

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

  const stringOffset = view.getUint32(8, true)
  const stringCount = view.getUint32(12, true)
  const directoryOffset = view.getUint32(16, true)
  const sectionCount = view.getUint32(20, true)
  const groundNodeIdIndex = view.getUint32(24, true)
  const strings = readStringTable(buffer, stringOffset, stringCount)
  const groundNodeId = strings[groundNodeIdIndex] ?? ''

  const sections = new Map<number, { offset: number; byteLength: number; recordCount: number }>()
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = directoryOffset + index * 16
    sections.set(view.getUint32(offset, true), {
      offset: view.getUint32(offset + 4, true),
      byteLength: view.getUint32(offset + 8, true),
      recordCount: view.getUint32(offset + 12, true),
    })
  }

  const metaSection = sections.get(SectionType.PaintMeta)
  const layersSection = sections.get(SectionType.PaintLayers)
  const chunksSection = sections.get(SectionType.PaintChunks)
  if (!metaSection || !layersSection || !chunksSection) {
    throw new Error('Ground paint sidecar is missing paint sections')
  }

  const metaView = new DataView(buffer, metaSection.offset, metaSection.byteLength)
  const layersView = new DataView(buffer, layersSection.offset, layersSection.byteLength)
  const chunksView = new DataView(buffer, chunksSection.offset, chunksSection.byteLength)

  const layers: TerrainPaintSettings['layers'] = []
  for (let index = 0; index < layersSection.recordCount; index += 1) {
    const offset = index * 8
    const textureAssetId = readStringIndex(layersView, offset + 4, strings)
    if (!textureAssetId) {
      continue
    }
    layers.push({
      channel: decodePaintChannel(layersView.getUint32(offset, true)),
      textureAssetId,
    })
  }

  const chunks: TerrainPaintSettings['chunks'] = {}
  for (let index = 0; index < chunksSection.recordCount; index += 1) {
    const offset = index * 8
    const chunkKey = readStringIndex(chunksView, offset, strings)
    const logicalId = readStringIndex(chunksView, offset + 4, strings)
    if (!chunkKey || !logicalId) {
      continue
    }
    chunks[chunkKey] = { logicalId }
  }

  return {
    groundNodeId,
    terrainPaint: {
      version: metaView.getUint32(0, true) as 1,
      weightmapResolution: metaView.getUint32(4, true),
      layers,
      chunks,
    },
  }
}