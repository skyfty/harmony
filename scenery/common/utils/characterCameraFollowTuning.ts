export type CharacterCameraPlatform = 'mp-weixin' | 'h5'

export type CharacterCameraPositionTuningOptions = {
  platform: CharacterCameraPlatform
  steeringActive: boolean
}

const DEFAULT_CHARACTER_CAMERA_POSITION_LERP_SPEED = 10
const WECHAT_STEERING_CAMERA_POSITION_LERP_SPEED = 0
const DEFAULT_CHARACTER_CAMERA_TARGET_LERP_SPEED = 8
const WECHAT_STEERING_CAMERA_TARGET_LERP_SPEED = 0

/**
 * The character visual transform is already time-smoothed before the follow
 * camera samples it. WeChat commonly renders the scene at 60 FPS while H5 can
 * run at 90-120 FPS, so applying the same second position filter there leaves
 * a visible trailing error. Keep the idle settle behavior, but follow the
 * already-smoothed visual rigidly while WeChat steering is active.
 */
export function resolveCharacterCameraPositionLerpSpeed(
  options: CharacterCameraPositionTuningOptions,
): number {
  return options.platform === 'mp-weixin' && options.steeringActive
    ? WECHAT_STEERING_CAMERA_POSITION_LERP_SPEED
    : DEFAULT_CHARACTER_CAMERA_POSITION_LERP_SPEED
}

/**
 * The camera's translation and look-at target are sampled from the same
 * already-smoothed character frame. Smoothing the target again can leave the
 * camera aiming several metres behind the visual on 60 FPS WeChat devices.
 */
export function resolveCharacterCameraTargetLerpSpeed(
  options: CharacterCameraPositionTuningOptions,
): number {
  return options.platform === 'mp-weixin' && options.steeringActive
    ? WECHAT_STEERING_CAMERA_TARGET_LERP_SPEED
    : DEFAULT_CHARACTER_CAMERA_TARGET_LERP_SPEED
}
