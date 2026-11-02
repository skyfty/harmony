import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'

import {
  FollowCameraController,
  createBackFollowCameraTuning,
  createCameraFollowState,
  createFollowCameraMotionState,
  updateBackFollowCamera,
  type CameraFollowPlacement,
} from '../../schema/followCameraController.ts'
import {
  resolveCharacterCameraPositionLerpSpeed,
  resolveCharacterCameraTargetLerpSpeed,
} from '../common/utils/characterCameraFollowTuning.ts'

function simulateCameraPositionError(positionLerpSpeed: number): number {
  const camera = new THREE.PerspectiveCamera()
  const controls = {
    target: new THREE.Vector3(),
    enabled: true,
  }
  const follow = createCameraFollowState()
  const motion = createFollowCameraMotionState()
  const controller = new FollowCameraController()
  const anchor = new THREE.Vector3()
  const forward = new THREE.Vector3(1, 0, 0)
  const placement: CameraFollowPlacement = {
    distance: 6,
    heightOffset: 4,
    targetLift: 0.5,
    targetForward: 3,
  }
  const update = (immediate: boolean): void => {
    updateBackFollowCamera({
      controller,
      motion,
      follow,
      placement,
      anchorWorld: anchor,
      desiredForwardWorld: forward,
      deltaSeconds: 1 / 60,
      ctx: {
        camera,
        mapControls: controls,
      },
      tuning: createBackFollowCameraTuning({
        positionLerpSpeed,
        targetLerpSpeed: 8,
      }),
      worldUp: new THREE.Vector3(0, 1, 0),
      followForwardPitch: true,
      immediate,
    })
  }

  update(true)
  for (let frame = 0; frame < 30; frame += 1) {
    anchor.x += 0.06
    update(false)
  }
  return camera.position.distanceTo(follow.desiredPosition)
}

function simulateCameraTargetError(targetLerpSpeed: number): number {
  const camera = new THREE.PerspectiveCamera()
  const controls = {
    target: new THREE.Vector3(),
    enabled: true,
  }
  const follow = createCameraFollowState()
  const motion = createFollowCameraMotionState()
  const controller = new FollowCameraController()
  const anchor = new THREE.Vector3()
  const forward = new THREE.Vector3(1, 0, 0)
  const placement: CameraFollowPlacement = {
    distance: 6,
    heightOffset: 4,
    targetLift: 0.5,
    targetForward: 3,
  }
  const update = (immediate: boolean): void => {
    updateBackFollowCamera({
      controller,
      motion,
      follow,
      placement,
      anchorWorld: anchor,
      desiredForwardWorld: forward,
      deltaSeconds: 1 / 60,
      ctx: {
        camera,
        mapControls: controls,
      },
      tuning: createBackFollowCameraTuning({
        positionLerpSpeed: 0,
        targetLerpSpeed,
      }),
      worldUp: new THREE.Vector3(0, 1, 0),
      followForwardPitch: true,
      immediate,
    })
  }

  update(true)
  for (let frame = 0; frame < 30; frame += 1) {
    const yaw = frame * 0.02
    forward.set(Math.cos(yaw), 0, Math.sin(yaw))
    update(false)
  }
  return controls.target.distanceTo(follow.desiredTarget)
}

test('WeChat removes redundant camera translation smoothing only while steering', () => {
  assert.equal(
    resolveCharacterCameraPositionLerpSpeed({
      platform: 'mp-weixin',
      steeringActive: true,
    }),
    0,
  )
  assert.equal(
    resolveCharacterCameraPositionLerpSpeed({
      platform: 'mp-weixin',
      steeringActive: false,
    }),
    10,
  )
  assert.equal(
    resolveCharacterCameraPositionLerpSpeed({
      platform: 'h5',
      steeringActive: true,
    }),
    10,
  )
})

test('WeChat removes redundant camera target smoothing only while steering', () => {
  assert.equal(
    resolveCharacterCameraTargetLerpSpeed({
      platform: 'mp-weixin',
      steeringActive: true,
    }),
    0,
  )
  assert.equal(
    resolveCharacterCameraTargetLerpSpeed({
      platform: 'mp-weixin',
      steeringActive: false,
    }),
    8,
  )
  assert.equal(
    resolveCharacterCameraTargetLerpSpeed({
      platform: 'h5',
      steeringActive: true,
    }),
    8,
  )
})

test('removing the second translation filter eliminates steady-state camera lag', () => {
  const smoothedError = simulateCameraPositionError(10)
  const rigidError = simulateCameraPositionError(0)

  assert.ok(smoothedError > 0.2, `expected measurable lag, got ${smoothedError}`)
  assert.ok(rigidError < 1e-6, `expected rigid follow, got ${rigidError}`)
})

test('removing the look-target filter eliminates camera aim lag', () => {
  const smoothedError = simulateCameraTargetError(8)
  const rigidError = simulateCameraTargetError(0)

  assert.ok(smoothedError > 0.1, `expected measurable aim lag, got ${smoothedError}`)
  assert.ok(rigidError < 1e-6, `expected rigid aim, got ${rigidError}`)
})
