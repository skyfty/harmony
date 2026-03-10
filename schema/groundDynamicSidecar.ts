import type { TerrainPaintChannel, TerrainPaintSettings } from './index'
import { TerrainScatterCategories, type TerrainScatterCategory, type TerrainScatterStoreSnapshot } from './terrain-scatter'

export const GROUND_DYNAMIC_SIDECAR_FILENAME = 'ground-dynamic.bin'
export const GROUND_DYNAMIC_SIDECAR_VERSION = 1

const GROUND_DYNAMIC_SIDECAR_MAGIC = 0x314d4447
const GROUND_DYNAMIC_SIDECAR_HEADER_BYTES = 40
const SECTION_DIRECTORY_ENTRY_BYTES = 16
const NULL_INDEX = 0xffffffff
const NULL_OFFSET = 0xffffffff

const enum SectionType {
  ScatterMeta = 1,
  ScatterLayers = 2,
  ScatterInstances = 3,
  PaintMeta = 4,
  PaintLayers = 5,
  PaintChunks = 6,
}

const enum GroundDynamicFlags {
  HasScatter = 1 << 0,
  HasPaint = 1 << 1,
}

const enum GroundCoordsFlags {
  HasGroundCoords = 1 << 0,
  HasGroundHeight = 1 << 1,
  HasGroundNormal = 1 << 2,
}

const enum PaintChannelCode {
  R = 0,
  G = 1,
  B = 2,
  A = 3,
}

const CATEGORY_TO_CODE = new Map<TerrainScatterCategory, number>(
  TerrainScatterCategories.map((category, index) => [category, index]),
)

const STRING_ENCODER = new TextEncoder()
const STRING_DECODER = new TextDecoder()

type BlobRef = {
  offset: number
  length: number
}

type SectionBuffer = {
  type: SectionType
  bytes: Uint8Array
  recordCount: number
}

type GroundDynamicOpaqueRecord = Record<string, unknown> | null

export type GroundDynamicSidecarPayload = {
  groundNodeId: string
  terrainScatter: TerrainScatterStoreSnapshot | null
  terrainPaint: TerrainPaintSettings | null
}

function encodeNullableOpaqueRecord(value: GroundDynamicOpaqueRecord): Uint8Array | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return STRING_ENCODER.encode(JSON.stringify(value))
}

function decodeNullableOpaqueRecord(bytes: Uint8Array | null): GroundDynamicOpaqueRecord {
  if (!bytes || bytes.byteLength === 0) {
    return null
  }
  const parsed = JSON.parse(STRING_DECODER.decode(bytes)) as unknown
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
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

class BlobPoolBuilder {
  private readonly chunks: Uint8Array[] = []
  private totalBytes = 0

  add(bytes: Uint8Array | null): BlobRef {
    if (!bytes || bytes.byteLength === 0) {
      return { offset: NULL_OFFSET, length: 0 }
    }
    const ref = { offset: this.totalBytes, length: bytes.byteLength }
    this.chunks.push(bytes)
    this.totalBytes += bytes.byteLength
    return ref
  }

  toBytes(): Uint8Array {
    const result = new Uint8Array(this.totalBytes)
    let offset = 0
    this.chunks.forEach((chunk) => {
      result.set(chunk, offset)
      offset += chunk.byteLength
    })
    return result
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

function writeBlobRef(view: DataView, offset: number, ref: BlobRef): void {
  view.setUint32(offset, ref.offset === NULL_OFFSET ? NULL_OFFSET : ref.offset, true)
  view.setUint32(offset + 4, ref.length, true)
}

function readBlobRef(view: DataView, offset: number): BlobRef {
  return {
    offset: view.getUint32(offset, true),
    length: view.getUint32(offset + 4, true),
  }
}

function resolveBlob(ref: BlobRef, blobBytes: Uint8Array): Uint8Array | null {
  if (ref.offset === NULL_OFFSET || ref.length === 0) {
    return null
  }
  const end = ref.offset + ref.length
  if (end > blobBytes.byteLength) {
    throw new Error('Invalid ground dynamic sidecar blob reference')
  }
  return blobBytes.slice(ref.offset, end)
}

function encodeCategory(category: TerrainScatterCategory): number {
  return CATEGORY_TO_CODE.get(category) ?? 0
}

function decodeCategory(code: number): TerrainScatterCategory {
  return TerrainScatterCategories[code] ?? TerrainScatterCategories[0]!
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

function normalizeScatterPayload(payload: GroundDynamicSidecarPayload): GroundDynamicSidecarPayload {
  return {
    groundNodeId: typeof payload.groundNodeId === 'string' ? payload.groundNodeId.trim() : '',
    terrainScatter: payload.terrainScatter ?? null,
    terrainPaint: payload.terrainPaint ?? null,
  }
}

function buildScatterMetaSection(snapshot: TerrainScatterStoreSnapshot): SectionBuffer {
  const bytes = new Uint8Array(24)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, Number.isFinite(snapshot.version) ? Math.trunc(snapshot.version) : 1, true)
  view.setUint32(4, Number.isFinite(snapshot.metadata?.version) ? Math.trunc(snapshot.metadata.version) : 1, true)
  view.setFloat64(8, Number.isFinite(snapshot.metadata?.createdAt) ? Number(snapshot.metadata.createdAt) : Number.NaN, true)
  view.setFloat64(16, Number.isFinite(snapshot.metadata?.updatedAt) ? Number(snapshot.metadata.updatedAt) : Number.NaN, true)
  return { type: SectionType.ScatterMeta, bytes, recordCount: 1 }
}

function buildScatterLayersSection(
  snapshot: TerrainScatterStoreSnapshot,
  strings: StringTableBuilder,
  blobs: BlobPoolBuilder,
): SectionBuffer {
  const recordBytes = 96
  const bytes = new Uint8Array(snapshot.layers.length * recordBytes)
  const view = new DataView(bytes.buffer)
  snapshot.layers.forEach((layer, index) => {
    const baseOffset = index * recordBytes
    const payloadRef = blobs.add(encodeNullableOpaqueRecord(layer.params?.payload as GroundDynamicOpaqueRecord))
    writeNullableStringIndex(view, baseOffset, strings.add(layer.id))
    writeNullableStringIndex(view, baseOffset + 4, strings.add(layer.label))
    view.setUint8(baseOffset + 8, encodeCategory(layer.category))
    let flags = 0
    if (layer.params?.alignToNormal) {
      flags |= 1 << 0
    }
    if (layer.params?.randomYaw) {
      flags |= 1 << 1
    }
    view.setUint8(baseOffset + 9, flags)
    view.setUint16(baseOffset + 10, 0, true)
    writeNullableStringIndex(view, baseOffset + 12, strings.add(layer.assetId))
    writeNullableStringIndex(view, baseOffset + 16, strings.add(layer.profileId))
    writeNullableStringIndex(view, baseOffset + 20, strings.add(layer.metadata?.authorId ?? null))
    view.setFloat32(baseOffset + 24, Number(layer.params?.minSlope ?? 0), true)
    view.setFloat32(baseOffset + 28, Number(layer.params?.maxSlope ?? 0), true)
    view.setFloat32(baseOffset + 32, Number(layer.params?.minHeight ?? 0), true)
    view.setFloat32(baseOffset + 36, Number(layer.params?.maxHeight ?? 0), true)
    view.setFloat32(baseOffset + 40, Number(layer.params?.minScale ?? 1), true)
    view.setFloat32(baseOffset + 44, Number(layer.params?.maxScale ?? 1), true)
    view.setFloat32(baseOffset + 48, Number(layer.params?.density ?? 1), true)
    view.setFloat64(baseOffset + 52, layer.params?.seed == null ? Number.NaN : Number(layer.params.seed), true)
    view.setFloat32(baseOffset + 60, Number(layer.params?.jitter?.position ?? 0), true)
    view.setFloat32(baseOffset + 64, Number(layer.params?.jitter?.rotation ?? 0), true)
    view.setFloat32(baseOffset + 68, Number(layer.params?.jitter?.scale ?? 0), true)
    view.setFloat64(baseOffset + 72, Number(layer.metadata?.createdAt ?? Number.NaN), true)
    view.setFloat64(baseOffset + 80, Number(layer.metadata?.updatedAt ?? Number.NaN), true)
    writeBlobRef(view, baseOffset + 88, payloadRef)
  })
  return { type: SectionType.ScatterLayers, bytes, recordCount: snapshot.layers.length }
}

function buildScatterInstancesSection(
  snapshot: TerrainScatterStoreSnapshot,
  strings: StringTableBuilder,
  blobs: BlobPoolBuilder,
): SectionBuffer {
  const flattenedInstances = snapshot.layers.flatMap((layer) => layer.instances)
  const recordBytes = 96
  const bytes = new Uint8Array(flattenedInstances.length * recordBytes)
  const view = new DataView(bytes.buffer)
  flattenedInstances.forEach((instance, index) => {
    const baseOffset = index * recordBytes
    const metadataRef = blobs.add(encodeNullableOpaqueRecord(instance.metadata as GroundDynamicOpaqueRecord))
    writeNullableStringIndex(view, baseOffset, strings.add(instance.id))
    writeNullableStringIndex(view, baseOffset + 4, strings.add(instance.assetId))
    writeNullableStringIndex(view, baseOffset + 8, strings.add(instance.layerId))
    writeNullableStringIndex(view, baseOffset + 12, strings.add(instance.profileId))
    view.setFloat64(baseOffset + 16, instance.seed == null ? Number.NaN : Number(instance.seed), true)
    view.setFloat32(baseOffset + 24, Number(instance.localPosition?.x ?? 0), true)
    view.setFloat32(baseOffset + 28, Number(instance.localPosition?.y ?? 0), true)
    view.setFloat32(baseOffset + 32, Number(instance.localPosition?.z ?? 0), true)
    view.setFloat32(baseOffset + 36, Number(instance.localRotation?.x ?? 0), true)
    view.setFloat32(baseOffset + 40, Number(instance.localRotation?.y ?? 0), true)
    view.setFloat32(baseOffset + 44, Number(instance.localRotation?.z ?? 0), true)
    view.setFloat32(baseOffset + 48, Number(instance.localScale?.x ?? 1), true)
    view.setFloat32(baseOffset + 52, Number(instance.localScale?.y ?? 1), true)
    view.setFloat32(baseOffset + 56, Number(instance.localScale?.z ?? 1), true)
    let groundFlags = 0
    if (instance.groundCoords) {
      groundFlags |= GroundCoordsFlags.HasGroundCoords
      if (instance.groundCoords.height != null) {
        groundFlags |= GroundCoordsFlags.HasGroundHeight
      }
      if (instance.groundCoords.normal) {
        groundFlags |= GroundCoordsFlags.HasGroundNormal
      }
    }
    view.setUint32(baseOffset + 60, groundFlags, true)
    view.setFloat32(baseOffset + 64, Number(instance.groundCoords?.x ?? Number.NaN), true)
    view.setFloat32(baseOffset + 68, Number(instance.groundCoords?.z ?? Number.NaN), true)
    view.setFloat32(baseOffset + 72, Number(instance.groundCoords?.height ?? Number.NaN), true)
    view.setFloat32(baseOffset + 76, Number(instance.groundCoords?.normal?.x ?? Number.NaN), true)
    view.setFloat32(baseOffset + 80, Number(instance.groundCoords?.normal?.y ?? Number.NaN), true)
    view.setFloat32(baseOffset + 84, Number(instance.groundCoords?.normal?.z ?? Number.NaN), true)
    writeBlobRef(view, baseOffset + 88, metadataRef)
  })
  return { type: SectionType.ScatterInstances, bytes, recordCount: flattenedInstances.length }
}

function buildPaintMetaSection(settings: TerrainPaintSettings): SectionBuffer {
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, Number.isFinite(settings.version) ? Math.trunc(settings.version) : 1, true)
  view.setUint32(4, Number.isFinite(settings.weightmapResolution) ? Math.trunc(settings.weightmapResolution) : 256, true)
  return { type: SectionType.PaintMeta, bytes, recordCount: 1 }
}

function buildPaintLayersSection(settings: TerrainPaintSettings, strings: StringTableBuilder): SectionBuffer {
  const recordBytes = 8
  const layers = Array.isArray(settings.layers) ? settings.layers : []
  const bytes = new Uint8Array(layers.length * recordBytes)
  const view = new DataView(bytes.buffer)
  layers.forEach((layer, index) => {
    const baseOffset = index * recordBytes
    view.setUint32(baseOffset, encodePaintChannel(layer.channel), true)
    writeNullableStringIndex(view, baseOffset + 4, strings.add(layer.textureAssetId))
  })
  return { type: SectionType.PaintLayers, bytes, recordCount: layers.length }
}

function buildPaintChunksSection(settings: TerrainPaintSettings, strings: StringTableBuilder): SectionBuffer {
  const recordBytes = 8
  const entries = Object.entries(settings.chunks ?? {})
  const bytes = new Uint8Array(entries.length * recordBytes)
  const view = new DataView(bytes.buffer)
  entries.forEach(([chunkKey, ref], index) => {
    const baseOffset = index * recordBytes
    writeNullableStringIndex(view, baseOffset, strings.add(chunkKey))
    writeNullableStringIndex(view, baseOffset + 4, strings.add(ref?.logicalId ?? null))
  })
  return { type: SectionType.PaintChunks, bytes, recordCount: entries.length }
}

export function serializeGroundDynamicSidecar(rawPayload: GroundDynamicSidecarPayload): ArrayBuffer {
  const payload = normalizeScatterPayload(rawPayload)
  if (!payload.groundNodeId) {
    throw new Error('groundNodeId is required for ground dynamic sidecar')
  }

  const strings = new StringTableBuilder()
  const blobs = new BlobPoolBuilder()
  const sections: SectionBuffer[] = []
  let flags = 0
  const groundNodeIdIndex = strings.add(payload.groundNodeId)

  if (payload.terrainScatter) {
    flags |= GroundDynamicFlags.HasScatter
    sections.push(buildScatterMetaSection(payload.terrainScatter))
    sections.push(buildScatterLayersSection(payload.terrainScatter, strings, blobs))
    sections.push(buildScatterInstancesSection(payload.terrainScatter, strings, blobs))
  }
  if (payload.terrainPaint) {
    flags |= GroundDynamicFlags.HasPaint
    sections.push(buildPaintMetaSection(payload.terrainPaint))
    sections.push(buildPaintLayersSection(payload.terrainPaint, strings))
    sections.push(buildPaintChunksSection(payload.terrainPaint, strings))
  }

  const stringBytes = strings.toBytes()
  const blobBytes = blobs.toBytes()
  const directoryOffset = GROUND_DYNAMIC_SIDECAR_HEADER_BYTES
  const directoryBytes = sections.length * SECTION_DIRECTORY_ENTRY_BYTES
  const stringTableOffset = directoryOffset + directoryBytes
  const blobOffset = stringTableOffset + stringBytes.byteLength
  let sectionOffset = blobOffset + blobBytes.byteLength
  const totalBytes = sectionOffset + sections.reduce((sum, section) => sum + section.bytes.byteLength, 0)
  const result = new Uint8Array(totalBytes)
  const view = new DataView(result.buffer)

  view.setUint32(0, GROUND_DYNAMIC_SIDECAR_MAGIC, true)
  view.setUint32(4, GROUND_DYNAMIC_SIDECAR_VERSION, true)
  view.setUint32(8, stringTableOffset, true)
  view.setUint32(12, strings.count, true)
  view.setUint32(16, blobOffset, true)
  view.setUint32(20, blobBytes.byteLength, true)
  view.setUint32(24, directoryOffset, true)
  view.setUint32(28, sections.length, true)
  view.setUint32(32, groundNodeIdIndex, true)
  view.setUint32(36, flags, true)

  result.set(stringBytes, stringTableOffset)
  result.set(blobBytes, blobOffset)

  sections.forEach((section, index) => {
    const directoryEntryOffset = directoryOffset + index * SECTION_DIRECTORY_ENTRY_BYTES
    view.setUint32(directoryEntryOffset, section.type, true)
    view.setUint32(directoryEntryOffset + 4, sectionOffset, true)
    view.setUint32(directoryEntryOffset + 8, section.bytes.byteLength, true)
    view.setUint32(directoryEntryOffset + 12, section.recordCount, true)
    result.set(section.bytes, sectionOffset)
    sectionOffset += section.bytes.byteLength
  })

  return result.buffer
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

function readSections(buffer: ArrayBuffer, directoryOffset: number, count: number): Map<number, { offset: number; byteLength: number; recordCount: number }> {
  const view = new DataView(buffer)
  const sections = new Map<number, { offset: number; byteLength: number; recordCount: number }>()
  for (let index = 0; index < count; index += 1) {
    const baseOffset = directoryOffset + index * SECTION_DIRECTORY_ENTRY_BYTES
    sections.set(view.getUint32(baseOffset, true), {
      offset: view.getUint32(baseOffset + 4, true),
      byteLength: view.getUint32(baseOffset + 8, true),
      recordCount: view.getUint32(baseOffset + 12, true),
    })
  }
  return sections
}

export function deserializeGroundDynamicSidecar(buffer: ArrayBuffer): GroundDynamicSidecarPayload {
  if (buffer.byteLength < GROUND_DYNAMIC_SIDECAR_HEADER_BYTES) {
    throw new Error('Invalid ground dynamic sidecar size')
  }
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  if (magic !== GROUND_DYNAMIC_SIDECAR_MAGIC || version !== GROUND_DYNAMIC_SIDECAR_VERSION) {
    throw new Error('Invalid ground dynamic sidecar header')
  }

  const stringTableOffset = view.getUint32(8, true)
  const stringCount = view.getUint32(12, true)
  const blobOffset = view.getUint32(16, true)
  const blobByteLength = view.getUint32(20, true)
  const directoryOffset = view.getUint32(24, true)
  const sectionCount = view.getUint32(28, true)
  const groundNodeIdIndex = view.getUint32(32, true)
  const flags = view.getUint32(36, true)
  const strings = readStringTable(buffer, stringTableOffset, stringCount)
  const sections = readSections(buffer, directoryOffset, sectionCount)
  const blobBytes = new Uint8Array(buffer, blobOffset, blobByteLength)
  const groundNodeId = strings[groundNodeIdIndex] ?? ''

  let terrainScatter: TerrainScatterStoreSnapshot | null = null
  if (flags & GroundDynamicFlags.HasScatter) {
    const metaSection = sections.get(SectionType.ScatterMeta)
    const layersSection = sections.get(SectionType.ScatterLayers)
    const instancesSection = sections.get(SectionType.ScatterInstances)
    if (!metaSection || !layersSection || !instancesSection) {
      throw new Error('Ground dynamic sidecar is missing scatter sections')
    }
    const metaView = new DataView(buffer, metaSection.offset, metaSection.byteLength)
    const layersView = new DataView(buffer, layersSection.offset, layersSection.byteLength)
    const instancesView = new DataView(buffer, instancesSection.offset, instancesSection.byteLength)
    const layers = Array.from({ length: layersSection.recordCount }, (_, index) => {
      const baseOffset = index * 96
      const payloadRef = readBlobRef(layersView, baseOffset + 88)
      return {
        id: readStringIndex(layersView, baseOffset, strings) ?? `layer-${index}`,
        label: readStringIndex(layersView, baseOffset + 4, strings) ?? 'Scatter Layer',
        category: decodeCategory(layersView.getUint8(baseOffset + 8)),
        assetId: readStringIndex(layersView, baseOffset + 12, strings),
        profileId: readStringIndex(layersView, baseOffset + 16, strings),
        params: {
          alignToNormal: Boolean(layersView.getUint8(baseOffset + 9) & (1 << 0)),
          randomYaw: Boolean(layersView.getUint8(baseOffset + 9) & (1 << 1)),
          minSlope: layersView.getFloat32(baseOffset + 24, true),
          maxSlope: layersView.getFloat32(baseOffset + 28, true),
          minHeight: layersView.getFloat32(baseOffset + 32, true),
          maxHeight: layersView.getFloat32(baseOffset + 36, true),
          minScale: layersView.getFloat32(baseOffset + 40, true),
          maxScale: layersView.getFloat32(baseOffset + 44, true),
          density: layersView.getFloat32(baseOffset + 48, true),
          seed: Number.isFinite(layersView.getFloat64(baseOffset + 52, true)) ? layersView.getFloat64(baseOffset + 52, true) : null,
          jitter: {
            position: layersView.getFloat32(baseOffset + 60, true),
            rotation: layersView.getFloat32(baseOffset + 64, true),
            scale: layersView.getFloat32(baseOffset + 68, true),
          },
          payload: decodeNullableOpaqueRecord(resolveBlob(payloadRef, blobBytes)),
        },
        metadata: {
          createdAt: layersView.getFloat64(baseOffset + 72, true),
          updatedAt: layersView.getFloat64(baseOffset + 80, true),
          authorId: readStringIndex(layersView, baseOffset + 20, strings),
        },
        instances: [] as TerrainScatterStoreSnapshot['layers'][number]['instances'],
      }
    })
    const layerById = new Map(layers.map((layer) => [layer.id, layer]))
    for (let index = 0; index < instancesSection.recordCount; index += 1) {
      const baseOffset = index * 96
      const metadataRef = readBlobRef(instancesView, baseOffset + 88)
      const layerId = readStringIndex(instancesView, baseOffset + 8, strings)
      const groundFlags = instancesView.getUint32(baseOffset + 60, true)
      const layer = layerId ? layerById.get(layerId) : null
      if (!layer) {
        continue
      }
      layer.instances.push({
        id: readStringIndex(instancesView, baseOffset, strings) ?? `instance-${index}`,
        assetId: readStringIndex(instancesView, baseOffset + 4, strings),
        layerId,
        profileId: readStringIndex(instancesView, baseOffset + 12, strings),
        seed: Number.isFinite(instancesView.getFloat64(baseOffset + 16, true)) ? instancesView.getFloat64(baseOffset + 16, true) : null,
        localPosition: {
          x: instancesView.getFloat32(baseOffset + 24, true),
          y: instancesView.getFloat32(baseOffset + 28, true),
          z: instancesView.getFloat32(baseOffset + 32, true),
        },
        localRotation: {
          x: instancesView.getFloat32(baseOffset + 36, true),
          y: instancesView.getFloat32(baseOffset + 40, true),
          z: instancesView.getFloat32(baseOffset + 44, true),
        },
        localScale: {
          x: instancesView.getFloat32(baseOffset + 48, true),
          y: instancesView.getFloat32(baseOffset + 52, true),
          z: instancesView.getFloat32(baseOffset + 56, true),
        },
        groundCoords: groundFlags & GroundCoordsFlags.HasGroundCoords
          ? {
              x: instancesView.getFloat32(baseOffset + 64, true),
              z: instancesView.getFloat32(baseOffset + 68, true),
              height: groundFlags & GroundCoordsFlags.HasGroundHeight ? instancesView.getFloat32(baseOffset + 72, true) : null,
              normal: groundFlags & GroundCoordsFlags.HasGroundNormal
                ? {
                    x: instancesView.getFloat32(baseOffset + 76, true),
                    y: instancesView.getFloat32(baseOffset + 80, true),
                    z: instancesView.getFloat32(baseOffset + 84, true),
                  }
                : null,
            }
          : null,
        metadata: decodeNullableOpaqueRecord(resolveBlob(metadataRef, blobBytes)),
      })
    }
    terrainScatter = {
      version: metaView.getUint32(0, true),
      groundNodeId,
      metadata: {
        createdAt: metaView.getFloat64(8, true),
        updatedAt: metaView.getFloat64(16, true),
        version: metaView.getUint32(4, true),
      },
      layers,
    }
  }

  let terrainPaint: TerrainPaintSettings | null = null
  if (flags & GroundDynamicFlags.HasPaint) {
    const metaSection = sections.get(SectionType.PaintMeta)
    const layersSection = sections.get(SectionType.PaintLayers)
    const chunksSection = sections.get(SectionType.PaintChunks)
    if (!metaSection || !layersSection || !chunksSection) {
      throw new Error('Ground dynamic sidecar is missing terrain paint sections')
    }
    const metaView = new DataView(buffer, metaSection.offset, metaSection.byteLength)
    const layersView = new DataView(buffer, layersSection.offset, layersSection.byteLength)
    const chunksView = new DataView(buffer, chunksSection.offset, chunksSection.byteLength)
    const layers: TerrainPaintSettings['layers'] = []
    for (let index = 0; index < layersSection.recordCount; index += 1) {
      const baseOffset = index * 8
      const textureAssetId = readStringIndex(layersView, baseOffset + 4, strings)
      if (!textureAssetId) {
        continue
      }
      layers.push({
        channel: decodePaintChannel(layersView.getUint32(baseOffset, true)),
        textureAssetId,
      })
    }
    const chunks: TerrainPaintSettings['chunks'] = {}
    for (let index = 0; index < chunksSection.recordCount; index += 1) {
      const baseOffset = index * 8
      const chunkKey = readStringIndex(chunksView, baseOffset, strings)
      const logicalId = readStringIndex(chunksView, baseOffset + 4, strings)
      if (!chunkKey || !logicalId) {
        continue
      }
      chunks[chunkKey] = { logicalId }
    }
    terrainPaint = {
      version: metaView.getUint32(0, true) as 1,
      weightmapResolution: metaView.getUint32(4, true),
      layers,
      chunks,
    }
  }

  return {
    groundNodeId,
    terrainScatter,
    terrainPaint,
  }
}