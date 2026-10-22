import { describe, expect, it } from 'vitest'

import { shouldApplyPhysicsBridgeFrameForPendingSnap } from '@schema/physicsBridgeSnapGuard'

describe('physics bridge snap guard', () => {
  const pendingSnap = {
    position: { x: 100, y: 20, z: 50 },
    expiresAtMs: 2_000,
  }

  it('rejects stale frames from before the teleport target was confirmed', () => {
    expect(shouldApplyPhysicsBridgeFrameForPendingSnap(
      pendingSnap,
      { x: 0, y: 20, z: 50 },
      1_000,
    )).toBe(false)
  })

  it('accepts and releases the guard when the bridge reaches the target', () => {
    expect(shouldApplyPhysicsBridgeFrameForPendingSnap(
      pendingSnap,
      { x: 100.2, y: 20, z: 50 },
      1_000,
    )).toBe(true)
  })

  it('stops suppressing frames after the safety timeout', () => {
    expect(shouldApplyPhysicsBridgeFrameForPendingSnap(
      pendingSnap,
      { x: 0, y: 20, z: 50 },
      2_001,
    )).toBe(true)
  })
})
