import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { mergeTerrainGeometries } from '../terrainMerge'

function buildQuadGeometry(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array([...a, ...b, ...c, ...d])
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  // +Y facing winding: (0,2,1) then (1,2,3).
  geometry.setIndex([0, 2, 1, 1, 2, 3])
  return geometry
}

function buildTriangleGeometry(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array([...a, ...b, ...c])
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
  geometry.setIndex([0, 1, 2])
  return geometry
}

function findVerticesAt(
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  tolerance = 1e-3,
): number[] {
  const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
  const result: number[] = []
  for (let i = 0; i < attribute.count; i += 1) {
    if (
      Math.abs(attribute.getX(i) - position[0]) <= tolerance
      && Math.abs(attribute.getY(i) - position[1]) <= tolerance
      && Math.abs(attribute.getZ(i) - position[2]) <= tolerance
    ) {
      result.push(i)
    }
  }
  return result
}

describe('mergeTerrainGeometries', () => {
  it('welds duplicated border vertices within the same material', () => {
    const result = mergeTerrainGeometries([
      {
        geometry: buildQuadGeometry([0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]),
        materialIndex: 0,
      },
      {
        geometry: buildQuadGeometry([1, 0, 0], [2, 0, 0], [1, 0, 1], [2, 0, 1]),
        materialIndex: 0,
      },
    ])

    expect(result).not.toBeNull()
    const stats = result!.stats
    expect(stats.sourceVertexCount).toBe(8)
    expect(stats.weldedVertexCount).toBe(2)
    expect(stats.outputVertexCount).toBe(6)
    expect(stats.outputTriangleCount).toBe(4)
    expect(result!.groups).toHaveLength(1)

    const normal = result!.geometry.getAttribute('normal') as THREE.BufferAttribute
    for (let i = 0; i < normal.count; i += 1) {
      expect(normal.getX(i)).toBeCloseTo(0, 5)
      expect(normal.getY(i)).toBeCloseTo(1, 5)
      expect(normal.getZ(i)).toBeCloseTo(0, 5)
    }
  })

  it('smooths normals across material boundaries without welding across them', () => {
    const result = mergeTerrainGeometries([
      {
        geometry: buildQuadGeometry([0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]),
        materialIndex: 0,
      },
      {
        // Rises 45 degrees away from the shared edge (1, 0, z).
        geometry: buildQuadGeometry([1, 0, 0], [2, 1, 0], [1, 0, 1], [2, 1, 1]),
        materialIndex: 1,
      },
    ])

    expect(result).not.toBeNull()
    expect(result!.groups.map((group) => group.materialIndex)).toEqual([0, 1])
    expect(result!.stats.weldedVertexCount).toBe(0)

    const geometry = result!.geometry
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
    for (const seamPosition of [[1, 0, 0], [1, 0, 1]] as Array<[number, number, number]>) {
      const copies = findVerticesAt(geometry, seamPosition)
      expect(copies.length).toBe(2)
      const normals = copies.map((vertexIndex) => ({
        x: normal.getX(vertexIndex),
        y: normal.getY(vertexIndex),
        z: normal.getZ(vertexIndex),
      }))
      expect(normals[0].x).toBeCloseTo(normals[1].x, 5)
      expect(normals[0].y).toBeCloseTo(normals[1].y, 5)
      expect(normals[0].z).toBeCloseTo(normals[1].z, 5)
      expect(normals[0].y).toBeGreaterThan(0)
      expect(Math.abs(normals[0].z)).toBeLessThan(1e-5)
    }
  })

  it('removes degenerate triangles', () => {
    const degenerate = new THREE.BufferGeometry()
    degenerate.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
    ]), 3))
    degenerate.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
    degenerate.setIndex([0, 0, 0])

    const result = mergeTerrainGeometries([
      {
        geometry: buildQuadGeometry([0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]),
        materialIndex: 0,
      },
      { geometry: degenerate, materialIndex: 0 },
    ])

    expect(result).not.toBeNull()
    expect(result!.stats.degenerateTrianglesRemoved).toBe(1)
    expect(result!.stats.outputTriangleCount).toBe(2)
  })

  it('strips skirt slivers but keeps near-vertical cliff faces', () => {
    const ground = buildQuadGeometry([0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1])
    // Skirt: long drop from the shared border edge, thin in X.
    const skirt = buildTriangleGeometry([1, 0, 0], [1, -100, 0.5], [1, 0, 1])
    // Cliff: near-vertical face with a real horizontal footprint.
    const cliff = buildTriangleGeometry([0, 0, 0], [2, 10, 0], [1, 10, 1])

    const result = mergeTerrainGeometries([
      { geometry: ground, materialIndex: 0 },
      { geometry: skirt, materialIndex: 0 },
      { geometry: cliff, materialIndex: 1 },
    ])

    expect(result).not.toBeNull()
    expect(result!.stats.skirtTrianglesRemoved).toBe(1)
    // ground (2) + skirt (0) + cliff (1)
    expect(result!.stats.outputTriangleCount).toBe(3)
  })

  it('keeps short near-vertical triangles below the skirt height threshold', () => {
    const ground = buildQuadGeometry([0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1])
    const shortVertical = buildTriangleGeometry([1, 0, 0], [1, -1.5, 0.5], [1, 0, 1])

    const result = mergeTerrainGeometries([
      { geometry: ground, materialIndex: 0 },
      { geometry: shortVertical, materialIndex: 0 },
    ])

    expect(result).not.toBeNull()
    expect(result!.stats.skirtTrianglesRemoved).toBe(0)
  })

  it('honours explicit merge options', () => {
    const left = buildQuadGeometry([0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1])
    // Border vertices offset by 2cm: welded under the default 0.05 epsilon but
    // not under the explicit 0.001 epsilon below.
    const right = buildQuadGeometry([1.02, 0, 0], [2.02, 0, 0], [1.02, 0, 1], [2.02, 0, 1])
    const result = mergeTerrainGeometries(
      [
        { geometry: left, materialIndex: 0 },
        { geometry: right, materialIndex: 0 },
      ],
      { weldEpsilon: 0.001, stripSkirts: false, smoothNormals: false },
    )

    expect(result).not.toBeNull()
    expect(result!.stats.weldedVertexCount).toBe(0)
    expect(result!.stats.outputVertexCount).toBe(8)

    const welded = mergeTerrainGeometries(
      [
        { geometry: left, materialIndex: 0 },
        { geometry: right, materialIndex: 0 },
      ],
      { weldEpsilon: 0.05 },
    )
    expect(welded).not.toBeNull()
    expect(welded!.stats.weldedVertexCount).toBe(2)
    expect(welded!.stats.outputVertexCount).toBe(6)
  })

  it('reports merge stages without changing the output', () => {
    const progress: Array<{ phase: string; completed: number; total: number }> = []
    const result = mergeTerrainGeometries(
      [
        {
          geometry: buildQuadGeometry([0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]),
          materialIndex: 0,
        },
        {
          geometry: buildQuadGeometry([1, 0, 0], [2, 0, 0], [1, 0, 1], [2, 0, 1]),
          materialIndex: 0,
        },
      ],
      {
        onProgress: (value) => progress.push(value),
      },
    )

    expect(result?.stats.outputTriangleCount).toBe(4)
    expect(progress.some((value) => value.phase === 'prepare')).toBe(true)
    expect(progress.some((value) => value.phase === 'weld')).toBe(true)
    expect(progress.some((value) => value.phase === 'smooth')).toBe(true)
    expect(progress.at(-1)?.phase).toBe('assemble')
    expect(progress.at(-1)?.completed).toBe(progress.at(-1)?.total)
  })
})
