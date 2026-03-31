export const DEFAULT_COLOR = '#ffffff'
export const DEFAULT_GROUND_COLOR = '#444444'
export const DEFAULT_INTENSITY = 1
export const DEFAULT_DISTANCE = 50
export const DEFAULT_DECAY = 1
export const DEFAULT_WIDTH = 10
export const DEFAULT_HEIGHT = 10
export const DEFAULT_CAST_SHADOW = false

export const DEFAULT_LIGHT_DIRECTION = { x: 0, y: -1, z: 0 } as const
export const DEFAULT_LIGHT_TARGET_DISTANCE: Record<'Directional' | 'Spot', number> = {
  Directional: 30,
  Spot: 20,
}

export const DEFAULT_SPOT_ANGLE_RAD = Math.PI / 6 // 30 degrees
export const DEFAULT_SPOT_ANGLE_DEG = 30
export const DEFAULT_PENUMBRA = 0.3

export const DEFAULT_SHADOW_MAP_SIZE_DIRECTIONAL = 2048
export const DEFAULT_SHADOW_MAP_SIZE_SPOT = 1024
export const DEFAULT_SHADOW_MAP_SIZE_OTHER = 512

export function getDefaultShadowMapSize(type: string | undefined): number {
  if (type === 'Directional') return DEFAULT_SHADOW_MAP_SIZE_DIRECTIONAL
  if (type === 'Spot') return DEFAULT_SHADOW_MAP_SIZE_SPOT
  return DEFAULT_SHADOW_MAP_SIZE_OTHER
}

export const DEFAULT_SHADOW_BIAS_DIRECTIONAL = -0.0002
export const DEFAULT_SHADOW_BIAS = 0
export const DEFAULT_SHADOW_NORMAL_BIAS = 0
export const DEFAULT_SHADOW_RADIUS = 1
export const DEFAULT_SHADOW_CAMERA_NEAR = 0.1
export const DEFAULT_SHADOW_CAMERA_FAR = 200
export const DEFAULT_SHADOW_ORTHO_SIZE = 20

export default {
  DEFAULT_COLOR,
  DEFAULT_GROUND_COLOR,
  DEFAULT_INTENSITY,
}
