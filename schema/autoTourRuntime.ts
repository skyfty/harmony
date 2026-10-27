import * as THREE from 'three'

import type { SceneNode } from './core'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  VEHICLE_COMPONENT_TYPE,
  type AutoTourComponentProps,
  type VehicleComponentProps,
  clampAutoTourComponentProps,
  clampVehicleComponentProps,
  guideRouteModeSupportsActor,
} from './components'
import {
  evaluateGuideRoute,
  guideRouteEventKey,
  resolveGuideRoutePrimaryProviderNodeId,
  sampleEvaluatedGuideRouteAtDistance,
  type CompiledGuideStop,
  type CompiledGuideTransition,
  type EvaluatedGuideRoute,
  type GuideRouteStopEventContext,
} from './guideRouteRuntime'
import {
  buildGuideRouteTravelWindow,
  type GuideRouteTourTargetOptions,
  type GuideRouteTravelWindow,
} from './guideRouteTourTarget'
import { sampleProceduralLandscapeGuideRouteSurface } from './proceduralLandscape/runtime'
import {
  buildPolylineMetricData,
  buildPolylineVertexArcLengths,
  projectPointToPolyline,
  type PolylineMetricData,
} from './polylineProgress'
import { findTargetWaypointIndexByProjectedS } from './pathFollowCommon'

export type AutoTourRuntimeDeps = {
  iterNodes: () => Iterable<SceneNode>
  resolveNodeById: (id: string) => SceneNode | null | undefined
  nodeObjectMap: Map<string, THREE.Object3D>
  resolveObjectBounds?: (object: THREE.Object3D) => THREE.Box3
  isManualDriveActive: () => boolean
  onNodeObjectTransformUpdated?: (nodeId: string, object: THREE.Object3D) => void
  onAutoSurfaceStart?: (nodeId: string) => void
  onAutoSurfaceEnd?: (nodeId: string) => void
  onTerminalStop?: (nodeId: string, reason: string) => void
  onGuideStop?: (
    nodeId: string,
    stop: CompiledGuideStop,
    context: GuideRouteStopEventContext,
  ) => void
  onGuideTransition?: (
    nodeId: string,
    transition: CompiledGuideTransition,
  ) => void
}

export type AutoTourRouteSnapResult = {
  nodeId: string
  routeNodeId: string
  worldPosition: THREE.Vector3
  worldQuaternion: THREE.Quaternion
  forwardWorld: THREE.Vector3
  yaw: number
  projectedS: number
  segmentIndex: number
  targetIndex: number
  routeWaypointCount: number
  sourceRouteWaypointCount: number
  polylineData3d: PolylineMetricData
  waypointArcLengths3d: number[]
  travelWindow: GuideRouteTravelWindow | null
  targetReached: boolean
}

export type AutoTourRuntime = {
  update: (deltaSeconds: number) => void
  reset: () => void
  resolveRouteSnap: (nodeId: string, target?: GuideRouteTourTargetOptions) => AutoTourRouteSnapResult | null
  seedTourPlaybackState: (nodeId: string, snap: AutoTourRouteSnapResult) => void
  startTour: (nodeId: string, target?: GuideRouteTourTargetOptions) => void
  continueFromEnd: (nodeId: string) => void
  stopTour: (nodeId: string) => void
  setPaused: (nodeId: string, paused: boolean) => void
  isPaused: (nodeId: string) => boolean
  isTourActive: (nodeId: string) => boolean
  completeGuideTransition: (nodeId: string, success: boolean, message?: string) => void
}

type RouteData = {
  evaluation: EvaluatedGuideRoute
  polylineData3d: PolylineMetricData
  waypointArcLengths3d: number[]
}

type PlaybackState = {
  routeNodeId: string
  routeTarget: GuideRouteTourTargetOptions | null
  routeWaypointCount: number
  sourceRouteWaypointCount: number
  distanceAlongRoute: number
  travelWindow: GuideRouteTravelWindow | null
  firedStopIds: Set<string>
  firedTransitionIds: Set<string>
  pendingTransitionId: string | null
  smoothedSpeedMps: number
  smoothedYawRad: number | null
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const TERMINAL_DISTANCE_EPSILON = 0.05
const ROUTE_END_REVERSE_EPSILON = 0.5
const AUTO_TOUR_YAW_SMOOTHING = 12
// Vehicle tours use a slower response so polyline corners do not snap the
// chassis (and the rigidly attached chase camera) within one frame.
const AUTO_TOUR_VEHICLE_YAW_SMOOTHING = 2.2
const AUTO_TOUR_SURFACE_CLEARANCE_M = 0.04
const AUTO_TOUR_SUPPORT_FOOTPRINT_INSET_RATIO = 0.15
const AUTO_TOUR_MAX_SUPPORT_SLOPE = Math.tan(THREE.MathUtils.degToRad(30))
const routeDataCache = new WeakMap<EvaluatedGuideRoute, RouteData>()

function transformBoundsCorners(
  bounds: THREE.Box3,
  matrix: THREE.Matrix4,
): THREE.Box3 {
  const transformed = new THREE.Box3()
  const corner = new THREE.Vector3()
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        transformed.expandByPoint(corner.set(x, y, z).applyMatrix4(matrix))
      }
    }
  }
  return transformed
}

function expSmoothingAlpha(speed: number, deltaSeconds: number): number {
  return 1 - Math.exp(-Math.max(0, speed) * Math.max(0, deltaSeconds))
}

function dampAngleRadians(current: number, target: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * THREE.MathUtils.clamp(alpha, 0, 1)
}

function setVector3Like(target: any, x: number, y: number, z: number): void {
  if (!target) {
    return
  }
  if (typeof target.set === 'function') {
    target.set(x, y, z)
    return
  }
  target.x = x
  target.y = y
  target.z = z
}

function syncNodeTransformFromObject(node: SceneNode, object: THREE.Object3D): void {
  setVector3Like(node.position as any, object.position.x, object.position.y, object.position.z)
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  euler.setFromQuaternion(object.quaternion)
  setVector3Like(node.rotation as any, euler.x, euler.y, euler.z)
}

function resolveRouteData(
  routeNode: SceneNode,
  providerObject: THREE.Object3D | null,
  routeObject: THREE.Object3D | null,
): RouteData | null {
  const evaluation = evaluateGuideRoute({ routeNode, providerObject, routeObject })
  if (evaluation.status !== 'ready') {
    return null
  }
  const cached = routeDataCache.get(evaluation)
  if (cached) {
    return cached
  }
  const polylineData3d = buildPolylineMetricData(evaluation.points, {
    closed: evaluation.loop,
    mode: '3d',
  })
  if (!polylineData3d) {
    return null
  }
  const routeData: RouteData = {
    evaluation,
    polylineData3d,
    waypointArcLengths3d: buildPolylineVertexArcLengths(
      evaluation.points,
      polylineData3d,
    ),
  }
  routeDataCache.set(evaluation, routeData)
  return routeData
}

function buildRouteDataFromEvaluation(
  evaluation: EvaluatedGuideRoute,
  loop: boolean,
): RouteData | null {
  const cached = routeDataCache.get(evaluation)
  if (cached) {
    return cached
  }
  const polylineData3d = buildPolylineMetricData(evaluation.points, {
    closed: loop,
    mode: '3d',
  })
  if (!polylineData3d) {
    return null
  }
  const routeData: RouteData = {
    evaluation,
    polylineData3d,
    waypointArcLengths3d: buildPolylineVertexArcLengths(
      evaluation.points,
      polylineData3d,
    ),
  }
  routeDataCache.set(evaluation, routeData)
  return routeData
}

function applyObjectWorldPose(
  object: THREE.Object3D,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
): void {
  if (object.parent) {
    object.parent.updateMatrixWorld(true)
    object.position.copy(object.parent.worldToLocal(worldPosition.clone()))
    object.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    object.quaternion.copy(
      new THREE.Quaternion()
        .copy(object.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
        .multiply(worldQuaternion),
    )
  } else {
    object.position.copy(worldPosition)
    object.quaternion.copy(worldQuaternion)
  }
  object.updateMatrixWorld(true)
}

type SupportedVehiclePose = {
  worldPosition: THREE.Vector3
  worldQuaternion: THREE.Quaternion
}

function readVectorAxis(vector: THREE.Vector3, axis: number): number {
  return axis === 0 ? vector.x : axis === 1 ? vector.y : vector.z
}

function writeVectorAxis(vector: THREE.Vector3, axis: number, value: number): void {
  if (axis === 0) {
    vector.x = value
  } else if (axis === 1) {
    vector.y = value
  } else {
    vector.z = value
  }
}

type VehicleWheelSupportCandidate = {
  point: THREE.Vector3
  isFrontWheel: boolean
}

function orderVehicleWheelSupportPoints(
  candidates: VehicleWheelSupportCandidate[],
  vehicleProps: VehicleComponentProps,
): THREE.Vector3[] | null {
  const front = candidates.filter((candidate) => candidate.isFrontWheel)
  const rear = candidates.filter((candidate) => !candidate.isFrontWheel)
  if (front.length !== 2 || rear.length !== 2) {
    return null
  }
  const rightAxis = vehicleProps.indexRightAxis
  const sortByRightAxis = (
    left: VehicleWheelSupportCandidate,
    right: VehicleWheelSupportCandidate,
  ) => readVectorAxis(left.point, rightAxis) - readVectorAxis(right.point, rightAxis)
  front.sort(sortByRightAxis)
  rear.sort(sortByRightAxis)
  const frontWidth = Math.abs(
    readVectorAxis(front[1]!.point, rightAxis) - readVectorAxis(front[0]!.point, rightAxis),
  )
  const rearWidth = Math.abs(
    readVectorAxis(rear[1]!.point, rightAxis) - readVectorAxis(rear[0]!.point, rightAxis),
  )
  if (frontWidth <= 1e-4 || rearWidth <= 1e-4) {
    return null
  }
  return [
    front[0]!.point,
    front[1]!.point,
    rear[0]!.point,
    rear[1]!.point,
  ]
}

function buildConfiguredWheelSupportFootprint(
  vehicleProps: VehicleComponentProps,
): THREE.Vector3[] | null {
  if (vehicleProps.wheels.length !== 4) {
    return null
  }
  const candidates: VehicleWheelSupportCandidate[] = []
  for (const wheel of vehicleProps.wheels) {
    const point = new THREE.Vector3(
      wheel.chassisConnectionPointLocal.x,
      wheel.chassisConnectionPointLocal.y,
      wheel.chassisConnectionPointLocal.z,
    )
    const direction = new THREE.Vector3(
      wheel.directionLocal.x,
      wheel.directionLocal.y,
      wheel.directionLocal.z,
    )
    if (direction.lengthSq() <= 1e-8) {
      writeVectorAxis(direction, vehicleProps.indexUpAxis, -1)
    }
    direction.normalize()
    point.addScaledVector(direction, wheel.suspensionRestLength + wheel.radius)
    candidates.push({ point, isFrontWheel: wheel.isFrontWheel })
  }
  return orderVehicleWheelSupportPoints(candidates, vehicleProps)
}

function buildVisualWheelSupportFootprint(params: {
  object: THREE.Object3D
  vehicleProps: VehicleComponentProps
  resolveObjectBounds: (object: THREE.Object3D) => THREE.Box3
}): THREE.Vector3[] | null {
  const { object, vehicleProps, resolveObjectBounds } = params
  const wheelNodeIds = new Set(
    vehicleProps.wheels
      .map((wheel) => wheel.nodeId)
      .filter((nodeId): nodeId is string => Boolean(nodeId)),
  )
  if (wheelNodeIds.size !== 4) {
    return null
  }
  object.updateMatrixWorld(true)
  const wheelObjects = new Map<string, THREE.Object3D>()
  object.traverse((candidate) => {
    const nodeId = typeof candidate.userData?.nodeId === 'string'
      ? candidate.userData.nodeId.trim()
      : ''
    if (nodeId && wheelNodeIds.has(nodeId) && !wheelObjects.has(nodeId)) {
      wheelObjects.set(nodeId, candidate)
    }
  })
  if (wheelObjects.size !== wheelNodeIds.size) {
    return null
  }

  const inverseObjectMatrix = object.matrixWorld.clone().invert()
  const candidates: VehicleWheelSupportCandidate[] = []
  for (const wheel of vehicleProps.wheels) {
    const wheelObject = wheel.nodeId ? wheelObjects.get(wheel.nodeId) : null
    if (!wheelObject) {
      return null
    }
    wheelObject.updateMatrixWorld(true)
    const wheelBounds = resolveObjectBounds(wheelObject)
    if (wheelBounds.isEmpty()) {
      return null
    }
    const localBounds = transformBoundsCorners(wheelBounds, inverseObjectMatrix)
    const point = new THREE.Vector3()
    writeVectorAxis(
      point,
      vehicleProps.indexRightAxis,
      (readVectorAxis(localBounds.min, vehicleProps.indexRightAxis)
        + readVectorAxis(localBounds.max, vehicleProps.indexRightAxis)) * 0.5,
    )
    writeVectorAxis(point, vehicleProps.indexUpAxis, readVectorAxis(localBounds.min, vehicleProps.indexUpAxis))
    writeVectorAxis(
      point,
      vehicleProps.indexForwardAxis,
      (readVectorAxis(localBounds.min, vehicleProps.indexForwardAxis)
        + readVectorAxis(localBounds.max, vehicleProps.indexForwardAxis)) * 0.5,
    )
    candidates.push({ point, isFrontWheel: wheel.isFrontWheel })
  }
  return orderVehicleWheelSupportPoints(candidates, vehicleProps)
}

function buildBoundsSupportFootprint(
  localBounds: THREE.Box3,
  vehicleProps: VehicleComponentProps,
): THREE.Vector3[] {
  const rightAxis = vehicleProps.indexRightAxis
  const upAxis = vehicleProps.indexUpAxis
  const forwardAxis = vehicleProps.indexForwardAxis
  const minRight = readVectorAxis(localBounds.min, rightAxis)
  const maxRight = readVectorAxis(localBounds.max, rightAxis)
  const minForward = readVectorAxis(localBounds.min, forwardAxis)
  const maxForward = readVectorAxis(localBounds.max, forwardAxis)
  const centerRight = (minRight + maxRight) * 0.5
  const centerForward = (minForward + maxForward) * 0.5
  const halfRight = (maxRight - minRight) * 0.5 * (1 - AUTO_TOUR_SUPPORT_FOOTPRINT_INSET_RATIO)
  const halfForward = (maxForward - minForward) * 0.5 * (1 - AUTO_TOUR_SUPPORT_FOOTPRINT_INSET_RATIO)
  const bottom = readVectorAxis(localBounds.min, upAxis)
  const combinations = [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ] as const
  return combinations.map(([rightSign, forwardSign]) => {
    const point = new THREE.Vector3()
    writeVectorAxis(point, rightAxis, centerRight + halfRight * rightSign)
    writeVectorAxis(point, upAxis, bottom)
    writeVectorAxis(point, forwardAxis, centerForward + halfForward * forwardSign)
    return point
  })
}

function resolveSupportedVehiclePose(params: {
  object: THREE.Object3D
  routePoint: THREE.Vector3
  forwardWorld: THREE.Vector3
  vehicleProps: VehicleComponentProps
  worldQuaternion: THREE.Quaternion
  providerNodeId: string | null
  resolveObjectBounds: (object: THREE.Object3D) => THREE.Box3
  localBoundsCache: WeakMap<THREE.Object3D, THREE.Box3>
  visualWheelFootprintCache: WeakMap<THREE.Object3D, THREE.Vector3[]>
}): SupportedVehiclePose {
  const {
    object,
    routePoint,
    forwardWorld,
    vehicleProps,
    worldQuaternion,
    providerNodeId,
    resolveObjectBounds,
    localBoundsCache,
    visualWheelFootprintCache,
  } = params
  const originalPosition = object.position.clone()
  const originalQuaternion = object.quaternion.clone()
  try {
    object.updateMatrixWorld(true)
    let footprint = visualWheelFootprintCache.get(object) ?? null
    if (!footprint) {
      footprint = buildVisualWheelSupportFootprint({
        object,
        vehicleProps,
        resolveObjectBounds,
      })
      if (footprint) {
        visualWheelFootprintCache.set(object, footprint)
      }
    }
    if (!footprint) {
      footprint = buildConfiguredWheelSupportFootprint(vehicleProps)
    }
    if (!footprint) {
      let localBounds = localBoundsCache.get(object) ?? null
      if (!localBounds) {
        const sourceBounds = resolveObjectBounds(object)
        if (sourceBounds.isEmpty()) {
          return {
            worldPosition: routePoint.clone(),
            worldQuaternion: worldQuaternion.clone(),
          }
        }
        const inverseObjectMatrix = object.matrixWorld.clone().invert()
        localBounds = transformBoundsCorners(sourceBounds, inverseObjectMatrix)
        localBoundsCache.set(object, localBounds)
      }
      footprint = buildBoundsSupportFootprint(localBounds, vehicleProps)
    }

    applyObjectWorldPose(object, routePoint.clone(), worldQuaternion)
    const footprintWorld = footprint.map((point) => point.clone().applyMatrix4(object.matrixWorld))
    const facingYawRad = Math.atan2(-forwardWorld.z, forwardWorld.x)
    const sampleHeights = footprintWorld.map((point) => (
      providerNodeId
        ? sampleProceduralLandscapeGuideRouteSurface(
          providerNodeId,
          point.x,
          point.z,
          facingYawRad,
        )?.point.y ?? null
        : null
    ))
    const average = (indices: number[]): number | null => {
      const values = indices
        .map((index) => sampleHeights[index])
        .filter((value): value is number => value != null && Number.isFinite(value))
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
    }
    const planarDistance = (leftIndex: number, rightIndex: number): number => (
      Math.hypot(
        footprintWorld[leftIndex]!.x - footprintWorld[rightIndex]!.x,
        footprintWorld[leftIndex]!.z - footprintWorld[rightIndex]!.z,
      )
    )
    const frontHeight = average([0, 1])
    const rearHeight = average([2, 3])
    const leftHeight = average([0, 2])
    const rightHeight = average([1, 3])
    const pitchDistance = (planarDistance(0, 2) + planarDistance(1, 3)) * 0.5
    const rollDistance = (planarDistance(0, 1) + planarDistance(2, 3)) * 0.5
    const pitchSlope = frontHeight != null && rearHeight != null && pitchDistance > 1e-4
      ? THREE.MathUtils.clamp(
        (frontHeight - rearHeight) / pitchDistance,
        -AUTO_TOUR_MAX_SUPPORT_SLOPE,
        AUTO_TOUR_MAX_SUPPORT_SLOPE,
      )
      : 0
    const rollSlope = rightHeight != null && leftHeight != null && rollDistance > 1e-4
      ? THREE.MathUtils.clamp(
        (rightHeight - leftHeight) / rollDistance,
        -AUTO_TOUR_MAX_SUPPORT_SLOPE,
        AUTO_TOUR_MAX_SUPPORT_SLOPE,
      )
      : 0
    const validSupportHeights = sampleHeights.filter(
      (height): height is number => height != null && Number.isFinite(height),
    )
    const supportSurfaceY = validSupportHeights.length
      ? Math.max(...validSupportHeights)
      : routePoint.y
    let supportedQuaternion = worldQuaternion.clone()
    if (frontHeight != null || rearHeight != null || leftHeight != null || rightHeight != null) {
      const forwardBase = forwardWorld.clone()
      forwardBase.y = 0
      if (forwardBase.lengthSq() <= 1e-8) {
        forwardBase.set(1, 0, 0)
      } else {
        forwardBase.normalize()
      }
      const localRight = new THREE.Vector3()
      writeVectorAxis(localRight, vehicleProps.indexRightAxis, 1)
      const rightBase = localRight
        .applyQuaternion(buildVehicleQuaternion(vehicleProps, forwardBase, WORLD_UP))
        .normalize()
      const supportNormal = WORLD_UP.clone()
        .addScaledVector(forwardBase, -pitchSlope)
        .addScaledVector(rightBase, -rollSlope)
        .normalize()
      supportedQuaternion = buildVehicleQuaternion(vehicleProps, forwardBase, supportNormal)
    }

    applyObjectWorldPose(object, routePoint.clone(), supportedQuaternion)
    const supportPointWorldPositions = footprint.map((point) => (
      point.clone().applyMatrix4(object.matrixWorld)
    ))
    const requiredOriginHeights = sampleHeights.flatMap((height, index) => (
      height == null
        ? []
        : [
          height
          + AUTO_TOUR_SURFACE_CLEARANCE_M
          - (supportPointWorldPositions[index]!.y - routePoint.y),
        ]
    ))
    const supported = routePoint.clone()
    supported.y = requiredOriginHeights.length
      ? Math.max(...requiredOriginHeights)
      : supportSurfaceY
    return {
      worldPosition: supported,
      worldQuaternion: supportedQuaternion,
    }
  } finally {
    object.position.copy(originalPosition)
    object.quaternion.copy(originalQuaternion)
    object.updateMatrixWorld(true)
  }
}

function buildVehicleQuaternion(
  vehicleProps: VehicleComponentProps,
  forwardWorld: THREE.Vector3,
  surfaceNormal: THREE.Vector3,
): THREE.Quaternion {
  const normal = surfaceNormal.clone().normalize()
  const forward = forwardWorld.clone()
  forward.addScaledVector(normal, -forward.dot(normal))
  if (forward.lengthSq() <= 1e-8) {
    forward.copy(forwardWorld)
  }
  forward.normalize()
  // Keep the declared vehicle right axis consistent with the same up x
  // forward convention used when deriving roadbed roll.
  const right = new THREE.Vector3().crossVectors(normal, forward).normalize()
  const up = right.lengthSq() > 1e-8
    ? new THREE.Vector3().crossVectors(forward, right).normalize()
    : normal
  const axisIndices = [
    vehicleProps.indexRightAxis,
    vehicleProps.indexUpAxis,
    vehicleProps.indexForwardAxis,
  ]
  const validAxes = new Set(axisIndices).size === 3
    && axisIndices.every((index) => index === 0 || index === 1 || index === 2)
  const axes = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]
  if (validAxes) {
    axes[vehicleProps.indexRightAxis]!.copy(right)
    axes[vehicleProps.indexUpAxis]!.copy(up)
    axes[vehicleProps.indexForwardAxis]!.copy(forward)
  } else {
    axes[0]!.copy(forward)
    axes[1]!.copy(up)
    axes[2]!.copy(right)
  }
  const matrix = new THREE.Matrix4().makeBasis(axes[0]!, axes[1]!, axes[2]!)
  if (matrix.determinant() < 0) {
    right.negate()
    if (validAxes) {
      axes[vehicleProps.indexRightAxis]!.copy(right)
    } else {
      axes[2]!.copy(right)
    }
    matrix.makeBasis(axes[0]!, axes[1]!, axes[2]!)
  }
  return new THREE.Quaternion().setFromRotationMatrix(matrix)
}

export function createAutoTourRuntime(deps: AutoTourRuntimeDeps): AutoTourRuntime {
  const playbackStates = new Map<string, PlaybackState>()
  const activeTourNodes = new Set<string>()
  const pausedTourNodes = new Set<string>()
  const disabledTourNodes = new Set<string>()
  const pendingTourTargets = new Map<string, GuideRouteTourTargetOptions>()
  const vehicleLocalBoundsCache = new WeakMap<THREE.Object3D, THREE.Box3>()
  const visualWheelFootprintCache = new WeakMap<THREE.Object3D, THREE.Vector3[]>()
  const resolveObjectBounds = deps.resolveObjectBounds
    ?? ((object: THREE.Object3D) => new THREE.Box3().setFromObject(object))

  function resolveRoute(routeNodeId: string | null | undefined): RouteData | null {
    if (!routeNodeId) {
      return null
    }
    const routeNode = deps.resolveNodeById(routeNodeId)
    if (!routeNode || routeNode.dynamicMesh?.type !== 'GuideRoute') {
      return null
    }
    const routeProps = routeNode.components?.guideRoute?.props
    const providerNodeId = resolveGuideRoutePrimaryProviderNodeId(routeProps)
    const providerObject = providerNodeId
      ? deps.nodeObjectMap.get(providerNodeId) ?? null
      : null
    const routeObject = deps.nodeObjectMap.get(routeNodeId) ?? null
    return resolveRouteData(routeNode, providerObject, routeObject)
  }

  function initializePlaybackState(params: {
    object: THREE.Object3D
    routeNodeId: string
    routeData: RouteData
  }): PlaybackState {
    const { object, routeNodeId, routeData } = params
    object.updateMatrixWorld(true)
    const worldPosition = object.getWorldPosition(new THREE.Vector3())
    const projection = projectPointToPolyline(
      routeData.evaluation.points,
      routeData.polylineData3d,
      worldPosition,
      new THREE.Vector3(),
    )
    return {
      routeNodeId,
      routeTarget: null,
      routeWaypointCount: routeData.evaluation.points.length,
      sourceRouteWaypointCount: routeData.evaluation.points.length,
      distanceAlongRoute: projection.s,
      travelWindow: null,
      firedStopIds: new Set(),
      firedTransitionIds: new Set(),
      pendingTransitionId: null,
      smoothedSpeedMps: 0,
      smoothedYawRad: null,
    }
  }

  function resolveSnap(
    nodeId: string,
    _tourProps: AutoTourComponentProps,
    node: SceneNode,
    routeData: RouteData,
  ): AutoTourRouteSnapResult | null {
    const object = deps.nodeObjectMap.get(nodeId) ?? null
    if (!object) {
      return null
    }
    object.updateMatrixWorld(true)
    const current = object.getWorldPosition(new THREE.Vector3())
    const projectionTarget = new THREE.Vector3()
    const projection = projectPointToPolyline(
      routeData.evaluation.points,
      routeData.polylineData3d,
      current,
      projectionTarget,
    )
    const sample = sampleEvaluatedGuideRouteAtDistance(
      routeData.evaluation,
      projection.s,
    )
    if (!sample) {
      return null
    }
    const tangentStart = sampleEvaluatedGuideRouteAtDistance(
      routeData.evaluation,
      Math.max(0, projection.s - 0.5),
    )
    const tangentEnd = sampleEvaluatedGuideRouteAtDistance(
      routeData.evaluation,
      Math.min(routeData.evaluation.totalLength, projection.s + 0.5),
    )
    const forwardWorld = tangentEnd && tangentStart
      ? tangentEnd.point.clone().sub(tangentStart.point)
      : new THREE.Vector3(1, 0, 0)
    if (forwardWorld.lengthSq() <= 1e-8) {
      forwardWorld.set(1, 0, 0)
    } else {
      forwardWorld.normalize()
    }
    const vehicleComponent = resolveEnabledComponentState<VehicleComponentProps>(
      node,
      VEHICLE_COMPONENT_TYPE,
    )
    const vehicleProps = vehicleComponent ? clampVehicleComponentProps(vehicleComponent.props) : null
    const yaw = Math.atan2(-forwardWorld.z, forwardWorld.x)
    let worldQuaternion = vehicleComponent
      ? buildVehicleQuaternion(
        vehicleProps!,
        forwardWorld,
        sample.normal,
      )
      : new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw)
    let worldPosition = sample.point.clone()
    if (vehicleComponent && vehicleProps) {
      const supportedPose = resolveSupportedVehiclePose({
        object,
        routePoint: sample.point,
        forwardWorld,
        vehicleProps,
        worldQuaternion,
        providerNodeId: routeData.evaluation.providerNodeId,
        resolveObjectBounds,
        localBoundsCache: vehicleLocalBoundsCache,
        visualWheelFootprintCache,
      })
      worldPosition = supportedPose.worldPosition
      worldQuaternion = supportedPose.worldQuaternion
    }
    return {
      nodeId,
      routeNodeId: routeData.evaluation.routeNodeId,
      worldPosition,
      worldQuaternion,
      forwardWorld,
      yaw,
      projectedS: projection.s,
      segmentIndex: projection.segmentIndex,
      targetIndex: findTargetWaypointIndexByProjectedS(
        routeData.waypointArcLengths3d,
        projection.s,
        routeData.evaluation.loop,
      ),
      routeWaypointCount: routeData.evaluation.points.length,
      sourceRouteWaypointCount: routeData.evaluation.points.length,
      polylineData3d: routeData.polylineData3d,
      waypointArcLengths3d: routeData.waypointArcLengths3d,
      travelWindow: null,
      targetReached: false,
    }
  }

  function resolveTargetedSnap(
    nodeId: string,
    _tourProps: AutoTourComponentProps,
    node: SceneNode,
    routeData: RouteData,
    target: GuideRouteTourTargetOptions,
  ): AutoTourRouteSnapResult | null {
    const object = deps.nodeObjectMap.get(nodeId) ?? null
    if (!object) {
      return null
    }
    object.updateMatrixWorld(true)
    const current = object.getWorldPosition(new THREE.Vector3())
    const projection = projectPointToPolyline(
      routeData.evaluation.points,
      routeData.polylineData3d,
      current,
      new THREE.Vector3(),
    )
    const travelWindow = target.travelWindow ?? buildGuideRouteTravelWindow(
      routeData.evaluation,
      projection.s,
      target,
      routeData.evaluation.loop,
    )
    if (!travelWindow) {
      const sample = sampleEvaluatedGuideRouteAtDistance(routeData.evaluation, projection.s)
      if (!sample) {
        return null
      }
      const tangent = sampleEvaluatedGuideRouteAtDistance(
        routeData.evaluation,
        Math.min(routeData.evaluation.totalLength, projection.s + 0.001),
      )?.point.clone().sub(sample.point) ?? new THREE.Vector3(1, 0, 0)
      if (tangent.lengthSq() <= 1e-8) {
        tangent.set(1, 0, 0)
      } else {
        tangent.normalize()
      }
      const vehicleComponent = resolveEnabledComponentState<VehicleComponentProps>(
        node,
        VEHICLE_COMPONENT_TYPE,
      )
      const vehicleProps = vehicleComponent ? clampVehicleComponentProps(vehicleComponent.props) : null
      const yaw = Math.atan2(-tangent.z, tangent.x)
      let worldQuaternion = vehicleComponent
        ? buildVehicleQuaternion(
          vehicleProps!,
          tangent,
          sample.normal,
        )
        : new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw)
      let worldPosition = sample.point.clone()
      if (vehicleComponent && vehicleProps) {
        const supportedPose = resolveSupportedVehiclePose({
          object,
          routePoint: sample.point,
          forwardWorld: tangent,
          vehicleProps,
          worldQuaternion,
          providerNodeId: routeData.evaluation.providerNodeId,
          resolveObjectBounds,
          localBoundsCache: vehicleLocalBoundsCache,
          visualWheelFootprintCache,
        })
        worldPosition = supportedPose.worldPosition
        worldQuaternion = supportedPose.worldQuaternion
      }
      return {
        nodeId,
        routeNodeId: routeData.evaluation.routeNodeId,
        worldPosition,
        worldQuaternion,
        forwardWorld: tangent,
        yaw,
        projectedS: projection.s,
        segmentIndex: projection.segmentIndex,
        targetIndex: 0,
        routeWaypointCount: routeData.evaluation.points.length,
        sourceRouteWaypointCount: routeData.evaluation.points.length,
        polylineData3d: routeData.polylineData3d,
        waypointArcLengths3d: routeData.waypointArcLengths3d,
        travelWindow: null,
        targetReached: true,
      }
    }

    const windowRouteData = buildRouteDataFromEvaluation(travelWindow.route, false)
    if (!windowRouteData) {
      return null
    }
    const sample = sampleEvaluatedGuideRouteAtDistance(windowRouteData.evaluation, 0)
    if (!sample) {
      return null
    }
    const tangentStart = sampleEvaluatedGuideRouteAtDistance(windowRouteData.evaluation, 0)
    const tangentEnd = sampleEvaluatedGuideRouteAtDistance(windowRouteData.evaluation, 0.5)
    const forwardWorld = tangentStart && tangentEnd
      ? tangentEnd.point.clone().sub(tangentStart.point)
      : new THREE.Vector3(1, 0, 0)
    if (forwardWorld.lengthSq() <= 1e-8) {
      forwardWorld.set(1, 0, 0)
    } else {
      forwardWorld.normalize()
    }
    const vehicleComponent = resolveEnabledComponentState<VehicleComponentProps>(
      node,
      VEHICLE_COMPONENT_TYPE,
    )
    const vehicleProps = vehicleComponent ? clampVehicleComponentProps(vehicleComponent.props) : null
    const yaw = Math.atan2(-forwardWorld.z, forwardWorld.x)
    let worldQuaternion = vehicleComponent
      ? buildVehicleQuaternion(
        vehicleProps!,
        forwardWorld,
        sample.normal,
      )
      : new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw)
    let worldPosition = sample.point.clone()
    if (vehicleComponent && vehicleProps) {
      const supportedPose = resolveSupportedVehiclePose({
        object,
        routePoint: sample.point,
        forwardWorld,
        vehicleProps,
        worldQuaternion,
        providerNodeId: routeData.evaluation.providerNodeId,
        resolveObjectBounds,
        localBoundsCache: vehicleLocalBoundsCache,
        visualWheelFootprintCache,
      })
      worldPosition = supportedPose.worldPosition
      worldQuaternion = supportedPose.worldQuaternion
    }
    return {
      nodeId,
      routeNodeId: routeData.evaluation.routeNodeId,
      worldPosition,
      worldQuaternion,
      forwardWorld,
      yaw,
      projectedS: 0,
      segmentIndex: 0,
      targetIndex: 1,
      routeWaypointCount: windowRouteData.evaluation.points.length,
      sourceRouteWaypointCount: routeData.evaluation.points.length,
      polylineData3d: windowRouteData.polylineData3d,
      waypointArcLengths3d: windowRouteData.waypointArcLengths3d,
      travelWindow,
      targetReached: false,
    }
  }

  function resolveRouteSnap(
    nodeId: string,
    target?: GuideRouteTourTargetOptions,
  ): AutoTourRouteSnapResult | null {
    const node = deps.resolveNodeById(nodeId)
    if (!node) {
      return null
    }
    const component = resolveEnabledComponentState<AutoTourComponentProps>(
      node,
      AUTO_TOUR_COMPONENT_TYPE,
    )
    if (!component) {
      return null
    }
    const tourProps = clampAutoTourComponentProps(component.props)
    const routeNodeId = target?.routeNodeId ?? tourProps.routeNodeId
    const routeData = resolveRoute(routeNodeId)
    if (!routeData) {
      return null
    }
    const snap = target
      ? resolveTargetedSnap(nodeId, tourProps, node, routeData, target)
      : resolveSnap(nodeId, tourProps, node, routeData)
    if (
      snap
      && !target
      && !routeData.evaluation.loop
      && snap.projectedS >= routeData.evaluation.totalLength - ROUTE_END_REVERSE_EPSILON
    ) {
      const firstStop = routeData.evaluation.stops[0]
      return firstStop
        ? resolveTargetedSnap(
            nodeId,
            tourProps,
            node,
            routeData,
            {
              routeNodeId: routeData.evaluation.routeNodeId,
              destinationStopId: firstStop.definition.id,
            },
          ) ?? snap
        : snap
    }
    return snap
  }

  function seedTourPlaybackState(
    nodeId: string,
    snap: AutoTourRouteSnapResult,
  ): void {
    const node = deps.resolveNodeById(nodeId)
    const object = deps.nodeObjectMap.get(nodeId) ?? null
    if (!node || !object) {
      return
    }
    const pendingTarget = pendingTourTargets.get(nodeId) ?? null
    const resolvedRouteNodeId = snap.routeNodeId
    playbackStates.set(nodeId, {
      routeNodeId: resolvedRouteNodeId,
      routeTarget: pendingTarget,
      routeWaypointCount: snap.routeWaypointCount,
      sourceRouteWaypointCount: snap.sourceRouteWaypointCount,
      distanceAlongRoute: snap.travelWindow ? 0 : snap.projectedS,
      travelWindow: snap.travelWindow,
      firedStopIds: new Set(),
      firedTransitionIds: new Set(),
      pendingTransitionId: null,
      smoothedSpeedMps: 0,
      smoothedYawRad: snap.yaw,
    })
    pendingTourTargets.delete(nodeId)
  }

  function stopTour(nodeId: string): void {
    playbackStates.delete(nodeId)
    activeTourNodes.delete(nodeId)
    pausedTourNodes.delete(nodeId)
    disabledTourNodes.add(nodeId)
    pendingTourTargets.delete(nodeId)
    deps.onAutoSurfaceEnd?.(nodeId)
  }

  function update(deltaSeconds: number): void {
    if (!(deltaSeconds >= 0) || deps.isManualDriveActive()) {
      return
    }

    for (const node of deps.iterNodes()) {
      if (disabledTourNodes.has(node.id)) {
        continue
      }
      if (!activeTourNodes.has(node.id)) {
        continue
      }
      if (pausedTourNodes.has(node.id)) {
        continue
      }
      const component = resolveEnabledComponentState<AutoTourComponentProps>(
        node,
        AUTO_TOUR_COMPONENT_TYPE,
      )
      if (!component) {
        continue
      }
      const object = deps.nodeObjectMap.get(node.id) ?? null
      if (!object) {
        continue
      }
      const tourProps = clampAutoTourComponentProps(component.props)
      let state = playbackStates.get(node.id)
      const pendingTarget = pendingTourTargets.get(node.id) ?? null
      const activeTarget = pendingTarget ?? state?.routeTarget ?? null
      const routeNodeId = state?.routeTarget?.routeNodeId
        ?? pendingTarget?.routeNodeId
        ?? tourProps.routeNodeId
      const fullRouteData = resolveRoute(routeNodeId)
      if (!fullRouteData) {
        continue
      }
      if (
        !state
        || state.routeNodeId !== fullRouteData.evaluation.routeNodeId
        || state.sourceRouteWaypointCount !== fullRouteData.evaluation.points.length
      ) {
        if (activeTarget) {
          object.updateMatrixWorld(true)
          const worldPosition = object.getWorldPosition(new THREE.Vector3())
          const projection = projectPointToPolyline(
            fullRouteData.evaluation.points,
            fullRouteData.polylineData3d,
            worldPosition,
            new THREE.Vector3(),
          )
          const travelWindow = buildGuideRouteTravelWindow(
            fullRouteData.evaluation,
            projection.s,
            activeTarget,
            fullRouteData.evaluation.loop,
          )
          const targetedRouteData = travelWindow
            ? buildRouteDataFromEvaluation(travelWindow.route, false)
            : null
          pendingTourTargets.delete(node.id)
          if (!travelWindow || !targetedRouteData) {
            activeTourNodes.delete(node.id)
            pausedTourNodes.delete(node.id)
            disabledTourNodes.add(node.id)
            deps.onTerminalStop?.(node.id, 'guide-route-target-reached')
            continue
          }
          state = {
            routeNodeId: fullRouteData.evaluation.routeNodeId,
            routeTarget: activeTarget,
            routeWaypointCount: targetedRouteData.evaluation.points.length,
            sourceRouteWaypointCount: fullRouteData.evaluation.points.length,
            distanceAlongRoute: 0,
            travelWindow,
            firedStopIds: new Set(),
            firedTransitionIds: new Set(),
            pendingTransitionId: null,
            smoothedSpeedMps: 0,
            smoothedYawRad: null,
          }
        } else {
          state = initializePlaybackState({
            object,
            routeNodeId: fullRouteData.evaluation.routeNodeId,
            routeData: fullRouteData,
          })
          state.routeTarget = null
        }
        playbackStates.set(node.id, state)
      }
      let routeData = fullRouteData
      if (state.travelWindow) {
        const targetedRouteData = buildRouteDataFromEvaluation(state.travelWindow.route, false)
        if (!targetedRouteData) {
          continue
        }
        routeData = targetedRouteData
      }
      const routeIsLooping = routeData.evaluation.loop && !state.travelWindow
      if (!activeTourNodes.has(node.id)) {
        activeTourNodes.add(node.id)
        deps.onAutoSurfaceStart?.(node.id)
      }

      if (state.pendingTransitionId) {
        continue
      }

      const totalLength = routeData.evaluation.totalLength
      if (totalLength <= 1e-6) {
        continue
      }
      const progressLeg = routeData.evaluation.legs.find((leg) => (
        state.distanceAlongRoute >= leg.routeStartDistance - 1e-4
        && state.distanceAlongRoute <= leg.routeEndDistance + 1e-4
      )) ?? routeData.evaluation.legs[routeData.evaluation.legs.length - 1]
      if (
        progressLeg
        && !guideRouteModeSupportsActor(progressLeg.travelMode, 'vehicle')
      ) {
        disabledTourNodes.add(node.id)
        activeTourNodes.delete(node.id)
        pausedTourNodes.delete(node.id)
        deps.onTerminalStop?.(node.id, 'guide-route-actor-mismatch')
        continue
      }
      const speedProbe = Math.max(1, Math.min(8, tourProps.speedMps * 0.5))
      const speedSampleBefore = sampleEvaluatedGuideRouteAtDistance(
        routeData.evaluation,
        Math.max(0, state.distanceAlongRoute - speedProbe),
      )
      const speedSampleAfter = sampleEvaluatedGuideRouteAtDistance(
        routeData.evaluation,
        Math.min(totalLength, state.distanceAlongRoute + speedProbe),
      )
      let curveSpeedLimit = Number.POSITIVE_INFINITY
      if (speedSampleBefore && speedSampleAfter) {
        const beforeDirection = speedSampleAfter.point.clone().sub(speedSampleBefore.point)
        const afterDirection = sampleEvaluatedGuideRouteAtDistance(
          routeData.evaluation,
          Math.min(totalLength, state.distanceAlongRoute + speedProbe * 2),
        )?.point.clone().sub(speedSampleAfter.point)
        beforeDirection.y = 0
        afterDirection?.setY(0)
        if (beforeDirection.lengthSq() > 1e-8 && afterDirection && afterDirection.lengthSq() > 1e-8) {
          beforeDirection.normalize()
          afterDirection.normalize()
          const angle = Math.acos(THREE.MathUtils.clamp(beforeDirection.dot(afterDirection), -1, 1))
          const curvature = angle / Math.max(1e-4, speedSampleAfter.point.distanceTo(speedSampleBefore.point))
          curveSpeedLimit = Math.sqrt(
            Math.max(0.01, progressLeg?.speedProfile.lateralAccelLimitMps2 ?? 2.5)
            / Math.max(1e-5, curvature),
          )
        }
      }
      const targetSpeedMps = Math.max(
        0,
        Math.min(
          tourProps.speedMps,
          progressLeg?.speedProfile.cruiseSpeedMps ?? tourProps.speedMps,
          curveSpeedLimit,
        ),
      )
      const speedAlpha = 1 - Math.exp(-Math.max(0, deltaSeconds) / 0.85)
      state.smoothedSpeedMps = state.smoothedSpeedMps <= 0
        ? targetSpeedMps
        : state.smoothedSpeedMps + (targetSpeedMps - state.smoothedSpeedMps) * speedAlpha
      const step = state.smoothedSpeedMps * deltaSeconds
      const previousDistance = state.distanceAlongRoute
      let nextDistance = previousDistance + step
      let wrapped = false
      let eventRangeEnd = Math.min(totalLength, nextDistance)
      if (routeIsLooping && nextDistance >= totalLength) {
        eventRangeEnd = totalLength
        nextDistance = 0
        wrapped = true
      }

      const crosses = (eventDistance: number, endDistance: number): boolean => (
        (previousDistance <= 1e-4 && eventDistance <= 1e-4)
        || (
          eventDistance > previousDistance + 1e-4
          && eventDistance <= endDistance + 1e-4
        )
      )
      const crossedStops = routeData.evaluation.stops.filter((stop) => (
        !state!.firedStopIds.has(guideRouteEventKey(stop.routeNodeId, stop.definition.id))
        && crosses(stop.routeDistance, eventRangeEnd)
      )).sort((left, right) => left.routeDistance - right.routeDistance)
      const targetedDestinationStop = state.travelWindow
        ? routeData.evaluation.stops.find((stop) => (
          stop.definition.id === state!.travelWindow!.destinationStopId
        )) ?? fullRouteData.evaluation.stops.find((stop) => (
          stop.definition.id === state!.travelWindow!.destinationStopId
        )) ?? null
        : null
      const crossedTransitions = routeData.evaluation.transitions.filter((transition) => (
        !state!.firedTransitionIds.has(
          guideRouteEventKey(transition.routeNodeId, transition.definition.id),
        )
        && crosses(transition.routeDistance, eventRangeEnd)
      )).sort((left, right) => left.routeDistance - right.routeDistance)
      const transitionAtNextEvent = crossedTransitions[0] ?? null
      const targetAtNextEvent = Boolean(
        targetedDestinationStop
        && crosses(totalLength, eventRangeEnd)
        && !transitionAtNextEvent
      )
      const nextEventDistance = transitionAtNextEvent
        ? transitionAtNextEvent.routeDistance
        : targetAtNextEvent
          ? totalLength
          : Number.POSITIVE_INFINITY
      if (Number.isFinite(nextEventDistance)) {
        nextDistance = nextEventDistance
        wrapped = false
      }

      const isTerminal = !routeIsLooping
        && nextDistance >= totalLength - TERMINAL_DISTANCE_EPSILON
      if (isTerminal) {
        nextDistance = totalLength
      } else if (totalLength > 0 && nextDistance > totalLength) {
        if (routeIsLooping) {
          nextDistance %= totalLength
        } else {
          nextDistance = totalLength
        }
      }

      const sample = sampleEvaluatedGuideRouteAtDistance(
        routeData.evaluation,
        nextDistance,
      )
      if (!sample) {
        continue
      }
      const tangentBefore = sampleEvaluatedGuideRouteAtDistance(
        routeData.evaluation,
        Math.max(0, nextDistance - 0.5),
      )
      const tangentAfter = sampleEvaluatedGuideRouteAtDistance(
        routeData.evaluation,
        Math.min(totalLength, nextDistance + 0.5),
      )
      const forwardWorld = tangentBefore && tangentAfter
        ? tangentAfter.point.clone().sub(tangentBefore.point)
        : new THREE.Vector3(1, 0, 0)
      if (forwardWorld.lengthSq() <= 1e-8) {
        forwardWorld.set(1, 0, 0)
      } else {
        forwardWorld.normalize()
      }
      const vehicleComponent = resolveEnabledComponentState<VehicleComponentProps>(
        node,
        VEHICLE_COMPONENT_TYPE,
      )
      const targetYawRad = Math.atan2(-forwardWorld.z, forwardWorld.x)
      if (vehicleComponent) {
        if (state.smoothedYawRad == null || deltaSeconds <= 0) {
          state.smoothedYawRad = targetYawRad
        } else {
          state.smoothedYawRad = dampAngleRadians(
            state.smoothedYawRad,
            targetYawRad,
            expSmoothingAlpha(AUTO_TOUR_VEHICLE_YAW_SMOOTHING, deltaSeconds),
          )
        }
        const horizontalMagnitude = Math.hypot(forwardWorld.x, forwardWorld.z)
        if (horizontalMagnitude > 1e-6) {
          forwardWorld.set(
            Math.cos(state.smoothedYawRad) * horizontalMagnitude,
            forwardWorld.y,
            -Math.sin(state.smoothedYawRad) * horizontalMagnitude,
          ).normalize()
        }
      }
      let desiredPosition = sample.point.clone()
      if (vehicleComponent) {
        const vehicleProps = clampVehicleComponentProps(vehicleComponent.props)
        const desiredQuaternion = buildVehicleQuaternion(
          vehicleProps,
          forwardWorld,
          sample.normal,
        )
        const supportedPose = resolveSupportedVehiclePose({
          object,
          routePoint: sample.point,
          forwardWorld,
          vehicleProps,
          worldQuaternion: desiredQuaternion,
          providerNodeId: routeData.evaluation.providerNodeId,
          resolveObjectBounds,
          localBoundsCache: vehicleLocalBoundsCache,
          visualWheelFootprintCache,
        })
        desiredPosition = supportedPose.worldPosition
        applyObjectWorldPose(object, desiredPosition, supportedPose.worldQuaternion)
      } else {
        const current = object.getWorldQuaternion(new THREE.Quaternion())
        const target = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, targetYawRad)
        const euler = new THREE.Euler().setFromQuaternion(current, 'YXZ')
        euler.y = dampAngleRadians(
          euler.y,
          targetYawRad,
          expSmoothingAlpha(AUTO_TOUR_YAW_SMOOTHING, deltaSeconds),
        )
        target.setFromEuler(new THREE.Euler(0, euler.y, 0, 'YXZ'))
        applyObjectWorldPose(object, desiredPosition, target)
      }

      state.distanceAlongRoute = nextDistance
      state.routeWaypointCount = routeData.evaluation.points.length
      state.sourceRouteWaypointCount = fullRouteData.evaluation.points.length
      syncNodeTransformFromObject(node, object)
      deps.onNodeObjectTransformUpdated?.(node.id, object)

      const reachedStops = crossedStops.filter((stop) => (
        stop.definition.id !== targetedDestinationStop?.definition.id
        && stop.routeDistance <= nextEventDistance + 1e-4
      ))
      for (const stop of reachedStops) {
        const stopKey = guideRouteEventKey(stop.routeNodeId, stop.definition.id)
        if (state.firedStopIds.has(stopKey)) {
          continue
        }
        state.firedStopIds.add(stopKey)
        deps.onGuideStop?.(node.id, stop, { isTourTarget: false })
      }
      if (targetedDestinationStop && targetAtNextEvent) {
        state.firedStopIds.add(guideRouteEventKey(
          targetedDestinationStop.routeNodeId,
          targetedDestinationStop.definition.id,
        ))
        state.distanceAlongRoute = totalLength
        state.smoothedSpeedMps = 0
        pausedTourNodes.add(node.id)
        deps.onGuideStop?.(node.id, targetedDestinationStop, { isTourTarget: true })
        return
      }
      if (transitionAtNextEvent) {
        state.firedTransitionIds.add(guideRouteEventKey(
          transitionAtNextEvent.routeNodeId,
          transitionAtNextEvent.definition.id,
        ))
        state.pendingTransitionId = transitionAtNextEvent.definition.id
        deps.onGuideTransition?.(node.id, transitionAtNextEvent)
      }
      if (wrapped) {
        state.firedStopIds.clear()
        state.firedTransitionIds.clear()
      }
      if (isTerminal && !transitionAtNextEvent) {
        disabledTourNodes.add(node.id)
        activeTourNodes.delete(node.id)
        pausedTourNodes.delete(node.id)
        deps.onTerminalStop?.(node.id, 'guide-route-complete')
      }
    }
  }

  return {
    update,
    resolveRouteSnap,
    seedTourPlaybackState,
    startTour: (nodeId, target) => {
      if (!nodeId) {
        return
      }
      const object = deps.nodeObjectMap.get(nodeId) ?? null
      if (object) {
        vehicleLocalBoundsCache.delete(object)
        visualWheelFootprintCache.delete(object)
      }
      disabledTourNodes.delete(nodeId)
      pausedTourNodes.delete(nodeId)
      playbackStates.delete(nodeId)
      if (target) {
        pendingTourTargets.set(nodeId, target)
      } else {
        pendingTourTargets.delete(nodeId)
      }
      activeTourNodes.add(nodeId)
      deps.onAutoSurfaceStart?.(nodeId)
    },
    continueFromEnd: (nodeId) => {
      const object = deps.nodeObjectMap.get(nodeId) ?? null
      if (object) {
        vehicleLocalBoundsCache.delete(object)
        visualWheelFootprintCache.delete(object)
      }
      disabledTourNodes.delete(nodeId)
      pausedTourNodes.delete(nodeId)
      playbackStates.delete(nodeId)
      pendingTourTargets.delete(nodeId)
      activeTourNodes.add(nodeId)
      deps.onAutoSurfaceStart?.(nodeId)
    },
    stopTour,
    setPaused: (nodeId, paused) => {
      if (!activeTourNodes.has(nodeId)) {
        return
      }
      if (paused) {
        pausedTourNodes.add(nodeId)
        const state = playbackStates.get(nodeId)
        if (state) {
          state.smoothedSpeedMps = 0
        }
      } else {
        pausedTourNodes.delete(nodeId)
      }
    },
    isPaused: (nodeId) => pausedTourNodes.has(nodeId),
    isTourActive: (nodeId) => (
      !disabledTourNodes.has(nodeId) && activeTourNodes.has(nodeId)
    ),
    completeGuideTransition: (nodeId, success, message) => {
      const state = playbackStates.get(nodeId)
      if (!state?.pendingTransitionId) {
        return
      }
      state.pendingTransitionId = null
      if (!success) {
        disabledTourNodes.add(nodeId)
        activeTourNodes.delete(nodeId)
        pausedTourNodes.delete(nodeId)
        deps.onTerminalStop?.(nodeId, message || 'guide-route-transition-failed')
      }
    },
    reset: () => {
      Array.from(activeTourNodes).forEach((nodeId) => {
        deps.onAutoSurfaceEnd?.(nodeId)
      })
      activeTourNodes.clear()
      pausedTourNodes.clear()
      disabledTourNodes.clear()
      playbackStates.clear()
      pendingTourTargets.clear()
    },
  }
}
