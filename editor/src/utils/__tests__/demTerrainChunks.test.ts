import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { splitDemTerrainGeometry } from '@schema/proceduralLandscape/demTerrain'

describe('DEM terrain frustum chunks', () => {
  it('splits indices and bounds without duplicating vertex attributes', () => {
    const columns = 5
    const rows = 5
    const positions = new Float32Array(columns * rows * 3)
    const normals = new Float32Array(columns * rows * 3)
    const uvs = new Float32Array(columns * rows * 2)
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const vertex = row * columns + column
        positions[vertex * 3] = column * 10
        positions[vertex * 3 + 1] = row * 0.5
        positions[vertex * 3 + 2] = row * 10
        normals[vertex * 3 + 1] = 1
        uvs[vertex * 2] = column / (columns - 1)
        uvs[vertex * 2 + 1] = row / (rows - 1)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

    const chunks = splitDemTerrainGeometry(geometry, columns, rows, 2)

    expect(chunks).toHaveLength(4)
    expect(chunks.map((chunk) => chunk.triangleCount)).toEqual([8, 8, 8, 8])
    expect(chunks.reduce((total, chunk) => total + (chunk.geometry.index?.count ?? 0), 0))
      .toBe((columns - 1) * (rows - 1) * 6)
    expect(chunks.every((chunk) => chunk.geometry.getAttribute('position') === geometry.getAttribute('position')))
      .toBe(true)
    expect(chunks[0]?.geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0])
    expect(chunks[0]?.geometry.boundingBox?.max.toArray()).toEqual([20, 1, 20])
    expect(chunks[3]?.geometry.boundingBox?.min.toArray()).toEqual([20, 1, 20])
    expect(chunks[3]?.geometry.boundingBox?.max.toArray()).toEqual([40, 2, 40])

    chunks.forEach((chunk) => chunk.geometry.dispose())
    geometry.dispose()
  })
})
