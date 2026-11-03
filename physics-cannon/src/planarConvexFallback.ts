import * as CANNON from 'cannon-es'
import type { PhysicsConvexHullShapeDesc } from '@harmony/physics-core'

const FLAT_CONVEX_VERTICAL_EPSILON = 0.01

/**
 * Cannon cannot build a stable ConvexPolyhedron from near-coplanar points.
 * Static authored surfaces such as zero-thickness floors are represented as a
 * triangle mesh instead, preserving their exact top plane without warnings.
 */
export function createPlanarConvexFallbackShape(
  shapeDesc: PhysicsConvexHullShapeDesc,
): CANNON.Shape | null {
  const source = Array.from(shapeDesc.vertices ?? [])
  if (source.length < 9) {
    return null
  }
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let index = 0; index + 2 < source.length; index += 3) {
    const x = Number(source[index] ?? 0)
    const y = Number(source[index + 1] ?? 0)
    const z = Number(source[index + 2] ?? 0)
    if (![x, y, z].every(Number.isFinite)) {
      return null
    }
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  if (maxY - minY > FLAT_CONVEX_VERTICAL_EPSILON) {
    return null
  }

  const sourceFaces = Array.isArray(shapeDesc.faces) ? shapeDesc.faces : []
  const indices: number[] = []
  const vertexCount = source.length / 3
  sourceFaces.forEach((face) => {
    if (!Array.isArray(face) || face.length < 3) {
      return
    }
    for (let index = 1; index + 1 < face.length; index += 1) {
      const a = Math.trunc(Number(face[0]))
      const b = Math.trunc(Number(face[index]))
      const c = Math.trunc(Number(face[index + 1]))
      if (
        [a, b, c].every((vertexIndex) => (
          Number.isInteger(vertexIndex) && vertexIndex >= 0 && vertexIndex < vertexCount
        ))
      ) {
        indices.push(a, b, c)
      }
    }
  })
  if (indices.length >= 3) {
    return new CANNON.Trimesh(source, indices)
  }

  const halfX = Math.max(0.001, (maxX - minX) * 0.5)
  const halfZ = Math.max(0.001, (maxZ - minZ) * 0.5)
  const halfY = Math.max(0.001, (maxY - minY) * 0.5)
  const box = new CANNON.Box(new CANNON.Vec3(halfX, halfY, halfZ))
  box.updateBoundingSphereRadius()
  return box
}
