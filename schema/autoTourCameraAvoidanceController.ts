import * as THREE from 'three'
import {
  computeFollowLerpAlpha,
  createCameraFollowState,
  type CameraFollowPlacement,
  type CameraFollowState,
  resetCameraFollowState,
} from './followCameraController'
import { projectPointToPolyline, samplePolylineAtS, type PolylineMetricData } from './polylineProgress'

export type AutoTourCameraRouteData = {
  routeNodeId: string
  points: THREE.Vector3[]
  dock: boolean[]
  polylineData3d: PolylineMetricData
  waypointArcLengths3d: number[]
}

export type AutoTourCameraCandidate = {
  id: string
  position: THREE.Vector3
  target: THREE.Vector3
  occlusionScore: number
  routeScore: number
  totalScore: number
}

export type AutoTourCameraAvoidanceRoots = {
  sceneGraphRoot: THREE.Object3D | null | undefined
  instancedMeshGroup: THREE.Object3D | null | undefined
}

export type AutoTourCameraOcclusionParams = {
  candidatePosition: THREE.Vector3
  candidateTarget: THREE.Vector3
  ignoreNodeIds: readonly string[]
  roots: AutoTourCameraAvoidanceRoots
}

export type AutoTourCameraAvoidanceUpdateParams = {
  nodeId: string
  routeData: AutoTourCameraRouteData
  anchorWorld: THREE.Vector3
  desiredForwardWorld: THREE.Vector3
  velocityWorld: THREE.Vector3
  up: THREE.Vector3
  placement: CameraFollowPlacement
  roots: AutoTourCameraAvoidanceRoots
  occlusionIgnoreNodeIds: readonly string[]
  deltaSeconds: number
  immediate?: boolean
}

export type AutoTourCameraAvoidanceUpdateResult = {
  routeProgress: number
  routeDistanceToEnd: number
  lookaheadDistance: number
  turnSeverity: number
  turnSign: number
  dockBlend: number
  nearEndBlend: number
  motionBlend: number
  wallProbeScore: number
  wallProbeSide: -1 | 0 | 1
  candidateGap: number
  narrowSignal: number
  wallSignal: number
  chosenCandidate: AutoTourCameraCandidate
  currentCandidate: AutoTourCameraCandidate
  bestCandidate: AutoTourCameraCandidate
  secondCandidate: AutoTourCameraCandidate
  candidateId: string
  currentPosition: THREE.Vector3
  currentTarget: THREE.Vector3
  desiredPosition: THREE.Vector3
  desiredTarget: THREE.Vector3
  narrowBlend: number
  wallBlend: number
  wallBiasSide: -1 | 0 | 1
}

const AUTO_TOUR_CAMERA_FOLLOW_OCCLUSION_MARGIN = 0.28
const AUTO_TOUR_CAMERA_FOLLOW_MIN_SWITCH_MS = 320
const AUTO_TOUR_CAMERA_FOLLOW_POSITION_LERP_SPEED = 4.8
const AUTO_TOUR_CAMERA_FOLLOW_TARGET_LERP_SPEED = 6.2
const AUTO_TOUR_CAMERA_FOLLOW_MIN_DISTANCE_GAIN = 0.78
const AUTO_TOUR_CAMERA_FOLLOW_MAX_DISTANCE_GAIN = 1.25
const AUTO_TOUR_CAMERA_FOLLOW_MAX_HEIGHT_GAIN = 1.18
const AUTO_TOUR_CAMERA_FOLLOW_SIDE_GAIN = 0.45
const AUTO_TOUR_CAMERA_FOLLOW_LOOKAHEAD_DISTANCE_MIN = 4
const AUTO_TOUR_CAMERA_FOLLOW_LOOKAHEAD_DISTANCE_MAX = 14
const AUTO_TOUR_CAMERA_FOLLOW_LOOKAHEAD_DISTANCE_SPEED_GAIN = 1.6
const AUTO_TOUR_CAMERA_FOLLOW_NARROW_ENTER_SIGNAL = 0.58
const AUTO_TOUR_CAMERA_FOLLOW_NARROW_EXIT_SIGNAL = 0.28
const AUTO_TOUR_CAMERA_FOLLOW_NARROW_BLEND_ATTACK = 4.6
const AUTO_TOUR_CAMERA_FOLLOW_NARROW_BLEND_RELEASE = 1.15
const AUTO_TOUR_CAMERA_FOLLOW_WALL_ENTER_SIGNAL = 0.22
const AUTO_TOUR_CAMERA_FOLLOW_WALL_EXIT_SIGNAL = 0.1
const AUTO_TOUR_CAMERA_FOLLOW_WALL_BLEND_ATTACK = 5.2
const AUTO_TOUR_CAMERA_FOLLOW_WALL_BLEND_RELEASE = 0.95
const AUTO_TOUR_CAMERA_FOLLOW_WALL_SIDE_SHIFT_RATIO = 0.16
const AUTO_TOUR_CAMERA_FOLLOW_WALL_TARGET_SHIFT_RATIO = 0.1
const AUTO_TOUR_CAMERA_FOLLOW_WALL_YAW_MAX_DEG = 8

const autoTourCameraOcclusionRaycaster = new THREE.Raycaster()

function resolveNodeIdFromObject(object: THREE.Object3D | null | undefined): string | null {
  const current = object ?? null
  return typeof current?.userData?.nodeId === 'string' ? current.userData.nodeId : null
}

function cloneCandidate(candidate: AutoTourCameraCandidate): AutoTourCameraCandidate {
  return {
    id: candidate.id,
    position: candidate.position.clone(),
    target: candidate.target.clone(),
    occlusionScore: candidate.occlusionScore,
    routeScore: candidate.routeScore,
    totalScore: candidate.totalScore,
  }
}

export class AutoTourCameraAvoidanceController {
  private readonly followState: CameraFollowState = createCameraFollowState()
  private readonly lastAnchor = new THREE.Vector3()
  private readonly velocityScratch = new THREE.Vector3()
  private readonly forwardScratch = new THREE.Vector3()
  private readonly upScratch = new THREE.Vector3(0, 1, 0)
  private readonly lookaheadPointScratch = new THREE.Vector3()
  private readonly nearPointScratch = new THREE.Vector3()
  private readonly farPointScratch = new THREE.Vector3()
  private readonly tangentScratch = new THREE.Vector3()
  private readonly tangentNextScratch = new THREE.Vector3()
  private readonly rightScratch = new THREE.Vector3()
  private readonly wallProbeOriginScratch = new THREE.Vector3()
  private readonly wallProbeTargetScratch = new THREE.Vector3()
  private readonly candidatePositionScratch = new THREE.Vector3()
  private readonly candidateTargetScratch = new THREE.Vector3()
  private readonly desiredPositionScratch = new THREE.Vector3()
  private readonly desiredTargetScratch = new THREE.Vector3()
  private readonly currentPositionScratch = new THREE.Vector3()
  private readonly currentTargetScratch = new THREE.Vector3()
  private candidateId = 'route'
  private candidateSwitchAtMs = 0
  private narrowLatched = false
  private narrowBlend = 0
  private narrowSwitchAtMs = 0
  private wallLatched = false
  private wallBlend = 0
  private wallSide: -1 | 0 | 1 = 0
  private wallSwitchAtMs = 0
  private hasSample = false

  reset(): void {
    resetCameraFollowState(this.followState)
    this.lastAnchor.set(0, 0, 0)
    this.velocityScratch.set(0, 0, 0)
    this.forwardScratch.set(0, 0, 0)
    this.candidateId = 'route'
    this.candidateSwitchAtMs = 0
    this.narrowLatched = false
    this.narrowBlend = 0
    this.narrowSwitchAtMs = 0
    this.wallLatched = false
    this.wallBlend = 0
    this.wallSide = 0
    this.wallSwitchAtMs = 0
    this.hasSample = false
  }

  seedFromPose(params: {
    cameraPosition: THREE.Vector3
    cameraTarget: THREE.Vector3
    anchorWorld: THREE.Vector3
    forwardWorld: THREE.Vector3
    velocityWorld?: THREE.Vector3 | null
  }): void {
    this.reset()
    this.followState.currentPosition.copy(params.cameraPosition)
    this.followState.currentTarget.copy(params.cameraTarget)
    this.followState.desiredPosition.copy(params.cameraPosition)
    this.followState.desiredTarget.copy(params.cameraTarget)
    this.followState.currentAnchor.copy(params.anchorWorld)
    this.followState.desiredAnchor.copy(params.anchorWorld)
    this.followState.heading.copy(params.forwardWorld)
    if (this.followState.heading.lengthSq() < 1e-8) {
      this.followState.heading.set(0, 0, 1)
    } else {
      this.followState.heading.y = 0
      if (this.followState.heading.lengthSq() < 1e-8) {
        this.followState.heading.set(0, 0, 1)
      } else {
        this.followState.heading.normalize()
      }
    }
    this.followState.lastVelocityDirection.copy(params.velocityWorld ?? params.forwardWorld)
    this.followState.lastVelocityDirection.y = 0
    this.followState.initialized = true
    this.lastAnchor.copy(params.anchorWorld)
    this.hasSample = true
  }

  computeOcclusionScore(params: AutoTourCameraOcclusionParams): number {
    const roots: THREE.Object3D[] = []
    if (params.roots.sceneGraphRoot) {
      roots.push(params.roots.sceneGraphRoot)
    }
    if (params.roots.instancedMeshGroup) {
      roots.push(params.roots.instancedMeshGroup)
    }
    if (!roots.length) {
      return 0
    }
    const dx = params.candidateTarget.x - params.candidatePosition.x
    const dy = params.candidateTarget.y - params.candidatePosition.y
    const dz = params.candidateTarget.z - params.candidatePosition.z
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (!Number.isFinite(distance) || distance <= 1e-4) {
      return 0
    }
    autoTourCameraOcclusionRaycaster.set(
      params.candidatePosition,
      new THREE.Vector3(dx / distance, dy / distance, dz / distance),
    )
    autoTourCameraOcclusionRaycaster.far = distance
    const intersections: THREE.Intersection[] = []
    for (const root of roots) {
      root.updateWorldMatrix(true, true)
      intersections.push(...autoTourCameraOcclusionRaycaster.intersectObject(root, true))
    }
    let score = 0
    for (const hit of intersections) {
      if (!hit.object?.visible) {
        continue
      }
      const hitNodeId = resolveNodeIdFromObject(hit.object)
      if (hitNodeId && params.ignoreNodeIds.includes(hitNodeId)) {
        continue
      }
      if (!Number.isFinite(hit.distance) || hit.distance <= 0) {
        continue
      }
      if (hit.distance >= distance - AUTO_TOUR_CAMERA_FOLLOW_OCCLUSION_MARGIN) {
        continue
      }
      score += 1 + Math.max(0, 1 - hit.distance / distance)
    }
    return score
  }

  formatModeLabel(turnSeverity: number, occlusionScore: number, candidateId: string): string {
    if (occlusionScore > 0.6) {
      return `avoid:${candidateId}`
    }
    if (turnSeverity > 0.55) {
      return `curve:${candidateId}`
    }
    return `route:${candidateId}`
  }

  private selectCandidates(params: {
    anchor: THREE.Vector3
    tangent: THREE.Vector3
    right: THREE.Vector3
    up: THREE.Vector3
    placement: CameraFollowPlacement
    turnSeverity: number
    preferredSide: -1 | 0 | 1
    narrowBlendPreview: number
    occlusionIgnoreNodeIds: readonly string[]
    roots: AutoTourCameraAvoidanceRoots
  }): AutoTourCameraCandidate[] {
    const narrowBlendPreview = params.narrowBlendPreview
    const baseDistance = params.placement.distance
    const baseHeight = params.placement.heightOffset
    const baseTargetLift = params.placement.targetLift
    const baseTargetForward = params.placement.targetForward
    const sideShift = Math.max(
      0.28,
      params.placement.distance * AUTO_TOUR_CAMERA_FOLLOW_SIDE_GAIN * (0.45 + params.turnSeverity * 0.9) * (1 - narrowBlendPreview * 0.35),
    )

    const candidateSpecs: Array<{
      id: string
      side: number
      distanceScale: number
      heightScale: number
      targetScale: number
      forwardScale: number
    }> = [
      { id: 'route', side: 0, distanceScale: 0.98, heightScale: 1.1, targetScale: 0.96, forwardScale: 0.92 },
      { id: 'curve-high', side: 0, distanceScale: 1.02, heightScale: 1.26, targetScale: 1.02, forwardScale: 0.96 },
      { id: 'curve-left', side: 1, distanceScale: 0.96, heightScale: 1.0, targetScale: 0.96, forwardScale: 0.9 },
      { id: 'curve-right', side: -1, distanceScale: 0.96, heightScale: 1.0, targetScale: 0.96, forwardScale: 0.9 },
    ]
    if (narrowBlendPreview > 0.12 || params.turnSeverity > 0.65) {
      candidateSpecs.push({
        id: 'narrow-high',
        side: 0,
        distanceScale: 1.08 + narrowBlendPreview * 0.04,
        heightScale: 1.42 + narrowBlendPreview * 0.12,
        targetScale: 1.02,
        forwardScale: 0.94,
      })
    }

    const candidates: AutoTourCameraCandidate[] = []
    for (const spec of candidateSpecs) {
      this.candidatePositionScratch
        .copy(params.anchor)
        .addScaledVector(params.tangent, -baseDistance * spec.distanceScale)
        .addScaledVector(params.up, baseHeight * spec.heightScale)
      this.candidatePositionScratch.addScaledVector(params.right, sideShift * spec.side)
      this.candidateTargetScratch
        .copy(params.anchor)
        .addScaledVector(params.tangent, baseTargetForward * spec.forwardScale)
        .addScaledVector(params.up, baseTargetLift * spec.targetScale)
      const occlusionScore = this.computeOcclusionScore({
        candidatePosition: this.candidatePositionScratch,
        candidateTarget: this.candidateTargetScratch,
        ignoreNodeIds: params.occlusionIgnoreNodeIds,
        roots: params.roots,
      })
      const routeScore =
        Math.abs(spec.side) * 0.18
        + (params.preferredSide !== 0 && spec.side === params.preferredSide ? -0.08 : 0)
        + Math.abs(spec.distanceScale - 1) * 0.22
        + Math.abs(spec.heightScale - 1) * 0.16
        + Math.abs(spec.targetScale - 1) * 0.08
        + (spec.id === 'route' ? -0.28 : 0)
        + (spec.id === 'narrow-high' ? -narrowBlendPreview * 0.18 : 0)
      candidates.push({
        id: spec.id,
        position: this.candidatePositionScratch.clone(),
        target: this.candidateTargetScratch.clone(),
        occlusionScore,
        routeScore,
        totalScore: occlusionScore * 4.5 + routeScore,
      })
    }
    candidates.sort((a, b) => a.totalScore - b.totalScore)
    return candidates
  }

  update(params: AutoTourCameraAvoidanceUpdateParams): AutoTourCameraAvoidanceUpdateResult {
    const deltaSeconds = Math.max(0, params.deltaSeconds)
    if (deltaSeconds > 0 && this.hasSample) {
      this.velocityScratch
        .copy(params.anchorWorld)
        .sub(this.lastAnchor)
        .multiplyScalar(1 / Math.max(1e-6, deltaSeconds))
      const alpha = computeFollowLerpAlpha(deltaSeconds, 8)
      this.followState.lastVelocityDirection.lerp(this.velocityScratch, alpha)
    } else {
      this.followState.lastVelocityDirection.set(0, 0, 0)
    }
    this.lastAnchor.copy(params.anchorWorld)
    this.hasSample = true

    if (this.followState.lastVelocityDirection.lengthSq() > 1e-6) {
      this.forwardScratch.set(
        this.followState.lastVelocityDirection.x,
        0,
        this.followState.lastVelocityDirection.z,
      )
    } else {
      this.forwardScratch.copy(params.desiredForwardWorld)
      this.forwardScratch.y = 0
    }
    if (this.forwardScratch.lengthSq() < 1e-8) {
      this.forwardScratch.set(0, 0, 1)
    } else {
      this.forwardScratch.normalize()
    }

    const project = projectPointToPolyline(
      params.routeData.points,
      params.routeData.polylineData3d,
      params.anchorWorld,
      this.nearPointScratch,
    )
    const routeLength = Math.max(1e-6, params.routeData.polylineData3d.totalLength)
    const routeProgress = THREE.MathUtils.clamp(project.s / routeLength, 0, 1)
    const routeDistanceToEnd = Math.max(0, routeLength - project.s)
    const lookaheadDistance = Math.max(
      AUTO_TOUR_CAMERA_FOLLOW_LOOKAHEAD_DISTANCE_MIN,
      Math.min(
        AUTO_TOUR_CAMERA_FOLLOW_LOOKAHEAD_DISTANCE_MAX,
        AUTO_TOUR_CAMERA_FOLLOW_LOOKAHEAD_DISTANCE_MIN
          + this.followState.lastVelocityDirection.length() * AUTO_TOUR_CAMERA_FOLLOW_LOOKAHEAD_DISTANCE_SPEED_GAIN
          + routeProgress * 1.5,
      ),
    )
    const narrowBlendPreview = this.narrowBlend
    const narrowLookaheadDistance = Math.min(
      AUTO_TOUR_CAMERA_FOLLOW_LOOKAHEAD_DISTANCE_MAX,
      lookaheadDistance + narrowBlendPreview * 3.2,
    )
    samplePolylineAtS(
      params.routeData.points,
      params.routeData.polylineData3d,
      project.s + narrowLookaheadDistance,
      this.lookaheadPointScratch,
    )
    samplePolylineAtS(
      params.routeData.points,
      params.routeData.polylineData3d,
      project.s + Math.min(routeLength, narrowLookaheadDistance * 0.55 + 1.2),
      this.nearPointScratch,
    )
    samplePolylineAtS(
      params.routeData.points,
      params.routeData.polylineData3d,
      project.s + Math.min(routeLength, narrowLookaheadDistance + 4),
      this.farPointScratch,
    )

    this.tangentScratch.copy(this.nearPointScratch).sub(params.anchorWorld)
    this.tangentScratch.y = 0
    if (this.tangentScratch.lengthSq() < 1e-8) {
      this.tangentScratch.copy(this.lookaheadPointScratch).sub(params.anchorWorld)
      this.tangentScratch.y = 0
    }
    if (this.tangentScratch.lengthSq() < 1e-8) {
      this.tangentScratch.set(0, 0, 1)
    } else {
      this.tangentScratch.normalize()
    }

    this.tangentNextScratch.copy(this.farPointScratch).sub(this.nearPointScratch)
    this.tangentNextScratch.y = 0
    if (this.tangentNextScratch.lengthSq() < 1e-8) {
      this.tangentNextScratch.copy(this.tangentScratch)
    } else {
      this.tangentNextScratch.normalize()
    }

    this.upScratch.copy(params.up)
    this.rightScratch.crossVectors(this.upScratch, this.tangentScratch)
    if (this.rightScratch.lengthSq() < 1e-8) {
      this.rightScratch.set(1, 0, 0)
    } else {
      this.rightScratch.normalize()
    }

    this.wallProbeOriginScratch.copy(this.lookaheadPointScratch)
    this.wallProbeOriginScratch.addScaledVector(this.upScratch, params.placement.heightOffset * 0.35 + 0.8)
    const wallProbeDistance = THREE.MathUtils.clamp(params.placement.distance * 0.42, 1.8, 5.4)
    this.wallProbeTargetScratch
      .copy(this.wallProbeOriginScratch)
      .addScaledVector(this.rightScratch, -wallProbeDistance)
    const wallProbeLeftScore = this.computeOcclusionScore({
      candidatePosition: this.wallProbeOriginScratch,
      candidateTarget: this.wallProbeTargetScratch,
      ignoreNodeIds: params.occlusionIgnoreNodeIds,
      roots: params.roots,
    })
    this.wallProbeTargetScratch
      .copy(this.wallProbeOriginScratch)
      .addScaledVector(this.rightScratch, wallProbeDistance)
    const wallProbeRightScore = this.computeOcclusionScore({
      candidatePosition: this.wallProbeOriginScratch,
      candidateTarget: this.wallProbeTargetScratch,
      ignoreNodeIds: params.occlusionIgnoreNodeIds,
      roots: params.roots,
    })
    const wallProbeScore = Math.max(wallProbeLeftScore, wallProbeRightScore)
    let wallProbeSide: -1 | 0 | 1 = 0
    if (wallProbeLeftScore > wallProbeRightScore) {
      wallProbeSide = 1
    } else if (wallProbeRightScore > wallProbeLeftScore) {
      wallProbeSide = -1
    }

    const turnDot = THREE.MathUtils.clamp(this.tangentScratch.dot(this.tangentNextScratch), -1, 1)
    const turnSeverity = THREE.MathUtils.clamp((1 - turnDot) * 0.5, 0, 1)
    const rawTurnSign = this.tangentScratch.x * this.tangentNextScratch.z - this.tangentScratch.z * this.tangentNextScratch.x
    const turnSign: -1 | 0 | 1 = rawTurnSign > 0 ? 1 : rawTurnSign < 0 ? -1 : 0
    const dockAheadDistance = (() => {
      for (let index = 0; index < params.routeData.waypointArcLengths3d.length; index += 1) {
        const s = params.routeData.waypointArcLengths3d[index] ?? 0
        if (s > project.s && params.routeData.dock[index] === true) {
          return s - project.s
        }
      }
      return Number.POSITIVE_INFINITY
    })()
    const dockBlend = Number.isFinite(dockAheadDistance)
      ? THREE.MathUtils.clamp(1 - dockAheadDistance / Math.max(4, lookaheadDistance * 1.5), 0, 1)
      : 0
    const nearEndBlend = routeDistanceToEnd <= 1e-6
      ? 1
      : THREE.MathUtils.clamp(1 - routeDistanceToEnd / Math.max(6, lookaheadDistance * 2), 0, 1)
    const motionBlend = THREE.MathUtils.clamp(this.followState.lastVelocityDirection.length() / Math.max(1, params.placement.distance), 0, 1)

    const baseDistance = params.placement.distance * THREE.MathUtils.clamp(
      1 + motionBlend * 0.08 + turnSeverity * 0.35 + dockBlend * 0.18 + nearEndBlend * 0.2 + narrowBlendPreview * 0.24,
      AUTO_TOUR_CAMERA_FOLLOW_MIN_DISTANCE_GAIN,
      AUTO_TOUR_CAMERA_FOLLOW_MAX_DISTANCE_GAIN,
    )
    const baseHeight = params.placement.heightOffset * THREE.MathUtils.clamp(
      0.92 + turnSeverity * 0.16 + dockBlend * 0.08 + nearEndBlend * 0.12 + narrowBlendPreview * 0.4,
      0.82,
      AUTO_TOUR_CAMERA_FOLLOW_MAX_HEIGHT_GAIN,
    )
    const baseTargetLift = params.placement.targetLift * (0.86 + turnSeverity * 0.08 + dockBlend * 0.06 + narrowBlendPreview * 0.14)
    const baseTargetForward = params.placement.targetForward * (1 + motionBlend * 0.12 + nearEndBlend * 0.1 + narrowBlendPreview * 0.12)
    const preferredSide: -1 | 0 | 1 = turnSign === 0 ? 0 : (turnSign > 0 ? -1 : 1)

    const candidates = this.selectCandidates({
      anchor: params.anchorWorld,
      tangent: this.tangentScratch,
      right: this.rightScratch,
      up: this.upScratch,
      placement: {
        distance: baseDistance,
        heightOffset: baseHeight,
        targetLift: baseTargetLift,
        targetForward: baseTargetForward,
      },
      turnSeverity,
      preferredSide,
      narrowBlendPreview,
      occlusionIgnoreNodeIds: params.occlusionIgnoreNodeIds,
      roots: params.roots,
    })
    const currentCandidate = candidates.find((candidate) => candidate.id === this.candidateId) ?? candidates[0]!
    const bestCandidate = candidates[0]!
    const secondCandidate = candidates[1] ?? bestCandidate
    const candidateGap = Math.max(0, secondCandidate.totalScore - bestCandidate.totalScore)
    const narrowSignal = THREE.MathUtils.clamp(
      (bestCandidate.occlusionScore * 0.55)
      + (THREE.MathUtils.clamp(1 - candidateGap / 0.8, 0, 1) * 0.3)
      + (turnSeverity * 0.12)
      + (dockBlend * 0.08),
      0,
      1,
    )
    const now = Date.now()
    if (!this.narrowLatched && narrowSignal >= AUTO_TOUR_CAMERA_FOLLOW_NARROW_ENTER_SIGNAL) {
      this.narrowLatched = true
      this.narrowSwitchAtMs = now
    } else if (
      this.narrowLatched
      && narrowSignal <= AUTO_TOUR_CAMERA_FOLLOW_NARROW_EXIT_SIGNAL
      && now - this.narrowSwitchAtMs >= 450
    ) {
      this.narrowLatched = false
      this.narrowSwitchAtMs = now
    }
    const narrowTargetBlend = this.narrowLatched ? Math.max(narrowSignal, 0.55) : 0
    const narrowBlendSpeed = this.narrowLatched
      ? AUTO_TOUR_CAMERA_FOLLOW_NARROW_BLEND_ATTACK
      : AUTO_TOUR_CAMERA_FOLLOW_NARROW_BLEND_RELEASE
    this.narrowBlend += (narrowTargetBlend - this.narrowBlend) * computeFollowLerpAlpha(deltaSeconds, narrowBlendSpeed)
    this.narrowBlend = THREE.MathUtils.clamp(this.narrowBlend, 0, 1)

    const wallSignal = THREE.MathUtils.clamp(
      (wallProbeScore * 0.45)
      + (narrowBlendPreview * 0.1)
      + (turnSeverity * 0.05),
      0,
      1,
    )
    if (!this.wallLatched && wallSignal >= AUTO_TOUR_CAMERA_FOLLOW_WALL_ENTER_SIGNAL) {
      this.wallLatched = true
      this.wallSwitchAtMs = now
      this.wallSide = wallProbeSide
    } else if (
      this.wallLatched
      && wallSignal <= AUTO_TOUR_CAMERA_FOLLOW_WALL_EXIT_SIGNAL
      && now - this.wallSwitchAtMs >= 420
    ) {
      this.wallLatched = false
      this.wallSwitchAtMs = now
      this.wallSide = 0
    } else if (this.wallLatched && wallProbeSide !== 0) {
      this.wallSide = wallProbeSide
    }
    const wallTargetBlend = this.wallLatched ? Math.max(wallSignal, 0.35) : 0
    const wallBlendSpeed = this.wallLatched
      ? AUTO_TOUR_CAMERA_FOLLOW_WALL_BLEND_ATTACK
      : AUTO_TOUR_CAMERA_FOLLOW_WALL_BLEND_RELEASE
    this.wallBlend += (wallTargetBlend - this.wallBlend) * computeFollowLerpAlpha(deltaSeconds, wallBlendSpeed)
    this.wallBlend = THREE.MathUtils.clamp(this.wallBlend, 0, 1)

    const canSwitch = now - this.candidateSwitchAtMs >= AUTO_TOUR_CAMERA_FOLLOW_MIN_SWITCH_MS
    const switchThreshold = 0.18 + turnSeverity * 0.2 + dockBlend * 0.12
    const shouldHoldCurrent =
      currentCandidate
      && currentCandidate.id !== bestCandidate.id
      && (!canSwitch || currentCandidate.totalScore <= bestCandidate.totalScore + switchThreshold)
    const chosenCandidate = shouldHoldCurrent ? currentCandidate : bestCandidate
    if (chosenCandidate.id !== this.candidateId) {
      this.candidateId = chosenCandidate.id
      this.candidateSwitchAtMs = now
    }

    this.desiredPositionScratch.copy(chosenCandidate.position)
    this.desiredTargetScratch.copy(chosenCandidate.target)
    const wallBiasSide = this.wallLatched ? this.wallSide : wallProbeSide
    const wallYawOffset = THREE.MathUtils.degToRad(AUTO_TOUR_CAMERA_FOLLOW_WALL_YAW_MAX_DEG) * this.wallBlend * wallBiasSide
    if (wallBiasSide !== 0 && this.wallBlend > 1e-4) {
      this.desiredPositionScratch.addScaledVector(
        this.rightScratch,
        wallBiasSide * params.placement.distance * AUTO_TOUR_CAMERA_FOLLOW_WALL_SIDE_SHIFT_RATIO * this.wallBlend,
      )
      this.desiredPositionScratch.addScaledVector(
        this.tangentScratch,
        -params.placement.distance * 0.05 * this.wallBlend,
      )
      this.desiredTargetScratch.addScaledVector(
        this.rightScratch,
        wallBiasSide * params.placement.targetLift * AUTO_TOUR_CAMERA_FOLLOW_WALL_TARGET_SHIFT_RATIO * this.wallBlend,
      )
      this.desiredTargetScratch.addScaledVector(
        this.rightScratch,
        wallBiasSide * params.placement.targetForward * Math.tan(wallYawOffset) * 0.35,
      )
    }

    const positionSpeed = AUTO_TOUR_CAMERA_FOLLOW_POSITION_LERP_SPEED
      + turnSeverity * 2.5
      + chosenCandidate.occlusionScore * 1.2
      + dockBlend * 0.8
      + this.narrowBlend * 0.9
    const targetSpeed = AUTO_TOUR_CAMERA_FOLLOW_TARGET_LERP_SPEED
      + turnSeverity * 2.2
      + dockBlend * 0.8
      + this.narrowBlend * 0.75
    const positionAlpha = params.immediate || !this.followState.initialized
      ? 1
      : computeFollowLerpAlpha(deltaSeconds, positionSpeed)
    const targetAlpha = params.immediate || !this.followState.initialized
      ? 1
      : computeFollowLerpAlpha(deltaSeconds, targetSpeed)

    if (positionAlpha >= 1) {
      this.followState.currentPosition.copy(this.desiredPositionScratch)
    } else {
      this.followState.currentPosition.lerp(this.desiredPositionScratch, positionAlpha)
    }
    if (targetAlpha >= 1) {
      this.followState.currentTarget.copy(this.desiredTargetScratch)
    } else {
      this.followState.currentTarget.lerp(this.desiredTargetScratch, targetAlpha)
    }
    this.followState.desiredPosition.copy(this.desiredPositionScratch)
    this.followState.desiredTarget.copy(this.desiredTargetScratch)
    this.followState.currentAnchor.copy(params.anchorWorld)
    this.followState.desiredAnchor.copy(params.anchorWorld)
    this.followState.heading.copy(this.tangentScratch)
    this.followState.initialized = true
    this.currentPositionScratch.copy(this.followState.currentPosition)
    this.currentTargetScratch.copy(this.followState.currentTarget)

    return {
      routeProgress,
      routeDistanceToEnd,
      lookaheadDistance,
      turnSeverity,
      turnSign,
      dockBlend,
      nearEndBlend,
      motionBlend,
      wallProbeScore,
      wallProbeSide,
      candidateGap,
      narrowSignal,
      wallSignal,
      chosenCandidate: cloneCandidate(chosenCandidate),
      currentCandidate: cloneCandidate(currentCandidate),
      bestCandidate: cloneCandidate(bestCandidate),
      secondCandidate: cloneCandidate(secondCandidate),
      candidateId: this.candidateId,
      currentPosition: this.currentPositionScratch,
      currentTarget: this.currentTargetScratch,
      desiredPosition: this.desiredPositionScratch,
      desiredTarget: this.desiredTargetScratch,
      narrowBlend: this.narrowBlend,
      wallBlend: this.wallBlend,
      wallBiasSide,
    }
  }
}
