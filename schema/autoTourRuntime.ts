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
} from './components'
import {
  evaluateGuideRoute,
  sampleEvaluatedGuideRouteAtDistance,
  type EvaluatedGuideRoute,
} from './guideRouteRuntime'
import { sampleProceduralLandscapeTerrainHeight } from './proceduralLandscape/runtime'
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
  onDockRequestedPause?: (
    nodeId: string,
    payload: { waypointIndex: number; terminal: boolean },
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
  polylineData3d: PolylineMetricData
  waypointArcLengths3d: number[]
}

export type AutoTourRuntime = {
  update: (deltaSeconds: number) => void
  reset: () => void
  resolveRouteSnap: (nodeId: string) => AutoTourRouteSnapResult | null
  seedTourPlaybackState: (nodeId: string, snap: AutoTourRouteSnapResult) => void
  startTour: (nodeId: string) => void
  continueFromEnd: (nodeId: string) => void
  stopTour: (nodeId: string) => void
  isTourActive: (nodeId: string) => boolean
}

type RouteData = {
  evaluation: EvaluatedGuideRoute
  polylineData3d: PolylineMetricData
  waypointArcLengths3d: number[]
}

type PlaybackState = {
  routeNodeId: string
  routeWaypointCount: number
  distanceAlongRoute: number
  hasGroundSupportSample: boolean
  dockHoldIndex: number | null
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const TERMINAL_DISTANCE_EPSILON = 0.05
const DOCK_DISTANCE_EPSILON = 0.05
const AUTO_TOUR_YAW_SMOOTHING = 12
const AUTO_TOUR_SURFACE_CLEARANCE_M = 0.04
const AUTO_TOUR_GROUND_FOLLOW_DAMPING = 10
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
  loop: boolean,
): RouteData | null {
  const evaluation = evaluateGuideRoute({ routeNode, providerObject })
  if (evaluation.status !== 'ready') {
    return null
  }
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

function resolveNextDockDistance(
  evaluation: EvaluatedGuideRoute,
  currentDistance: number,
): { index: number; distance: number } | null {
  for (let index = 0; index < evaluation.dock.length; index += 1) {
    if (!evaluation.dock[index]) {
      continue
    }
    const distance = evaluation.cumulativeLengths[index] ?? 0
    if (distance > currentDistance + DOCK_DISTANCE_EPSILON) {
      return { index, distance }
    }
  }
  return null
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

function resolveSupportedVehicleWorldPosition(params: {
  object: THREE.Object3D
  routePoint: THREE.Vector3
  worldQuaternion: THREE.Quaternion
  providerNodeId: string | null
  resolveObjectBounds: (object: THREE.Object3D) => THREE.Box3
  localBoundsCache: WeakMap<THREE.Object3D, THREE.Box3>
}): THREE.Vector3 {
  const {
    object,
    routePoint,
    worldQuaternion,
    providerNodeId,
    resolveObjectBounds,
    localBoundsCache,
  } = params
  const originalPosition = object.position.clone()
  const originalQuaternion = object.quaternion.clone()
  try {
    object.updateMatrixWorld(true)
    let localBounds = localBoundsCache.get(object) ?? null
    if (!localBounds) {
      const sourceBounds = resolveObjectBounds(object)
      if (sourceBounds.isEmpty()) {
        return routePoint.clone()
      }
      const inverseObjectMatrix = object.matrixWorld.clone().invert()
      localBounds = transformBoundsCorners(sourceBounds, inverseObjectMatrix)
      localBoundsCache.set(object, localBounds)
    }
    applyObjectWorldPose(object, routePoint.clone(), worldQuaternion)
    const bounds = transformBoundsCorners(localBounds, object.matrixWorld)
    if (bounds.isEmpty()) {
      return routePoint.clone()
    }
    const surfaceHeights = [routePoint.y]
    if (providerNodeId) {
      const samplePoints = [
        [routePoint.x, routePoint.z],
        [bounds.min.x, bounds.min.z],
        [bounds.max.x, bounds.min.z],
        [bounds.min.x, bounds.max.z],
        [bounds.max.x, bounds.max.z],
      ] as const
      samplePoints.forEach(([x, z]) => {
        const height = sampleProceduralLandscapeTerrainHeight(providerNodeId, x, z)
        if (height != null && Number.isFinite(height)) {
          surfaceHeights.push(height)
        }
      })
    }
    const supportSurfaceY = Math.max(...surfaceHeights)
    const supported = routePoint.clone()
    supported.y += supportSurfaceY + AUTO_TOUR_SURFACE_CLEARANCE_M - bounds.min.y
    return supported
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
  const right = new THREE.Vector3().crossVectors(forward, normal).normalize()
  const up = right.lengthSq() > 1e-8
    ? new THREE.Vector3().crossVectors(right, forward).normalize()
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
  const disabledTourNodes = new Set<string>()
  const vehicleLocalBoundsCache = new WeakMap<THREE.Object3D, THREE.Box3>()
  const resolveObjectBounds = deps.resolveObjectBounds
    ?? ((object: THREE.Object3D) => new THREE.Box3().setFromObject(object))

  function resolveNodeRoute(tourProps: AutoTourComponentProps): RouteData | null {
    const routeNodeId = tourProps.routeNodeId
    if (!routeNodeId) {
      return null
    }
    const routeNode = deps.resolveNodeById(routeNodeId)
    if (!routeNode || routeNode.dynamicMesh?.type !== 'GuideRoute') {
      return null
    }
    const routeProps = routeNode.components?.guideRoute?.props as
      | { surfaceProviderNodeId?: unknown }
      | undefined
    const providerNodeId = typeof routeProps?.surfaceProviderNodeId === 'string'
      ? routeProps.surfaceProviderNodeId
      : ''
    const providerObject = providerNodeId
      ? deps.nodeObjectMap.get(providerNodeId) ?? null
      : null
    return resolveRouteData(routeNode, providerObject, Boolean(tourProps.loop))
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
      routeWaypointCount: routeData.evaluation.points.length,
      distanceAlongRoute: projection.s,
      hasGroundSupportSample: false,
      dockHoldIndex: null,
    }
  }

  function resolveSnap(
    nodeId: string,
    tourProps: AutoTourComponentProps,
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
    const yaw = Math.atan2(-forwardWorld.z, forwardWorld.x)
    const worldQuaternion = vehicleComponent
      ? buildVehicleQuaternion(
        clampVehicleComponentProps(vehicleComponent.props),
        forwardWorld,
        sample.normal,
      )
      : new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw)
    const worldPosition = vehicleComponent
      ? resolveSupportedVehicleWorldPosition({
        object,
        routePoint: sample.point,
        worldQuaternion,
        providerNodeId: routeData.evaluation.providerNodeId,
        resolveObjectBounds,
        localBoundsCache: vehicleLocalBoundsCache,
      })
      : sample.point.clone()
    return {
      nodeId,
      routeNodeId: tourProps.routeNodeId!,
      worldPosition,
      worldQuaternion,
      forwardWorld,
      yaw,
      projectedS: projection.s,
      segmentIndex: projection.segmentIndex,
      targetIndex: findTargetWaypointIndexByProjectedS(
        routeData.waypointArcLengths3d,
        projection.s,
        Boolean(tourProps.loop),
      ),
      routeWaypointCount: routeData.evaluation.points.length,
      polylineData3d: routeData.polylineData3d,
      waypointArcLengths3d: routeData.waypointArcLengths3d,
    }
  }

  function resolveRouteSnap(nodeId: string): AutoTourRouteSnapResult | null {
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
    const routeData = resolveNodeRoute(tourProps)
    return routeData
      ? resolveSnap(nodeId, tourProps, node, routeData)
      : null
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
    playbackStates.set(nodeId, {
      routeNodeId: snap.routeNodeId,
      routeWaypointCount: snap.routeWaypointCount,
      distanceAlongRoute: snap.projectedS,
      hasGroundSupportSample: false,
      dockHoldIndex: null,
    })
  }

  function stopTour(nodeId: string): void {
    playbackStates.delete(nodeId)
    activeTourNodes.delete(nodeId)
    disabledTourNodes.add(nodeId)
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
      const routeData = resolveNodeRoute(tourProps)
      if (!routeData) {
        continue
      }
      const routeNodeId = tourProps.routeNodeId!
      let state = playbackStates.get(node.id)
      if (
        !state
        || state.routeNodeId !== routeNodeId
        || state.routeWaypointCount !== routeData.evaluation.points.length
      ) {
        state = initializePlaybackState({
          object,
          routeNodeId,
          routeData,
        })
        playbackStates.set(node.id, state)
      }
      if (!activeTourNodes.has(node.id)) {
        activeTourNodes.add(node.id)
        deps.onAutoSurfaceStart?.(node.id)
      }

      if (state.dockHoldIndex !== null) {
        const heldDistance = routeData.evaluation.cumulativeLengths[state.dockHoldIndex] ?? 0
        state.distanceAlongRoute = heldDistance + DOCK_DISTANCE_EPSILON
        state.dockHoldIndex = null
      }

      const totalLength = routeData.evaluation.totalLength
      if (totalLength <= 1e-6) {
        continue
      }
      const speedMps = Math.max(0, tourProps.speedMps)
      const step = speedMps * deltaSeconds
      let nextDistance = state.distanceAlongRoute + step
      let pauseAfterApply: { index: number; terminal: boolean } | null = null

      const nextDock = resolveNextDockDistance(
        routeData.evaluation,
        state.distanceAlongRoute,
      )
      if (nextDock && nextDistance >= nextDock.distance) {
        nextDistance = nextDock.distance
        pauseAfterApply = {
          index: nextDock.index,
          terminal: !tourProps.loop && nextDock.distance >= totalLength - TERMINAL_DISTANCE_EPSILON,
        }
      }

      const isTerminal = !tourProps.loop
        && nextDistance >= totalLength - TERMINAL_DISTANCE_EPSILON
      if (isTerminal) {
        nextDistance = totalLength
        pauseAfterApply = {
          index: routeData.evaluation.points.length - 1,
          terminal: true,
        }
      } else if (totalLength > 0 && nextDistance > totalLength) {
        if (tourProps.loop) {
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
      let desiredPosition = sample.point.clone()
      const vehicleComponent = resolveEnabledComponentState<VehicleComponentProps>(
        node,
        VEHICLE_COMPONENT_TYPE,
      )
      if (vehicleComponent) {
        const vehicleProps = clampVehicleComponentProps(vehicleComponent.props)
        const desiredQuaternion = buildVehicleQuaternion(
          vehicleProps,
          forwardWorld,
          sample.normal,
        )
        object.updateMatrixWorld(true)
        const currentWorldQuaternion = object.getWorldQuaternion(new THREE.Quaternion())
        currentWorldQuaternion.slerp(
          desiredQuaternion,
          expSmoothingAlpha(AUTO_TOUR_YAW_SMOOTHING, deltaSeconds),
        )
        desiredPosition = resolveSupportedVehicleWorldPosition({
          object,
          routePoint: sample.point,
          worldQuaternion: currentWorldQuaternion,
          providerNodeId: routeData.evaluation.providerNodeId,
          resolveObjectBounds,
          localBoundsCache: vehicleLocalBoundsCache,
        })
        if (state.hasGroundSupportSample) {
          const currentWorldPosition = object.getWorldPosition(new THREE.Vector3())
          const smoothedY = THREE.MathUtils.lerp(
            currentWorldPosition.y,
            desiredPosition.y,
            expSmoothingAlpha(AUTO_TOUR_GROUND_FOLLOW_DAMPING, deltaSeconds),
          )
          desiredPosition.y = Math.max(desiredPosition.y, smoothedY)
        }
        state.hasGroundSupportSample = true
        applyObjectWorldPose(object, desiredPosition, currentWorldQuaternion)
      } else {
        const yaw = Math.atan2(-forwardWorld.z, forwardWorld.x)
        const current = object.getWorldQuaternion(new THREE.Quaternion())
        const target = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw)
        const euler = new THREE.Euler().setFromQuaternion(current, 'YXZ')
        euler.y = dampAngleRadians(
          euler.y,
          yaw,
          expSmoothingAlpha(AUTO_TOUR_YAW_SMOOTHING, deltaSeconds),
        )
        target.setFromEuler(new THREE.Euler(0, euler.y, 0, 'YXZ'))
        applyObjectWorldPose(object, desiredPosition, target)
      }

      state.distanceAlongRoute = nextDistance
      state.routeWaypointCount = routeData.evaluation.points.length
      syncNodeTransformFromObject(node, object)
      deps.onNodeObjectTransformUpdated?.(node.id, object)

      if (pauseAfterApply) {
        if (pauseAfterApply.terminal) {
          disabledTourNodes.add(node.id)
          activeTourNodes.delete(node.id)
          deps.onTerminalStop?.(node.id, 'guide-route-complete')
        } else {
          state.dockHoldIndex = pauseAfterApply.index
        }
        deps.onDockRequestedPause?.(node.id, {
          waypointIndex: pauseAfterApply.index,
          terminal: pauseAfterApply.terminal,
        })
      }
    }
  }

  return {
    update,
    resolveRouteSnap,
    seedTourPlaybackState,
    startTour: (nodeId) => {
      if (!nodeId) {
        return
      }
      const object = deps.nodeObjectMap.get(nodeId) ?? null
      if (object) {
        vehicleLocalBoundsCache.delete(object)
      }
      disabledTourNodes.delete(nodeId)
      playbackStates.delete(nodeId)
      activeTourNodes.add(nodeId)
      deps.onAutoSurfaceStart?.(nodeId)
    },
    continueFromEnd: (nodeId) => {
      const object = deps.nodeObjectMap.get(nodeId) ?? null
      if (object) {
        vehicleLocalBoundsCache.delete(object)
      }
      disabledTourNodes.delete(nodeId)
      playbackStates.delete(nodeId)
      activeTourNodes.add(nodeId)
      deps.onAutoSurfaceStart?.(nodeId)
    },
    stopTour,
    isTourActive: (nodeId) => (
      !disabledTourNodes.has(nodeId) && activeTourNodes.has(nodeId)
    ),
    reset: () => {
      Array.from(activeTourNodes).forEach((nodeId) => {
        deps.onAutoSurfaceEnd?.(nodeId)
      })
      activeTourNodes.clear()
      disabledTourNodes.clear()
      playbackStates.clear()
    },
  }
}
