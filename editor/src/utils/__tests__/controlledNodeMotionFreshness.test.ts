import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { isControlledNodeMotionPositionAligned } from '@schema/motion'

describe('controlled node motion freshness', () => {
  it('rejects stale telemetry left behind by a teleport', () => {
    expect(isControlledNodeMotionPositionAligned(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(25, 0, 0),
      4,
    )).toBe(false)
  })

  it('accepts telemetry that still matches the rendered object position', () => {
    expect(isControlledNodeMotionPositionAligned(
      new THREE.Vector3(10, 1, 5),
      new THREE.Vector3(10.1, 1, 5),
      4,
    )).toBe(true)
  })

  it('rejects non-finite positions', () => {
    expect(isControlledNodeMotionPositionAligned(
      new THREE.Vector3(Number.NaN, 0, 0),
      new THREE.Vector3(0, 0, 0),
      4,
    )).toBe(false)
  })
})
