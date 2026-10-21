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
  groundClearanceM: number
  dockHoldIndex: number | null
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const TERMINAL_DISTANCE_EPSILON = 0.05
const DOCK_DISTANCE_EPSILON = 0.05
const AUTO_TOUR_YAW_SMOOTHING = 12
const routeDataCache = new WeakMap<EvaluatedGuideRoute, RouteData>()

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

function resolveObjectGroundClearance(object: THREE.Object3D | null): number {
  if (!object) {
    return 0
  }
  object.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) {
    return 0
  }
  const origin = object.getWorldPosition(new THREE.Vector3())
  return Math.max(0, origin.y - bounds.min.y)
}

function resolveVehicleGroundClearance(
  node: SceneNode,
  object: THREE.Object3D | null,
): number {
  return resolveEnabledComponentState<VehicleComponentProps>(node, VEHICLE_COMPONENT_TYPE)
    ? resolveObjectGroundClearance(object)
    : 0
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
    node: SceneNode
    object: THREE.Object3D
    routeNodeId: string
    routeData: RouteData
  }): PlaybackState {
    const { node, object, routeNodeId, routeData } = params
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
      groundClearanceM: resolveVehicleGroundClearance(node, object),
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
    const worldPosition = sample.point.clone()
    worldPosition.y += resolveVehicleGroundClearance(node, object)
    return {
      nodeId,
      routeNodeId: tourProps.routeNodeId!,
      worldPosition,
      forwardWorld,
      yaw: Math.atan2(-forwardWorld.z, forwardWorld.x),
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
      groundClearanceM: resolveVehicleGroundClearance(node, object),
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
          node,
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
      const desiredPosition = sample.point.clone()
      desiredPosition.y += state.groundClearanceM
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
      disabledTourNodes.delete(nodeId)
      playbackStates.delete(nodeId)
      activeTourNodes.add(nodeId)
      deps.onAutoSurfaceStart?.(nodeId)
    },
    continueFromEnd: (nodeId) => {
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
