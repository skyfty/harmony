import {
  type PhysicsCompoundShapeDesc,
  type PhysicsHeightfieldDesc,
  type PhysicsShapeDesc,
  type PhysicsStaticMeshDesc,
} from '@harmony/physics-core'
import {
  createAmmoTransform,
  createAmmoVector3,
  isZeroVector,
  type AmmoVector3,
  type AmmoApi,
} from './ammoHelpers'

export type BuiltAmmoShape = {
  shape: any
  cleanup: Array<() => void>
}

export function createAmmoShape(
  ammo: AmmoApi,
  shapeDesc: PhysicsShapeDesc,
  dynamic: boolean,
  resolveShapeById?: (shapeId: number) => PhysicsShapeDesc | null,
): BuiltAmmoShape {
  if (shapeDesc.kind === 'box') {
    const halfExtents = createAmmoVector3(ammo, shapeDesc.halfExtents)
    const shape = new ammo.btBoxShape(halfExtents)
    return {
      shape,
      cleanup: [
        () => ammo.destroy(shape),
        () => ammo.destroy(halfExtents),
      ],
    }
  }

  if (shapeDesc.kind === 'sphere') {
    const shape = new ammo.btSphereShape(shapeDesc.radius)
    return {
      shape,
      cleanup: [() => ammo.destroy(shape)],
    }
  }

  if (shapeDesc.kind === 'cylinder') {
    const halfExtents = createAmmoVector3(ammo, [
      Math.max(shapeDesc.radiusTop, shapeDesc.radiusBottom),
      Math.max(1e-4, shapeDesc.height * 0.5),
      Math.max(shapeDesc.radiusTop, shapeDesc.radiusBottom),
    ])
    const shape = new ammo.btCylinderShape(halfExtents)
    return {
      shape,
      cleanup: [
        () => ammo.destroy(shape),
        () => ammo.destroy(halfExtents),
      ],
    }
  }

  if (shapeDesc.kind === 'convex-hull') {
    const shape = new ammo.btConvexHullShape()
    const point = createAmmoVector3(ammo, [0, 0, 0])
    for (let index = 0; index < shapeDesc.vertices.length; index += 3) {
      point.setValue(
        shapeDesc.vertices[index] ?? 0,
        shapeDesc.vertices[index + 1] ?? 0,
        shapeDesc.vertices[index + 2] ?? 0,
      )
      shape.addPoint(point, false)
    }
    shape.recalcLocalAabb?.()
    return {
      shape,
      cleanup: [
        () => ammo.destroy(shape),
        () => ammo.destroy(point),
      ],
    }
  }

  if (shapeDesc.kind === 'heightfield') {
    return buildHeightfieldTerrainShape(ammo, shapeDesc, dynamic)
  }

  if (shapeDesc.kind === 'static-mesh') {
    return buildTriangleMeshShape(ammo, shapeDesc, dynamic)
  }

  if (shapeDesc.kind === 'compound') {
    if (!resolveShapeById) {
      throw new Error('Compound shape resolver is required')
    }
    return createAmmoCompoundShape(ammo, shapeDesc, dynamic, resolveShapeById)
  }

  throw new Error(`Unsupported Ammo physics shape: ${(shapeDesc as PhysicsShapeDesc).kind}`)
}

export function createAmmoCompoundShape(
  ammo: AmmoApi,
  shapeDesc: PhysicsCompoundShapeDesc,
  dynamic: boolean,
  resolveShapeById: (shapeId: number) => PhysicsShapeDesc | null,
): BuiltAmmoShape {
  const shape = new ammo.btCompoundShape(true)
  const cleanup: Array<() => void> = [() => ammo.destroy(shape)]
  shapeDesc.children.forEach((child) => {
    const childShapeDesc = resolveShapeById(child.shapeId)
    if (!childShapeDesc) {
      throw new Error(`Unknown physics shape: ${child.shapeId}`)
    }
    const childShape = createAmmoShape(ammo, childShapeDesc, dynamic, resolveShapeById)
    const childTransform = createAmmoTransform(ammo, child.transform)
    shape.addChildShape(childTransform, childShape.shape)
    cleanup.push(...childShape.cleanup)
    cleanup.push(() => ammo.destroy(childTransform))
  })
  return {
    shape,
    cleanup,
  }
}

function buildHeightfieldTerrainShape(ammo: AmmoApi, shapeDesc: PhysicsHeightfieldDesc, dynamic: boolean): BuiltAmmoShape {
  if (dynamic) {
    throw new Error(`Ammo heightfield shapes do not support dynamic rigid bodies: ${shapeDesc.id}`)
  }

  const rows = Math.max(2, shapeDesc.rows | 0)
  const columns = Math.max(2, shapeDesc.columns | 0)
  const heights = buildAmmoHeightfieldHeights(shapeDesc)
  const { minHeight, maxHeight } = resolveHeightfieldRange(shapeDesc, heights)
  const dataPtr = ammo._malloc(heights.byteLength)
  ammo.HEAPF32.set(heights, dataPtr >>> 2)

  const heightfieldShape = new ammo.btHeightfieldTerrainShape(
    columns,
    rows,
    dataPtr,
    1,
    minHeight,
    maxHeight,
    1,
    'PHY_FLOAT',
    false,
  )
  const localScaling = createAmmoVector3(ammo, [Math.max(1e-4, shapeDesc.elementSize), 1, Math.max(1e-4, shapeDesc.elementSize)])
  heightfieldShape.setLocalScaling(localScaling)

  const cleanup: Array<() => void> = [
    () => ammo._free(dataPtr),
    () => ammo.destroy(heightfieldShape),
    () => ammo.destroy(localScaling),
  ]

  const centeredOffset = resolveAmmoHeightfieldOffset(shapeDesc, minHeight, maxHeight)
  if (isZeroVector(centeredOffset)) {
    return {
      shape: heightfieldShape,
      cleanup,
    }
  }

  const compoundShape = new ammo.btCompoundShape(true)
  const childTransform = createAmmoTransform(ammo, {
    position: centeredOffset,
    rotation: [0, 0, 0, 1],
  })
  compoundShape.addChildShape(childTransform, heightfieldShape)

  return {
    shape: compoundShape,
    cleanup: [
      ...cleanup,
      () => ammo.destroy(compoundShape),
      () => ammo.destroy(childTransform),
    ],
  }
}

function buildTriangleMeshShape(ammo: AmmoApi, meshDesc: PhysicsStaticMeshDesc, dynamic: boolean): BuiltAmmoShape {
  const triangleMesh = new ammo.btTriangleMesh(true, false)
  const vertexA = createAmmoVector3(ammo, [0, 0, 0])
  const vertexB = createAmmoVector3(ammo, [0, 0, 0])
  const vertexC = createAmmoVector3(ammo, [0, 0, 0])

  if (meshDesc.indices.length >= 3) {
    for (let index = 0; index < meshDesc.indices.length; index += 3) {
      const ia = (meshDesc.indices[index] ?? 0) * 3
      const ib = (meshDesc.indices[index + 1] ?? 0) * 3
      const ic = (meshDesc.indices[index + 2] ?? 0) * 3
      vertexA.setValue(meshDesc.vertices[ia] ?? 0, meshDesc.vertices[ia + 1] ?? 0, meshDesc.vertices[ia + 2] ?? 0)
      vertexB.setValue(meshDesc.vertices[ib] ?? 0, meshDesc.vertices[ib + 1] ?? 0, meshDesc.vertices[ib + 2] ?? 0)
      vertexC.setValue(meshDesc.vertices[ic] ?? 0, meshDesc.vertices[ic + 1] ?? 0, meshDesc.vertices[ic + 2] ?? 0)
      triangleMesh.addTriangle(vertexA, vertexB, vertexC, false)
    }
  } else {
    for (let index = 0; index + 8 < meshDesc.vertices.length; index += 9) {
      vertexA.setValue(meshDesc.vertices[index] ?? 0, meshDesc.vertices[index + 1] ?? 0, meshDesc.vertices[index + 2] ?? 0)
      vertexB.setValue(meshDesc.vertices[index + 3] ?? 0, meshDesc.vertices[index + 4] ?? 0, meshDesc.vertices[index + 5] ?? 0)
      vertexC.setValue(meshDesc.vertices[index + 6] ?? 0, meshDesc.vertices[index + 7] ?? 0, meshDesc.vertices[index + 8] ?? 0)
      triangleMesh.addTriangle(vertexA, vertexB, vertexC, false)
    }
  }

  const shape = dynamic
    ? buildDynamicTriangleShape(ammo, meshDesc, triangleMesh)
    : new ammo.btBvhTriangleMeshShape(triangleMesh, true, true)

  return {
    shape,
    cleanup: [
      () => ammo.destroy(shape),
      () => ammo.destroy(triangleMesh),
      () => ammo.destroy(vertexC),
      () => ammo.destroy(vertexB),
      () => ammo.destroy(vertexA),
    ],
  }
}

function buildDynamicTriangleShape(ammo: AmmoApi, meshDesc: PhysicsStaticMeshDesc, triangleMesh: any): any {
  if (ammo.btConvexTriangleMeshShape) {
    return new ammo.btConvexTriangleMeshShape(triangleMesh, true)
  }
  const hull = new ammo.btConvexHullShape()
  const point = createAmmoVector3(ammo, [0, 0, 0])
  for (let index = 0; index < meshDesc.vertices.length; index += 3) {
    point.setValue(
      meshDesc.vertices[index] ?? 0,
      meshDesc.vertices[index + 1] ?? 0,
      meshDesc.vertices[index + 2] ?? 0,
    )
    hull.addPoint(point, false)
  }
  hull.recalcLocalAabb?.()
  ammo.destroy(point)
  return hull
}

function buildAmmoHeightfieldHeights(shape: PhysicsHeightfieldDesc): Float32Array {
  const heights = new Float32Array(shape.rows * shape.columns)
  let offset = 0
  for (let row = 0; row < shape.rows; row += 1) {
    for (let column = 0; column < shape.columns; column += 1) {
      heights[offset] = getHeightfieldHeight(shape, row, column)
      offset += 1
    }
  }
  return heights
}

function resolveHeightfieldMinHeight(shape: PhysicsHeightfieldDesc, heights: Float32Array): number {
  if (typeof shape.minHeight === 'number' && Number.isFinite(shape.minHeight)) {
    return shape.minHeight
  }
  let minHeight = Number.POSITIVE_INFINITY
  for (let index = 0; index < heights.length; index += 1) {
    minHeight = Math.min(minHeight, heights[index] ?? 0)
  }
  return Number.isFinite(minHeight) ? minHeight : 0
}

function resolveHeightfieldMaxHeight(shape: PhysicsHeightfieldDesc, heights: Float32Array): number {
  if (typeof shape.maxHeight === 'number' && Number.isFinite(shape.maxHeight)) {
    return shape.maxHeight
  }
  let maxHeight = Number.NEGATIVE_INFINITY
  for (let index = 0; index < heights.length; index += 1) {
    maxHeight = Math.max(maxHeight, heights[index] ?? 0)
  }
  return Number.isFinite(maxHeight) ? maxHeight : 0
}

function resolveHeightfieldRange(
  shape: PhysicsHeightfieldDesc,
  heights: Float32Array,
): { minHeight: number; maxHeight: number } {
  const minHeight = resolveHeightfieldMinHeight(shape, heights)
  const maxHeight = resolveHeightfieldMaxHeight(shape, heights)
  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    return { minHeight: 0, maxHeight: 1 }
  }
  if (maxHeight <= minHeight) {
    return { minHeight, maxHeight: minHeight + 1 }
  }
  return { minHeight, maxHeight }
}

function resolveAmmoHeightfieldOffset(shape: PhysicsHeightfieldDesc, minHeight: number, maxHeight: number): AmmoVector3 {
  const localOffset = shape.localOffset
  if (Array.isArray(localOffset) && localOffset.length === 3) {
    return [localOffset[0] ?? 0, localOffset[1] ?? 0, localOffset[2] ?? 0]
  }
  const centerY = -(minHeight + maxHeight) * 0.5
  return [0, centerY, 0]
}

function getHeightfieldHeight(shape: PhysicsHeightfieldDesc, row: number, column: number): number {
  const index = row * shape.columns + column
  const value = shape.heights[index] ?? 0
  return Number.isFinite(value) ? value : 0
}
