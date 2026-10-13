import * as THREE from 'three'
import type { Heightfield } from './heightfield'
import { bakeTerrainHeight, type RoadProfile } from './roadProfile'

/**
 * Builds the terrain surface with slowroads-style road flattening baked into
 * the vertices, plus a per-vertex `aRoadProx` attribute used by the surface
 * shader for gravel/road/canopy blending. The build is time-sliced so the page
 * never freezes while a million vertices are rasterized.
 */
export interface TerrainMeshBuilderOptions {
  /** Quads per axis; 1024 gives ~1.56m cells over the 1600m world. */
  segments?: number
}

export interface TerrainMeshBuilder {
  step(budgetMs?: number): boolean
  readonly progress: number
  readonly geometry: THREE.BufferGeometry | null
  readonly vertexCount: number
  readonly triangleCount: number
}

export function createTerrainMeshBuilder(
  field: Heightfield,
  profile: RoadProfile,
  options: TerrainMeshBuilderOptions = {},
): TerrainMeshBuilder {
  const segments = Math.max(64, Math.round(options.segments ?? 1024))
  const vertsPerRow = segments + 1
  const totalVertices = vertsPerRow * vertsPerRow
  const cellSize = field.worldSize / segments
  const half = field.halfSize

  const heights = new Float32Array(totalVertices)
  const roadProx = new Float32Array(totalVertices)
  const positions = new Float32Array(totalVertices * 3)
  const normals = new Float32Array(totalVertices * 3)
  const indices = new Uint32Array(segments * segments * 6)

  let phase: 'heights' | 'positions' | 'indices' | 'finalize' | 'done' = 'heights'
  let rowCursor = 0
  let geometry: THREE.BufferGeometry | null = null
  const totalRowWork = segments * 3

  const runHeightsRow = (row: number): void => {
    const z = -half + row * cellSize
    const rowOffset = row * vertsPerRow
    for (let col = 0; col < vertsPerRow; col += 1) {
      const x = -half + col * cellSize
      const baked = bakeTerrainHeight(field, profile, x, z)
      const index = rowOffset + col
      heights[index] = baked.height
      roadProx[index] = baked.roadProx
    }
  }

  const runPositionsRow = (row: number): void => {
    const z = -half + row * cellSize
    const rowOffset = row * vertsPerRow
    for (let col = 0; col < vertsPerRow; col += 1) {
      const x = -half + col * cellSize
      const index = rowOffset + col
      const height = heights[index]!
      positions[index * 3] = x
      positions[index * 3 + 1] = height
      positions[index * 3 + 2] = z

      const left = heights[rowOffset + Math.max(0, col - 1)]!
      const right = heights[rowOffset + Math.min(segments, col + 1)]!
      const up = heights[Math.max(0, row - 1) * vertsPerRow + col]!
      const down = heights[Math.min(segments, row + 1) * vertsPerRow + col]!
      const dx = (right - left) / Math.max(1e-4, cellSize * 2)
      const dz = (down - up) / Math.max(1e-4, cellSize * 2)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      normals[index * 3] = -dx * inverseLength
      normals[index * 3 + 1] = inverseLength
      normals[index * 3 + 2] = -dz * inverseLength
    }
  }

  const runIndicesRow = (row: number): void => {
    let cursor = row * segments * 6
    const rowOffset = row * vertsPerRow
    for (let col = 0; col < segments; col += 1) {
      const a = rowOffset + col
      const b = a + 1
      const c = a + vertsPerRow
      const d = c + 1
      // Counter-clockwise when viewed from above so the surface keeps its
      // front face towards the sky (default FrontSide culling).
      indices[cursor] = a
      indices[cursor + 1] = c
      indices[cursor + 2] = d
      indices[cursor + 3] = a
      indices[cursor + 4] = d
      indices[cursor + 5] = b
      cursor += 6
    }
  }

  const finalize = (): void => {
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    next.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    next.setAttribute('aRoadProx', new THREE.BufferAttribute(roadProx, 1))
    next.setIndex(new THREE.BufferAttribute(indices, 1))
    next.computeBoundingSphere()
    geometry = next
    phase = 'done'
  }

  return {
    step(budgetMs = 12): boolean {
      const start = performance.now()
      while (phase !== 'done') {
        if (performance.now() - start >= budgetMs) {
          break
        }
        if (phase === 'heights') {
          runHeightsRow(rowCursor)
          rowCursor += 1
          if (rowCursor > segments) {
            phase = 'positions'
            rowCursor = 0
          }
          continue
        }
        if (phase === 'positions') {
          runPositionsRow(rowCursor)
          rowCursor += 1
          if (rowCursor > segments) {
            phase = 'indices'
            rowCursor = 0
          }
          continue
        }
        if (phase === 'indices') {
          runIndicesRow(rowCursor)
          rowCursor += 1
          if (rowCursor >= segments) {
            phase = 'finalize'
          }
          continue
        }
        if (phase === 'finalize') {
          finalize()
        }
      }
      return phase === 'done'
    },
    get progress(): number {
      if (phase === 'done') {
        return 1
      }
      const done = (phase === 'heights' ? 0 : phase === 'positions' ? segments : phase === 'indices' ? segments * 2 : totalRowWork - 1)
      return Math.min(1, (done + rowCursor) / totalRowWork)
    },
    get geometry(): THREE.BufferGeometry | null {
      return geometry
    },
    vertexCount: totalVertices,
    triangleCount: segments * segments * 2,
  }
}
