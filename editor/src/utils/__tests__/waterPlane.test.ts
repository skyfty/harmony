import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createWaterPlane,
  createWaterTerrainHeightField,
} from '@schema/proceduralLandscape/waterPlane'
import type { TerrainHeightGrid } from '@schema/proceduralLandscape/terrainSampler'

function createGrid(): TerrainHeightGrid {
  const cols = 10
  const rows = 10
  const cellSize = 10
  const heights = new Float32Array(cols * rows)
  const coverage = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      heights[index] = row * 10 + col
      coverage[index] = 1
    }
  }
  const sampleHeight = (x: number, z: number): number | null => {
    if (x < 0 || x > 90 || z < 0 || z > 90) {
      return null
    }
    return z + x
  }
  return {
    minX: 0,
    minZ: 0,
    maxX: 90,
    maxZ: 90,
    cellSize,
    cols,
    rows,
    minY: 0,
    maxY: 90,
    averageEdgeLength: cellSize,
    heights,
    coverage,
    memoryBytes: heights.byteLength + coverage.byteLength,
    contains: (x, z) => x >= 0 && x <= 90 && z >= 0 && z <= 90,
    sampleHeight,
    sampleNormal: () => new THREE.Vector3(0, 1, 0),
  }
}

describe('procedural landscape water plane', () => {
  it('packs terrain height and coverage for shader depth tests', () => {
    const field = createWaterTerrainHeightField(createGrid())
    const data = field.texture.image.data as Uint8Array
    const decodeAt = (col: number, row: number): { height: number; coverage: number } => {
      const offset = (row * field.width + col) * 4
      const packed = data[offset]! * 256 + data[offset + 1]!
      return {
        height: field.minY + (packed / 65535) * (field.maxY - field.minY),
        coverage: data[offset + 2]! / 255,
      }
    }
    expect(field.width).toBe(10)
    expect(field.height).toBe(10)
    expect(field.bytes).toBe(400)
    expect(decodeAt(0, 0)).toEqual({ height: 0, coverage: 1 })
    expect(decodeAt(9, 9).height).toBeCloseTo(90, 3)
    expect(field.texture.minFilter).toBe(THREE.NearestFilter)
    field.texture.dispose()
  })

  it('updates the mesh and shader waterline together', () => {
    const grid = createGrid()
    const water = createWaterPlane({
      worldSize: 180,
      centerX: 45,
      centerZ: 45,
      waterLevel: 18,
      waves: new THREE.Texture(),
      terrainGrid: grid,
    })
    const material = water.mesh.material as THREE.ShaderMaterial
    expect(water.mesh.position.y).toBe(18)
    expect(material.uniforms.uWaterLevel!.value).toBe(18)
    expect(material.uniforms.uHasTerrainDepth!.value).toBe(1)
    expect(water.depthTextureBytes).toBe(400)

    water.setWaterLevel(27)
    expect(water.mesh.position.y).toBe(27)
    expect(material.uniforms.uWaterLevel!.value).toBe(27)

    water.setDebugMode(1)
    expect(material.uniforms.uDebugMode!.value).toBe(1)
    water.setTerrainGrid(null)
    expect(water.depthTextureBytes).toBe(4)
    expect(material.uniforms.uHasTerrainDepth!.value).toBe(0)
    water.dispose()
  })
})
