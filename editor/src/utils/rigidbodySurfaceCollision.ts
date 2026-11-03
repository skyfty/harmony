import * as THREE from 'three'
import type { SceneNode } from '@schema/core'
import type {
  RigidbodyComponentProps,
  RigidbodyPhysicsShape,
} from '@schema/components'

export const FLAT_FLOOR_COLLIDER_THICKNESS_EPSILON = 1e-6
const DEGENERATE_CONVEX_VERTICAL_EPSILON = 0.01

export type RigidbodyHostWorldTransform = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

/**
 * A zero-thickness Floor cannot be represented by a stable convex volume.
 * Static floors are exact walkable surfaces, so the exporter uses their mesh
 * triangles directly instead of manufacturing a near-coplanar hull.
 */
export function shouldUseExactFlatFloorCollider(
  node: SceneNode,
  props: Pick<RigidbodyComponentProps, 'bodyType' | 'colliderType'>,
): boolean {
  if (node.dynamicMesh?.type !== 'Floor') {
    return false
  }
  const thickness = Number(node.dynamicMesh.thickness)
  return props.bodyType === 'STATIC'
    && props.colliderType === 'convex'
    && (!Number.isFinite(thickness) || thickness <= FLAT_FLOOR_COLLIDER_THICKNESS_EPSILON)
}

export function isDegenerateConvexRigidbodyShape(
  shape: RigidbodyPhysicsShape | null | undefined,
): boolean {
  if (!shape || (shape.kind !== 'convex' && shape.kind !== 'convex-mesh')) {
    return false
  }
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const includeVertex = (vertex: [number, number, number], offsetY = 0): void => {
    const y = Number(vertex[1]) + offsetY
    if (!Number.isFinite(y)) {
      return
    }
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (shape.kind === 'convex') {
    const offsetY = shape.offset?.[1] ?? 0
    shape.vertices.forEach((vertex) => includeVertex(vertex, offsetY))
  } else {
    shape.parts.forEach((part) => {
      const offsetY = part.offset?.[1] ?? 0
      part.vertices.forEach((vertex) => includeVertex(vertex, offsetY))
    })
  }
  return Number.isFinite(minY)
    && Number.isFinite(maxY)
    && maxY - minY <= DEGENERATE_CONVEX_VERTICAL_EPSILON
}

export function shouldReuseGeneratedRigidbodyShape(
  node: SceneNode,
  props: Pick<RigidbodyComponentProps, 'bodyType' | 'colliderType'>,
  shape: RigidbodyPhysicsShape | null | undefined,
): boolean {
  if (!shape) {
    return false
  }
  if (!shouldUseExactFlatFloorCollider(node, props)) {
    return true
  }
  if (shape.kind !== 'static-mesh') {
    return false
  }
  return shape.vertices.length >= 3
    && shape.indices.length >= 3
    && shape.indices.length % 3 === 0
    && shape.vertices.every((vertex) => (
      Array.isArray(vertex)
      && vertex.length >= 3
      && vertex.every((value) => Number.isFinite(value))
    ))
    && shape.indices.every((index) => Number.isInteger(index) && index >= 0 && index < shape.vertices.length)
}

/**
 * Converts the sampling object's triangles into a static mesh expressed in the
 * host Rigidbody frame (before the node world scale is reapplied by physics).
 */
export function buildStaticMeshShapeFromObject(
  samplingObject: THREE.Object3D,
  hostWorldTransform: RigidbodyHostWorldTransform | null,
): RigidbodyPhysicsShape | null {
  samplingObject.updateWorldMatrix(true, true)
  const hostInverse = hostWorldTransform
    ? new THREE.Matrix4()
      .compose(
        hostWorldTransform.position,
        hostWorldTransform.quaternion,
        hostWorldTransform.scale,
      )
      .invert()
    : samplingObject.matrixWorld.clone().invert()
  const localMatrix = new THREE.Matrix4()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const cross = new THREE.Vector3()
  const vertices: Array<[number, number, number]> = []
  const indices: number[] = []

  const appendTriangle = (
    ia: number,
    ib: number,
    ic: number,
    position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  ): void => {
    a.fromBufferAttribute(position, ia).applyMatrix4(localMatrix)
    b.fromBufferAttribute(position, ib).applyMatrix4(localMatrix)
    c.fromBufferAttribute(position, ic).applyMatrix4(localMatrix)
    if (![a, b, c].every((point) => (
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    ))) {
      return
    }
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    if (cross.crossVectors(ab, ac).lengthSq() <= 1e-12) {
      return
    }
    const base = vertices.length
    vertices.push([a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z])
    indices.push(base, base + 1, base + 2)
  }

  samplingObject.traverse((child) => {
    const mesh = child as THREE.Mesh & {
      isMesh?: boolean
      isInstancedMesh?: boolean
      geometry?: THREE.BufferGeometry
    }
    if (mesh.isMesh !== true || mesh.isInstancedMesh === true || !mesh.geometry) {
      return
    }
    const position = mesh.geometry.getAttribute('position') as
      | THREE.BufferAttribute
      | THREE.InterleavedBufferAttribute
      | undefined
    if (!position || position.itemSize < 3 || position.count < 3) {
      return
    }
    mesh.updateWorldMatrix(true, false)
    localMatrix.multiplyMatrices(hostInverse, mesh.matrixWorld)
    const index = mesh.geometry.getIndex()
    const vertexCount = position.count
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(vertexCount / 3)
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const ia = index ? index.getX(triangleIndex * 3) : triangleIndex * 3
      const ib = index ? index.getX(triangleIndex * 3 + 1) : triangleIndex * 3 + 1
      const ic = index ? index.getX(triangleIndex * 3 + 2) : triangleIndex * 3 + 2
      if (
        ia < 0 || ib < 0 || ic < 0
        || ia >= vertexCount || ib >= vertexCount || ic >= vertexCount
      ) {
        continue
      }
      appendTriangle(ia, ib, ic, position)
    }
  })

  if (vertices.length < 3 || indices.length < 3) {
    return null
  }
  return {
    kind: 'static-mesh',
    vertices,
    indices,
    applyScale: true,
  }
}
