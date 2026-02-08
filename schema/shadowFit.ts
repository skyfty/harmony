import * as THREE from 'three'

export type DirectionalShadowFitOptions = {
  /** Half-height in local ground space used for fitting near/far. */
  safeHeight?: number
  /** Extra padding applied to left/right/top/bottom and near/far (world units in light camera space). */
  padding?: number
  /** Clamp orthographic half-size (in light camera space). Helps keep shadows sharp on huge grounds. */
  maxOrthoSize?: number
  /** Minimum near plane. */
  minNear?: number
  /** Maximum far plane clamp. */
  maxFar?: number
  /** Only fit lights that have `castShadow=true`. Default true. */
  onlyCastShadow?: boolean
}

const DEFAULT_SAFE_HEIGHT = 100
const DEFAULT_MIN_NEAR = 0.1
const DEFAULT_MAX_FAR = 5000

function computeDefaultPadding(groundWidth: number, groundDepth: number): number {
  const extent = Math.max(Math.abs(groundWidth), Math.abs(groundDepth))
  if (!Number.isFinite(extent) || extent <= 0) {
    return 2
  }
  return Math.max(1, extent * 0.02)
}

function buildGroundWorldCorners(
  groundWorldMatrix: THREE.Matrix4,
  groundWidth: number,
  groundDepth: number,
  safeHeight: number,
): THREE.Vector3[] {
  const halfWidth = Number.isFinite(groundWidth) ? Math.abs(groundWidth) / 2 : 0
  const halfDepth = Number.isFinite(groundDepth) ? Math.abs(groundDepth) / 2 : 0
  const h = Number.isFinite(safeHeight) ? Math.max(0, safeHeight) : 0
  const cornersLocal = [
    new THREE.Vector3(-halfWidth, -h, -halfDepth),
    new THREE.Vector3(halfWidth, -h, -halfDepth),
    new THREE.Vector3(-halfWidth, -h, halfDepth),
    new THREE.Vector3(halfWidth, -h, halfDepth),
    new THREE.Vector3(-halfWidth, h, -halfDepth),
    new THREE.Vector3(halfWidth, h, -halfDepth),
    new THREE.Vector3(-halfWidth, h, halfDepth),
    new THREE.Vector3(halfWidth, h, halfDepth),
  ]

  for (const v of cornersLocal) {
    v.applyMatrix4(groundWorldMatrix)
  }
  return cornersLocal
}

function fitDirectionalLightShadowToWorldPoints(
  light: THREE.DirectionalLight,
  worldPoints: THREE.Vector3[],
  options?: DirectionalShadowFitOptions,
): boolean {
  const onlyCastShadow = options?.onlyCastShadow ?? true
  if (onlyCastShadow && !light.castShadow) {
    return false
  }

  const shadow = light.shadow
  const camera = shadow?.camera
  if (!shadow || !camera || !(camera as any).isOrthographicCamera) {
    return false
  }

  const orthoCamera = camera as THREE.OrthographicCamera
  light.updateMatrixWorld(true)
  light.target?.updateMatrixWorld?.(true)
  orthoCamera.updateMatrixWorld(true)

  const padding = options?.padding ?? 0
  const maxOrthoSize =
    typeof options?.maxOrthoSize === 'number' && Number.isFinite(options.maxOrthoSize) && options.maxOrthoSize > 0
      ? options.maxOrthoSize
      : null

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  const tmp = new THREE.Vector3()
  for (const p of worldPoints) {
    tmp.copy(p).applyMatrix4(orthoCamera.matrixWorldInverse)
    minX = Math.min(minX, tmp.x)
    maxX = Math.max(maxX, tmp.x)
    minY = Math.min(minY, tmp.y)
    maxY = Math.max(maxY, tmp.y)
    minZ = Math.min(minZ, tmp.z)
    maxZ = Math.max(maxZ, tmp.z)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return false
  }

  // Camera looks down -Z. Points in front typically have negative z.
  const minNear = options?.minNear ?? DEFAULT_MIN_NEAR
  const maxFarClamp = options?.maxFar ?? DEFAULT_MAX_FAR
  const near = Math.max(minNear, -maxZ - padding)
  const far = Math.min(maxFarClamp, Math.max(near + 0.01, -minZ + padding))

  let left = minX - padding
  let right = maxX + padding
  let bottom = minY - padding
  let top = maxY + padding

  if (maxOrthoSize !== null) {
    const centerX = (left + right) * 0.5
    const centerY = (bottom + top) * 0.5
    const halfX = Math.min(maxOrthoSize, Math.max(0.01, (right - left) * 0.5))
    const halfY = Math.min(maxOrthoSize, Math.max(0.01, (top - bottom) * 0.5))
    left = centerX - halfX
    right = centerX + halfX
    bottom = centerY - halfY
    top = centerY + halfY
  }

  const changed =
    orthoCamera.left !== left ||
    orthoCamera.right !== right ||
    orthoCamera.bottom !== bottom ||
    orthoCamera.top !== top ||
    orthoCamera.near !== near ||
    orthoCamera.far !== far

  orthoCamera.left = left
  orthoCamera.right = right
  orthoCamera.bottom = bottom
  orthoCamera.top = top
  orthoCamera.near = near
  orthoCamera.far = far
  orthoCamera.updateProjectionMatrix()

  if (changed) {
    shadow.needsUpdate = true
  }

  return changed
}

/**
 * Fits all DirectionalLight shadow cameras under `root` to cover the given ground rectangle.
 */
export function fitDirectionalLightShadowsToGround(
  root: THREE.Object3D,
  groundWorldMatrix: THREE.Matrix4,
  groundWidth: number,
  groundDepth: number,
  options?: DirectionalShadowFitOptions,
): number {
  const safeHeight = options?.safeHeight ?? DEFAULT_SAFE_HEIGHT
  const padding = options?.padding ?? computeDefaultPadding(groundWidth, groundDepth)
  const worldCorners = buildGroundWorldCorners(groundWorldMatrix, groundWidth, groundDepth, safeHeight)
  const opts: DirectionalShadowFitOptions = { ...options, safeHeight, padding }

  let changedCount = 0
  root.traverse((obj) => {
    if (!(obj as any).isDirectionalLight) {
      return
    }
    const light = obj as THREE.DirectionalLight
    if (fitDirectionalLightShadowToWorldPoints(light, worldCorners, opts)) {
      changedCount += 1
    }
  })

  return changedCount
}

export type AutoFitDirectionalShadowToGroundOptions = {
  /** Minimum `safeHeight` used for fitting near/far (world units). Default 100. */
  safeHeightMin?: number
  /** `safeHeight` scale relative to ground diagonal. Default 0.15. */
  safeHeightScale?: number
  /** Minimum far clamp. Default 5000. */
  maxFarMin?: number
  /** Far clamp scale relative to ground diagonal. Default 6. */
  maxFarScale?: number
  /** Extra far padding. Default 1000. */
  maxFarPadding?: number
  /** Absolute far clamp cap. Default 2,000,000. */
  maxFarCap?: number
}

/**
 * Fits a single DirectionalLight's shadow camera to cover the ground.
 *
 * This derives a reasonable `safeHeight` and `maxFar` from the ground size so
 * shadows remain stable as ground is moved/resized.
 */
export function autoFitDirectionalLightShadowToGround(
  light: THREE.DirectionalLight,
  groundWorldMatrix: THREE.Matrix4,
  groundWidth: number,
  groundDepth: number,
  options?: DirectionalShadowFitOptions & AutoFitDirectionalShadowToGroundOptions,
): boolean {
  const width = Math.abs(groundWidth)
  const depth = Math.abs(groundDepth)
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) {
    return false
  }

  const diagonal = Math.sqrt(width * width + depth * depth)
  const safeHeightMin = options?.safeHeightMin ?? 100
  const safeHeightScale = options?.safeHeightScale ?? 0.15
  const safeHeight = options?.safeHeight ?? Math.max(safeHeightMin, diagonal * safeHeightScale)

  const maxFarMin = options?.maxFarMin ?? 5000
  const maxFarScale = options?.maxFarScale ?? 6
  const maxFarPadding = options?.maxFarPadding ?? 1000
  const maxFarCap = options?.maxFarCap ?? 2_000_000

  const computedMaxFar = Math.max(maxFarMin, diagonal * maxFarScale + maxFarPadding)
  const maxFar = options?.maxFar ?? Math.min(maxFarCap, computedMaxFar)

  // Fit only this light by passing the light itself as the traversal root.
  const changedCount = fitDirectionalLightShadowsToGround(light, groundWorldMatrix, width, depth, {
    ...options,
    safeHeight,
    maxFar,
    onlyCastShadow: options?.onlyCastShadow ?? true,
  })

  return changedCount > 0
}
