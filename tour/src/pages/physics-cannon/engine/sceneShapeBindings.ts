import * as CANNON from 'cannon-es'
import type {
  PhysicsCompoundShapeDesc,
  PhysicsConvexHullShapeDesc,
  PhysicsShapeDesc,
  PhysicsStaticMeshDesc,
  PhysicsTransform,
  PhysicsVector3,
} from '@harmony/physics-core'

export type CannonSceneShapeBinding = {
  shape: CANNON.Shape
  position: CANNON.Vec3
  quaternion: CANNON.Quaternion
}

const identityQuaternion = new CANNON.Quaternion(0, 0, 0, 1)
const cylinderShapeRotation = new CANNON.Quaternion()
cylinderShapeRotation.setFromEuler(Math.PI / 2, 0, 0, 'XYZ')

export function createCannonSceneShapeBindings(
  shapeMap: Map<number, PhysicsShapeDesc>,
  shapeId: number,
): CannonSceneShapeBinding[] {
  const shapeDesc = shapeMap.get(shapeId)
  if (!shapeDesc) {
    throw new Error(`Unknown physics shape: ${shapeId}`)
  }
  if (shapeDesc.kind === 'compound') {
    return shapeDesc.children.flatMap((child) => {
      const childBindings = createCannonSceneShapeBindings(shapeMap, child.shapeId)
      return childBindings.map((binding) => composeShapeBinding(binding, child.transform))
    })
  }
  if (shapeDesc.kind === 'heightfield') {
    return [{
      shape: createHeightfieldShape(shapeDesc),
      position: vec3FromTuple(shapeDesc.localOffset ?? [0, 0, 0]),
      quaternion: quatClone(identityQuaternion),
    }]
  }
  return [{
    shape: createShape(shapeDesc),
    position: new CANNON.Vec3(0, 0, 0),
    quaternion: new CANNON.Quaternion(0, 0, 0, 1),
  }]
}

function createShape(shapeDesc: Exclude<PhysicsShapeDesc, PhysicsCompoundShapeDesc>): CANNON.Shape {
  switch (shapeDesc.kind) {
    case 'box':
      return new CANNON.Box(vec3FromTuple(shapeDesc.halfExtents))
    case 'sphere':
      return new CANNON.Sphere(shapeDesc.radius)
    case 'cylinder': {
      const cylinder = new CANNON.Cylinder(
        shapeDesc.radiusTop,
        shapeDesc.radiusBottom,
        shapeDesc.height,
        Math.max(3, Math.trunc(shapeDesc.segments ?? 16)),
      )
      cylinder.transformAllPoints(new CANNON.Vec3(0, 0, 0), cylinderShapeRotation)
      return cylinder
    }
    case 'convex-hull':
      return createConvexHullShape(shapeDesc)
    case 'static-mesh':
      return createStaticMeshShape(shapeDesc)
    case 'heightfield':
      return createHeightfieldShape(shapeDesc)
    default: {
      const exhaustive: never = shapeDesc
      throw new Error(`Unsupported cannon shape: ${String(exhaustive)}`)
    }
  }
}

function createHeightfieldShape(shapeDesc: Extract<PhysicsShapeDesc, { kind: 'heightfield' }>): CANNON.Heightfield {
  const matrix: number[][] = []
  let offset = 0
  for (let column = 0; column < shapeDesc.columns; column += 1) {
    const values: number[] = []
    for (let row = 0; row < shapeDesc.rows; row += 1) {
      values.push(shapeDesc.heights[offset] ?? 0)
      offset += 1
    }
    matrix.push(values)
  }
  return new CANNON.Heightfield(matrix, { elementSize: shapeDesc.elementSize })
}

function createConvexHullShape(shapeDesc: PhysicsConvexHullShapeDesc): CANNON.ConvexPolyhedron {
  const vertices: CANNON.Vec3[] = []
  for (let index = 0; index < shapeDesc.vertices.length; index += 3) {
    vertices.push(new CANNON.Vec3(
      shapeDesc.vertices[index] ?? 0,
      shapeDesc.vertices[index + 1] ?? 0,
      shapeDesc.vertices[index + 2] ?? 0,
    ))
  }
  const faces = Array.isArray(shapeDesc.faces) && shapeDesc.faces.length
    ? shapeDesc.faces.map((face) => face.map((value) => Math.trunc(value)))
    : inferConvexHullFaces(vertices.length)
  return new CANNON.ConvexPolyhedron({ vertices, faces })
}

function createStaticMeshShape(shapeDesc: PhysicsStaticMeshDesc): CANNON.Trimesh {
  return new CANNON.Trimesh(Array.from(shapeDesc.vertices), Array.from(shapeDesc.indices))
}

function inferConvexHullFaces(vertexCount: number): number[][] {
  if (vertexCount === 8) {
    return [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0],
    ]
  }
  throw new Error('Convex hull faces are required for non-box cannon shapes')
}

function composeShapeBinding(binding: CannonSceneShapeBinding, transform: PhysicsTransform): CannonSceneShapeBinding {
  const parentPosition = vec3FromTuple(transform.position)
  const parentQuaternion = quatFromTuple(transform.rotation)
  const composedPosition = parentQuaternion.vmult(binding.position)
  composedPosition.vadd(parentPosition, composedPosition)
  const composedQuaternion = new CANNON.Quaternion()
  parentQuaternion.mult(binding.quaternion, composedQuaternion)
  return {
    shape: binding.shape,
    position: composedPosition,
    quaternion: composedQuaternion,
  }
}

function vec3FromTuple(tuple: PhysicsVector3): CANNON.Vec3 {
  return new CANNON.Vec3(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0)
}

function quatFromTuple(tuple: PhysicsTransform['rotation']): CANNON.Quaternion {
  return new CANNON.Quaternion(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0, tuple[3] ?? 1)
}

function quatClone(source: CANNON.Quaternion): CANNON.Quaternion {
  return new CANNON.Quaternion(source.x, source.y, source.z, source.w)
}
