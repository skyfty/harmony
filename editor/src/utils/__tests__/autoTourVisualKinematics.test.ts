import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  resolveVehicleVisualForwardWorld,
  resolveVehicleVisualMotionPose,
  resolveVehicleWheelRollDelta,
  resolveSignedVehicleTravel,
  resolveWheelSpinAxisInObjectSpace,
} from '@schema/autoTourVisualKinematics'

describe('autoTourVisualKinematics', () => {
  it('uses the moving visual object instead of a stale physics chassis during auto tour', () => {
    const object = new THREE.Object3D()
    object.position.set(8, 12, 4)
    object.rotation.y = Math.PI / 2
    object.updateMatrixWorld(true)
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()

    const source = resolveVehicleVisualMotionPose({
      tourActive: true,
      object,
      chassisPosition: { x: 0, y: 0, z: 0 },
      chassisQuaternion: { x: 0, y: 0, z: 0, w: 1 },
      positionOut: position,
      quaternionOut: quaternion,
    })

    expect(source).toBe('visual')
    expect(position.toArray()).toEqual([8, 12, 4])
    expect(Math.abs(quaternion.y)).toBeCloseTo(Math.SQRT1_2)
  })

  it('keeps a Tanke200 axle aligned with its local right axis around vehicle turns', () => {
    const vehicleQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 2,
    )
    const vehicleQuaternionInverse = vehicleQuaternion.clone().invert()
    const axis = resolveWheelSpinAxisInObjectSpace({
      axleAxis: new THREE.Vector3(0, 0, 1),
      vehicleWorldQuaternion: vehicleQuaternion,
      parentWorldQuaternionInverse: vehicleQuaternionInverse,
      baseQuaternionInverse: new THREE.Quaternion(),
      target: new THREE.Vector3(),
    })

    expect(axis.x).toBeCloseTo(0)
    expect(axis.y).toBeCloseTo(0)
    expect(axis.z).toBeCloseTo(1)
  })

  it('keeps the visual spin axis on the vehicle right axis through parent and wheel-base rotations', () => {
    const rightAxis = new THREE.Vector3(0, 0, 1)
    for (const [pitch, yaw, roll] of [
      [0, 0, 0],
      [0.22, -0.71, 0.15],
      [-0.34, 1.1, -0.28],
    ]) {
      const vehicleWorldQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(pitch, yaw, roll, 'YXZ'),
      )
      const parentWorldQuaternion = vehicleWorldQuaternion.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.19, -0.37, 0.08, 'YXZ')),
      )
      const baseQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-0.44, 0.63, 1.17, 'YXZ'),
      )
      const spinAxis = resolveWheelSpinAxisInObjectSpace({
        axleAxis: rightAxis,
        vehicleWorldQuaternion,
        parentWorldQuaternionInverse: parentWorldQuaternion.clone().invert(),
        baseQuaternionInverse: baseQuaternion.clone().invert(),
        target: new THREE.Vector3(),
      })
      const resolvedWorldSpinAxis = spinAxis
        .applyQuaternion(baseQuaternion)
        .applyQuaternion(parentWorldQuaternion)
        .normalize()
      const expectedWorldSpinAxis = rightAxis
        .clone()
        .applyQuaternion(vehicleWorldQuaternion)
        .normalize()

      expect(resolvedWorldSpinAxis.dot(expectedWorldSpinAxis)).toBeCloseTo(1, 6)
    }
  })

  it('freezes wheel roll while an auto-tour is paused', () => {
    expect(resolveVehicleWheelRollDelta({
      signedTravel: 1.5,
      radius: 0.5,
      frozen: false,
    })).toBeCloseTo(-3)
    expect(resolveVehicleWheelRollDelta({
      signedTravel: 1.5,
      radius: 0.5,
      frozen: true,
    })).toBe(0)
  })

  it('derives cinematic camera heading from the visual object quaternion', () => {
    const object = new THREE.Object3D()
    object.rotation.y = Math.PI / 2
    object.updateMatrixWorld(true)
    const forward = new THREE.Vector3()

    const resolved = resolveVehicleVisualForwardWorld(
      object,
      new THREE.Vector3(1, 0, 0),
      forward,
    )

    expect(resolved).toBe(true)
    expect(forward.x).toBeCloseTo(0)
    expect(forward.y).toBeCloseTo(0)
    expect(forward.z).toBeCloseTo(-1)
  })

  it('derives wheel travel from visual displacement while the physics chassis is unchanged', () => {
    const travel = resolveSignedVehicleTravel(
      new THREE.Vector3(1.5, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Quaternion(),
    )

    expect(travel).toBeCloseTo(1.5)
  })
})
