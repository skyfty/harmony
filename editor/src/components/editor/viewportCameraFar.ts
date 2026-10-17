import { resolveCameraFarForFogDistance } from '@schema/slowroads/core/environment'

/** 雾推导的远裁剪面上限（米）：覆盖 16× 场景视距仍有余量。 */
export const VIEWPORT_CAMERA_FAR_MAX = 30000

/** 远裁剪面相对场景雾远端的余量：先让雾收满，再轮到裁切。 */
export const VIEWPORT_CAMERA_FAR_FOG_MARGIN = 1.25

/**
 * 编辑视口远裁剪面：本地取景所需的 `baseFar` 是下限，场景雾距只负责把它抬高。
 * 无有效雾距（环境运行时未生效 / 小场景）时保持原有取景行为不变。
 */
export function resolveViewportCameraFar(baseFar: number, fogFar: number): number {
  const safeBaseFar = Number.isFinite(baseFar) && baseFar > 0 ? baseFar : 1
  if (!Number.isFinite(fogFar) || fogFar <= 0) {
    return safeBaseFar
  }
  return Math.max(
    safeBaseFar,
    resolveCameraFarForFogDistance({
      fogFar,
      fallbackFar: safeBaseFar,
      maxFar: Math.max(safeBaseFar, VIEWPORT_CAMERA_FAR_MAX),
      marginFactor: VIEWPORT_CAMERA_FAR_FOG_MARGIN,
    }),
  )
}
