import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  computeUprightVehicleYawQuaternion,
  resolveRoadLanePoseFromRows,
  selectNearestRoadLanePose,
} from '@schema/vehicleRoadRespawn'

type TestRow = {
  x: number
  z: number
  y: number
  heading: number
}

function makeStraightRows(options: {
  startX?: number
  spacing?: number
  count?: number
  startY?: number
  slope?: number
} = {}): TestRow[] {
  const startX = options.startX ?? 0
  const spacing = options.spacing ?? 2
  const count = options.count ?? 6
  const startY = options.startY ?? 10
  const slope = options.slope ?? 0
  return Array.from({ length: count }, (_, index) => ({
    x: startX + index * spacing,
    z: 0,
    y: startY + index * slope,
    heading: 0,
  }))
}

describe('procedural road lane respawn pose', () => {
  it('snaps to the right lane and keeps the current forward direction', () => {
    const pose = resolveRoadLanePoseFromRows(makeStraightRows(), {
      worldX: 5,
      worldZ: 1.25,
      facingYawRad: 0,
      halfWidth: 4.5,
    })

    expect(pose).not.toBeNull()
    expect(pose!.x).toBeCloseTo(5, 5)
    expect(pose!.z).toBeCloseTo(2.25, 5)
    expect(pose!.yawRad).toBeCloseTo(0, 5)
    expect(pose!.distance).toBeCloseTo(1.25, 5)
  })

  it('uses the opposite lane when the vehicle faces against the route', () => {
    const pose = resolveRoadLanePoseFromRows(makeStraightRows(), {
      worldX: 5,
      worldZ: 0.5,
      facingYawRad: Math.PI,
      halfWidth: 4.5,
    })

    expect(pose).not.toBeNull()
    expect(pose!.z).toBeCloseTo(-2.25, 5)
    expect(Math.cos(pose!.yawRad)).toBeCloseTo(-1, 5)
    expect(Math.sin(pose!.yawRad)).toBeCloseTo(0, 5)
  })

  it('clamps past the end of the road while retaining lane alignment', () => {
    const pose = resolveRoadLanePoseFromRows(makeStraightRows(), {
      worldX: 30,
      worldZ: 0,
      facingYawRad: 0,
      halfWidth: 4.5,
    })

    expect(pose).not.toBeNull()
    expect(pose!.x).toBeCloseTo(10, 5)
    expect(pose!.z).toBeCloseTo(2.25, 5)
    expect(pose!.distance).toBeCloseTo(20, 5)
  })

  it('keeps a single-track road on its centerline', () => {
    const pose = resolveRoadLanePoseFromRows(makeStraightRows(), {
      worldX: 5,
      worldZ: 1.25,
      facingYawRad: 0,
      halfWidth: 0.9,
    })

    expect(pose).not.toBeNull()
    expect(pose!.z).toBeCloseTo(0, 5)
  })

  it('interpolates lane height from the road cross-section', () => {
    const pose = resolveRoadLanePoseFromRows(makeStraightRows({ slope: 2 }), {
      worldX: 0.5,
      worldZ: 0,
      facingYawRad: 0,
      halfWidth: 4,
      columnHeights: [
        [10, 20, 30],
        [12, 22, 32],
      ],
      surfaceLift: 0.05,
    })

    expect(pose).not.toBeNull()
    // The right lane center is halfway from the crown to the right edge.
    expect(pose!.y).toBeCloseTo(25.55, 5)
  })

  it('selects the closest available landscape road', () => {
    const near = { x: 1, y: 2, z: 3, yawRad: 0, distance: 1 }
    const far = { x: 4, y: 5, z: 6, yawRad: 0, distance: 5 }

    expect(selectNearestRoadLanePose([far, null, near])).toBe(near)
    expect(selectNearestRoadLanePose([null])).toBeNull()
  })
})

describe('upright vehicle reset orientation', () => {
  const worldUp = new THREE.Vector3(0, 1, 0)

  it('maps a +X local forward axis onto the lane direction', () => {
    const quaternion = computeUprightVehicleYawQuaternion(
      { rightIndex: 2, upIndex: 1, forwardIndex: 0 },
      Math.PI / 2,
    )
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)

    expect(forward.x).toBeCloseTo(0, 5)
    expect(forward.y).toBeCloseTo(0, 5)
    expect(forward.z).toBeCloseTo(-1, 5)
    expect(up.dot(worldUp)).toBeCloseTo(1, 5)
  })

  it('maps a +Z local forward axis onto the lane direction', () => {
    const quaternion = computeUprightVehicleYawQuaternion(
      { rightIndex: 0, upIndex: 1, forwardIndex: 2 },
      0,
    )
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)

    expect(forward.x).toBeCloseTo(1, 5)
    expect(forward.y).toBeCloseTo(0, 5)
    expect(forward.z).toBeCloseTo(0, 5)
    expect(up.dot(worldUp)).toBeCloseTo(1, 5)
  })
})
