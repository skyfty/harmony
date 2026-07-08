import test from 'node:test'
import assert from 'node:assert/strict'
import { createBehaviorTemplate, ensureBehaviorParams } from '../behaviors/definitions.ts'
import { buildMoveToCameraPlacement, buildMoveToTargetPose } from '../behaviors/moveToRuntime.ts'
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
