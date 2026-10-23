import { describe, expect, it } from 'vitest'
import { buildZipArchive } from '../zipArchive'

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

describe('buildZipArchive', () => {
  it('writes store-only entries and reports monotonic progress', () => {
    const entries = [
      { name: 'dem.tif', bytes: new Uint8Array([1, 2, 3, 4]) },
      { name: 'dem.json', bytes: new TextEncoder().encode('{"version":1}') },
    ]
    const progress: number[] = []
    const archive = buildZipArchive(entries, new Date('2026-01-02T03:04:05Z'), {
      onProgress: (value) => progress.push(value.completed),
    })

    expect(readU32(archive, 0)).toBe(0x04034b50)
    expect(new TextDecoder().decode(archive)).toContain('dem.json')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)).toBeGreaterThan(0)
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index]).toBeGreaterThanOrEqual(progress[index - 1])
    }
  })
})
