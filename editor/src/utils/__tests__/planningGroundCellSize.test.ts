import { describe, expect, it } from 'vitest'
import { resolveGroundWorkingCellSizeForBounds } from '@/utils/planningGroundCellSize'

const LARGE_BOUNDS = { minX: -17140, maxX: 17140, minZ: -19540, maxZ: 19540 }
const SMALL_BOUNDS = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 }
const TINY_BOUNDS = { minX: -250, maxX: 250, minZ: -250, maxZ: 250 }

function assertChunkSpansWholeCells(cellSize: number, chunkSizeMeters: number): void {
  const spanCells = Math.max(1, Math.round(chunkSizeMeters / cellSize))
  expect(Math.abs(spanCells * cellSize - chunkSizeMeters)).toBeLessThan(1e-6)
}

describe('resolveGroundWorkingCellSizeForBounds', () => {
  it('coarsens a 34x39km DEM to a whole-chunk-cell size and stays inside the vertex budget', () => {
    const cellSize = resolveGroundWorkingCellSizeForBounds(1, LARGE_BOUNDS, 100)
    expect(cellSize).toBeCloseTo(20, 6)
    assertChunkSpansWholeCells(cellSize, 100)
    const rows = Math.round((LARGE_BOUNDS.maxZ - LARGE_BOUNDS.minZ) / cellSize)
    const columns = Math.round((LARGE_BOUNDS.maxX - LARGE_BOUNDS.minX) / cellSize)
    expect((rows + 1) * (columns + 1)).toBeLessThanOrEqual(2048 * 2048)
  })

  it('keeps a small scene at its current cell size', () => {
    expect(resolveGroundWorkingCellSizeForBounds(1, SMALL_BOUNDS, 100)).toBe(1)
    expect(resolveGroundWorkingCellSizeForBounds(0.5, TINY_BOUNDS, 100)).toBe(0.5)
  })

  it('re-derives the budget-correct size instead of sticking to a coarser current value', () => {
    expect(resolveGroundWorkingCellSizeForBounds(20, LARGE_BOUNDS, 100)).toBe(20)
    expect(resolveGroundWorkingCellSizeForBounds(100, LARGE_BOUNDS, 100)).toBe(20)
  })

  it('quantizes to a divisor of the configured chunk size', () => {
    const midBounds = { minX: -4000, maxX: 4000, minZ: -4000, maxZ: 4000 }
    const cellSize = resolveGroundWorkingCellSizeForBounds(1, midBounds, 64)
    expect(cellSize).toBeCloseTo(4, 6)
    assertChunkSpansWholeCells(cellSize, 64)
  })

  it('falls back to one full chunk when the required cell size exceeds the chunk size', () => {
    const hugeBounds = { minX: -60000, maxX: 60000, minZ: -60000, maxZ: 60000 }
    const cellSize = resolveGroundWorkingCellSizeForBounds(1, hugeBounds, 64)
    expect(cellSize).toBeCloseTo(64, 6)
    assertChunkSpansWholeCells(cellSize, 64)
  })
})
