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
  localOffsetOverride?: THREE.Vector3 | null
  lockLocalOffset?: boolean
  smoothTargetForProgrammaticFollow?: boolean
}

export type CameraFollowContext = {
  camera: THREE.PerspectiveCamera | null
  mapControls?: { target: THREE.Vector3; update: () => void; enabled?: boolean; enablePan?: boolean; minDistance?: number; maxDistance?: number }
}

export type CameraFollowPoseConstraint = (params: {
  camera: THREE.PerspectiveCamera
  position: THREE.Vector3
  target: THREE.Vector3
  desiredPosition: THREE.Vector3
  desiredTarget: THREE.Vector3
  anchor: THREE.Vector3
  heading: THREE.Vector3
}) => void

type Vector3Like = { x: number; y: number; z: number }

type VelocityLike = Vector3Like & {
  lengthSquared?: () => number
  lengthSq?: () => number
}

export type FollowCameraMotionState = {
  velocity: THREE.Vector3
  velocityScratch: THREE.Vector3
  lastAnchor: THREE.Vector3
  hasSample: boolean
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

  positionLerpSpeed: 5.4,
  targetLerpSpeed: 5.8,
  headingLerpSpeed: 3.2,
  anchorLerpSpeed: 4.4,

  lookaheadTime: 0.08,
  lookaheadDistanceMax: 0.9,
  lookaheadMinSpeedSq: 1,
  lookaheadBlendStart: 0.7,
  lookaheadBlendSpeed: 2.2,

  backwardDotThreshold: -0.25,
  forwardReleaseDot: 0.25,

  collisionLockSpeedSq: 1.21,
  collisionDirectionDotThreshold: -0.35,
  collisionHoldTime: 0.8,

  motionSpeedThreshold: 1.2,
  motionSpeedFull: 7,
  motionBlendSpeed: 2.4,
  motionDistanceBoost: 0.14,
  motionHeightBoost: 0.08,

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

const FOLLOW_CAMERA_PLANAR_VELOCITY_DEAD_ZONE = 0.14
const FOLLOW_CAMERA_PLANAR_VELOCITY_DEAD_ZONE_SQ = FOLLOW_CAMERA_PLANAR_VELOCITY_DEAD_ZONE * FOLLOW_CAMERA_PLANAR_VELOCITY_DEAD_ZONE
const FOLLOW_CAMERA_ANCHOR_DEAD_ZONE = 0.03
const FOLLOW_CAMERA_ANCHOR_DEAD_ZONE_SQ = FOLLOW_CAMERA_ANCHOR_DEAD_ZONE * FOLLOW_CAMERA_ANCHOR_DEAD_ZONE
const FOLLOW_CAMERA_VELOCITY_FLIP_SPEED_SQ = 0.09
const FOLLOW_CAMERA_VELOCITY_LERP_SPEED = 8

export function createFollowCameraMotionState(): FollowCameraMotionState {
  return {
    velocity: new THREE.Vector3(),
    velocityScratch: new THREE.Vector3(),
    lastAnchor: new THREE.Vector3(),
    hasSample: false,
  }
}

export function resetFollowCameraMotionState(state: FollowCameraMotionState): void {
  state.velocity.set(0, 0, 0)
  state.velocityScratch.set(0, 0, 0)
  state.lastAnchor.set(0, 0, 0)
  state.hasSample = false
}

export type UpdateMotionAwareFollowCameraOptions = {
  controller: FollowCameraController
  motion: FollowCameraMotionState
  follow: CameraFollowState
  placement: CameraFollowPlacement
  anchorWorld: THREE.Vector3
  desiredForwardWorld: THREE.Vector3
  deltaSeconds: number
  ctx: CameraFollowContext
  velocityWorld?: VelocityLike | null
  worldUp?: THREE.Vector3
  distanceScale?: number
  tuning?: Partial<CameraFollowTuning>
  followControlsDirty?: boolean
  localOffsetOverride?: THREE.Vector3 | null
  lockLocalOffset?: boolean
  immediate?: boolean
  applyOrbitTween?: boolean
  smoothTargetForProgrammaticFollow?: boolean
  velocityLerpSpeed?: number
}

export function updateMotionAwareFollowCamera(options: UpdateMotionAwareFollowCameraOptions): boolean {
  const {
    controller,
    motion,
    follow,
    placement,
    anchorWorld,
    desiredForwardWorld,
    deltaSeconds,
    ctx,
    velocityWorld,
  } = options

  if (options.immediate) {
    motion.hasSample = false
    motion.velocity.set(0, 0, 0)
    motion.lastAnchor.copy(anchorWorld)
    motion.hasSample = true
  } else if (deltaSeconds > 0 && motion.hasSample) {
    const dt = Math.max(1e-6, Math.min(0.25, deltaSeconds))
    if (velocityWorld) {
      motion.velocityScratch.set(velocityWorld.x, velocityWorld.y, velocityWorld.z)
    } else {
      motion.velocityScratch.copy(anchorWorld).sub(motion.lastAnchor).multiplyScalar(1 / dt)
    }
    motion.velocityScratch.y = 0
    const sampleSpeedSq = (motion.velocityScratch.x * motion.velocityScratch.x) + (motion.velocityScratch.z * motion.velocityScratch.z)
    if (sampleSpeedSq <= FOLLOW_CAMERA_PLANAR_VELOCITY_DEAD_ZONE_SQ) {
      if (motion.velocity.lengthSq() <= FOLLOW_CAMERA_PLANAR_VELOCITY_DEAD_ZONE_SQ) {
        motion.velocity.set(0, 0, 0)
      } else {
        const releaseAlpha = computeFollowLerpAlpha(dt, Math.max(2, (options.velocityLerpSpeed ?? FOLLOW_CAMERA_VELOCITY_LERP_SPEED) * 0.5))
        motion.velocity.lerp(motion.velocityScratch.set(0, 0, 0), releaseAlpha)
      }
    } else {
      const smoothedSpeedSq = motion.velocity.x * motion.velocity.x + motion.velocity.z * motion.velocity.z
      const isLowSpeedDirectionFlip =
        smoothedSpeedSq > FOLLOW_CAMERA_PLANAR_VELOCITY_DEAD_ZONE_SQ
        && motion.velocity.dot(motion.velocityScratch) < 0
        && sampleSpeedSq < FOLLOW_CAMERA_VELOCITY_FLIP_SPEED_SQ
      const blendSpeed = isLowSpeedDirectionFlip
        ? Math.max(2.5, (options.velocityLerpSpeed ?? FOLLOW_CAMERA_VELOCITY_LERP_SPEED) * 0.5)
        : (options.velocityLerpSpeed ?? FOLLOW_CAMERA_VELOCITY_LERP_SPEED)
      motion.velocity.lerp(motion.velocityScratch, computeFollowLerpAlpha(dt, blendSpeed))
    }
  } else if (!motion.hasSample && deltaSeconds > 0) {
    motion.velocity.set(0, 0, 0)
    motion.hasSample = true
  }

  motion.lastAnchor.copy(anchorWorld)
  motion.hasSample = true

  return controller.update({
    follow,
    placement,
    anchorWorld,
    desiredForwardWorld,
    velocityWorld: motion.velocity,
    deltaSeconds,
    ctx,
    worldUp: options.worldUp,
    distanceScale: options.distanceScale,
    tuning: options.tuning,
    followControlsDirty: options.followControlsDirty,
    localOffsetOverride: options.localOffsetOverride,
    lockLocalOffset: options.lockLocalOffset,
    immediate: Boolean(options.immediate),
    applyOrbitTween: options.applyOrbitTween,
    smoothTargetForProgrammaticFollow: options.smoothTargetForProgrammaticFollow,
  })
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
    // 当前帧的跟随状态对象，用于保存相机跟随过程中的历史数据、插值结果与运行时标记。
    follow: CameraFollowState
    // 相机的摆放/布局配置，决定相机相对目标的位置、朝向与跟随方式。
    placement: CameraFollowPlacement
    // 被跟随目标的世界空间锚点位置，通常对应角色或物体的跟随中心。
    anchorWorld: THREE.Vector3
    // 目标期望朝向的世界空间方向，用于计算跟随视角和相机朝向参考。
    desiredForwardWorld: THREE.Vector3
    // 目标当前世界速度；可为空，存在时会参与前瞻预测与平滑跟随。
    velocityWorld?: VelocityLike | null
    // 本次更新的时间步长，所有插值、预测和过渡都依赖该值保证与帧率无关。
    deltaSeconds: number
    // 相机跟随运行上下文，包含相机实例及相关运行时环境。
    ctx: CameraFollowContext
    // 世界“上”方向，默认使用 Y 轴正方向，可用于适配不同坐标系。
    worldUp?: THREE.Vector3
    // 距离缩放因子，用于在不同场景尺度下统一跟随距离和速度表现。
    distanceScale?: number
    // 跟随调参项的局部覆盖值，仅覆盖显式传入的字段，其余保持默认。
    tuning?: Partial<CameraFollowTuning>
    // 标记跟随控制是否脏，便于在需要时触发重算或状态同步。
    followControlsDirty?: boolean
    // 本地偏移覆盖值；当外部需要强制指定局部偏移时由此传入。
    localOffsetOverride?: THREE.Vector3 | null
    // 是否锁定本地偏移，锁定后通常不再根据运行时结果动态改写。
    lockLocalOffset?: boolean
    // 是否立即生效；用于跳过平滑过渡，直接切换到目标状态。
    immediate?: boolean
    // 是否应用 orbit tween；控制是否启用轨道视角相关的过渡逻辑。
    applyOrbitTween?: boolean
    // 当没有 mapControls 或 mapControls 被禁用时，是否仍然对 target 使用平滑插值。
    smoothTargetForProgrammaticFollow?: boolean
  }): boolean {
    // 这里通过参数对象统一接收本次相机跟随更新所需的全部输入，
    // 便于在不同调用场景下按需传入：例如程序驱动、玩家控制，
    // 以及带有插值/约束的复杂跟随逻辑。
    const {
      follow,
      placement,
      anchorWorld,
      desiredForwardWorld,
      velocityWorld,
      deltaSeconds,
      ctx,
    } = options
    const camera = ctx.camera
    if (!camera) {
      // 没有相机实例时，无法完成任何跟随更新，直接返回失败。
      return false
    }

    // 将外部 tuning 与默认值合并，确保后续所有阈值/速度参数都有稳定的基础值。
    const tuning: CameraFollowTuning = { ...DEFAULT_CAMERA_FOLLOW_TUNING, ...(options.tuning ?? {}) }
    // 世界上方向量默认取 Y 轴正方向；允许外部覆盖以适配不同坐标系。
    const worldUp = options.worldUp ?? new THREE.Vector3(0, 1, 0)

    // 复用临时向量，避免每帧分配对象造成 GC 压力。
    const temp = this.temp

    // 复制 placement，后续会在此副本上做缩放/修正，避免污染调用方传入的数据。
    const placementWorking: CameraFollowPlacement = {
      distance: placement.distance,
      heightOffset: placement.heightOffset,
      targetLift: placement.targetLift,
      targetForward: placement.targetForward,
    }

    // distanceScale 用于整体拉伸跟随距离；非法或非正数时回退到 1。
    const distanceScale = Number.isFinite(options.distanceScale) && (options.distanceScale as number) > 0
      ? (options.distanceScale as number)
      : 1

    // 锚点预测：先以真实锚点为基础，再根据速度添加前向预判。
    temp.followPredictedAnchor.copy(anchorWorld)

    // 记录平面速度相关信息：平方值用于快速比较，速度值用于插值/预测。
    let planarSpeedSq = 0
    let planarSpeed = 0
    // forwardSpeed 表示相对目标朝向的前进速度，用于计算相机前向预瞄距离。
    let forwardSpeed = 0

    if (velocityWorld) {
      // 只考虑水平面速度，忽略垂直分量，避免上下跳动影响相机逻辑。
      temp.planarVelocity.set(velocityWorld.x, 0, velocityWorld.z)
      planarSpeedSq = temp.planarVelocity.lengthSq()
      planarSpeed = Math.sqrt(planarSpeedSq)
    } else {
      temp.planarVelocity.set(0, 0, 0)
    }

    // 小速度死区：低于阈值时视为静止，避免抖动和微小噪声引起的相机漂移。
    if (planarSpeedSq <= FOLLOW_CAMERA_PLANAR_VELOCITY_DEAD_ZONE_SQ) {
      temp.planarVelocity.set(0, 0, 0)
      planarSpeedSq = 0
      planarSpeed = 0
    }

    // 速度越高，越倾向于拉远相机并抬高视角；这里先计算平滑混合目标值。
    const motionSpeedRange = Math.max(1e-3, tuning.motionSpeedFull - tuning.motionSpeedThreshold)
    const motionBlendTarget = planarSpeed <= tuning.motionSpeedThreshold
      ? 0
      : Math.min(1, (planarSpeed - tuning.motionSpeedThreshold) / motionSpeedRange)
    // motionBlendAlpha 控制“当前混合值”朝目标值靠拢的速度；首帧或 immediate 时直接到位。
    const motionBlendAlpha = options.immediate || !follow.initialized
      ? 1
      : computeFollowLerpAlpha(deltaSeconds, tuning.motionBlendSpeed)
    if (motionBlendAlpha >= 1) {
      follow.motionDistanceBlend = motionBlendTarget
    } else {
      follow.motionDistanceBlend += (motionBlendTarget - follow.motionDistanceBlend) * motionBlendAlpha
    }

    // 基于运动状态缩放相机的距离、高度与目标偏移。
    const motionDistanceScale = 1 + follow.motionDistanceBlend * tuning.motionDistanceBoost
    placementWorking.distance = Math.min(
      tuning.distanceMax,
      Math.max(tuning.distanceMin, placementWorking.distance * distanceScale * motionDistanceScale),
    )
    const motionHeightScale = 1 + follow.motionDistanceBlend * tuning.motionHeightBoost
    placementWorking.heightOffset *= motionHeightScale
    placementWorking.targetLift *= motionHeightScale
    placementWorking.targetForward *= motionDistanceScale

    if (!follow.initialized) {
      // 初始化阶段：用目标朝向建立初始 heading，作为后续平滑插值的基准。
      follow.heading.copy(desiredForwardWorld)
      follow.heading.y = 0
      if (follow.heading.lengthSq() < 1e-6) {
        follow.heading.set(0, 0, 1)
      } else {
        follow.heading.normalize()
      }
      follow.lastVelocityDirection.set(0, 0, 0)
      follow.shouldHoldAnchorForReverse = false
      follow.motionDistanceBlend = 0
      follow.lookaheadOffset.set(0, 0, 0)
    }

    // 判断目标是否在明显移动；这会影响锚点更新策略和用户手动偏移的处理。
    const speedSq = velocityWorld ? readVelocityLengthSquared(velocityWorld) : 0
    const isTargetMoving = speedSq > tuning.movingSpeedSq

    // 计算本帧期望的朝向：优先使用外部给定朝向，否则退回到历史 heading。
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

    // 计算速度在当前朝向上的投影，用于判断前进/后退以及前瞻距离。
    if (planarSpeedSq > 0) {
      forwardSpeed = temp.planarVelocity.dot(desiredHeading)
      temp.tempVector.copy(temp.planarVelocity).normalize()
      follow.lastVelocityDirection.copy(temp.tempVector)
    } else {
      forwardSpeed = 0
      follow.lastVelocityDirection.set(0, 0, 0)
    }

    // heading 以插值方式平滑向目标朝向靠拢，减少相机瞬时转向造成的突兀感。
    const headingLerp = follow.initialized ? computeFollowLerpAlpha(deltaSeconds, tuning.headingLerpSpeed) : 1
    follow.heading.lerp(desiredHeading, headingLerp)
    if (follow.heading.lengthSq() < 1e-6) {
      follow.heading.copy(desiredHeading)
    } else {
      follow.heading.normalize()
    }

    // 构建相机局部坐标系：forward/right/up，用于把局部偏移转换到世界空间。
    const headingForward = temp.cameraForward.copy(follow.heading)
    const headingRight = temp.cameraRight.crossVectors(worldUp, headingForward)
    if (headingRight.lengthSq() < 1e-6) {
      headingRight.set(1, 0, 0)
    } else {
      headingRight.normalize()
    }
    const headingUp = temp.cameraUp.copy(worldUp)

    // 根据速度与阈值，计算前瞻（lookahead）混合量：越接近高速，前瞻越明显。
    const lookaheadBlendRange = Math.max(1e-3, Math.sqrt(tuning.lookaheadMinSpeedSq) - tuning.lookaheadBlendStart)
    const lookaheadBlend = planarSpeed > tuning.lookaheadBlendStart
      ? Math.min(1, (planarSpeed - tuning.lookaheadBlendStart) / lookaheadBlendRange)
      : 0
    // 前瞻距离以“前进速度 * 预瞄时间”为基础，再做上限裁剪，避免过度超前。
    const forwardLookaheadDistance = Math.max(0, forwardSpeed) * tuning.lookaheadTime * lookaheadBlend
    if (forwardLookaheadDistance > 1e-4) {
      temp.predictionOffset.copy(follow.heading)
      temp.predictionOffset.multiplyScalar(Math.min(tuning.lookaheadDistanceMax * lookaheadBlend, forwardLookaheadDistance))
    } else {
      temp.predictionOffset.set(0, 0, 0)
    }

    // 前瞻偏移本身也做一次插值，避免速度变化时锚点突然跳变。
    const lookaheadAlpha = options.immediate || !follow.initialized
      ? 1
      : computeFollowLerpAlpha(deltaSeconds, tuning.lookaheadBlendSpeed)
    if (lookaheadAlpha >= 1) {
      follow.lookaheadOffset.copy(temp.predictionOffset)
    } else {
      follow.lookaheadOffset.lerp(temp.predictionOffset, lookaheadAlpha)
    }

    // 组合真实锚点与前瞻偏移，得到本帧用于跟随的预测锚点。
    temp.followPredictedAnchor.add(follow.lookaheadOffset)
    if (!follow.initialized || options.immediate || isTargetMoving) {
      // 初始状态、强制立即更新或目标正在明显移动时，直接采用预测锚点。
      follow.desiredAnchor.copy(temp.followPredictedAnchor)
    } else {
      // 目标基本静止时，若预测锚点与当前锚点的差异很小，则保持现有锚点，避免微抖。
      temp.tempVector.copy(temp.followPredictedAnchor).sub(follow.currentAnchor)
      if (temp.tempVector.lengthSq() <= FOLLOW_CAMERA_ANCHOR_DEAD_ZONE_SQ) {
        follow.desiredAnchor.copy(follow.currentAnchor)
      } else {
        follow.desiredAnchor.copy(temp.followPredictedAnchor)
      }
    }

    // 锚点本身再做一次平滑插值，让相机追随更柔和。
    const baseAnchorAlpha = options.immediate || !follow.initialized
      ? 1
      : computeFollowLerpAlpha(deltaSeconds, tuning.anchorLerpSpeed)
    if (baseAnchorAlpha >= 1) {
      follow.currentAnchor.copy(follow.desiredAnchor)
    } else if (baseAnchorAlpha > 0) {
      follow.currentAnchor.lerp(follow.desiredAnchor, baseAnchorAlpha)
    }
    const anchorForCamera = follow.currentAnchor

    // localOffset 代表相机相对锚点的局部偏移，通常表现为“后方 + 上方”。
    const lockLocalOffset = Boolean(options.lockLocalOffset)
    if (options.localOffsetOverride) {
      // 若外部明确指定局部偏移，优先使用外部值，并标记为已初始化。
      follow.localOffset.copy(options.localOffsetOverride)
      follow.hasLocalOffset = true
    } else if (!follow.hasLocalOffset) {
      // 首次没有本地偏移时，使用默认值：位于目标后方并略高于目标。
      follow.localOffset.set(0, placementWorking.heightOffset, -placementWorking.distance)
      follow.hasLocalOffset = true
    }
    if (!lockLocalOffset) {
      // 对局部偏移做“在目标后方”和“高度下限”的约束，保证相机不会跑到不合理位置。
      enforceFollowBehind(follow, placementWorking, tuning)
      clampFollowLocalOffset(follow, placementWorking, tuning)
    }

    // 目标点偏移：通常用于让相机看向锚点上方或前方的一小段空间。
    temp.followOffsetLocal.set(0, placementWorking.targetLift, placementWorking.targetForward)
    temp.followTargetOffsetWorld
      .copy(headingRight)
      .multiplyScalar(temp.followOffsetLocal.x)
      .addScaledVector(headingUp, temp.followOffsetLocal.y)
      .addScaledVector(headingForward, temp.followOffsetLocal.z)
    follow.desiredTarget.copy(anchorForCamera).add(temp.followTargetOffsetWorld)

    // 如果存在地图控制器，则需要考虑用户是否正在通过控制器调整相机。
    const mapControls = ctx.mapControls
    const controlsEnabled = Boolean(mapControls?.enabled)
    // 纯程序化跟随：没有控制器或控制器禁用时，完全由本逻辑驱动相机目标。
    const pureProgrammaticFollow = !mapControls || !controlsEnabled
    // 只有在目标静止且控制器开启时，才允许将用户操作视为相机偏移调整。
    const allowCameraAdjustments = !isTargetMoving && controlsEnabled
    let userAdjusted = allowCameraAdjustments && Boolean(options.followControlsDirty)
    if (allowCameraAdjustments && !userAdjusted && follow.initialized) {
      // 通过当前相机位置与已记录位置的差值，判断用户是否手动拖动/修改了相机。
      const deltaPosition = camera.position.distanceTo(follow.currentPosition)
      userAdjusted = deltaPosition > 1e-3
    }
    if (allowCameraAdjustments && userAdjusted && !lockLocalOffset) {
      // 将世界空间下的相机偏移转换回局部空间，用于保存用户当前的自定义相对视角。
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

    // 将局部偏移重新投影回世界空间，计算相机最终的目标位置。
    temp.desiredWorldOffset
      .copy(headingRight)
      .multiplyScalar(follow.localOffset.x)
      .addScaledVector(headingUp, follow.localOffset.y)
      .addScaledVector(headingForward, follow.localOffset.z)
    follow.desiredPosition.copy(anchorForCamera).add(temp.desiredWorldOffset)

    // immediate：首次初始化或强制立即更新时，直接把当前状态推到目标状态。
    const immediate = Boolean(options.immediate) || !follow.initialized
    if (immediate) {
      follow.currentPosition.copy(follow.desiredPosition)
      follow.currentTarget.copy(follow.desiredTarget)
      follow.initialized = true
    } else {
      const positionAlpha = computeFollowLerpAlpha(deltaSeconds, tuning.positionLerpSpeed)
      follow.currentPosition.lerp(follow.desiredPosition, positionAlpha)
      if (pureProgrammaticFollow && !options.smoothTargetForProgrammaticFollow) {
        follow.currentTarget.copy(follow.desiredTarget)
      } else {
        const targetAlpha = computeFollowLerpAlpha(deltaSeconds, tuning.targetLerpSpeed)
        follow.currentTarget.lerp(follow.desiredTarget, targetAlpha)
      }
    }

    // 将计算出的结果写回相机，并执行 lookAt。

    camera.position.copy(follow.currentPosition)
    camera.up.copy(headingUp)
    camera.lookAt(follow.currentTarget)
    
    if (mapControls) {
      // 同步控制器目标，确保控制器与当前相机状态保持一致。
      mapControls.target.copy(follow.currentTarget)
    }

    // 标记本帧已完成初始化，后续将进入平滑跟随模式。
    follow.initialized = true
    return true
  }
}

function enforceFollowBehind(
  follow: CameraFollowState,
  placement: CameraFollowPlacement,
  tuning: CameraFollowTuning,
): void {
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
