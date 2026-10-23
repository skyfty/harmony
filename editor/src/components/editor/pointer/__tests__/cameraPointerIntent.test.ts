import { describe, expect, it } from 'vitest'
import { resolveCameraPointerAction } from '../cameraPointerIntent'

describe('resolveCameraPointerAction', () => {
  it('maps map-mode mouse buttons to pan and rotate', () => {
    expect(resolveCameraPointerAction({ enabled: true, mode: 'map', button: 0 })).toBe('pan')
    expect(resolveCameraPointerAction({ enabled: true, mode: 'map', button: 1 })).toBe('pan')
    expect(resolveCameraPointerAction({ enabled: true, mode: 'map', button: 2 })).toBe('rotate')
  })

  it('maps orbit-mode mouse buttons to rotate and pan', () => {
    expect(resolveCameraPointerAction({ enabled: true, mode: 'orbit', button: 0 })).toBe('rotate')
    expect(resolveCameraPointerAction({ enabled: true, mode: 'orbit', button: 1 })).toBe('rotate')
    expect(resolveCameraPointerAction({ enabled: true, mode: 'orbit', button: 2 })).toBe('pan')
  })

  it('does not claim unsupported buttons or a disabled controller', () => {
    expect(resolveCameraPointerAction({ enabled: true, mode: 'map', button: 4 })).toBeNull()
    expect(resolveCameraPointerAction({ enabled: false, mode: 'map', button: 2 })).toBeNull()
    expect(resolveCameraPointerAction({ enabled: false, mode: 'orbit', button: 0 })).toBeNull()
  })
})
