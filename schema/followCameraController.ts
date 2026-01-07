import * as THREE from 'three'

export type CameraFollowState = {
  desiredPosition: THREE.Vector3
  desiredTarget: THREE.Vector3
  currentPosition: THREE.Vector3
  currentTarget: THREE.Vector3
  desiredAnchor: THREE.Vector3
  currentAnchor: THREE.Vector3
  anchorHoldSeconds: number
  lastVelocityDirection: THREE.Vector3
  heading: THREE.Vector3
  initialized: boolean
  localOffset: THREE.Vector3
  hasLocalOffset: boolean
  shouldHoldAnchorForReverse: boolean
  motionDistanceBlend: number
  lookaheadOffset: THREE.Vector3
}

export type CameraFollowPlacement = {
  distance: number
  heightOffset: number
  targetLift: number
  targetForward: number
}

export type CameraFollowOptions = {
  immediate?: boolean
  applyOrbitTween?: boolean
  followControlsDirty?: boolean
}

export type CameraFollowContext = {
  camera: THREE.PerspectiveCamera | null
  mapControls?: { target: THREE.Vector3; update: () => void; enablePan?: boolean; minDistance?: number; maxDistance?: number }
}

type Vector3Like = { x: number; y: number; z: number }

type VelocityLike = Vector3Like & {
  lengthSquared?: () => number
  lengthSq?: () => number
}

export type CameraFollowTuning = {
  distanceMin: number
  distanceMax: number
  heightMin: number

  positionLerpSpeed: number
  targetLerpSpeed: number
  headingLerpSpeed: number
  anchorLerpSpeed: number

  lookaheadTime: number
  lookaheadDistanceMax: number
  lookaheadMinSpeedSq: number
  lookaheadBlendStart: number
  lookaheadBlendSpeed: number

  backwardDotThreshold: number
  forwardReleaseDot: number

  collisionLockSpeedSq: number
  collisionDirectionDotThreshold: number
  collisionHoldTime: number

  motionSpeedThreshold: number
  motionSpeedFull: number
  motionBlendSpeed: number
  motionDistanceBoost: number
  motionHeightBoost: number

  movingSpeedSq: number
}

export const DEFAULT_CAMERA_FOLLOW_TUNING: CameraFollowTuning = {
  distanceMin: 1,
  distanceMax: 10,
  heightMin: 4,

  positionLerpSpeed: 8,
  targetLerpSpeed: 10,
  headingLerpSpeed: 5.5,
  anchorLerpSpeed: 4.5,

  lookaheadTime: 0.18,
  lookaheadDistanceMax: 3,
  lookaheadMinSpeedSq: 0.9,
  lookaheadBlendStart: 0.25,
  lookaheadBlendSpeed: 4,

  backwardDotThreshold: -0.25,
  forwardReleaseDot: 0.25,

  collisionLockSpeedSq: 1.21,
  collisionDirectionDotThreshold: -0.35,
  collisionHoldTime: 0.8,

  motionSpeedThreshold: 0.7,
  motionSpeedFull: 6,
  motionBlendSpeed: 3.2,
  motionDistanceBoost: 0.28,
  motionHeightBoost: 0.22,

  movingSpeedSq: 0.04,
}

export const DEFAULT_OBJECT_SIZE_FALLBACK = { width: 2.4, height: 1.4, length: 4.2 }

export function createCameraFollowState(): CameraFollowState {
  return {
    desiredPosition: new THREE.Vector3(),
    desiredTarget: new THREE.Vector3(),
    currentPosition: new THREE.Vector3(),
    currentTarget: new THREE.Vector3(),
    desiredAnchor: new THREE.Vector3(),
    currentAnchor: new THREE.Vector3(),
    anchorHoldSeconds: 0,
    lastVelocityDirection: new THREE.Vector3(),
    heading: new THREE.Vector3(),
    initialized: false,
    localOffset: new THREE.Vector3(),
    hasLocalOffset: false,
    shouldHoldAnchorForReverse: false,
    motionDistanceBlend: 0,
    lookaheadOffset: new THREE.Vector3(),
  }
}

export function resetCameraFollowState(state: CameraFollowState): void {
  state.desiredPosition.set(0, 0, 0)
  state.desiredTarget.set(0, 0, 0)
  state.currentPosition.set(0, 0, 0)
  state.currentTarget.set(0, 0, 0)
  state.desiredAnchor.set(0, 0, 0)
  state.currentAnchor.set(0, 0, 0)
  state.anchorHoldSeconds = 0
  state.lastVelocityDirection.set(0, 0, 0)
  state.heading.set(0, 0, 0)
  state.initialized = false
  state.localOffset.set(0, 0, 0)
  state.hasLocalOffset = false
  state.shouldHoldAnchorForReverse = false
  state.motionDistanceBlend = 0
  state.lookaheadOffset.set(0, 0, 0)
}

export function computeFollowLerpAlpha(deltaSeconds: number, speed: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 0
  }
  if (speed <= 0) {
    return 1
  }
  return 1 - Math.exp(-speed * deltaSeconds)
}

export function getApproxDimensions(object: THREE.Object3D | null, fallback = DEFAULT_OBJECT_SIZE_FALLBACK): { width: number; height: number; length: number } {
  if (!object) {
    return { ...fallback }
  }
  const box = new THREE.Box3().setFromObject(object)
  if (!Number.isFinite(box.min.x) || box.isEmpty()) {
    return { ...fallback }
  }
  const size = box.getSize(new THREE.Vector3())
  return {
    width: Math.max(size.x, fallback.width),
    height: Math.max(size.y, fallback.height),
    length: Math.max(size.z, fallback.length),
  }
}

export type FollowPlacementRatios = {
  heightRatio: number
  heightMin: number
  distanceLengthRatio: number
  distanceWidthRatio: number
  distanceDiagonalRatio: number
  targetLiftRatio: number
  targetLiftMin: number
  targetForwardRatio: number
  targetForwardMin: number
}

export const DEFAULT_FOLLOW_PLACEMENT_RATIOS: FollowPlacementRatios = {
  heightRatio: 0.7,
  heightMin: 4.0,
  distanceLengthRatio: 2.8,
  distanceWidthRatio: 0.4,
  distanceDiagonalRatio: 0.45,
  targetLiftRatio: 0.3,
  targetLiftMin: 0.5,
  targetForwardRatio: 0.82,
  targetForwardMin: 3,
}

export function computeFollowPlacement(
  dimensions: { width: number; height: number; length: number },
  ratios: FollowPlacementRatios = DEFAULT_FOLLOW_PLACEMENT_RATIOS,
  tuning: CameraFollowTuning = DEFAULT_CAMERA_FOLLOW_TUNING,
): CameraFollowPlacement {
  const lengthComponent = dimensions.length * ratios.distanceLengthRatio
  const widthComponent = dimensions.width * ratios.distanceWidthRatio
  const diagonalComponent = Math.hypot(dimensions.length, dimensions.height) * ratios.distanceDiagonalRatio
  const unclampedDistance = Math.max(tuning.distanceMin, lengthComponent + widthComponent + diagonalComponent)
  const distance = Math.min(unclampedDistance, tuning.distanceMax)
  const heightOffset = Math.max(dimensions.height * ratios.heightRatio, ratios.heightMin)
  const targetLift = Math.max(dimensions.height * ratios.targetLiftRatio, ratios.targetLiftMin)
  const targetForward = Math.max(dimensions.length * ratios.targetForwardRatio, ratios.targetForwardMin)
  return { distance, heightOffset, targetLift, targetForward }
}

function readVelocityLengthSquared(velocity: VelocityLike): number {
  if (typeof velocity.lengthSquared === 'function') {
    try {
      return velocity.lengthSquared()
    } catch {
      // ignore
    }
  }
  if (typeof velocity.lengthSq === 'function') {
    try {
      return velocity.lengthSq()
    } catch {
      // ignore
    }
  }
  const x = velocity.x
  const y = velocity.y
  const z = velocity.z
  return x * x + y * y + z * z
}

export class FollowCameraController {
  private readonly temp = {
    cameraForward: new THREE.Vector3(),
    cameraRight: new THREE.Vector3(),
    cameraUp: new THREE.Vector3(),
    planarVelocity: new THREE.Vector3(),
    predictionOffset: new THREE.Vector3(),
    tempVector: new THREE.Vector3(),
    followOffsetLocal: new THREE.Vector3(),
    followTargetOffsetWorld: new THREE.Vector3(),
    desiredWorldOffset: new THREE.Vector3(),
    followPredictedAnchor: new THREE.Vector3(),
    followWorldOffset: new THREE.Vector3(),
  }

  update(options: {
    follow: CameraFollowState
    placement: CameraFollowPlacement
    anchorWorld: THREE.Vector3
    desiredForwardWorld: THREE.Vector3
    velocityWorld?: VelocityLike | null
    deltaSeconds: number
    ctx: CameraFollowContext
    worldUp?: THREE.Vector3
    distanceScale?: number
    tuning?: Partial<CameraFollowTuning>
    onUpdateOrbitLookTween?: (deltaSeconds: number) => void
    followControlsDirty?: boolean
    immediate?: boolean
    applyOrbitTween?: boolean
  }): boolean {
    const {
      follow,
      placement,
      anchorWorld,
      desiredForwardWorld,
      velocityWorld,
      deltaSeconds,
      ctx,
      onUpdateOrbitLookTween,
    } = options

    const camera = ctx.camera
    if (!camera) {
      return false
    }

    const tuning: CameraFollowTuning = { ...DEFAULT_CAMERA_FOLLOW_TUNING, ...(options.tuning ?? {}) }
    const worldUp = options.worldUp ?? new THREE.Vector3(0, 1, 0)

    const temp = this.temp

    // Copy placement so we can scale/mutate it like the original vehicle follow.
    const placementWorking: CameraFollowPlacement = {
      distance: placement.distance,
      heightOffset: placement.heightOffset,
      targetLift: placement.targetLift,
      targetForward: placement.targetForward,
    }

    const distanceScale = Number.isFinite(options.distanceScale) && (options.distanceScale as number) > 0
      ? (options.distanceScale as number)
      : 1

    // Anchor + optional prediction.
    temp.followPredictedAnchor.copy(anchorWorld)

    let planarSpeedSq = 0
    let planarSpeed = 0
    let lookaheadActive = false

    if (velocityWorld) {
      temp.planarVelocity.set(velocityWorld.x, 0, velocityWorld.z)
      planarSpeedSq = temp.planarVelocity.lengthSq()
      planarSpeed = Math.sqrt(planarSpeedSq)

      const lookaheadBlendRange = Math.max(1e-3, Math.sqrt(tuning.lookaheadMinSpeedSq) - tuning.lookaheadBlendStart)
      const lookaheadBlend = planarSpeed > tuning.lookaheadBlendStart
        ? Math.min(1, (planarSpeed - tuning.lookaheadBlendStart) / lookaheadBlendRange)
        : 0

      if (lookaheadBlend > 0) {
        temp.predictionOffset.copy(temp.planarVelocity)
        temp.predictionOffset.multiplyScalar(tuning.lookaheadTime * lookaheadBlend)
        const offsetLength = temp.predictionOffset.length()
        const maxLookahead = Math.max(0, tuning.lookaheadDistanceMax * lookaheadBlend)
        if (maxLookahead > 1e-4 && offsetLength > maxLookahead) {
          temp.predictionOffset.multiplyScalar(maxLookahead / offsetLength)
        }
        lookaheadActive = maxLookahead > 1e-4 && temp.predictionOffset.lengthSq() > 1e-8
      } else {
        temp.predictionOffset.set(0, 0, 0)
      }

      if (planarSpeedSq > tuning.collisionLockSpeedSq) {
        const normalizedDir = temp.tempVector.copy(temp.planarVelocity)
        const dirLength = normalizedDir.length()
        if (dirLength > 1e-6 && follow.lastVelocityDirection.lengthSq() > 1e-6) {
          normalizedDir.multiplyScalar(1 / dirLength)
          if (normalizedDir.dot(follow.lastVelocityDirection) < tuning.collisionDirectionDotThreshold) {
            follow.anchorHoldSeconds = tuning.collisionHoldTime
            follow.shouldHoldAnchorForReverse = true
          }
        }
      }

      const movementDot = temp.planarVelocity.dot(follow.heading)
      if (planarSpeedSq > 1e-6) {
        temp.tempVector.copy(temp.planarVelocity).normalize()
        follow.lastVelocityDirection.copy(temp.tempVector)
        if (movementDot > tuning.forwardReleaseDot) {
          follow.shouldHoldAnchorForReverse = false
        }
      }
    } else {
      temp.planarVelocity.set(0, 0, 0)
      follow.lastVelocityDirection.set(0, 0, 0)
    }

    const motionSpeedRange = Math.max(1e-3, tuning.motionSpeedFull - tuning.motionSpeedThreshold)
    const motionBlendTarget = planarSpeed <= tuning.motionSpeedThreshold
      ? 0
      : Math.min(1, (planarSpeed - tuning.motionSpeedThreshold) / motionSpeedRange)
    const motionBlendAlpha = options.immediate || !follow.initialized
      ? 1
      : computeFollowLerpAlpha(deltaSeconds, tuning.motionBlendSpeed)
    if (motionBlendAlpha >= 1) {
      follow.motionDistanceBlend = motionBlendTarget
    } else {
      follow.motionDistanceBlend += (motionBlendTarget - follow.motionDistanceBlend) * motionBlendAlpha
    }

    const motionDistanceScale = 1 + follow.motionDistanceBlend * tuning.motionDistanceBoost
    placementWorking.distance = Math.min(
      tuning.distanceMax,
      Math.max(tuning.distanceMin, placementWorking.distance * distanceScale * motionDistanceScale),
    )
    const motionHeightScale = 1 + follow.motionDistanceBlend * tuning.motionHeightBoost
    placementWorking.heightOffset *= motionHeightScale
    placementWorking.targetLift *= motionHeightScale
    placementWorking.targetForward *= motionDistanceScale

    if (follow.anchorHoldSeconds > 0) {
      follow.anchorHoldSeconds = Math.max(0, follow.anchorHoldSeconds - deltaSeconds)
    }

    if (!follow.initialized) {
      follow.heading.copy(desiredForwardWorld)
      follow.heading.y = 0
      if (follow.heading.lengthSq() < 1e-6) {
        follow.heading.set(0, 0, 1)
      } else {
        follow.heading.normalize()
      }
      follow.anchorHoldSeconds = 0
      follow.lastVelocityDirection.set(0, 0, 0)
      follow.shouldHoldAnchorForReverse = false
      follow.motionDistanceBlend = 0
      follow.lookaheadOffset.set(0, 0, 0)
    }

    const speedSq = velocityWorld ? readVelocityLengthSquared(velocityWorld) : 0
    const isTargetMoving = speedSq > tuning.movingSpeedSq

    const desiredHeading = temp.cameraForward
    if (desiredForwardWorld.lengthSq() > 1e-6) {
      desiredHeading.copy(desiredForwardWorld)
    } else if (follow.heading.lengthSq() > 1e-6) {
      desiredHeading.copy(follow.heading)
    } else {
      desiredHeading.set(0, 0, 1)
    }
    desiredHeading.y = 0
    if (desiredHeading.lengthSq() < 1e-6) {
      desiredHeading.set(0, 0, 1)
    } else {
      desiredHeading.normalize()
    }

    const headingLerp = follow.initialized ? computeFollowLerpAlpha(deltaSeconds, tuning.headingLerpSpeed) : 1
    follow.heading.lerp(desiredHeading, headingLerp)
    if (follow.heading.lengthSq() < 1e-6) {
      follow.heading.copy(desiredHeading)
    } else {
      follow.heading.normalize()
    }

    const headingForward = temp.cameraForward.copy(follow.heading)
    const headingRight = temp.cameraRight.crossVectors(worldUp, headingForward)
    if (headingRight.lengthSq() < 1e-6) {
      headingRight.set(1, 0, 0)
    } else {
      headingRight.normalize()
    }
    const headingUp = temp.cameraUp.copy(worldUp)

    const movingBackward = velocityWorld
      ? temp.planarVelocity.dot(follow.heading) < tuning.backwardDotThreshold
      : false
    const reversing = movingBackward
    follow.shouldHoldAnchorForReverse = reversing

    if (lookaheadActive) {
      if (reversing) {
        const lookaheadLength = temp.predictionOffset.length()
        if (lookaheadLength > 1e-6) {
          temp.tempVector.copy(follow.heading)
          if (temp.tempVector.lengthSq() < 1e-6) {
            temp.tempVector.copy(temp.planarVelocity)
          }
          if (temp.tempVector.lengthSq() < 1e-6) {
            temp.tempVector.set(0, 0, 1)
          }
          temp.tempVector.normalize().multiplyScalar(-lookaheadLength)
          temp.predictionOffset.copy(temp.tempVector)
        } else {
          temp.predictionOffset.set(0, 0, 0)
        }
      }
    } else {
      temp.predictionOffset.set(0, 0, 0)
    }

    const lookaheadAlpha = options.immediate || !follow.initialized
      ? 1
      : computeFollowLerpAlpha(deltaSeconds, tuning.lookaheadBlendSpeed)
    if (lookaheadAlpha >= 1) {
      follow.lookaheadOffset.copy(temp.predictionOffset)
    } else {
      follow.lookaheadOffset.lerp(temp.predictionOffset, lookaheadAlpha)
    }

    temp.followPredictedAnchor.add(follow.lookaheadOffset)
    follow.desiredAnchor.copy(temp.followPredictedAnchor)

    const anchorHoldActive = follow.anchorHoldSeconds > 0
    const baseAnchorAlpha = options.immediate || !follow.initialized
      ? 1
      : computeFollowLerpAlpha(deltaSeconds, tuning.anchorLerpSpeed)
    const anchorAlpha = anchorHoldActive ? 0 : baseAnchorAlpha
    if (anchorAlpha >= 1) {
      follow.currentAnchor.copy(follow.desiredAnchor)
    } else if (anchorAlpha > 0) {
      follow.currentAnchor.lerp(follow.desiredAnchor, anchorAlpha)
    }
    const anchorForCamera = follow.currentAnchor

    // local offset (defaults to behind + above) + clamping.
    if (!follow.hasLocalOffset) {
      follow.localOffset.set(0, placementWorking.heightOffset, -placementWorking.distance)
      follow.hasLocalOffset = true
    }
    enforceFollowBehind(follow, placementWorking, tuning)
    clampFollowLocalOffset(follow, placementWorking, tuning)

    // target offset.
    temp.followOffsetLocal.set(0, placementWorking.targetLift, placementWorking.targetForward)
    temp.followTargetOffsetWorld
      .copy(headingRight)
      .multiplyScalar(temp.followOffsetLocal.x)
      .addScaledVector(headingUp, temp.followOffsetLocal.y)
      .addScaledVector(headingForward, temp.followOffsetLocal.z)
    follow.desiredTarget.copy(anchorForCamera).add(temp.followTargetOffsetWorld)

    const mapControls = ctx.mapControls
    if (mapControls) {
      mapControls.target.copy(follow.desiredTarget)
      if (options.applyOrbitTween && onUpdateOrbitLookTween) {
        onUpdateOrbitLookTween(deltaSeconds)
      }
      mapControls.update?.()
    }

    const allowCameraAdjustments = !isTargetMoving
    let userAdjusted = allowCameraAdjustments && Boolean(options.followControlsDirty)
    if (allowCameraAdjustments && !userAdjusted && follow.initialized) {
      const deltaPosition = camera.position.distanceTo(follow.currentPosition)
      userAdjusted = deltaPosition > 1e-3
    }
    if (allowCameraAdjustments && userAdjusted) {
      temp.followWorldOffset.copy(camera.position).sub(anchorForCamera)
      follow.localOffset.set(
        temp.followWorldOffset.dot(headingRight),
        temp.followWorldOffset.dot(headingUp),
        temp.followWorldOffset.dot(headingForward),
      )
      follow.hasLocalOffset = true
      enforceFollowBehind(follow, placementWorking, tuning)
      clampFollowLocalOffset(follow, placementWorking, tuning)
    }

    temp.desiredWorldOffset
      .copy(headingRight)
      .multiplyScalar(follow.localOffset.x)
      .addScaledVector(headingUp, follow.localOffset.y)
      .addScaledVector(headingForward, follow.localOffset.z)
    follow.desiredPosition.copy(anchorForCamera).add(temp.desiredWorldOffset)

    const immediate = Boolean(options.immediate) || !follow.initialized
    if (immediate) {
      follow.currentPosition.copy(follow.desiredPosition)
      follow.currentTarget.copy(follow.desiredTarget)
      follow.initialized = true
    } else {
      const positionAlpha = computeFollowLerpAlpha(deltaSeconds, tuning.positionLerpSpeed)
      const targetAlpha = computeFollowLerpAlpha(deltaSeconds, tuning.targetLerpSpeed)
      follow.currentPosition.lerp(follow.desiredPosition, positionAlpha)
      follow.currentTarget.lerp(follow.desiredTarget, targetAlpha)
    }

    camera.position.copy(follow.currentPosition)
    camera.up.copy(headingUp)
    camera.lookAt(follow.currentTarget)

    follow.initialized = true
    return true
  }
}

function enforceFollowBehind(follow: CameraFollowState, placement: CameraFollowPlacement, tuning: CameraFollowTuning): void {
  const local = follow.localOffset
  const minBack = Math.max(placement.distance, tuning.distanceMin)
  const minHeight = Math.max(placement.heightOffset, tuning.heightMin)
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y) || !Number.isFinite(local.z)) {
    local.set(0, minHeight, -minBack)
    follow.hasLocalOffset = true
    return
  }
  let adjusted = false
  if (local.z > -minBack) {
    local.z = -minBack
    adjusted = true
  }
  if (local.y < minHeight) {
    local.y = minHeight
    adjusted = true
  }
  if (Math.abs(local.x) > 1e-4) {
    local.x = 0
    adjusted = true
  }
  if (adjusted) {
    follow.hasLocalOffset = true
  }
}

function clampFollowLocalOffset(follow: CameraFollowState, placement: CameraFollowPlacement | undefined, tuning: CameraFollowTuning): void {
  const local = follow.localOffset
  const length = local.length()
  const minDistance = tuning.distanceMin
  const maxDistance = tuning.distanceMax
  const fallbackHeight = placement ? Math.max(placement.heightOffset, tuning.heightMin) : tuning.heightMin
  const fallbackDistance = placement ? Math.max(placement.distance, tuning.distanceMin) : tuning.distanceMin
  if (!Number.isFinite(length) || length < 1e-3) {
    local.set(0, fallbackHeight, -Math.max(minDistance, fallbackDistance))
    return
  }
  const clamped = Math.min(maxDistance, Math.max(minDistance, length))
  if (Math.abs(clamped - length) > 1e-4) {
    local.multiplyScalar(clamped / length)
  }
}
