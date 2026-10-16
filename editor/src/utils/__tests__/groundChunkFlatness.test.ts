import { describe, expect, it } from 'vitest'
import type { GroundDynamicMesh } from '@schema/core'
import { canTreatGroundChunkAsFlatPlane } from '@schema/groundMesh'

function createDefinition(options: { withDem: boolean; cellSize?: number }): GroundDynamicMesh {
  const cellSize = options.cellSize ?? 10
  const span = 2000
  const columns = Math.round(span / cellSize)
  const rows = columns
  const vertexCount = (rows + 1) * (columns + 1)
  const manualHeightMap = new Float64Array(vertexCount)
  const planningHeightMap = new Float64Array(vertexCount)
  for (let index = 0; index < vertexCount; index += 1) {
    planningHeightMap[index] = (index % (columns + 1)) * 0.5
  }
  return {
    type: 'Ground',
    terrainMode: 'infinite',
    chunkSizeMeters: 100,
    cellSize,
    baseHeight: 0,
    worldBounds: {
      minX: -span * 0.5,
      maxX: span * 0.5,
      minZ: -span * 0.5,
      maxZ: span * 0.5,
    },
    manualHeightMap,
    planningHeightMap,
    planningMetadata: options.withDem
      ? {
          demSource: {
            width: 200,
            height: 200,
            targetRows: rows,
            targetColumns: columns,
            targetCellSize: cellSize,
            worldBounds: {
              minX: -span * 0.5,
              minY: -span * 0.5,
              maxX: span * 0.5,
              maxY: span * 0.5,
            },
          },
        }
      : null,
  } as unknown as GroundDynamicMesh
}

describe('canTreatGroundChunkAsFlatPlane', () => {
  it('keeps the flat fast path for plain ground without DEM coverage', () => {
    const definition = createDefinition({ withDem: false })
    expect(canTreatGroundChunkAsFlatPlane(definition, 0, 0)).toBe(true)
  })

  it('refuses the flat fast path for chunks covered by the planning DEM', () => {
    const definition = createDefinition({ withDem: true })
    expect(canTreatGroundChunkAsFlatPlane(definition, 0, 0)).toBe(false)
    expect(canTreatGroundChunkAsFlatPlane(definition, 5, 5)).toBe(false)
  })

  it('still allows the flat fast path outside the DEM coverage', () => {
    const definition = createDefinition({ withDem: true })
    expect(canTreatGroundChunkAsFlatPlane(definition, 50, 50)).toBe(true)
  })
})
