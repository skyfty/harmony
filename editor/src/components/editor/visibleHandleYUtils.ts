import * as THREE from 'three'

const DEFAULT_TOP_MARGIN_PX = 72
const DEFAULT_BOTTOM_MARGIN_PX = 56
const DEFAULT_SAMPLE_STEPS = 6
const DEFAULT_BINARY_STEPS = 5

const tmpWorldPoint = new THREE.Vector3()
const tmpProjectedPoint = new THREE.Vector3()

type ProjectionResult = {
  depthVisible: boolean
  screenY: number
}

function projectLocalPoint(options: {
  camera: THREE.Camera
  canvas: HTMLCanvasElement
  runtimeObject: THREE.Object3D
  localAnchor: THREE.Vector3
  localY: number
}): ProjectionResult {
  const bounds = options.canvas.getBoundingClientRect()
  tmpWorldPoint.copy(options.localAnchor)
  tmpWorldPoint.y = options.localY
  options.runtimeObject.localToWorld(tmpWorldPoint)
  tmpProjectedPoint.copy(tmpWorldPoint).project(options.camera)
  return {
    depthVisible: tmpProjectedPoint.z >= -1 && tmpProjectedPoint.z <= 1,
    screenY: (-tmpProjectedPoint.y * 0.5 + 0.5) * bounds.height,
  }
}

function isWithinVerticalBounds(result: ProjectionResult, topPx: number, bottomPx: number): boolean {
  return result.depthVisible && result.screenY >= topPx && result.screenY <= bottomPx
}

export function resolveVisibleLocalHandleY(options: {
  camera: THREE.Camera | null
  canvas: HTMLCanvasElement | null
  runtimeObject: THREE.Object3D
  localAnchor: THREE.Vector3
  preferredLocalY: number
  minLocalY: number
  topMarginPx?: number
  bottomMarginPx?: number
}): number {
  const lower = Math.min(options.preferredLocalY, options.minLocalY)
  const upper = Math.max(options.preferredLocalY, options.minLocalY)
  const preferred = THREE.MathUtils.clamp(options.preferredLocalY, lower, upper)
  const minLocalY = THREE.MathUtils.clamp(options.minLocalY, lower, upper)

  if (!options.camera || !options.canvas) {
    return preferred
  }

  const bounds = options.canvas.getBoundingClientRect()
  if (bounds.height <= 0 || bounds.width <= 0) {
    return preferred
  }

  const topPx = Math.max(0, Number.isFinite(options.topMarginPx) ? Number(options.topMarginPx) : DEFAULT_TOP_MARGIN_PX)
  const bottomPx = bounds.height - Math.max(0, Number.isFinite(options.bottomMarginPx) ? Number(options.bottomMarginPx) : DEFAULT_BOTTOM_MARGIN_PX)
  if (bottomPx <= topPx) {
    return preferred
  }

  const preferredProjection = projectLocalPoint({
    camera: options.camera,
    canvas: options.canvas,
    runtimeObject: options.runtimeObject,
    localAnchor: options.localAnchor,
    localY: preferred,
  })
  if (isWithinVerticalBounds(preferredProjection, topPx, bottomPx)) {
    return preferred
  }

  const minProjection = projectLocalPoint({
    camera: options.camera,
    canvas: options.canvas,
    runtimeObject: options.runtimeObject,
    localAnchor: options.localAnchor,
    localY: minLocalY,
  })
  if (!isWithinVerticalBounds(minProjection, topPx, bottomPx)) {
    return preferredProjection.depthVisible ? preferred : minLocalY
  }

  let previousY = preferred
  let bestVisibleY = minLocalY
  let foundVisible = false

  for (let step = 1; step <= DEFAULT_SAMPLE_STEPS; step += 1) {
    const t = step / DEFAULT_SAMPLE_STEPS
    const candidateY = THREE.MathUtils.lerp(preferred, minLocalY, t)
    const candidateProjection = projectLocalPoint({
      camera: options.camera,
      canvas: options.canvas,
      runtimeObject: options.runtimeObject,
      localAnchor: options.localAnchor,
      localY: candidateY,
    })
    if (!isWithinVerticalBounds(candidateProjection, topPx, bottomPx)) {
      previousY = candidateY
      continue
    }

    bestVisibleY = candidateY
    foundVisible = true

    let low = candidateY
    let high = previousY
    for (let index = 0; index < DEFAULT_BINARY_STEPS; index += 1) {
      const mid = (low + high) * 0.5
      const midProjection = projectLocalPoint({
        camera: options.camera,
        canvas: options.canvas,
        runtimeObject: options.runtimeObject,
        localAnchor: options.localAnchor,
        localY: mid,
      })
      if (isWithinVerticalBounds(midProjection, topPx, bottomPx)) {
        bestVisibleY = mid
        low = mid
      } else {
        high = mid
      }
    }
    break
  }

  return foundVisible ? bestVisibleY : minLocalY
}