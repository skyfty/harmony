export type CameraControlMode = 'map' | 'orbit'

export type CameraPointerAction = 'pan' | 'rotate'

/**
 * Resolves the camera action for a mouse button without touching the scene.
 *
 * Keeping this mapping pure lets pointer-down routing defer scene picks while
 * preserving the exact controls exposed by CameraControls.
 */
export function resolveCameraPointerAction(options: {
  enabled: boolean
  mode: CameraControlMode
  button: number
}): CameraPointerAction | null {
  if (!options.enabled) {
    return null
  }

  if (options.mode === 'map') {
    if (options.button === 0 || options.button === 1) {
      return 'pan'
    }
    if (options.button === 2) {
      return 'rotate'
    }
    return null
  }

  if (options.button === 0 || options.button === 1) {
    return 'rotate'
  }
  return options.button === 2 ? 'pan' : null
}
