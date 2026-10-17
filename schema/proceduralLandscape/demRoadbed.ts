import * as THREE from 'three'
import type { RoadBandRow } from './roadBandRows'
import { smoothstep } from './noise'

export interface DemRoadbedGeometryOptions {
  rows: ReadonlyArray<RoadBandRow>
  halfWidth: number
  shoulderWidth: number
  /** Horizontal width of the cut/fill slope on each side. */
  sideWidth: number
  /** Extra ring outside the slope so the mesh tucks under the coarse terrain. */
  coverageWidth: number
  /** Roadbed height relative to the design road height (negative = below road). */
  roadDrop: number
  /** Outer coverage ring drop below the raw terrain, hides the seam. */
  edgeDrop: number
  lateralStep: number
  rawHeightAt: (x: number, z: number) => number | null
  hostInverse: THREE.Matrix4
}

export interface DemRoadbedGeometryResult {
  geometry: THREE.BufferGeometry
  innerHalfWidth: number
  outerHalfWidth: number
  meshHalfWidth: number
  vertexCount: number
  triangleCount: number
}

/**
 * High-resolution cut/fill roadbed for DEM terrain.
 *
 * The coarse DEM triangle can rise several meters between its 30m vertices.
 * Hiding the road under a shader-flattened coarse surface is not reliable, so
 * this mesh spans the asphalt/shoulder, a smooth side slope and a small
 * coverage ring, and meets the raw terrain at its outer edge.
 */
export function createDemRoadbedGeometry(
  options: DemRoadbedGeometryOptions,
): DemRoadbedGeometryResult | null {
  const rows = options.rows
  if (rows.length < 2) {
    return null
  }
  const innerHalfWidth = Math.max(0, options.halfWidth + options.shoulderWidth)
  const outerHalfWidth = innerHalfWidth + Math.max(0, options.sideWidth)
  const meshHalfWidth = outerHalfWidth + Math.max(0, options.coverageWidth)
  const lateralStep = Math.max(0.75, options.lateralStep)
  const columns = Math.max(3, Math.ceil((meshHalfWidth * 2) / lateralStep) + 1)
  const vertexCount = rows.length * columns
  const triangleCount = (rows.length - 1) * (columns - 1) * 2
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(triangleCount * 3)
  const point = new THREE.Vector3()
  let vertexCursor = 0

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!
    const normalX = -Math.sin(row.heading)
    const normalZ = Math.cos(row.heading)
    const roadY = row.y - options.roadDrop
    for (let col = 0; col < columns; col += 1) {
      const t = columns > 1 ? col / (columns - 1) : 0.5
      const lateral = -meshHalfWidth + t * meshHalfWidth * 2
      const distance = Math.abs(lateral)
      const x = row.x + normalX * lateral
      const z = row.z + normalZ * lateral
      const raw = options.rawHeightAt(x, z) ?? row.y
      let y: number
      if (distance <= innerHalfWidth) {
        y = roadY
      } else if (distance < outerHalfWidth) {
        y = roadY + (raw - roadY) * smoothstep(innerHalfWidth, outerHalfWidth, distance)
      } else {
        // Tuck the outer ring slightly under the raw surface so any DEM
        // interpolation difference reads as a seam-free join, not a crack.
        y = raw - options.edgeDrop * smoothstep(outerHalfWidth, meshHalfWidth, distance)
      }
      point.set(x, y, z).applyMatrix4(options.hostInverse)
      positions[vertexCursor++] = point.x
      positions[vertexCursor++] = point.y
      positions[vertexCursor++] = point.z
    }
  }

  let indexCursor = 0
  for (let row = 0; row < rows.length - 1; row += 1) {
    const rowOffset = row * columns
    for (let col = 0; col < columns - 1; col += 1) {
      const a = rowOffset + col
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices[indexCursor++] = a
      indices[indexCursor++] = b
      indices[indexCursor++] = c
      indices[indexCursor++] = b
      indices[indexCursor++] = d
      indices[indexCursor++] = c
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return {
    geometry,
    innerHalfWidth,
    outerHalfWidth,
    meshHalfWidth,
    vertexCount,
    triangleCount,
  }
}
