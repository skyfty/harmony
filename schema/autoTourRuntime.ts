import * as THREE from 'three'
import type { SceneNode } from './core'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import { applyPurePursuitVehicleControlSafe, holdVehicleBrakeSafe, resetPurePursuitVehicleControlState, type PurePursuitVehicleControlState } from './purePursuitRuntime'
import { syncBodyFromObject } from './physicsBodySync'
import { sleepPhysicsBody, stopPhysicsBodyMotion } from './physicsRuntimeBridge'
import type { VehicleDriveVehicle } from './VehicleDriveController'
import type { ControlledNodeMotionTelemetry } from './controlledNodeMotionRuntime'
import type { PolylineMetricData } from './polylineProgress'
import { buildPolylineMetricData, buildPolylineVertexArcLengths, projectPointToPolyline } from './polylineProgress'
import {
  findClosestWaypointIndex,
  findTargetWaypointIndexByProjectedS,
  resolvePathFollowPlanarArrivalDistance,
} from './pathFollowCommon'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  GUIDE_ROUTE_COMPONENT_TYPE,
  clampAutoTourComponentProps,
  clampGuideRouteComponentProps,
  PURE_PURSUIT_COMPONENT_TYPE,
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  clampPurePursuitComponentProps,
  type AutoTourComponentProps,
  type GuideRouteComponentProps,
  type PurePursuitComponentProps,
  type VehicleComponentProps,
} from './components'

export type AutoTourVehicleInstanceLike = {
  vehicle: VehicleDriveVehicle
  wheelCount: number
  steerableWheelIndices: number[]
  axisForward: THREE.Vector3
}

export type AutoTourRuntimeDeps = {
  /** Nodes in the current preview/runtime graph. */
  iterNodes: () => Iterable<SceneNode>
  /** Used to resolve the referenced guide-route node. */
  resolveNodeById: (id: string) => SceneNode | null | undefined
  /** Maps nodeId -> runtime Object3D (used for local->world of guide-route points). */
  nodeObjectMap: Map<string, THREE.Object3D>
  /** Maps nodeId -> vehicle instance. */
  vehicleInstances: Map<string, AutoTourVehicleInstanceLike>
  /** Optional resolver for actual runtime telemetry of the controlled node. */
  resolveVehicleMotionTelemetry?: (nodeId: string) => ControlledNodeMotionTelemetry | null
  /** When true, AutoTour is paused (manual drive has priority). */
  isManualDriveActive: () => boolean
  /** Optional callback when AutoTour updates a runtime object's transform (useful for instanced meshes). */
  onNodeObjectTransformUpdated?: (nodeId: string, object: THREE.Object3D) => void

  /** Optional callback to stop any node motion instantly (e.g., rigidbody velocity reset). */
  stopNodeMotion?: (nodeId: string) => void

  /** Optional callback invoked when a tour reaches a terminal stop (non-looping end). */
  onTerminalStop?: (nodeId: string, reason: string) => void

  /** Optional callback invoked when AutoTour requests the host to pause (e.g., after docking at a waypoint). */
  onDockRequestedPause?: (nodeId: string, payload: { waypointIndex: number; terminal: boolean }) => void

  /**
   * When true, auto-tour will only run after calling `startTour(nodeId)`.
   * When false/omitted, enabled AutoTour components will run automatically (legacy behavior).
   */
  requiresExplicitStart?: boolean
}

export type AutoTourRuntime = {
  update: (deltaSeconds: number) => void
  reset: () => void
  /** Computes the nearest guide-route snap point and forward heading for a touring node. */
  resolveRouteSnap: (nodeId: string) => AutoTourRouteSnapResult | null
  /** Seeds playback state so the next update starts from the provided snap pose instead of reinitializing from the old position. */
  seedTourPlaybackState: (nodeId: string, snap: AutoTourRouteSnapResult) => void
  /** Enables auto-tour playback for the given nodeId (if it has an enabled AutoTour component). */
  startTour: (nodeId: string) => void
  /**
   * When a non-looping tour has reached its terminal stop, calling this will
   * clear the terminal lock and drive the vehicle straight back to waypoint(0).
   * Once the start is reached, the tour continues on a new round.
   */
  continueFromEnd: (nodeId: string) => void
  /** Stops auto-tour playback for the given nodeId and immediately stops motion. */
  stopTour: (nodeId: string) => void
  /** Returns whether the given nodeId is currently marked as touring. */
  isTourActive: (nodeId: string) => boolean
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

type AutoTourPlaybackMode = 'seek-waypoint' | 'path' | 'loop-to-start' | 'return-to-start' | 'stopped' | 'stopping' | 'dock-hold'

type AutoTourPlaybackState = {
  mode: AutoTourPlaybackMode
  targetIndex: number
  routeNodeId: string
  routeWaypointCount: number
  hasSmoothedState: boolean
  smoothedWorldPosition: THREE.Vector3
  smoothedYaw: number

  /** When stopping/docking, the index we are targeting to come to a stop at. */
  dockStopIndex: number | undefined
  /** When in dock-hold, the index we have stopped at (used to advance on resume). */
  dockHoldIndex: number | undefined
  /** Latch to prevent repeated dock pause callbacks while staying at the same waypoint. */
  dockLatchIndex: number | undefined

  polylineData3d: PolylineMetricData | undefined
  waypointArcLengths3d: number[] | undefined
  lastProjectedS: number | undefined
}
const AUTO_TOUR_POSITION_SMOOTHING = 14
const AUTO_TOUR_YAW_SMOOTHING = 12
const AUTO_TOUR_STOP_POSITION_EPSILON = 0.03
const AUTO_TOUR_DIRECT_MOVE_TURN_LOOKAHEAD_SECONDS = 0.9
const AUTO_TOUR_DIRECT_MOVE_TURN_LOOKAHEAD_MIN = 1.5
const AUTO_TOUR_DIRECT_MOVE_TURN_LOOKAHEAD_MAX = 6
const AUTO_TOUR_DIRECT_MOVE_CORNER_FULL_SLOW_ANGLE = THREE.MathUtils.degToRad(80)
const AUTO_TOUR_DIRECT_MOVE_YAW_FULL_SLOW_ANGLE = THREE.MathUtils.degToRad(65)
const AUTO_TOUR_DIRECT_MOVE_MIN_SPEED_FACTOR = 0.42
const AUTO_TOUR_DIRECT_MOVE_CORNER_BLEND_FACTOR = 0.75
// When loop=false, treat near-identical start/end points as accidental duplicates and drop the last one.
// Keep this small to avoid altering legitimately-close routes.
const AUTO_TOUR_END_DUPLICATE_EPSILON_METERS = 0.05
const AUTO_TOUR_STOP_NEAR_END_DISTANCE_METERS = 0.5


function expSmoothingAlpha(smoothing: number, deltaSeconds: number): number {
  const k = Math.max(0, smoothing)
  const dt = Math.max(0, deltaSeconds)
  if (k <= 0 || dt <= 0) {
    return 1
  }
  return 1 - Math.exp(-k * dt)
}

function dampAngleRadians(current: number, target: number, alpha: number): number {
  const a = THREE.MathUtils.clamp(alpha, 0, 1)
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * a
}

function getWorldYawRadiansFromQuaternion(quaternion: THREE.Quaternion): number {
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  euler.setFromQuaternion(quaternion)
  return euler.y
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

function resolveVehicleSpeedCapMps(vehicleProps: VehicleComponentProps | null | undefined): number {
  const maxSpeedKmh = vehicleProps?.maxSpeedKmh
  if (typeof maxSpeedKmh !== 'number' || !Number.isFinite(maxSpeedKmh) || maxSpeedKmh <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return maxSpeedKmh / 3.6
}

function resolveRemainingRouteDistance(
  polylineData3d: PolylineMetricData | undefined,
  projectedS: number | undefined,
): number | null {
  if (!polylineData3d || !Number.isFinite(polylineData3d.totalLength) || typeof projectedS !== 'number' || !Number.isFinite(projectedS)) {
    return null
  }
  return Math.max(0, polylineData3d.totalLength - projectedS)
}

function shouldEnterStoppingByRemainingDistance(
  polylineData3d: PolylineMetricData | undefined,
  projectedS: number | undefined,
  thresholdMeters: number,
): boolean {
  const remainingDistance = resolveRemainingRouteDistance(polylineData3d, projectedS)
  if (remainingDistance === null) {
    return false
  }
  return remainingDistance <= Math.max(0, thresholdMeters)
}

function syncNodeTransformFromObject(node: SceneNode, object: THREE.Object3D): void {
  // Keep runtime node state in sync so other systems that apply node->object transforms
  // won't snap the object back (prevents jitter / stuck targetIndex).
  setVector3Like(node.position as any, object.position.x, object.position.y, object.position.z)
  // Use YXZ for yaw stability; scene nodes store Euler components.
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  euler.setFromQuaternion(object.quaternion)
  setVector3Like(node.rotation as any, euler.x, euler.y, euler.z)
}

// helper `findNextWaypointIndexByS` removed — unused

export function createAutoTourRuntime(deps: AutoTourRuntimeDeps): AutoTourRuntime {
  const autoTourPlaybackState = new Map<string, AutoTourPlaybackState>()
  const purePursuitControlStateByNodeId = new Map<string, Map<string, PurePursuitVehicleControlState>>()
  const requiresExplicitStart = deps.requiresExplicitStart === true
  const activeTourNodes = new Set<string>()
  const disabledTourNodes = new Set<string>()
  // Nodes that reached a terminal (loop=false) stop and must remain "parked" via continuous braking.
  // This is intentionally independent of autoTourPlaybackState to allow flexible resume behavior.
  const terminalBrakeHoldNodes = new Set<string>()
  // Nodes that reached a terminal (loop=false) stop and should not re-initialize movement until restarted.
  const terminalStoppedNodes = new Set<string>()
  const terminalParkedPoses = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>()

  // Nodes that should re-enter playback by first returning to waypoint(0).
  const pendingReturnToStartNodes = new Set<string>()

  const autoTourTargetPosition = new THREE.Vector3()
  const autoTourCurrentPosition = new THREE.Vector3()
  const autoTourDirection = new THREE.Vector3()
  const autoTourDesiredDir = new THREE.Vector3()
  const autoTourNextSegmentDir = new THREE.Vector3()
  const autoTourObjectWorldQuaternion = new THREE.Quaternion()
  const autoTourParentWorldQuaternion = new THREE.Quaternion()
  const autoTourWorldQuaternion = new THREE.Quaternion()
  const autoTourLocalQuaternion = new THREE.Quaternion()
  const autoTourUp = new THREE.Vector3(0, 1, 0)
  const autoTourNextWorldPosition = new THREE.Vector3()
  const autoTourLocalPosition = new THREE.Vector3()
  const autoTourPlanarTarget = new THREE.Vector3()
  const autoTourSnapForward = new THREE.Vector3()
  const autoTourSnapPoint = new THREE.Vector3()

  const returnToStartPointA = new THREE.Vector3()
  const returnToStartPointB = new THREE.Vector3()
  const returnToStartPointC = new THREE.Vector3()
  const returnToStartPolyline: THREE.Vector3[] = [returnToStartPointA, returnToStartPointB, returnToStartPointC]

  function clearPlaybackStateForNode(nodeId: string): void {
    const prefix = `${nodeId}:`
    for (const key of autoTourPlaybackState.keys()) {
      if (key.startsWith(prefix)) {
        autoTourPlaybackState.delete(key)
      }
    }
  }

  function resetVehicleControlState(state: PurePursuitVehicleControlState): void {
    resetPurePursuitVehicleControlState(state)
  }

  function resetVehicleControlStatesForNode(nodeId: string): void {
    const nodeStates = purePursuitControlStateByNodeId.get(nodeId)
    if (!nodeStates) {
      return
    }
    for (const state of nodeStates.values()) {
      resetVehicleControlState(state)
    }
  }

  function clearVehicleControlStateForNode(nodeId: string): void {
    purePursuitControlStateByNodeId.delete(nodeId)
  }

  function ensureVehicleControlStateForNode(nodeId: string, autoTourId: string): PurePursuitVehicleControlState {
    let nodeStates = purePursuitControlStateByNodeId.get(nodeId)
    if (!nodeStates) {
      nodeStates = new Map<string, PurePursuitVehicleControlState>()
      purePursuitControlStateByNodeId.set(nodeId, nodeStates)
    }
    let state = nodeStates.get(autoTourId)
    if (!state) {
      state = {}
      nodeStates.set(autoTourId, state)
    }
    return state
  }

  function getAutoTourDockStopIndex(state: AutoTourPlaybackState, endIndex: number): number {
    return typeof state.dockStopIndex === 'number' && Number.isFinite(state.dockStopIndex)
      ? Math.max(0, Math.min(endIndex, Math.floor(state.dockStopIndex)))
      : endIndex
  }

  function requestAutoTourDockPause(nodeId: string, stopIndex: number, terminal: boolean): void {
    try {
      deps.onDockRequestedPause?.(nodeId, { waypointIndex: stopIndex, terminal })
    } catch {
      // ignore host callback errors
    }
  }

  function writeObjectWorldPosition(nodeObject: THREE.Object3D, worldPosition: THREE.Vector3): void {
    if (nodeObject.parent) {
      nodeObject.parent.updateMatrixWorld(true)
      autoTourLocalPosition.copy(worldPosition)
      nodeObject.parent.worldToLocal(autoTourLocalPosition)
      nodeObject.position.copy(autoTourLocalPosition)
    } else {
      nodeObject.position.copy(worldPosition)
    }
  }

  function snapNodeObjectToWorldPosition(node: SceneNode, nodeObject: THREE.Object3D, worldPosition: THREE.Vector3): void {
    nodeObject.position.copy(worldPosition)
    syncNodeTransformFromObject(node, nodeObject)
    deps.onNodeObjectTransformUpdated?.(node.id, nodeObject)
  }

  function finalizeAutoTourDockStop(options: {
    nodeId: string
    state: AutoTourPlaybackState
    endIndex: number
    tourProps: AutoTourComponentProps
    terminalReason: string
  }): void {
    const { nodeId, state, endIndex, tourProps, terminalReason } = options
    const stopIndex = getAutoTourDockStopIndex(state, endIndex)
    const isTerminal = !tourProps.loop && stopIndex >= endIndex
    if (isTerminal) {
      state.mode = 'stopped'
      finalizeTourTerminalStop({
        nodeId,
        reason: terminalReason,
        state,
        tourProps,
      })
      return
    }

    state.mode = 'dock-hold'
      state.dockHoldIndex = stopIndex
    if (state.dockLatchIndex !== stopIndex) {
      state.dockLatchIndex = stopIndex
      requestAutoTourDockPause(nodeId, stopIndex, false)
    }
  }

  function ensurePlaybackStateForNode(options: {
    nodeId: string
    autoTourId: string
    routeNodeId: string
    points: THREE.Vector3[]
    nodeObject: THREE.Object3D | null
    vehicleInstance: AutoTourVehicleInstanceLike | null
    usePhysicsDrive: boolean
    hasVehicleInstance: boolean
  }): AutoTourPlaybackState | null {
    const {
      nodeId,
      autoTourId,
      routeNodeId,
      points,
      nodeObject,
      vehicleInstance,
      usePhysicsDrive,
      hasVehicleInstance,
    } = options
    const key = `${nodeId}:${autoTourId}`
    const cached = autoTourPlaybackState.get(key) ?? null
    let state = cached
    if (state && state.routeNodeId === routeNodeId && state.routeWaypointCount === points.length) {
      return state
    }
    if (!nodeObject && !(usePhysicsDrive && hasVehicleInstance)) {
      return null
    }

    const positionSample = autoTourCurrentPosition
    if (usePhysicsDrive && hasVehicleInstance) {
      const body = vehicleInstance!.vehicle.chassisBody
      positionSample.set(body.position.x, body.position.y, body.position.z)
    } else {
      nodeObject!.getWorldPosition(positionSample)
    }
    const controlState = ensureVehicleControlStateForNode(nodeId, autoTourId)

    const initialTargetIndex = findClosestWaypointIndex(points, positionSample)
    let polylineData3d: PolylineMetricData | undefined
    let waypointArcLengths3d: number[] | undefined
    let projectedS: number | undefined
    let initialYaw = 0

    if (usePhysicsDrive && hasVehicleInstance) {
      autoTourObjectWorldQuaternion
        .set(
          vehicleInstance!.vehicle.chassisBody.quaternion.x,
          vehicleInstance!.vehicle.chassisBody.quaternion.y,
          vehicleInstance!.vehicle.chassisBody.quaternion.z,
          vehicleInstance!.vehicle.chassisBody.quaternion.w,
        )
        .normalize()
      initialYaw = getWorldYawRadiansFromQuaternion(autoTourObjectWorldQuaternion)
    } else {
      nodeObject!.getWorldQuaternion(autoTourObjectWorldQuaternion)
      initialYaw = getWorldYawRadiansFromQuaternion(autoTourObjectWorldQuaternion)
    }

    state = {
      mode: 'seek-waypoint',
      targetIndex: initialTargetIndex,
      routeNodeId,
      routeWaypointCount: points.length,
      hasSmoothedState: true,
      smoothedWorldPosition: positionSample.clone(),
      smoothedYaw: initialYaw,
      polylineData3d,
      waypointArcLengths3d,
      lastProjectedS: projectedS,
      dockStopIndex: undefined,
      dockHoldIndex: undefined,
      dockLatchIndex: undefined,
    }
    autoTourPlaybackState.set(key, state)
    resetVehicleControlState(controlState)
    return state
  }

  function prepareAutoTourRouteMotion(options: {
    nodeId: string
    state: AutoTourPlaybackState
    vehicleInstance: AutoTourVehicleInstanceLike | null
    points: THREE.Vector3[]
    dockFlags: boolean[]
    moveSpeed: number
    deltaSeconds: number
    arrivalDistance: number
    tourProps: AutoTourComponentProps
    routeSpeed?: number
    pursuitProps?: PurePursuitComponentProps
    vehicleProps?: VehicleComponentProps
    controlState?: PurePursuitVehicleControlState
    isVehicleRoute: boolean
  }): { endIndex: number; distance: number; continueRoute: boolean } {
    const {
      nodeId,
      state,
      vehicleInstance,
      points,
      dockFlags,
      moveSpeed,
      deltaSeconds,
      arrivalDistance,
      tourProps,
      routeSpeed = 0,
      pursuitProps,
      vehicleProps,
      controlState,
      isVehicleRoute,
    } = options
    const resolvedPursuitProps = pursuitProps ?? null
    const resolvedVehicleProps = vehicleProps ?? null
    const resolvedControlState = controlState ?? null
    const endIndex = points.length - 1

    if (state.mode === 'return-to-start') {
      const startPoint = points[0]!
      const dx = startPoint.x - autoTourCurrentPosition.x
      const dz = startPoint.z - autoTourCurrentPosition.z
      const distanceToStart = Math.sqrt(dx * dx + dz * dz)
      const reachedStart = !Number.isFinite(distanceToStart) || distanceToStart <= arrivalDistance

      if (isVehicleRoute && vehicleInstance && resolvedPursuitProps && resolvedVehicleProps && resolvedControlState) {
        const vehicleSpeedCap = resolveVehicleSpeedCapMps(resolvedVehicleProps)
        const nextPoint = points[Math.min(1, endIndex)]!
        returnToStartPointA.set(autoTourCurrentPosition.x, autoTourCurrentPosition.y, autoTourCurrentPosition.z)
        returnToStartPointB.set(startPoint.x, autoTourCurrentPosition.y, startPoint.z)
        returnToStartPointC.set(nextPoint.x, autoTourCurrentPosition.y, nextPoint.z)

        const result = applyPurePursuitVehicleControlSafe({
          vehicleInstance: vehicleInstance as any,
          points: returnToStartPolyline,
          loop: false,
          deltaSeconds,
          speedMps: routeSpeed,
          speedCapMps: vehicleSpeedCap,
          resolvedForwardSpeedMps: deps.resolveVehicleMotionTelemetry?.(nodeId)?.forwardSpeedMps ?? null,
          pursuitProps: resolvedPursuitProps,
          vehicleProps: resolvedVehicleProps,
          state: resolvedControlState,
          modeStopping: false,
          distanceToTarget: distanceToStart,
        })
        vehicleInstance.vehicle.autoTourTargetSpeedMps = result.targetSpeedMps
        vehicleInstance.vehicle.autoTourTargetSteeringRad = result.steeringRad
      } else if (!reachedStart) {
        state.mode = 'seek-waypoint'
        state.targetIndex = 0
      }

      if (!reachedStart) {
        return { endIndex, distance: distanceToStart, continueRoute: true }
      }

      state.mode = 'path'
      state.targetIndex = Math.min(1, endIndex)
    }

    if (state.mode === 'seek-waypoint' || state.mode === 'path') {
      if (!state.polylineData3d || !state.waypointArcLengths3d) {
        const polyline = buildPolylineMetricData(points, { closed: Boolean(tourProps.loop), mode: '3d' })
        if (polyline) {
          state.polylineData3d = polyline
          state.waypointArcLengths3d = buildPolylineVertexArcLengths(points, polyline)
        }
      }

      const polylineData3d = state.polylineData3d
      const waypointS = state.waypointArcLengths3d
      if (polylineData3d && waypointS) {
        const proj = projectPointToPolyline(points, polylineData3d, autoTourCurrentPosition, autoTourNextWorldPosition)
        state.lastProjectedS = proj.s

        const deviation = Math.sqrt(Math.max(0, proj.distanceSq))
        const maxDeviation = Math.max(1, arrivalDistance * 2)
        if (Number.isFinite(deviation) && deviation <= maxDeviation) {
          const baseAhead = moveSpeed * deltaSeconds * 2
          const passAheadMeters = Math.max(arrivalDistance, Math.max(0.5, Math.min(3, Number.isFinite(baseAhead) ? baseAhead : 0)))
          const sAhead = proj.s + passAheadMeters
          const stopBarrierIndex = (() => {
            for (let i = Math.max(0, state.targetIndex); i <= endIndex; i += 1) {
              if (dockFlags[i] === true) return i
            }
            return endIndex
          })()

          let nextIndex = state.targetIndex
          while (nextIndex < stopBarrierIndex && (waypointS[nextIndex + 1] ?? 0) <= sAhead) {
            nextIndex += 1
          }
          state.targetIndex = Math.max(state.targetIndex, Math.min(stopBarrierIndex, nextIndex))

          const terminalStopThresholdMeters = Math.max(AUTO_TOUR_STOP_NEAR_END_DISTANCE_METERS, arrivalDistance)
          if (
            !tourProps.loop
            && stopBarrierIndex === endIndex
            && shouldEnterStoppingByRemainingDistance(polylineData3d, proj.s, terminalStopThresholdMeters)
          ) {
            state.mode = 'stopping'
            state.targetIndex = endIndex
          } else if (tourProps.loop) {
            if (state.mode === 'seek-waypoint') {
              state.mode = 'path'
            }
          } else if (state.mode === 'seek-waypoint') {
            state.mode = 'path'
          }
        }
      }
    }

    const target = points[state.targetIndex]!
    autoTourPlanarTarget.copy(target)
    autoTourPlanarTarget.y = autoTourCurrentPosition.y
    autoTourDirection.copy(autoTourPlanarTarget).sub(autoTourCurrentPosition)
    autoTourDirection.y = 0

    return {
      endIndex,
      distance: Math.sqrt(autoTourDirection.x * autoTourDirection.x + autoTourDirection.z * autoTourDirection.z),
      continueRoute: false,
    }
  }

  function advanceAutoTourVehicleRoute(options: {
    nodeId: string
    autoTourId: string
    state: AutoTourPlaybackState
    vehicleInstance: AutoTourVehicleInstanceLike
    points: THREE.Vector3[]
    dockFlags: boolean[]
    routeSpeed: number
    speedCap: number
    moveSpeed: number
    deltaSeconds: number
    arrivalDistance: number
    tourProps: AutoTourComponentProps
    pursuitProps: PurePursuitComponentProps
    vehicleProps: VehicleComponentProps
  }): boolean {
    const {
      nodeId,
      autoTourId,
      state,
      vehicleInstance,
      points,
      routeSpeed,
      speedCap,
      moveSpeed,
      deltaSeconds,
      arrivalDistance,
      tourProps,
      pursuitProps,
      vehicleProps,
    } = options
    const controlState = ensureVehicleControlStateForNode(nodeId, autoTourId)
    const route = prepareAutoTourRouteMotion({
      nodeId,
      state,
      vehicleInstance,
      points,
      dockFlags: options.dockFlags,
      routeSpeed,
      moveSpeed,
      deltaSeconds,
      arrivalDistance,
      tourProps,
      pursuitProps,
      vehicleProps,
      controlState,
      isVehicleRoute: true,
    })
    if (route.continueRoute) {
      return true
    }

    const result = applyPurePursuitVehicleControlSafe({
      vehicleInstance: vehicleInstance as any,
      points,
      loop: Boolean(tourProps.loop),
      deltaSeconds,
      speedMps: routeSpeed,
      speedCapMps: speedCap,
      resolvedForwardSpeedMps: deps.resolveVehicleMotionTelemetry?.(nodeId)?.forwardSpeedMps ?? null,
      pursuitProps,
      vehicleProps,
      state: controlState,
      modeStopping: state.mode === 'stopping',
      distanceToTarget: route.distance,
      ...(state.mode === 'stopping'
        ? {
          stopIndex: getAutoTourDockStopIndex(state, route.endIndex),
        }
        : {}),
    })
    vehicleInstance.vehicle.autoTourTargetSpeedMps = result.targetSpeedMps
    vehicleInstance.vehicle.autoTourTargetSteeringRad = result.steeringRad

    if (state.mode === 'stopping' && result.reachedStop) {
      finalizeAutoTourDockStop({ nodeId, state, endIndex: route.endIndex, tourProps, terminalReason: 'vehicle-reached-stop' })
    }

    return true
  }

  function advanceAutoTourObjectMotion(options: {
    node: SceneNode
    nodeObject: THREE.Object3D
    state: AutoTourPlaybackState
    points: THREE.Vector3[]
    dockFlags: boolean[]
    moveSpeed: number
    deltaSeconds: number
    arrivalDistance: number
    tourProps: AutoTourComponentProps
    vehicleProps: VehicleComponentProps
    hasVehicleInstance: boolean
    directMoveVehicle: boolean
    vehicleInstance: AutoTourVehicleInstanceLike | null
  }): boolean {
    const {
      node,
      nodeObject,
      state,
      points,
      dockFlags,
      moveSpeed,
      deltaSeconds,
      arrivalDistance,
      tourProps,
      vehicleProps,
      hasVehicleInstance,
      directMoveVehicle,
      vehicleInstance,
    } = options
    const route = prepareAutoTourRouteMotion({
      nodeId: node.id,
      state,
      vehicleInstance,
      points,
      dockFlags,
      moveSpeed,
      deltaSeconds,
      arrivalDistance,
      tourProps,
      isVehicleRoute: false,
    })
    if (route.continueRoute) {
      return true
    }

    let directMoveSpeedFactor = 1
    let cornerTurnAssist = 0
    const lookaheadDistance = Math.max(
      AUTO_TOUR_DIRECT_MOVE_TURN_LOOKAHEAD_MIN,
      Math.min(
        AUTO_TOUR_DIRECT_MOVE_TURN_LOOKAHEAD_MAX,
        Math.max(arrivalDistance * 2, moveSpeed * AUTO_TOUR_DIRECT_MOVE_TURN_LOOKAHEAD_SECONDS),
      ),
    )

    const distance = route.distance

    if (state.mode !== 'stopping') {
      const nextTargetIndex = state.targetIndex < route.endIndex
        ? state.targetIndex + 1
        : (tourProps.loop ? 0 : -1)

      if (nextTargetIndex >= 0 && nextTargetIndex !== state.targetIndex) {
        autoTourTargetPosition.copy(points[nextTargetIndex]!)
        autoTourTargetPosition.y = autoTourCurrentPosition.y
        autoTourNextSegmentDir.copy(autoTourTargetPosition).sub(autoTourPlanarTarget)
        autoTourNextSegmentDir.y = 0

        if (autoTourNextSegmentDir.lengthSq() > 1e-10) {
          autoTourNextSegmentDir.normalize()

          const blendByDistance = THREE.MathUtils.clamp(1 - distance / lookaheadDistance, 0, 1)
          const cornerAngle = Math.acos(THREE.MathUtils.clamp(autoTourDesiredDir.dot(autoTourNextSegmentDir), -1, 1))
          const cornerSharpness = THREE.MathUtils.clamp(cornerAngle / AUTO_TOUR_DIRECT_MOVE_CORNER_FULL_SLOW_ANGLE, 0, 1)

          cornerTurnAssist = blendByDistance * cornerSharpness
          const cornerBlend = cornerTurnAssist * AUTO_TOUR_DIRECT_MOVE_CORNER_BLEND_FACTOR
          if (cornerBlend > 1e-4) {
            autoTourDesiredDir.lerp(autoTourNextSegmentDir, cornerBlend).normalize()
          }
          directMoveSpeedFactor = Math.min(
            directMoveSpeedFactor,
            1 - cornerTurnAssist * (1 - AUTO_TOUR_DIRECT_MOVE_MIN_SPEED_FACTOR),
          )
        }
      }

      if (tourProps.alignToPath) {
        const desiredYaw = Math.atan2(-autoTourDesiredDir.z, autoTourDesiredDir.x)
        const yawDelta = Math.abs(Math.atan2(Math.sin(desiredYaw - state.smoothedYaw), Math.cos(desiredYaw - state.smoothedYaw)))
        const yawSharpness = THREE.MathUtils.clamp(yawDelta / AUTO_TOUR_DIRECT_MOVE_YAW_FULL_SLOW_ANGLE, 0, 1)
        directMoveSpeedFactor = Math.min(
          directMoveSpeedFactor,
          1 - yawSharpness * (1 - AUTO_TOUR_DIRECT_MOVE_MIN_SPEED_FACTOR),
        )
      }
    }

    if (state.mode === 'stopping') {
      autoTourNextWorldPosition.copy(autoTourPlanarTarget)
    } else {
      const stepDistance = moveSpeed * Math.max(AUTO_TOUR_DIRECT_MOVE_MIN_SPEED_FACTOR, directMoveSpeedFactor) * deltaSeconds
      const clampedStep = Number.isFinite(stepDistance) ? Math.max(0, stepDistance) : 0
      autoTourNextWorldPosition.copy(autoTourCurrentPosition)
      if (clampedStep > 0) {
        autoTourNextWorldPosition.addScaledVector(autoTourDesiredDir, Math.min(clampedStep, distance))
      }
    }

    if (!state.hasSmoothedState) {
      state.hasSmoothedState = true
      state.smoothedWorldPosition.copy(autoTourCurrentPosition)
      nodeObject.getWorldQuaternion(autoTourObjectWorldQuaternion)
      state.smoothedYaw = getWorldYawRadiansFromQuaternion(autoTourObjectWorldQuaternion)
    }

    if (state.mode === 'stopping') {
      const positionAlpha = expSmoothingAlpha(AUTO_TOUR_POSITION_SMOOTHING, deltaSeconds)
      state.smoothedWorldPosition.lerp(autoTourNextWorldPosition, positionAlpha)
    } else {
      state.smoothedWorldPosition.copy(autoTourNextWorldPosition)
    }

    if (nodeObject.parent) {
      nodeObject.parent.updateMatrixWorld(true)
      autoTourLocalPosition.copy(state.smoothedWorldPosition)
      nodeObject.parent.worldToLocal(autoTourLocalPosition)
      nodeObject.position.copy(autoTourLocalPosition)
    } else {
      nodeObject.position.copy(state.smoothedWorldPosition)
    }

    if (tourProps.alignToPath) {
      const desiredYaw = Math.atan2(-autoTourDesiredDir.z, autoTourDesiredDir.x)
      const yawAlpha = expSmoothingAlpha(AUTO_TOUR_YAW_SMOOTHING * (1 + cornerTurnAssist * 0.35), deltaSeconds)
      state.smoothedYaw = dampAngleRadians(state.smoothedYaw, desiredYaw, yawAlpha)
      autoTourWorldQuaternion.setFromAxisAngle(autoTourUp, state.smoothedYaw)
      if (nodeObject.parent) {
        nodeObject.parent.getWorldQuaternion(autoTourParentWorldQuaternion)
        autoTourLocalQuaternion.copy(autoTourParentWorldQuaternion).invert().multiply(autoTourWorldQuaternion)
        nodeObject.quaternion.copy(autoTourLocalQuaternion)
      } else {
        nodeObject.quaternion.copy(autoTourWorldQuaternion)
      }
    }

    syncNodeTransformFromObject(node, nodeObject)
    deps.onNodeObjectTransformUpdated?.(node.id, nodeObject)

    if (directMoveVehicle && hasVehicleInstance && vehicleInstance) {
      syncBodyFromObject(vehicleInstance.vehicle.chassisBody, nodeObject)
      holdVehicleBrakeSafe({
        vehicleInstance: vehicleInstance as any,
        brakeForce: vehicleProps.brakeForceMax * 6,
      })
    }

    if (state.mode === 'stopping' && state.smoothedWorldPosition.distanceToSquared(autoTourPlanarTarget) <= AUTO_TOUR_STOP_POSITION_EPSILON * AUTO_TOUR_STOP_POSITION_EPSILON) {
      state.smoothedWorldPosition.copy(autoTourPlanarTarget)
      writeObjectWorldPosition(nodeObject, autoTourPlanarTarget)
      deps.onNodeObjectTransformUpdated?.(node.id, nodeObject)
      finalizeAutoTourDockStop({
        nodeId: node.id,
        state,
        endIndex: route.endIndex,
        tourProps,
        terminalReason: 'non-vehicle-snapped-end',
      })
    }

    return true
  }

  function prepareAutoTourVehicleNodeState(options: {
    nodeId: string
    state: AutoTourPlaybackState
    points: THREE.Vector3[]
    endIndex: number
    tourProps: AutoTourComponentProps
    vehicleInstance: AutoTourVehicleInstanceLike | null
    hasVehicleInstance: boolean
    usePhysicsDrive: boolean
    directMoveVehicle: boolean
  }): boolean {
    const {
      nodeId,
      state,
      points,
      endIndex,
      tourProps,
      vehicleInstance,
      hasVehicleInstance,
      usePhysicsDrive,
      directMoveVehicle,
    } = options

    if (state.mode === 'loop-to-start') {
      state.mode = 'path'
    }

    if (options.state.mode === 'dock-hold') {
      const holdIndex = typeof state.dockHoldIndex === 'number' && Number.isFinite(state.dockHoldIndex)
        ? Math.floor(state.dockHoldIndex)
        : state.targetIndex
      const nextIndex = tourProps.loop
        ? ((holdIndex + 1) % points.length)
        : Math.max(0, Math.min(endIndex, holdIndex + 1))
      state.mode = 'path'
      state.targetIndex = nextIndex
      state.dockHoldIndex = undefined
      state.dockStopIndex = undefined
      state.dockLatchIndex = undefined
    }

    if (state.mode === 'stopped') {
      if (tourProps.loop) {
        state.mode = 'loop-to-start'
        state.targetIndex = 0
      } else {
        if (hasVehicleInstance && vehicleInstance) {
          vehicleInstance.vehicle.autoTourTargetSpeedMps = 0
          vehicleInstance.vehicle.autoTourTargetSteeringRad = 0
        }
        return false
      }
    }

    if (directMoveVehicle) {
      if (!usePhysicsDrive) {
        if (hasVehicleInstance && vehicleInstance) {
          vehicleInstance.vehicle.autoTourTargetSpeedMps = 0
          vehicleInstance.vehicle.autoTourTargetSteeringRad = 0
        }
        resetVehicleControlStatesForNode(nodeId)
      }
    }

    return true
  }

  function advanceAutoTourVehicleNodeMotion(options: {
    node: SceneNode
    nodeObject: THREE.Object3D | null
    autoTourId: string
    state: AutoTourPlaybackState
    points: THREE.Vector3[]
    dockFlags: boolean[]
    endIndex: number
    routeSpeed: number
    moveSpeed: number
    deltaSeconds: number
    arrivalDistance: number
    tourProps: AutoTourComponentProps
    pursuitProps: PurePursuitComponentProps
    vehicleProps: VehicleComponentProps
    vehicleInstance: AutoTourVehicleInstanceLike | null
    hasVehicleInstance: boolean
    hasVehicleComponent: boolean
    usePhysicsDrive: boolean
  }): boolean {
    const {
      node,
      nodeObject,
      autoTourId,
      state,
      points,
      dockFlags,
      endIndex,
      routeSpeed,
      moveSpeed,
      deltaSeconds,
      arrivalDistance,
      tourProps,
      pursuitProps,
      vehicleProps,
      vehicleInstance,
      hasVehicleInstance,
      hasVehicleComponent,
      usePhysicsDrive,
    } = options

    const directMoveVehicle = hasVehicleComponent && (!hasVehicleInstance || !usePhysicsDrive)
    const vehicleSpeedCap = resolveVehicleSpeedCapMps(vehicleProps)

    if (hasVehicleComponent) {
      const shouldContinue = prepareAutoTourVehicleNodeState({
        nodeId: node.id,
        state,
        points,
        endIndex,
        tourProps,
        vehicleInstance,
        hasVehicleInstance,
        usePhysicsDrive,
        directMoveVehicle,
      })
      if (!shouldContinue) {
        return true
      }
    }

    if (!Number.isFinite(state.targetIndex)) {
      state.targetIndex = 0
    }
    state.targetIndex = Math.max(0, Math.min(endIndex, Math.floor(state.targetIndex)))

    if (usePhysicsDrive && hasVehicleInstance && vehicleInstance) {
      const chassisBody = vehicleInstance.vehicle.chassisBody
      autoTourCurrentPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
    } else if (nodeObject) {
      nodeObject.getWorldPosition(autoTourCurrentPosition)
    }

    if (hasVehicleInstance && usePhysicsDrive && vehicleInstance) {
      advanceAutoTourVehicleRoute({
        nodeId: node.id,
        autoTourId,
        state,
        vehicleInstance,
        points,
        dockFlags,
        routeSpeed,
        speedCap: vehicleSpeedCap,
        moveSpeed,
        deltaSeconds,
        arrivalDistance,
        tourProps,
        pursuitProps,
        vehicleProps,
      })
      return true
    }

    return true
  }

  function advanceAutoTourObjectNodeMotion(options: {
    node: SceneNode
    nodeObject: THREE.Object3D
    state: AutoTourPlaybackState
    points: THREE.Vector3[]
    dockFlags: boolean[]
    moveSpeed: number
    deltaSeconds: number
    arrivalDistance: number
    tourProps: AutoTourComponentProps
    vehicleProps: VehicleComponentProps
    hasVehicleInstance: boolean
    directMoveVehicle: boolean
    vehicleInstance: AutoTourVehicleInstanceLike | null
  }): boolean {
    return advanceAutoTourObjectMotion(options)
  }

  function clearTerminalParkedPose(nodeId: string): void {
    terminalParkedPoses.delete(nodeId)
  }

  function captureTerminalParkedPose(nodeId: string, sourceObject: THREE.Object3D | null, chassisBody: VehicleDriveVehicle['chassisBody'] | null): void {
    const parkedPose = terminalParkedPoses.get(nodeId) ?? {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
    }
    if (sourceObject) {
      sourceObject.updateMatrixWorld(true)
      sourceObject.getWorldPosition(parkedPose.position)
      sourceObject.getWorldQuaternion(parkedPose.quaternion)
    } else if (chassisBody) {
      parkedPose.position.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
      parkedPose.quaternion.set(
        chassisBody.quaternion.x,
        chassisBody.quaternion.y,
        chassisBody.quaternion.z,
        chassisBody.quaternion.w,
      )
    }
    terminalParkedPoses.set(nodeId, parkedPose)
  }

  function requestReturnToStart(nodeId: string): void {
    if (!nodeId) {
      return
    }
    // Make sure the node is eligible to move again.
    terminalBrakeHoldNodes.delete(nodeId)
    terminalStoppedNodes.delete(nodeId)
    clearTerminalParkedPose(nodeId)
    disabledTourNodes.delete(nodeId)
    pendingReturnToStartNodes.add(nodeId)
    // Force a clean re-init; we will override into return-to-start once state exists.
    clearPlaybackStateForNode(nodeId)
    clearVehicleControlStateForNode(nodeId)
  }

  function finalizeTourTerminalStop(options: {
    nodeId: string
    reason: string
    state?: AutoTourPlaybackState
    tourProps: AutoTourComponentProps
  }): void {
    const { nodeId, reason, state, tourProps } = options
    if (tourProps.loop) {
      return
    }

    if (requiresExplicitStart) {
      // Keep node marked as active so the host UI can offer resume/stop choices.
      // The node will remain in `activeTourNodes` until explicitly stopped via stopTour().
    } else {
      disabledTourNodes.add(nodeId)
    }

    // Plan B: keep the vehicle locked in place after a terminal stop by continuously holding brake.
    terminalBrakeHoldNodes.add(nodeId)
    terminalStoppedNodes.add(nodeId)

    // Apply a one-time hard stop so the node truly "parks" at the end even if physics is active.
    stopVehicleImmediately(nodeId)
    deps.stopNodeMotion?.(nodeId)

    // Free cached state; restart will re-init cleanly via startTour().
    clearPlaybackStateForNode(nodeId)
    clearVehicleControlStateForNode(nodeId)

    // Notify host that this node has reached a terminal stop so it can prompt the user.
    try {
      deps.onTerminalStop?.(nodeId, reason)
    } catch {
      // Ignore errors in host callback.
    }

    // Also request the host to pause auto-tour controls (e.g., to reuse pause/resume UX).
    try {
      deps.onDockRequestedPause?.(nodeId, { waypointIndex: Number.isFinite(state?.targetIndex) ? state!.targetIndex : 0, terminal: true })
    } catch {
      // Ignore errors in host callback.
    }
  }

  function stopVehicleImmediately(nodeId: string): void {
    const vehicleInstance = deps.vehicleInstances.get(nodeId) ?? null
    const chassisBody = vehicleInstance?.vehicle?.chassisBody ?? null
    if (!vehicleInstance || !chassisBody) {
      return
    }

    const stopObject = deps.nodeObjectMap.get(nodeId) ?? null
    if (stopObject) {
      stopObject.getWorldPosition(autoTourCurrentPosition)
    }

    captureTerminalParkedPose(nodeId, stopObject, chassisBody)

    // Ensure the body is awake while we apply braking/force resets.
    try {
      chassisBody.wakeUp?.()
    } catch {
      // ignore
    }

    // Apply strong braking and reset steering/engine via the shared safe helper.
    try {
      if (stopObject) {
        syncBodyFromObject(chassisBody, stopObject)
      }
      vehicleInstance.vehicle.autoTourTargetSpeedMps = 0
      vehicleInstance.vehicle.autoTourTargetSteeringRad = 0
    } catch {
      // Best-effort; physics may be resetting.
    }

    // Hard-stop velocity to prevent coasting.
    try {
      stopPhysicsBodyMotion(chassisBody)
      sleepPhysicsBody(chassisBody, { minSpeedLimit: 0.05, minTimeLimit: 0.05 })
      if (stopObject) {
        stopObject.getWorldPosition(autoTourCurrentPosition)
      }
    } catch {
      // ignore
    }
  }

  function getGuideRouteWorldWaypoints(routeNodeId: string): { points: THREE.Vector3[]; dock: boolean[] } | null {
    const routeNode = deps.resolveNodeById(routeNodeId)
    if (!routeNode) {
      return null
    }
    const component = resolveEnabledComponentState<GuideRouteComponentProps>(routeNode, GUIDE_ROUTE_COMPONENT_TYPE)
    if (!component) {
      return null
    }
    const routeObject = deps.nodeObjectMap.get(routeNodeId) ?? null
    if (!routeObject) {
      return null
    }
    const props = clampGuideRouteComponentProps(component.props)
    if (!props.waypoints.length) {
      return null
    }
    routeObject.updateMatrixWorld(true)
    const points: THREE.Vector3[] = []
    const dock: boolean[] = []
    props.waypoints.forEach((wp) => {
      autoTourTargetPosition.set(wp.position.x, wp.position.y, wp.position.z)
      points.push(routeObject.localToWorld(autoTourTargetPosition.clone()))
      dock.push(wp.dock === true)
    })
    return points.length >= 2 ? { points, dock } : null
  }

  function resolvePlaybackNodeWorldPosition(nodeId: string): THREE.Vector3 | null {
    const vehicleInstance = deps.vehicleInstances.get(nodeId) ?? null
    const chassisBody = vehicleInstance?.vehicle?.chassisBody ?? null
    if (chassisBody) {
      autoTourCurrentPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
      return autoTourCurrentPosition
    }
    const nodeObject = deps.nodeObjectMap.get(nodeId) ?? null
    if (!nodeObject) {
      return null
    }
    nodeObject.getWorldPosition(autoTourCurrentPosition)
    return autoTourCurrentPosition
  }

  function resolveRouteSnap(nodeId: string): AutoTourRouteSnapResult | null {
    if (!nodeId) {
      return null
    }
    const node = deps.resolveNodeById(nodeId)
    if (!node) {
      return null
    }
    const autoTour = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
    if (!autoTour) {
      return null
    }
    const tourProps = clampAutoTourComponentProps(autoTour.props)
    const routeNodeId = tourProps.routeNodeId
    if (!routeNodeId) {
      return null
    }
    const routeData = getGuideRouteWorldWaypoints(routeNodeId)
    if (!routeData) {
      return null
    }

    const worldPosition = resolvePlaybackNodeWorldPosition(nodeId)
    if (!worldPosition) {
      return null
    }

    const polylineData3d = buildPolylineMetricData(routeData.points, {
      closed: Boolean(tourProps.loop),
      mode: '3d',
    })
    if (!polylineData3d) {
      return null
    }

    const waypointArcLengths3d = buildPolylineVertexArcLengths(routeData.points, polylineData3d)
    const projection = projectPointToPolyline(routeData.points, polylineData3d, worldPosition, autoTourSnapPoint)

    const pointA = routeData.points[projection.segmentIndex] ?? routeData.points[0]
    const pointB = routeData.points[(projection.segmentIndex + 1) % routeData.points.length] ?? pointA
    if (!pointA || !pointB) {
      return null
    }
    autoTourSnapForward.copy(pointB).sub(pointA)
    autoTourSnapForward.y = 0
    if (autoTourSnapForward.lengthSq() < 1e-8) {
      autoTourSnapForward.set(1, 0, 0)
    } else {
      autoTourSnapForward.normalize()
    }

    return {
      nodeId,
      routeNodeId,
      worldPosition: autoTourSnapPoint.clone(),
      forwardWorld: autoTourSnapForward.clone(),
      yaw: Math.atan2(-autoTourSnapForward.z, autoTourSnapForward.x),
      projectedS: projection.s,
      segmentIndex: projection.segmentIndex,
      targetIndex: findTargetWaypointIndexByProjectedS(waypointArcLengths3d, projection.s, Boolean(tourProps.loop)),
      routeWaypointCount: routeData.points.length,
      polylineData3d,
      waypointArcLengths3d,
    }
  }

  function seedTourPlaybackState(nodeId: string, snap: AutoTourRouteSnapResult): void {
    if (!nodeId || !snap || snap.nodeId !== nodeId) {
      return
    }
    const node = deps.resolveNodeById(nodeId)
    if (!node) {
      return
    }
    const autoTour = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
    if (!autoTour) {
      return
    }
    const tourProps = clampAutoTourComponentProps(autoTour.props)
    const key = `${node.id}:${autoTour.id}`
    autoTourPlaybackState.set(key, {
      mode: 'path',
      targetIndex: Math.max(0, Math.min(snap.routeWaypointCount - 1, Math.floor(snap.targetIndex))),
      routeNodeId: snap.routeNodeId,
      routeWaypointCount: snap.routeWaypointCount,
      hasSmoothedState: true,
      smoothedWorldPosition: snap.worldPosition.clone(),
      smoothedYaw: snap.yaw,
      dockStopIndex: undefined,
      dockHoldIndex: undefined,
      dockLatchIndex: undefined,
      polylineData3d: snap.polylineData3d,
      waypointArcLengths3d: snap.waypointArcLengths3d.slice(),
      lastProjectedS: snap.projectedS,
    })

    resetVehicleControlState(ensureVehicleControlStateForNode(nodeId, autoTour.id))

    terminalBrakeHoldNodes.delete(nodeId)
    terminalStoppedNodes.delete(nodeId)
    disabledTourNodes.delete(nodeId)
    pendingReturnToStartNodes.delete(nodeId)
    if (requiresExplicitStart) {
      activeTourNodes.add(nodeId)
    }

    if (
      !tourProps.loop
      && shouldEnterStoppingByRemainingDistance(
        snap.polylineData3d,
        snap.projectedS,
        AUTO_TOUR_STOP_NEAR_END_DISTANCE_METERS,
      )
    ) {
      const seeded = autoTourPlaybackState.get(key)
      if (seeded) {
        seeded.mode = 'stopping'
        seeded.dockStopIndex = snap.routeWaypointCount - 1
      }
    }
  }

  /**
   * 更新自动导览系统的核心函数，负责处理所有节点的路径跟随、制动和停靠逻辑。
   * 
   * @param deltaSeconds - 自上次更新以来经过的时间（秒）。如果 ≤ 0，则跳过更新。
   * 
   * @remarks
   * 该函数执行以下主要流程：
   * 
   * 1. **手动驾驶检测**：
   *    - 如果手动驾驶模式激活，清除所有自动制动状态并立即返回，确保手动控制优先级最高。
   * 
   * 2. **终端制动保持**（Pre-pass）：
   *    - 遍历 `terminalBrakeHoldNodes` 集合，为已到达终点的车辆持续施加强制动力。
   *    - 即使 AutoTour 组件被禁用或播放状态已清除，仍保持制动以防止车辆滑动。
   *    - 使用 6 倍最大制动力确保车辆完全静止。
   * 
   * 3. **节点遍历与状态管理**：
   *    对每个启用 AutoTour 组件的节点：
   *    
   *    a. **过滤条件**：
   *       - 跳过已禁用、未显式启动或已终端停止的节点。
   *       - 验证 AutoTour 组件、路线数据和目标速度的有效性。
   *    
   *    b. **组件解析**：
   *       - 解析 `AutoTour`、`Vehicle`、`PurePursuit` 组件及其属性。
   *       - 根据组件配置决定驱动模式：
  *         * `shouldDriveAsVehicle`: 使用物理引擎 + PurePursuit 算法驱动（真实车辆行为）。
  *         * `directMoveVehicle`: 在没有物理车辆实例时，或当 AutoTour 显式关闭物理驱动时，直接移动变换并同步底盘。
   *         * 其他：直接移动渲染对象（非车辆节点）。
   *    
   *    c. **播放状态初始化/恢复**：
   *       - 如果状态不存在或路线已更改，重新初始化播放状态。
   *       - 使用 3D 折线投影找到最近航点并计算初始朝向。
   *       - 构建弧长查找表（`waypointArcLengths3d`）用于后续快进逻辑。
   *    
   *    d. **停靠保持模式处理**：
   *       - 当处于 `dock-hold` 模式时（宿主暂停后恢复），立即前进到下一个航点，避免重复停靠。
   *    
   *    e. **终点停止与循环处理**：
   *       - 非循环路线到达终点：保持制动（车辆）或静止（非车辆）。
   *       - 循环路线：切换到 `loop-to-start` 模式重新开始。
   *    
   *    f. **目标索引快进**（仅限 `shouldDriveAsVehicle`）：
   *       - 基于车辆在路线上的弧长投影位置动态调整 `targetIndex`。
   *       - 防止因物理超调/跳过航点导致卡住。
   *       - 遇到停靠航点时停止快进，确保强制停靠点不被跳过。
   *       - 自动检测非循环路线的终点并进入 `stopping` 模式。
   *    
   *    g. **到达判定**：
   *       - 仅在 XZ 平面（水平面）上计算距离和方向，忽略 Y 轴差异。
   *       - 使用动态到达距离（`arrivalDistance`）判定是否到达当前航点。
   *       - 到达后对齐位置（直接移动节点）并推进状态机。
   *    
   *    h. **停靠逻辑**：
   *       - 检测航点是否启用停靠标志（`dockFlags`）或为终点。
   *       - 进入 `stopping` 模式，触发减速/制动直至完全停止。
   *       - 停止后切换到 `dock-hold` 并调用宿主回调请求暂停。
   *       - 终点停止后清理播放状态并标记为 `stopped`。
   *    
   *    i. **运动控制分支**：
   *       
   *       **车辆分支（`shouldDriveAsVehicle`）**：
   *       - 调用 `applyPurePursuitVehicleControlSafe` 应用纯追踪算法。
   *       - 根据前瞻距离、速度、制动参数控制油门/转向/制动。
   *       - 停止模式下逐渐减速至零速并保持制动。
   *       
   *       **非车辆分支**：
   *       - 计算目标位置并使用指数平滑（`expSmoothingAlpha`）插值移动。
   *       - 如果 `alignToPath` 启用，平滑旋转朝向路径方向。
   *       - 直接更新对象的 `position` 和 `quaternion`（仅运行时，不持久化）。
   *       - 停止模式下平滑到精确终点位置（误差 < `AUTO_TOUR_STOP_POSITION_EPSILON`）。
   *       
  *       **直接移动车辆分支（`directMoveVehicle`）**：
  *       - 仅在无法使用物理车辆实例时走该分支。
  *       - 移动渲染对象后同步物理底盘位置。
  *       - 应用强制制动防止物理引擎干扰。
   * 
   * 4. **状态持久化**：
   *    - 所有播放状态存储在 `autoTourPlaybackState` Map 中。
   *    - 状态包含目标索引、平滑位置/朝向、弧长数据等，确保帧间连续性。
   * 
   * @example
   * ```typescript
   * // 每帧调用（通常在渲染循环中）
   * const dt = clock.getDelta();
   * autoTourRuntime.update(dt);
   * ```
   * 
   * @internal
   * 内部使用的临时变量（避免 GC 压力）：
   * - `autoTourCurrentPosition`: 当前世界位置
   * - `autoTourNextWorldPosition`: 下一帧目标世界位置
   * - `autoTourDirection`: XZ 平面移动方向向量
   * - `autoTourObjectWorldQuaternion`: 世界四元数缓存
   * - 等等...
   */
  function update(deltaSeconds: number): void {
    const manualDriveActive = deps.isManualDriveActive()

    if (deltaSeconds <= 0) {
      return
    }
    if (manualDriveActive) {
      // Manual drive has priority; do not keep auto-parking brakes applied.
      terminalBrakeHoldNodes.clear()
      terminalStoppedNodes.clear()
      terminalParkedPoses.clear()
      purePursuitControlStateByNodeId.clear()
      return
    }

    // Pre-pass: apply continuous braking for vehicles that reached a terminal stop,
    // even if their AutoTour is disabled and/or playback state has been cleared.
    if (terminalBrakeHoldNodes.size > 0) {
      for (const nodeId of Array.from(terminalBrakeHoldNodes)) {
        const vehicleInstance = deps.vehicleInstances.get(nodeId) ?? null
        const chassisBody = vehicleInstance?.vehicle?.chassisBody ?? null
        if (!vehicleInstance || !chassisBody) {
          terminalBrakeHoldNodes.delete(nodeId)
          clearTerminalParkedPose(nodeId)
          continue
        }

        const node = deps.resolveNodeById(nodeId) ?? null
        const vehicleComponent = node
          ? resolveEnabledComponentState<VehicleComponentProps>(node, VEHICLE_COMPONENT_TYPE)
          : null
        const vehicleProps = clampVehicleComponentProps(vehicleComponent?.props ?? null)
        try {   
          holdVehicleBrakeSafe({
            vehicleInstance: vehicleInstance as any,
            brakeForce: vehicleProps.brakeForceMax * 6,
          })
        } catch {
          // Best-effort; the host runtime might be resetting physics.
        }
      }
    }

    for (const node of deps.iterNodes()) {
      if (disabledTourNodes.has(node.id)) {
        continue
      }
      if (requiresExplicitStart && !activeTourNodes.has(node.id)) {
        continue
      }
      if (terminalStoppedNodes.has(node.id)) {
        continue
      }
      const autoTour = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
      if (!autoTour) {
        continue
      }
      const tourProps = clampAutoTourComponentProps(autoTour.props)

      const vehicleComponent = resolveEnabledComponentState<VehicleComponentProps>(node, VEHICLE_COMPONENT_TYPE)
      const hasVehicleComponent = Boolean(vehicleComponent)
      const purePursuit = resolveEnabledComponentState<PurePursuitComponentProps>(node, PURE_PURSUIT_COMPONENT_TYPE)
      // Only use PurePursuit component props; do NOT fall back to AutoTour props.
      // This ensures that vehicle nodes without PurePursuit do not enter the pure-pursuit driving branch.
      const pursuitProps = clampPurePursuitComponentProps(purePursuit?.props ?? null)
      const vehicleProps = clampVehicleComponentProps(vehicleComponent?.props ?? null)
      const routeNodeId = tourProps.routeNodeId
      if (!routeNodeId) {
        continue
      }
      const routeData = getGuideRouteWorldWaypoints(routeNodeId)
      if (!routeData) {
        continue
      }

      let points = routeData.points
      let dockFlags = routeData.dock

      // If this is a closed path authored with start=end but loop is disabled,
      // drop the duplicate end vertex to avoid immediately triggering a terminal stop.
      if (!tourProps.loop && points.length >= 3) {
        const first = points[0]!
        const last = points[points.length - 1]!
        const dx = first.x - last.x
        const dz = first.z - last.z
        const planarSq = dx * dx + dz * dz
        if (planarSq <= AUTO_TOUR_END_DUPLICATE_EPSILON_METERS * AUTO_TOUR_END_DUPLICATE_EPSILON_METERS) {
          points = points.slice(0, -1)
          dockFlags = dockFlags.slice(0, -1)
        }
      }

      const endIndex = points.length - 1

      // 将巡游配置速度先归一为非负值，避免外部配置误写负数时引入反向速度或其他异常行为。
      const routeSpeed = Math.max(0, tourProps.speedMps)
      // Vehicle route uses the vehicle's own top speed as the hard cap.
      const speedCap = resolveVehicleSpeedCapMps(vehicleProps)
      const moveSpeed = Math.min(routeSpeed, speedCap)
      if (moveSpeed <= 0) {
        continue
      }

      const arrivalDistance = resolvePathFollowPlanarArrivalDistance(
        moveSpeed,
        pursuitProps.arrivalDistanceMinMeters,
        pursuitProps.arrivalDistanceMaxMeters,
        pursuitProps.arrivalDistanceSpeedFactor,
      )

      const vehicleInstance = deps.vehicleInstances.get(node.id) ?? null
      const hasVehicleInstance = Boolean(vehicleInstance?.vehicle?.chassisBody)
      const usePhysicsDrive = tourProps.usePhysicsDrive
      const nodeObject = deps.nodeObjectMap.get(node.id) ?? null

      if (hasVehicleComponent) {
        if (usePhysicsDrive && !hasVehicleInstance) {
          continue
        }
        if (!usePhysicsDrive && !nodeObject) {
          continue
        }
      } else if (!nodeObject) {
        // Direct-move branch requires a render object.
        continue
      }

      let state = ensurePlaybackStateForNode({
        nodeId: node.id,
        autoTourId: autoTour.id,
        routeNodeId,
        points,
        nodeObject,
        vehicleInstance,
        usePhysicsDrive,
        hasVehicleInstance,
      })

      if (!state) {
        continue
      }

      // If the host requested a terminal-continue, enter return-to-start mode.
      if (pendingReturnToStartNodes.has(node.id)) {
        pendingReturnToStartNodes.delete(node.id)
        state.mode = 'return-to-start'
        state.targetIndex = 0
        state.dockStopIndex = undefined
        state.dockHoldIndex = undefined
        state.dockLatchIndex = undefined
        resetVehicleControlStatesForNode(node.id)
      }

      const advanced = hasVehicleComponent
        ? advanceAutoTourVehicleNodeMotion({
          node,
          nodeObject,
          autoTourId: autoTour.id,
          state,
          points,
          dockFlags,
          endIndex,
          routeSpeed,
          moveSpeed,
          deltaSeconds,
          arrivalDistance,
          tourProps,
          pursuitProps,
          vehicleProps,
          vehicleInstance,
          hasVehicleInstance,
          hasVehicleComponent,
          usePhysicsDrive,
        })
        : advanceAutoTourObjectNodeMotion({
          node,
          nodeObject: nodeObject!,
          state,
          points,
          dockFlags,
          moveSpeed,
          deltaSeconds,
          arrivalDistance,
          tourProps,
          vehicleProps,
          hasVehicleInstance,
          directMoveVehicle: false,
          vehicleInstance,
        })

      if (advanced) {
        continue
      }

    }
  }

  return {
    update,
    reset: () => {
      autoTourPlaybackState.clear()
      purePursuitControlStateByNodeId.clear()
      activeTourNodes.clear()
      disabledTourNodes.clear()
      terminalBrakeHoldNodes.clear()
      terminalStoppedNodes.clear()
      terminalParkedPoses.clear()
      pendingReturnToStartNodes.clear()
    },
    resolveRouteSnap,
    seedTourPlaybackState,
    startTour: (nodeId: string) => {
      if (!nodeId) {
        return
      }
      pendingReturnToStartNodes.delete(nodeId)
      terminalBrakeHoldNodes.delete(nodeId)
      terminalStoppedNodes.delete(nodeId)
      clearTerminalParkedPose(nodeId)
      clearVehicleControlStateForNode(nodeId)
      disabledTourNodes.delete(nodeId)
      if (requiresExplicitStart) {
        activeTourNodes.add(nodeId)
      }
      // Force a clean re-initialization on next update.
      clearPlaybackStateForNode(nodeId)
    },
    continueFromEnd: (nodeId: string) => {
      requestReturnToStart(nodeId)
      if (requiresExplicitStart && nodeId) {
        activeTourNodes.add(nodeId)
      }
    },
    stopTour: (nodeId: string) => {
      if (!nodeId) {
        return
      }
      pendingReturnToStartNodes.delete(nodeId)
      // Explicit stop should not keep "park" brakes applied forever.
      terminalBrakeHoldNodes.delete(nodeId)
      terminalStoppedNodes.delete(nodeId)
      clearTerminalParkedPose(nodeId)
      if (requiresExplicitStart) {
        activeTourNodes.delete(nodeId)
      } else {
        disabledTourNodes.add(nodeId)
      }
      clearVehicleControlStateForNode(nodeId)

      // Freeze any cached smoothing/controller state for this node so restart is clean.
      const prefix = `${nodeId}:`
      for (const [key, state] of autoTourPlaybackState.entries()) {
        if (!key.startsWith(prefix)) {
          continue
        }
        state.mode = 'stopped'

        const node = deps.resolveNodeById(nodeId)
        const object = deps.nodeObjectMap.get(nodeId) ?? null
        if (node && object) {
          object.getWorldPosition(state.smoothedWorldPosition)
          object.getWorldQuaternion(autoTourObjectWorldQuaternion)
          state.smoothedYaw = getWorldYawRadiansFromQuaternion(autoTourObjectWorldQuaternion)
          state.hasSmoothedState = true
          snapNodeObjectToWorldPosition(node, object, state.smoothedWorldPosition)
        }
      }

      // Vehicles need explicit braking + velocity zeroing.
      stopVehicleImmediately(nodeId)

      // Non-vehicle motion may still be driven by a physics body in the host runtime.
      deps.stopNodeMotion?.(nodeId)
    },
    isTourActive: (nodeId: string) => {
      if (!nodeId) {
        return false
      }
      if (disabledTourNodes.has(nodeId)) {
        return false
      }
      if (requiresExplicitStart) {
        return activeTourNodes.has(nodeId)
      }
      const node = deps.resolveNodeById(nodeId)
      return Boolean(resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE))
    },
  }
}
