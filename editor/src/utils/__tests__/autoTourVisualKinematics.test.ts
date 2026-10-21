import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  resolveVehicleVisualForwardWorld,
  resolveVehicleVisualMotionPose,
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
