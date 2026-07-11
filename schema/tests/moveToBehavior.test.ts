import test from 'node:test'
import assert from 'node:assert/strict'
import { createBehaviorTemplate, ensureBehaviorParams } from '../behaviors/definitions.ts'
import {
  buildMoveToCameraPlacement,
  buildMoveToTargetPose,
  resolveMoveToAlignedQuaternionForLocalForwardAxis,
  resolveBindingByNodeId,
  resolveMoveToTargetPoseFromObject,
  resolveMoveToSubjectType,
  resolveMoveToYawDeltaRadians,
  resolveMoveToYawRadiansFromForward,
  resolveMoveToWorldForwardFromQuaternion,
} from '../behaviors/moveToRuntime.ts'
import { type PhysicsBodyBindingEntry } from '../physicsBodySync.ts'
import { resolveBindingKind } from '../sceneBindingRuntime.ts'
import * as THREE from 'three'

test('moveTo defaults to non-kinetics mode', () => {
  const template = createBehaviorTemplate('click', 'moveTo')
  assert.equal(template.script.type, 'moveTo')
  assert.deepEqual(template.script.params, {
    targetNodeId: null,
    kinetics: false,
  })
})

test('moveTo normalization keeps kinetics', () => {
  const normalized = ensureBehaviorParams({
    type: 'moveTo',
    params: {
      targetNodeId: 'node-1',
      kinetics: false,
    } as never,
  })

  assert.equal(normalized.type, 'moveTo')
  assert.deepEqual(normalized.params, {
    targetNodeId: 'node-1',
    kinetics: false,
  })
})

test('moveTo target pose uses local +X as forward and +Y as up', () => {
  const pose = buildMoveToTargetPose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion())

  assert.deepEqual(pose.position.toArray(), [1, 2, 3])
  assert.ok(pose.forward.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-8)
  assert.ok(pose.up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-8)
})

test('moveTo camera placement offsets from the target pose', () => {
  const pose = buildMoveToTargetPose(new THREE.Vector3(0, 10, 0), new THREE.Quaternion())
  const placement = buildMoveToCameraPlacement(pose)

  assert.ok(placement.position.distanceTo(new THREE.Vector3(-1.5, 11.7, 0)) < 1e-8)
  assert.ok(placement.lookAt.distanceTo(new THREE.Vector3(1.5, 10, 0)) < 1e-8)
  assert.ok(placement.up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-8)
})

test('moveTo target pose follows the object world transform', () => {
  const parent = new THREE.Object3D()
  parent.rotation.y = Math.PI / 2
  parent.position.set(5, 0, -2)
  const child = new THREE.Object3D()
  child.position.set(3, 4, 5)
  child.rotation.set(0.3, -0.5, 0.2)
  parent.add(child)
  parent.updateWorldMatrix(true, true)

  const pose = resolveMoveToTargetPoseFromObject(child)

  assert.ok(pose.position.distanceTo(child.getWorldPosition(new THREE.Vector3())) < 1e-8)
  assert.ok(pose.forward.length() > 0.999)
  assert.ok(pose.up.length() > 0.999)
})

test('moveTo binding lookup returns the registered entry', () => {
  const entry: PhysicsBodyBindingEntry = {
    nodeId: 'vehicle-1',
    body: {
      position: { x: 0, y: 0, z: 0, set: () => undefined },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0, set: () => undefined },
      angularVelocity: { x: 0, y: 0, z: 0, set: () => undefined },
    },
    bodies: [],
    object: null,
    orientationAdjustment: null,
    bindingKind: 'vehicle',
  }

  const binding = resolveBindingByNodeId('vehicle-1', new Map([[ 'vehicle-1', entry ]]))

  assert.equal(binding, entry)
  assert.equal(binding?.bindingKind, 'vehicle')
})

test('moveTo subject type prefers vehicle over character and camera', () => {
  assert.equal(resolveMoveToSubjectType({ vehicleActive: true, hasControlledCharacter: true }), 'vehicle')
  assert.equal(resolveMoveToSubjectType({ vehicleActive: false, hasControlledCharacter: true }), 'character')
  assert.equal(resolveMoveToSubjectType({ vehicleActive: false, hasControlledCharacter: false }), 'camera')
})

test('moveTo yaw helpers use local +X as forward', () => {
  assert.equal(resolveMoveToYawRadiansFromForward(new THREE.Vector3(1, 0, 0)), 0)
  assert.equal(resolveMoveToYawDeltaRadians(0, Math.PI / 2), Math.PI / 2)
  assert.equal(resolveMoveToYawDeltaRadians(Math.PI, -Math.PI), 0)
})

test('moveTo alignment helper maps local +z forward to target +x', () => {
  const aligned = resolveMoveToAlignedQuaternionForLocalForwardAxis(
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 1),
  )
  const worldForward = resolveMoveToWorldForwardFromQuaternion(aligned, new THREE.Vector3(0, 0, 1))

  assert.ok(worldForward.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-8)
})

test('resolveBindingKind recognizes all supported binding kinds', () => {
  assert.equal(resolveBindingKind({ bindingKind: 'rigidbody' }), 'rigidbody')
  assert.equal(resolveBindingKind({ bindingKind: 'vehicle' }), 'vehicle')
  assert.equal(resolveBindingKind({ bindingKind: 'character' }), 'character')
  assert.equal(resolveBindingKind({ bindingKind: 'other' as never }), null)
  assert.equal(resolveBindingKind(null), null)
})
