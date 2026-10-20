import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type CatalogFile = {
  logicalId: string
  file: string
  width?: number
  height?: number
  hasAlpha?: boolean
}

function readPngTransparency(buffer: Buffer): boolean {
  const colorType = buffer[25]
  if (colorType === 4 || colorType === 6) {
    return true
  }
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'tRNS') {
      return true
    }
    if (type === 'IEND' || length > buffer.length - offset - 12) {
      break
    }
    offset += 12 + length
  }
  return false
}

describe('slowroads 2048 imposter assets', () => {
  it('preserves transparency in every committed color atlas', () => {
    const assetRoot = resolve(process.cwd(), '../tools/slowroads-lab/assets-src')
    const catalogPath = resolve(assetRoot, 'catalog.json')
    expect(existsSync(catalogPath)).toBe(true)
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { files: CatalogFile[] }
    const colorVariants = catalog.files.filter((entry) =>
      /_imposters_\d_d\..*@2048$/.test(entry.logicalId),
    )

    expect(colorVariants.length).toBeGreaterThanOrEqual(8)
    for (const entry of colorVariants) {
      expect(entry.width, entry.logicalId).toBe(2048)
      expect(entry.height, entry.logicalId).toBe(512)
      expect(entry.hasAlpha, entry.logicalId).toBe(true)
      expect(readPngTransparency(readFileSync(resolve(assetRoot, entry.file))), entry.logicalId)
        .toBe(true)
    }
  })
})
