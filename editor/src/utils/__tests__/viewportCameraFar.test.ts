import { describe, expect, it } from 'vitest'
import {
  resolveViewportCameraFar,
  VIEWPORT_CAMERA_FAR_MAX,
} from '@/components/editor/viewportCameraFar'

describe('editor viewport camera far', () => {
  it('keeps the local clip distance when no scene fog is active', () => {
    expect(resolveViewportCameraFar(1732, 0)).toBe(1732)
    expect(resolveViewportCameraFar(1732, Number.NaN)).toBe(1732)
    expect(resolveViewportCameraFar(1732, -1)).toBe(1732)
  })

  it('covers the scene fog distance without lowering a farther local view', () => {
    expect(resolveViewportCameraFar(1732, 14220)).toBeCloseTo(17775, 6)
    expect(resolveViewportCameraFar(40000, 14220)).toBe(40000)
    expect(resolveViewportCameraFar(5000, 20000)).toBe(25000)
  })

  it('caps fog-derived far while preserving a larger local far', () => {
    expect(resolveViewportCameraFar(5000, 40000)).toBe(VIEWPORT_CAMERA_FAR_MAX)
    expect(resolveViewportCameraFar(40000, 40000)).toBe(40000)
  })
})
