import assert from 'node:assert/strict'

import {
  createAmmoShape,
} from '../dist/shapeFactory.js'

class MockVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
}

class MockQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
  }
}

class MockTransform {
  constructor() {
    this.origin = new MockVector3()
    this.rotation = new MockQuaternion()
  }

  setIdentity() {}

  setOrigin(origin) {
    this.origin = origin
  }

  setRotation(rotation) {
    this.rotation = rotation
  }
}

class MockHeightfieldTerrainShape {
  constructor(...args) {
    this.args = args
    this.localScaling = null
  }

  setLocalScaling(scaling) {
    this.localScaling = scaling
  }
}

class MockCompoundShape {
  constructor(enableDynamicAabbTree) {
    this.enableDynamicAabbTree = enableDynamicAabbTree
    this.children = []
  }

  addChildShape(transform, shape) {
    this.children.push({
      position: {
        x: transform.origin.x,
        y: transform.origin.y,
        z: transform.origin.z,
      },
      rotation: {
        x: transform.rotation.x,
        y: transform.rotation.y,
        z: transform.rotation.z,
        w: transform.rotation.w,
      },
      shape,
    })
  }
}

function createMockAmmo() {
  return {
    destroy() {},
    _malloc() {
      return 0
    },
    _free() {},
    HEAPF32: new Float32Array(64),
    btVector3: MockVector3,
    btQuaternion: MockQuaternion,
    btTransform: MockTransform,
    btDefaultMotionState() {},
    btRigidBodyConstructionInfo() {},
    btRigidBody() {},
    btBoxShape() {},
    btSphereShape() {},
    btCylinderShape() {},
    btConvexHullShape() {},
    btCompoundShape: MockCompoundShape,
    btHeightfieldTerrainShape: MockHeightfieldTerrainShape,
    btTriangleMesh() {},
    btBvhTriangleMeshShape() {},
    btVehicleTuning() {},
    btDefaultVehicleRaycaster() {},
    btRaycastVehicle() {},
    btDefaultCollisionConfiguration() {},
    btCollisionDispatcher() {},
    btDbvtBroadphase() {},
    btSequentialImpulseConstraintSolver() {},
    btDiscreteDynamicsWorld() {},
    ClosestRayResultCallback() {},
  }
}

async function main() {
  const ammo = createMockAmmo()
  const built = createAmmoShape(
    ammo,
    {
      id: 1,
      kind: 'heightfield',
      rows: 2,
      columns: 2,
      elementSize: 100,
      heights: new Float32Array([0, 10, 0, 10]),
      localOffset: [-50, -50, 0],
    },
    false,
  )

  assert.ok(built, 'expected Ammo heightfield shape to build')
  assert.equal(built.shape instanceof MockCompoundShape, true, 'heightfield should be wrapped in a compound shape when centered')
  assert.equal(built.shape.children.length, 1, 'expected a single centered heightfield child')
  assert.deepEqual(
    built.shape.children[0].position,
    { x: -50, y: -5, z: -50 },
    'compiled ground heightfield should stay centered on Y while keeping depth on Z',
  )

  console.log('compiled-ground-offset-regression: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
