import * as THREE from 'three'

import type {
  PhysicsBridge,
  PhysicsBodyDesc,
  PhysicsRuntimeBodyEntry,
  PhysicsShapeDesc,
} from '@harmony/physics-core'
import type { RigidbodyPhysicsShape } from './components'
import type { PhysicsBodyLike } from './physicsBodySync'
import type { PhysicsWorldLike } from './physicsRuntimeBridge'

type GroundCollisionRuntimeBridgeBody = PhysicsBodyLike & {
  __runtimeBodyEntry: PhysicsRuntimeBodyEntry
}

/**
 * World-space triangle mesh collision definition.
 *
 * Vertices are expected to be already transformed into world space, therefore the
 * generated rigid body keeps an identity transform.
 */
export type StaticMeshCollisionShapeDefinition = {
  kind: 'static-mesh'
  vertices: Float32Array
  indices: Uint32Array
}

export type GroundCollisionRuntimeShapeDefinition =
  | RigidbodyPhysicsShape
  | StaticMeshCollisionShapeDefinition

export type GroundCollisionRuntimeBridgeDeps = {
  getPhysicsWorld: () => PhysicsWorldLike | null
  ensurePhysicsWorld: () => PhysicsWorldLike
  createBody: (
    node: unknown,
    component: unknown,
    shapeDefinition: GroundCollisionRuntimeShapeDefinition | null,
    object: THREE.Object3D,
  ) => { body: PhysicsBodyLike; orientationAdjustment: null } | null
  loggerTag?: string
}

export type GroundCollisionRuntimeBridgeDepsOptions = {
  enabled: boolean
  sceneLoaded: boolean
  getPhysicsBridge: () => PhysicsBridge | null
  runtimeBodyIds: Set<number>
  nextRuntimeId: () => number
  enqueueMutation: (task: () => Promise<void>) => void
  loggerTag?: string
}

function createRuntimeBodyVec3(x = 0, y = 0, z = 0) {
  return {
    x,
    y,
    z,
    set(nextX: number, nextY: number, nextZ: number) {
      this.x = nextX
      this.y = nextY
      this.z = nextZ
      return this
    },
  }
}

function flattenHeightfieldShapeHeights(shape: Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>): Float32Array {
  const columnCount = shape.matrix.length
  const rowCount = shape.matrix[0]?.length ?? 0
  const values = new Float32Array(columnCount * rowCount)
  let offset = 0
  for (let column = 0; column < columnCount; column += 1) {
    const columnValues = shape.matrix[column] ?? []
    for (let row = 0; row < rowCount; row += 1) {
      values[offset] = columnValues[row] ?? 0
      offset += 1
    }
  }
  return values
}

/**
 * Accepts either a flat numeric array or a tuple list so both the runtime chunk shape
 * and the serialized `RigidbodyPhysicsShape` variant can feed the same runtime body.
 */
function flattenStaticMeshShapeVertices(vertices: unknown): Float32Array | null {
  if (vertices instanceof Float32Array) {
    return vertices
  }
  if (ArrayBuffer.isView(vertices)) {
    return Float32Array.from(vertices as unknown as ArrayLike<number>)
  }
  if (!Array.isArray(vertices) || vertices.length === 0) {
    return null
  }
  if (typeof vertices[0] === 'number') {
    return Float32Array.from(vertices as number[])
  }
  const tupleList = vertices as unknown[]
  const flat = new Float32Array(tupleList.length * 3)
  tupleList.forEach((entry, index) => {
    const tuple = Array.isArray(entry) ? entry : []
    flat[index * 3] = Number(tuple[0] ?? 0) || 0
    flat[index * 3 + 1] = Number(tuple[1] ?? 0) || 0
    flat[index * 3 + 2] = Number(tuple[2] ?? 0) || 0
  })
  return flat
}

function flattenStaticMeshShapeIndices(indices: unknown): Uint32Array | null {
  if (indices instanceof Uint32Array) {
    return indices
  }
  if (ArrayBuffer.isView(indices)) {
    return Uint32Array.from(indices as unknown as ArrayLike<number>)
  }
  if (!Array.isArray(indices) || indices.length === 0) {
    return null
  }
  const values = new Uint32Array(indices.length)
  indices.forEach((value, index) => {
    values[index] = Math.max(0, Math.trunc(Number(value) || 0))
  })
  return values
}

function createRuntimeBodyEntry(
  shapeDefinition: GroundCollisionRuntimeShapeDefinition,
  object: THREE.Object3D,
  nextRuntimeId: () => number,
): PhysicsRuntimeBodyEntry | null {
  object.updateMatrixWorld(true)
  const worldPosition = new THREE.Vector3()
  const worldQuaternion = new THREE.Quaternion()
  const worldScale = new THREE.Vector3()
  object.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale)
  const bodyId = nextRuntimeId()
  const materialId = null
  let shapeDesc: PhysicsShapeDesc
  let shapeId = nextRuntimeId()

  if (shapeDefinition.kind === 'static-mesh') {
    const vertices = flattenStaticMeshShapeVertices(shapeDefinition.vertices)
    const indices = flattenStaticMeshShapeIndices(shapeDefinition.indices)
    if (!vertices || !indices || indices.length < 3 || vertices.length < 9) {
      return null
    }
    // Triangle vertices are world space already, so no proxy transform is applied.
    shapeDesc = {
      id: shapeId,
      kind: 'static-mesh',
      vertices,
      indices,
    }
    return {
      shapes: [shapeDesc],
      body: {
        id: bodyId,
        type: 'static',
        mass: 0,
        materialId,
        shapeId,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
      },
    }
  }

  if (shapeDefinition.kind === 'heightfield') {
    const rows = shapeDefinition.matrix[0]?.length ?? 0
    const columns = shapeDefinition.matrix.length
    if (rows <= 1 || columns <= 1) {
      return null
    }
    shapeDesc = {
      id: shapeId,
      kind: 'heightfield',
      rows,
      columns,
      elementSize: shapeDefinition.elementSize,
      heights: flattenHeightfieldShapeHeights(shapeDefinition),
      localOffset: [
        shapeDefinition.offset?.[0] ?? 0,
        shapeDefinition.offset?.[1] ?? 0,
        shapeDefinition.offset?.[2] ?? 0,
      ],
    }
  } else if (shapeDefinition.kind === 'box') {
    const childShapeId = shapeId
    const compoundShapeId = nextRuntimeId()
    const boxShape: Extract<PhysicsShapeDesc, { kind: 'box' }> = {
      id: childShapeId,
      kind: 'box',
      halfExtents: [
        shapeDefinition.halfExtents[0],
        shapeDefinition.halfExtents[1],
        shapeDefinition.halfExtents[2],
      ],
    }
    const compoundShape: Extract<PhysicsShapeDesc, { kind: 'compound' }> = {
      id: compoundShapeId,
      kind: 'compound',
      children: [
        {
          shapeId: childShapeId,
          transform: {
            position: [
              shapeDefinition.offset?.[0] ?? 0,
              shapeDefinition.offset?.[1] ?? 0,
              shapeDefinition.offset?.[2] ?? 0,
            ],
            rotation: [0, 0, 0, 1],
          },
        },
      ],
    }
    shapeId = compoundShapeId
    return {
      shapes: [boxShape, compoundShape],
      body: {
        id: bodyId,
        type: 'static',
        mass: 0,
        materialId,
        shapeId,
        transform: {
          position: [worldPosition.x, worldPosition.y, worldPosition.z],
          rotation: [worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w],
        },
      },
    }
  } else {
    return null
  }

  const body: PhysicsBodyDesc = {
    id: bodyId,
    type: 'static',
    mass: 0,
    materialId,
    shapeId,
    transform: {
      position: [worldPosition.x, worldPosition.y, worldPosition.z],
      rotation: [worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w],
    },
  }
  return {
    shapes: [shapeDesc],
    body,
  }
}

function createRuntimeBody(entry: PhysicsRuntimeBodyEntry): GroundCollisionRuntimeBridgeBody {
  return {
    __runtimeBodyEntry: entry,
    position: createRuntimeBodyVec3(),
    quaternion: {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
      set(nextX: number, nextY: number, nextZ: number, nextW: number) {
        this.x = nextX
        this.y = nextY
        this.z = nextZ
        this.w = nextW
        return this
      },
    },
    velocity: createRuntimeBodyVec3(),
    angularVelocity: createRuntimeBodyVec3(),
  }
}

export function createGroundCollisionRuntimeBridgeDeps(
  options: GroundCollisionRuntimeBridgeDepsOptions,
): GroundCollisionRuntimeBridgeDeps | null {
  if (!options.enabled || !options.sceneLoaded) {
    return null
  }

  const bridgeWorld: PhysicsWorldLike = {
    addBody(body) {
      const runtimeBody = body as GroundCollisionRuntimeBridgeBody | null
      const entry = runtimeBody?.__runtimeBodyEntry
      if (!entry) {
        return
      }
      options.runtimeBodyIds.add(entry.body.id)
      options.enqueueMutation(async () => {
        const bridge = options.getPhysicsBridge()
        if (!bridge) {
          return
        }
        await bridge.addRuntimeBodies({
          bodies: [entry],
        })
      })
    },
    removeBody(body) {
      const runtimeBody = body as GroundCollisionRuntimeBridgeBody | null
      const bodyId = runtimeBody?.__runtimeBodyEntry?.body.id
      if (!bodyId || !options.runtimeBodyIds.has(bodyId)) {
        return
      }
      options.runtimeBodyIds.delete(bodyId)
      options.enqueueMutation(async () => {
        const bridge = options.getPhysicsBridge()
        if (!bridge) {
          return
        }
        await bridge.removeRuntimeBodies({
          bodyIds: [bodyId],
        })
      })
    },
  }

  return {
    getPhysicsWorld: () => bridgeWorld,
    ensurePhysicsWorld: () => bridgeWorld,
    createBody: (
      _node: unknown,
      _component: unknown,
      shapeDefinition: GroundCollisionRuntimeShapeDefinition | null,
      object: THREE.Object3D,
    ) => {
      if (!shapeDefinition) {
        return null
      }
      const entry = createRuntimeBodyEntry(shapeDefinition, object, options.nextRuntimeId)
      if (!entry) {
        return null
      }
      return {
        body: createRuntimeBody(entry) as unknown as PhysicsBodyLike,
        orientationAdjustment: null,
      }
    },
    loggerTag: options.loggerTag,
  }
}
