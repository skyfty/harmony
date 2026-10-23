import { describe, expect, it } from 'vitest'
import { shouldRunCameraInteractionMaintenance } from '../cameraInteractionMaintenance'

describe('shouldRunCameraInteractionMaintenance', () => {
  it('runs continuously while idle', () => {
    expect(shouldRunCameraInteractionMaintenance({
      active: false,
      ended: false,
      nowMs: 101,
      lastRunAtMs: 100,
      intervalMs: 100,
    })).toBe(true)
  })

  it('throttles camera-driven work while dragging', () => {
    expect(shouldRunCameraInteractionMaintenance({
      active: true,
      ended: false,
      nowMs: 150,
      lastRunAtMs: 100,
      intervalMs: 100,
    })).toBe(false)
    expect(shouldRunCameraInteractionMaintenance({
      active: true,
      ended: false,
      nowMs: 200,
      lastRunAtMs: 100,
      intervalMs: 100,
    })).toBe(true)
  })

  it('always performs the settle pass when interaction ends', () => {
    expect(shouldRunCameraInteractionMaintenance({
      active: false,
      ended: true,
      nowMs: 101,
      lastRunAtMs: 100,
      intervalMs: 100,
    })).toBe(true)
  })
})
