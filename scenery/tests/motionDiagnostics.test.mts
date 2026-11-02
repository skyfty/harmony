import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMotionDiagnosticsProbe,
  type MotionProbeReport,
  type MotionProbeVector,
} from '../common/utils/motionDiagnostics.ts'

function vector(x: number, y = 0, z = 0): MotionProbeVector {
  return { x, y, z }
}

test('reports frame, physics, character and camera evidence in one window', () => {
  let now = 0
  const reports: MotionProbeReport[] = []
  const probe = createMotionDiagnosticsProbe({
    intervalMs: 1000,
    now: () => now,
    onReport: (report) => reports.push(report),
  })
  probe.setPlatform('mp-weixin')

  for (let frame = 0; frame < 20; frame += 1) {
    now += frame === 10 ? 50 : 16
    probe.recordFrame(16, 0.016, now)
    probe.recordFrameWork(4)
  }
  probe.recordPhysicsStepRequest()
  probe.recordPhysicsStepReply(35, { bodyCount: 4, characterMotorCount: 1 })
  probe.recordPhysicsInputRequest(1)
  probe.recordPhysicsInputReply(32)
  probe.recordCharacterTarget(0.2)
  probe.recordCharacterVisual({
    targetErrorM: 0.12,
    correctionM: 0.03,
    deltaSeconds: 0.016,
  })
  probe.recordCamera({
    anchor: vector(1),
    camera: vector(0, 2, -4),
    controlsTarget: vector(1),
    desiredCamera: vector(0.5, 2, -4),
    desiredTarget: vector(1),
    cameraUp: vector(0, 1),
    desiredForward: vector(0, 0, 1),
    groundNormal: vector(0, 1),
    positionLerpSpeed: 10,
    targetLerpSpeed: 8,
    deltaSeconds: 0.016,
    input: {
      source: 'touch',
      touchActive: true,
      rawX: 0,
      rawY: 1,
      moveX: 0,
      moveZ: 1,
      turn: 0,
      desiredYaw: 0,
      resolvedYaw: 0,
    },
  })
  now += 16
  probe.recordCamera({
    anchor: vector(1.01),
    camera: vector(0, 2, -4),
    controlsTarget: vector(1.01),
    desiredCamera: vector(0.5, 2, -4),
    desiredTarget: vector(1.01),
    cameraUp: vector(0.2, 1),
    desiredForward: vector(0.6, 0, 1),
    groundNormal: vector(0.2, 1),
    positionLerpSpeed: 10,
    targetLerpSpeed: 8,
    deltaSeconds: 0.016,
    input: {
      source: 'touch',
      touchActive: true,
      rawX: 0,
      rawY: 1,
      moveX: 0,
      moveZ: 1,
      turn: 0,
      desiredYaw: 0,
      resolvedYaw: 0,
    },
  })
  now = 1100
  probe.recordFrameWork(4)

  assert.equal(reports.length, 1)
  const report = reports[0]
  assert.equal(report.platform, 'mp-weixin')
  assert.equal(report.frames.samples, 20)
  assert.ok(report.frames.measuredMsMax >= 50)
  assert.equal(report.physics.stepReplyMsMax, 35)
  assert.equal(report.physics.inputReplyMsMax, 32)
  assert.equal(report.character.targetStepMWindowMax, 0.2)
  assert.equal(report.camera.input.source, 'touch')
  assert.ok(report.flags.includes('frame-cadence-jitter'))
  assert.ok(report.flags.includes('physics-roundtrip-latency'))
  assert.ok(report.flags.includes('character-target-steps-spike'))
  assert.ok(report.flags.includes('camera-up-jitter'))
  assert.ok(report.flags.includes('camera-forward-spike'))
  assert.ok(report.flags.includes('ground-normal-jitter'))
})

test('does not emit while idle and supports an explicit flush', () => {
  let now = 0
  const reports: MotionProbeReport[] = []
  const probe = createMotionDiagnosticsProbe({
    intervalMs: 500,
    now: () => now,
    onReport: (report) => reports.push(report),
  })

  now = 16
  probe.recordFrame(16, 0.016, now)
  probe.recordFrameWork(3)
  now = 1500
  probe.recordFrameWork(3)
  assert.equal(reports.length, 0)

  probe.flush()
  assert.equal(reports.length, 1)
  assert.equal(reports[0].sequence, 1)
  assert.equal(reports[0].camera.samples, 0)
})

test('reset starts a fresh window without resetting the report sequence', () => {
  let now = 0
  const reports: MotionProbeReport[] = []
  const probe = createMotionDiagnosticsProbe({
    intervalMs: 500,
    now: () => now,
    onReport: (report) => reports.push(report),
  })

  probe.recordCamera({
    anchor: vector(0),
    camera: vector(0, 2, -4),
    controlsTarget: vector(0),
    desiredCamera: vector(0, 2, -4),
    desiredTarget: vector(0),
    cameraUp: vector(0, 1),
    desiredForward: vector(0, 0, 1),
    groundNormal: vector(0, 1),
    positionLerpSpeed: 10,
    targetLerpSpeed: 8,
    deltaSeconds: 0.016,
    input: {
      source: 'touch',
      touchActive: true,
      rawX: 0,
      rawY: 1,
      moveX: 0,
      moveZ: 1,
      turn: 0,
      desiredYaw: 0,
      resolvedYaw: 0,
    },
  })
  probe.flush()
  probe.reset()
  now = 100
  probe.recordFrame(16, 0.016, now)
  probe.flush()

  assert.equal(reports.length, 2)
  assert.equal(reports[0].sequence, 1)
  assert.equal(reports[1].sequence, 2)
  assert.equal(reports[1].camera.samples, 0)
})
