import { describe, expect, it } from 'vitest'
import { SEASON_IDS } from '@schema/slowroads/core/seasonCatalog'
import {
  bushVariantEntries,
  grassVariantEntries,
} from '@schema/slowroads/core/spriteRegions'

describe('ground foliage sprite regions', () => {
  it('uses only bottom-row bush sprites in the first three atlas cells', () => {
    for (const season of SEASON_IDS) {
      const entries = bushVariantEntries(season)
      expect(entries.length).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(entry.cell).toBeLessThanOrEqual(2)
        expect(entry.region.v1).toBeLessThan(0.65)
        expect(entry.region.v1 - entry.region.v0).toBeLessThan(0.65)
      }
    }
  })

  it('excludes the brown heather-ball sprite from ordinary grass', () => {
    for (const season of SEASON_IDS) {
      const entries = grassVariantEntries(season)
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every((entry) => entry.cell <= 2)).toBe(true)
    }
  })
})
