/**
 * Minimal ZIP archive writer (STORE method, no compression) used to bundle the
 * exported terrain package (geometry GLB + external textures + manifest) into a
 * single downloadable file. The payloads are already compressed formats (GLB
 * buffers, JPEG/PNG), so deflate would add cost without real benefit.
 */

export interface ZipArchiveEntry {
  name: string
  bytes: Uint8Array
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function toDosDateTime(date: Date): { time: number; datePart: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time:
      ((date.getHours() & 0x1f) << 11)
      | ((date.getMinutes() & 0x3f) << 5)
      | ((Math.floor(date.getSeconds() / 2)) & 0x1f),
    datePart:
      (((year - 1980) & 0x7f) << 9)
      | (((date.getMonth() + 1) & 0x0f) << 5)
      | (date.getDate() & 0x1f),
  }
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}

export function buildZipArchive(entries: ZipArchiveEntry[], createdAt: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  const centralRecords: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = []

  let cursor = 0
  const { time, datePart } = toDosDateTime(createdAt)

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.bytes)
    const localHeader = new DataView(new ArrayBuffer(30))
    writeU32(localHeader, 0, 0x04034b50)
    writeU16(localHeader, 4, 20)
    writeU16(localHeader, 6, 0x0800) // UTF-8 names
    writeU16(localHeader, 8, 0) // STORE
    writeU16(localHeader, 10, time)
    writeU16(localHeader, 12, datePart)
    writeU32(localHeader, 14, crc)
    writeU32(localHeader, 18, entry.bytes.length)
    writeU32(localHeader, 22, entry.bytes.length)
    writeU16(localHeader, 26, nameBytes.length)
    writeU16(localHeader, 28, 0)
    localParts.push(new Uint8Array(localHeader.buffer), nameBytes, entry.bytes)
    centralRecords.push({ name: nameBytes, crc, size: entry.bytes.length, offset: cursor })
    cursor += 30 + nameBytes.length + entry.bytes.length
  }

  let centralSize = 0
  for (const record of centralRecords) {
    const header = new DataView(new ArrayBuffer(46))
    writeU32(header, 0, 0x02014b50)
    writeU16(header, 4, 20)
    writeU16(header, 6, 20)
    writeU16(header, 8, 0x0800)
    writeU16(header, 10, 0)
    writeU16(header, 12, time)
    writeU16(header, 14, datePart)
    writeU32(header, 16, record.crc)
    writeU32(header, 20, record.size)
    writeU32(header, 24, record.size)
    writeU16(header, 28, record.name.length)
    writeU16(header, 30, 0)
    writeU16(header, 32, 0)
    writeU16(header, 34, 0)
    writeU16(header, 36, 0)
    writeU32(header, 38, 0)
    writeU32(header, 42, record.offset)
    centralParts.push(new Uint8Array(header.buffer), record.name)
    centralSize += 46 + record.name.length
  }

  const end = new DataView(new ArrayBuffer(22))
  writeU32(end, 0, 0x06054b50)
  writeU16(end, 4, 0)
  writeU16(end, 6, 0)
  writeU16(end, 8, centralRecords.length)
  writeU16(end, 10, centralRecords.length)
  writeU32(end, 12, centralSize)
  writeU32(end, 16, cursor)
  writeU16(end, 20, 0)

  const total = cursor + centralSize + 22
  const output = new Uint8Array(total)
  let writeCursor = 0
  for (const part of localParts) {
    output.set(part, writeCursor)
    writeCursor += part.length
  }
  for (const part of centralParts) {
    output.set(part, writeCursor)
    writeCursor += part.length
  }
  output.set(new Uint8Array(end.buffer), writeCursor)
  return output
}

