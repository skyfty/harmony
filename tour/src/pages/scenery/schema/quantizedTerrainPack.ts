export const QUANTIZED_TERRAIN_PACK_FORMAT = 'harmony-quantized-terrain-pack' as const
export const QUANTIZED_TERRAIN_PACK_VERSION = 1 as const

const QUANTIZED_TERRAIN_PACK_MAGIC = 0x5154504b // QTPK
const QUANTIZED_TERRAIN_PACK_PREFIX_BYTES = Uint32Array.BYTES_PER_ELEMENT * 3
const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

export type QuantizedTerrainPackEntry = {
  tileKey: string
  byteOffset: number
  byteLength: number
}

export type QuantizedTerrainPackHeader = {
  format: typeof QUANTIZED_TERRAIN_PACK_FORMAT
  version: typeof QUANTIZED_TERRAIN_PACK_VERSION
  datasetId: string
  regionKey: string
  tileCount: number
  entries: QuantizedTerrainPackEntry[]
}

export type QuantizedTerrainPackData = {
  header: QuantizedTerrainPackHeader
  entries: Record<string, ArrayBuffer>
}

function normalizeTileKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cloneArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0)
}

function validatePackData(data: QuantizedTerrainPackData): QuantizedTerrainPackHeader {
  const inputHeader = data.header ?? null
  if (!inputHeader || typeof inputHeader !== 'object') {
    throw new Error('Quantized terrain pack header is required')
  }
  const datasetId = typeof inputHeader.datasetId === 'string' ? inputHeader.datasetId.trim() : ''
  const regionKey = typeof inputHeader.regionKey === 'string' ? inputHeader.regionKey.trim() : ''
  if (!datasetId || !regionKey) {
    throw new Error('Quantized terrain pack requires datasetId and regionKey')
  }

  const normalizedEntries: QuantizedTerrainPackEntry[] = []
  const seen = new Set<string>()
  for (const [tileKeyRaw, buffer] of Object.entries(data.entries ?? {})) {
    const tileKey = normalizeTileKey(tileKeyRaw)
    if (!tileKey || seen.has(tileKey)) {
      continue
    }
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= 0) {
      throw new Error(`Quantized terrain pack tile "${tileKey}" must be a non-empty ArrayBuffer`)
    }
    seen.add(tileKey)
    normalizedEntries.push({
      tileKey,
      byteOffset: 0,
      byteLength: buffer.byteLength,
    })
  }

  normalizedEntries.sort((left, right) => left.tileKey.localeCompare(right.tileKey))
  return {
    format: QUANTIZED_TERRAIN_PACK_FORMAT,
    version: QUANTIZED_TERRAIN_PACK_VERSION,
    datasetId,
    regionKey,
    tileCount: normalizedEntries.length,
    entries: normalizedEntries,
  }
}

export function serializeQuantizedTerrainPack(data: QuantizedTerrainPackData): ArrayBuffer {
  const header = validatePackData(data)
  let payloadOffset = 0
  const headerWithOffsets: QuantizedTerrainPackHeader = {
    ...header,
    entries: header.entries.map((entry) => {
      const next = {
        ...entry,
        byteOffset: payloadOffset,
      }
      payloadOffset += entry.byteLength
      return next
    }),
  }

  const headerBytes = TEXT_ENCODER.encode(JSON.stringify(headerWithOffsets))
  const totalBytes = QUANTIZED_TERRAIN_PACK_PREFIX_BYTES + headerBytes.byteLength + payloadOffset
  const buffer = new ArrayBuffer(totalBytes)
  const prefix = new Uint32Array(buffer, 0, 3)
  prefix[0] = QUANTIZED_TERRAIN_PACK_MAGIC
  prefix[1] = QUANTIZED_TERRAIN_PACK_VERSION
  prefix[2] = headerBytes.byteLength

  const target = new Uint8Array(buffer)
  target.set(headerBytes, QUANTIZED_TERRAIN_PACK_PREFIX_BYTES)

  let writeOffset = QUANTIZED_TERRAIN_PACK_PREFIX_BYTES + headerBytes.byteLength
  for (const entry of headerWithOffsets.entries) {
    const payload = new Uint8Array(data.entries[entry.tileKey]!)
    target.set(payload, writeOffset)
    writeOffset += payload.byteLength
  }

  return buffer
}

function parseQuantizedTerrainPackHeader(raw: unknown): QuantizedTerrainPackHeader | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const candidate = raw as Partial<QuantizedTerrainPackHeader>
  if (candidate.format !== QUANTIZED_TERRAIN_PACK_FORMAT || candidate.version !== QUANTIZED_TERRAIN_PACK_VERSION) {
    return null
  }
  if (typeof candidate.datasetId !== 'string' || typeof candidate.regionKey !== 'string' || !Array.isArray(candidate.entries)) {
    return null
  }
  return candidate as QuantizedTerrainPackHeader
}

export function deserializeQuantizedTerrainPack(buffer: ArrayBuffer | null | undefined): QuantizedTerrainPackData | null {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < QUANTIZED_TERRAIN_PACK_PREFIX_BYTES) {
    return null
  }
  const prefix = new Uint32Array(buffer, 0, 3)
  if (prefix[0] !== QUANTIZED_TERRAIN_PACK_MAGIC || prefix[1] !== QUANTIZED_TERRAIN_PACK_VERSION) {
    return null
  }
  const headerLength = prefix[2] ?? 0
  if (QUANTIZED_TERRAIN_PACK_PREFIX_BYTES + headerLength > buffer.byteLength) {
    return null
  }
  const source = new Uint8Array(buffer)
  const headerText = TEXT_DECODER.decode(source.slice(QUANTIZED_TERRAIN_PACK_PREFIX_BYTES, QUANTIZED_TERRAIN_PACK_PREFIX_BYTES + headerLength))
  const header = parseQuantizedTerrainPackHeader(JSON.parse(headerText))
  if (!header) {
    return null
  }

  const payloadBaseOffset = QUANTIZED_TERRAIN_PACK_PREFIX_BYTES + headerLength
  const entries: Record<string, ArrayBuffer> = {}
  for (const entry of header.entries) {
    const tileKey = normalizeTileKey(entry.tileKey)
    const byteOffset = Math.max(0, Math.trunc(entry.byteOffset))
    const byteLength = Math.max(0, Math.trunc(entry.byteLength))
    if (!tileKey || byteLength <= 0) {
      continue
    }
    const start = payloadBaseOffset + byteOffset
    const end = start + byteLength
    if (end > source.byteLength) {
      throw new Error(`Quantized terrain pack entry "${tileKey}" exceeds pack bounds`)
    }
    entries[tileKey] = cloneArrayBuffer(source.slice(start, end).buffer)
  }

  return {
    header: {
      ...header,
      tileCount: header.entries.length,
    },
    entries,
  }
}

export function readQuantizedTerrainPackEntry(
  pack: QuantizedTerrainPackData | null | undefined,
  tileKey: string,
): ArrayBuffer | null {
  if (!pack) {
    return null
  }
  const normalizedTileKey = normalizeTileKey(tileKey)
  if (!normalizedTileKey) {
    return null
  }
  const buffer = pack.entries[normalizedTileKey]
  return buffer instanceof ArrayBuffer ? cloneArrayBuffer(buffer) : null
}
