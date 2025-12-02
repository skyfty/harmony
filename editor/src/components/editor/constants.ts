import * as THREE from 'three'
export { GROUND_NODE_ID } from '@harmony/schema'

export const DEFAULT_BACKGROUND_COLOR = 0x516175
export const SKY_ENVIRONMENT_INTENSITY = 0.35
export const FALLBACK_AMBIENT_INTENSITY = 0.2
export const FALLBACK_DIRECTIONAL_INTENSITY = 0.65
export const FALLBACK_DIRECTIONAL_SHADOW_MAP_SIZE = 512
export const SKY_SCALE = 2500
export const SKY_FALLBACK_LIGHT_DISTANCE = 75
export const SKY_SUN_LIGHT_DISTANCE = 150
export const SKY_SUN_LIGHT_MIN_HEIGHT = 12

export const CLICK_DRAG_THRESHOLD_PX = 5
export const ASSET_DRAG_MIME = 'application/x-harmony-asset'
export const MIN_CAMERA_HEIGHT = 0.25
export const MIN_TARGET_HEIGHT = 0
export const GRID_MAJOR_SPACING = 1
export const GRID_MINOR_SPACING = 0.5
export const GRID_SNAP_SPACING = GRID_MINOR_SPACING
export const WALL_DIAGONAL_SNAP_THRESHOLD = THREE.MathUtils.degToRad(20)
export const GRID_MINOR_DASH_SIZE = GRID_MINOR_SPACING * 0.12
export const GRID_MINOR_GAP_SIZE = GRID_MINOR_SPACING * 0.2
export const FACE_SNAP_PREVIEW_DISTANCE = 0.1
export const FACE_SNAP_COMMIT_DISTANCE = 0.04
export const FACE_SNAP_MIN_OVERLAP = 0.05
export const FACE_SNAP_MOVEMENT_EPSILON = 1e-4
export const FACE_SNAP_EFFECT_MAX_OPACITY = 0.78
export const FACE_SNAP_EFFECT_MIN_OPACITY = 0.2
export const FACE_SNAP_EFFECT_MIN_SIZE = 0.12
export const FACE_SNAP_EFFECT_MAX_SIZE = 48
export const FACE_SNAP_EFFECT_SCALE_PULSE = 0.22
export const FACE_SNAP_EFFECT_PULSE_SPEED = 140
export const GRID_BASE_HEIGHT = 0.03
export const GRID_HIGHLIGHT_HEIGHT = 0.03
export const GRID_HIGHLIGHT_PADDING = 0.1
export const GRID_HIGHLIGHT_MIN_SIZE = GRID_MAJOR_SPACING * 1.3
export const DEFAULT_GRID_HIGHLIGHT_SIZE = GRID_MAJOR_SPACING * 1.5
export const DEFAULT_GRID_HIGHLIGHT_DIMENSIONS = { width: DEFAULT_GRID_HIGHLIGHT_SIZE, depth: DEFAULT_GRID_HIGHLIGHT_SIZE } as const
export const POINT_LIGHT_HELPER_SIZE = 0.5
export const DIRECTIONAL_LIGHT_HELPER_SIZE = 5
export const DEFAULT_CAMERA_POSITION = { x: 5, y: 5, z: 5 } as const
export const DEFAULT_CAMERA_TARGET = { x: 0, y: 0, z: 0 } as const
export const DEFAULT_PERSPECTIVE_FOV = 60
export const MIN_CAMERA_DISTANCE = 2
export const MAX_CAMERA_DISTANCE = 30
export const CAMERA_POLAR_EPSILON = 1e-3
export const MIN_ORTHOGRAPHIC_ZOOM = 0.25
export const MAX_ORTHOGRAPHIC_ZOOM = 8
export const CAMERA_DISTANCE_EPSILON = 1e-3
export const ORTHO_FRUSTUM_SIZE = 20
export const DROP_TO_GROUND_EPSILON = 1e-4
export const ALIGN_DELTA_EPSILON = 1e-6
export const RIGHT_CLICK_ROTATION_STEP = THREE.MathUtils.degToRad(15)
export const GROUND_HEIGHT_STEP = 0.5

export interface SelectionRotationOptions {
  axis: 'x' | 'y'
  degrees: number
}
