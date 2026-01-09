import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode } from './index'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import { applyPurePursuitVehicleControlSafe, holdVehicleBrakeSafe } from './purePursuitRuntime'
import { syncBodyFromObject } from './physicsEngine'
import type { PolylineMetricData } from './polylineProgress'
import { buildPolylineMetricData, buildPolylineVertexArcLengths, projectPointToPolyline } from './polylineProgress'
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
  vehicle: CANNON.RaycastVehicle
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
  /** Enables auto-tour playback for the given nodeId (if it has an enabled AutoTour component). */
  startTour: (nodeId: string) => void
  /** Stops auto-tour playback for the given nodeId and immediately stops motion. */
  stopTour: (nodeId: string) => void
  /** Returns whether the given nodeId is currently marked as touring. */
  isTourActive: (nodeId: string) => boolean
}

type AutoTourPlaybackState = {
  mode: 'seek-waypoint' | 'path' | 'loop-to-start' | 'stopped' | 'stopping' | 'dock-hold'
  targetIndex: number
  routeNodeId: string
  routeWaypointCount: number
  hasSmoothedState: boolean
  smoothedWorldPosition: THREE.Vector3
  smoothedYaw: number

  /** When stopping/docking, the index we are targeting to come to a stop at. */
  dockStopIndex?: number
  /** When in dock-hold, the index we have stopped at (used to advance on resume). */
  dockHoldIndex?: number
  /** Latch to prevent repeated dock pause callbacks while staying at the same waypoint. */
  dockLatchIndex?: number

  polylineData3d?: PolylineMetricData
  waypointArcLengths3d?: number[]
  lastProjectedS?: number

  // Vehicle-only control state.
  speedIntegral?: number
  lastSteerRad?: number
  reverseActive?: boolean
}
const AUTO_TOUR_POSITION_SMOOTHING = 14
const AUTO_TOUR_YAW_SMOOTHING = 12
const AUTO_TOUR_STOP_POSITION_EPSILON = 0.03


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

function syncNodeTransformFromObject(node: SceneNode, object: THREE.Object3D): void {
  // Keep runtime node state in sync so other systems that apply node->object transforms
  // won't snap the object back (prevents jitter / stuck targetIndex).
  setVector3Like(node.position as any, object.position.x, object.position.y, object.position.z)
  // Use YXZ for yaw stability; scene nodes store Euler components.
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  euler.setFromQuaternion(object.quaternion)
  setVector3Like(node.rotation as any, euler.x, euler.y, euler.z)
}

function findClosestWaypointIndex(points: THREE.Vector3[], position: THREE.Vector3): number {
  let bestIndex = 0
  let bestDistanceSq = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i += 1) {
    const d = position.distanceToSquared(points[i] ?? position)
    if (d < bestDistanceSq) {
      bestDistanceSq = d
      bestIndex = i
    }
  }
  return bestIndex
}

function findNextWaypointIndexByS(waypointS: readonly number[], s: number): number {
  if (!waypointS.length) {
    return 0
  }
  const safeS = Number.isFinite(s) ? s : 0
  let index = 0
  while (index < waypointS.length - 1 && (waypointS[index] ?? 0) < safeS) {
    index += 1
  }
  return Math.max(0, Math.min(waypointS.length - 1, index))
}

export function createAutoTourRuntime(deps: AutoTourRuntimeDeps): AutoTourRuntime {
  const autoTourPlaybackState = new Map<string, AutoTourPlaybackState>()
  const requiresExplicitStart = deps.requiresExplicitStart === true
  const activeTourNodes = new Set<string>()
  const disabledTourNodes = new Set<string>()
  // Nodes that reached a terminal (loop=false) stop and must remain "parked" via continuous braking.
  // This is intentionally independent of autoTourPlaybackState, since terminal stop clears playback state.
  const terminalBrakeHoldNodes = new Set<string>()
  // Nodes that reached a terminal (loop=false) stop and should not re-initialize movement until restarted.
  const terminalStoppedNodes = new Set<string>()
  

  const autoTourTargetPosition = new THREE.Vector3()
  const autoTourCurrentPosition = new THREE.Vector3()
  const autoTourDirection = new THREE.Vector3()
  const autoTourDesiredDir = new THREE.Vector3()
  const autoTourObjectWorldQuaternion = new THREE.Quaternion()
  const autoTourParentWorldQuaternion = new THREE.Quaternion()
  const autoTourWorldQuaternion = new THREE.Quaternion()
  const autoTourLocalQuaternion = new THREE.Quaternion()
  const autoTourUp = new THREE.Vector3(0, 1, 0)
  const autoTourNextWorldPosition = new THREE.Vector3()
  const autoTourLocalPosition = new THREE.Vector3()
  const autoTourPlanarTarget = new THREE.Vector3()

  

  function clearPlaybackStateForNode(nodeId: string): void {
    const prefix = `${nodeId}:`
    for (const key of autoTourPlaybackState.keys()) {
      if (key.startsWith(prefix)) {
        autoTourPlaybackState.delete(key)
      }
    }
  }

  function finalizeTourTerminalStop(options: {
    nodeId: string
    reason: string
    key?: string
    state?: AutoTourPlaybackState
    tourProps: AutoTourComponentProps
    pursuitProps?: PurePursuitComponentProps
  }): void {
    const { nodeId, reason, key, state, tourProps, pursuitProps } = options
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

    const before = {
      v: { x: chassisBody.velocity.x, y: chassisBody.velocity.y, z: chassisBody.velocity.z },
      w: { x: chassisBody.angularVelocity.x, y: chassisBody.angularVelocity.y, z: chassisBody.angularVelocity.z },
      sleepState: (chassisBody as any).sleepState,
    }
    // stopVehicleImmediately: begin (debug logs removed)

    // Ensure the body is awake while we apply braking/force resets.
    try {
      chassisBody.wakeUp?.()
    } catch {
      // ignore
    }

    // Apply strong braking and reset steering/engine via the shared safe helper.
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
      for (let index = 0; index < vehicleInstance.wheelCount; index += 1) {
        vehicleInstance.vehicle.applyEngineForce(0, index)
        vehicleInstance.vehicle.setSteeringValue(0, index)
      }
    } catch {
      // Best-effort; physics may be resetting.
    }

    // Hard-stop velocity to prevent coasting.
    try {
      chassisBody.allowSleep = true
      chassisBody.sleepSpeedLimit = Math.max(0.05, chassisBody.sleepSpeedLimit ?? 0)
      chassisBody.sleepTimeLimit = Math.max(0.05, chassisBody.sleepTimeLimit ?? 0)
      chassisBody.velocity.set(0, 0, 0)
      chassisBody.angularVelocity.set(0, 0, 0)
      // Sleep to avoid solver jitter once stopped.
      chassisBody.sleep?.()
    } catch {
      // ignore
    }

    // stopVehicleImmediately: end (debug logs removed)
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

  function update(deltaSeconds: number): void {
    const manualDriveActive = deps.isManualDriveActive()

    if (deltaSeconds <= 0) {
      return
    }
    if (manualDriveActive) {
      // Manual drive has priority; do not keep auto-parking brakes applied.
      terminalBrakeHoldNodes.clear()
      terminalStoppedNodes.clear()
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
      const hasPurePursuitComponent = Boolean(purePursuit)
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

      const points = routeData.points
      const dockFlags = routeData.dock

      const endIndex = points.length - 1

      const speed = Math.max(0, tourProps.speedMps)
      if (speed <= 0) {
        continue
      }

      const arrivalDistance = Math.max(pursuitProps.arrivalDistanceMinMeters, pursuitProps.arrivalDistanceMaxMeters)

      const key = `${node.id}:${autoTour.id}`
      const cached = autoTourPlaybackState.get(key) ?? null
      let state = cached

      const vehicleInstance = deps.vehicleInstances.get(node.id) ?? null
      const hasVehicleInstance = Boolean(vehicleInstance?.vehicle?.chassisBody)
      const shouldDriveAsVehicle = hasVehicleComponent && hasPurePursuitComponent && hasVehicleInstance
      const directMoveVehicle = hasVehicleComponent && !hasPurePursuitComponent
      const nodeObject = deps.nodeObjectMap.get(node.id) ?? null

      if (shouldDriveAsVehicle) {
        // OK: can drive purely via physics.
      } else if (!nodeObject) {
        // Direct-move branch requires a render object.
        continue
      }

      if (!state || state.routeNodeId !== routeNodeId || state.routeWaypointCount !== points.length) {
        // Initialize by heading to the nearest waypoint (includes start/end/intermediate).
        const positionSample = autoTourCurrentPosition
        if (hasVehicleInstance) {
          const body = vehicleInstance!.vehicle.chassisBody
          positionSample.set(body.position.x, body.position.y, body.position.z)
        } else {
          nodeObject!.getWorldPosition(positionSample)
        }

        let initialTargetIndex = findClosestWaypointIndex(points, positionSample)
        let polylineData3d: PolylineMetricData | undefined
        let waypointArcLengths3d: number[] | undefined
        let projectedS: number | undefined

        const polyline = buildPolylineMetricData(points, { closed: Boolean(tourProps.loop), mode: '3d' })
        if (polyline) {
          polylineData3d = polyline
          waypointArcLengths3d = buildPolylineVertexArcLengths(points, polyline)
          const proj = projectPointToPolyline(points, polyline, positionSample, autoTourNextWorldPosition)
          projectedS = proj.s
          initialTargetIndex = findNextWaypointIndexByS(waypointArcLengths3d, proj.s)
        }

        let initialYaw = 0
        if (hasVehicleInstance) {
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
        }
        autoTourPlaybackState.set(key, state)
      }

      if (!state) {
        continue
      }

      // Vehicle nodes that are moving via direct node transforms should not use the
      // stopping/stopped state machine (they can still respect loop via index wrap).
      if (directMoveVehicle) {
        if (state.mode === 'loop-to-start') {
          state.mode = 'path'
        }
        // When direct-moving a vehicle and not looping, fully stop updating once we
        // have reached the final waypoint.
        if (!tourProps.loop && state.mode === 'stopped') {
          continue
        }
      }

      // Dock-hold is entered after coming to a complete stop at a docking waypoint.
      // The host pauses auto-tour by not calling update(). When update() resumes,
      // immediately advance to the next waypoint to avoid re-docking at the same point.
      if (state.mode === 'dock-hold') {
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

      // When stopped and not looping:
      // - non-vehicle: do nothing (object already at final position)
      // - vehicle: keep holding brake to avoid rolling
      if (state.mode === 'stopped') {
        if (tourProps.loop) {
          state.mode = 'loop-to-start'
          state.targetIndex = 0
        } else {
          if (shouldDriveAsVehicle) {
            holdVehicleBrakeSafe({
              vehicleInstance: vehicleInstance! as any,
              brakeForce: vehicleProps.brakeForceMax * 6,
            })
          }
          continue
        }
      }

      // Safety clamp.
      // 如果目标索引不是有限数字，则重置为0
      if (!Number.isFinite(state.targetIndex)) {
        state.targetIndex = 0
      }
      // 保证目标索引在合法范围内（0 ~ endIndex），并取整
      state.targetIndex = Math.max(0, Math.min(endIndex, Math.floor(state.targetIndex)))

      // Resolve current world position.
      if (hasVehicleInstance) {
        const chassisBody = vehicleInstance!.vehicle.chassisBody
        autoTourCurrentPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
      } else {
        nodeObject!.getWorldPosition(autoTourCurrentPosition)
      }

      // Vehicle + PurePursuit: fast-forward targetIndex based on arc-length progress along the route.
      // This prevents getting stuck when the vehicle overshoots/skips discrete waypoints.
      if (shouldDriveAsVehicle && (state.mode === 'seek-waypoint' || state.mode === 'path')) {
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
            const baseAhead = speed * deltaSeconds * 2
            const passAheadMeters = Math.max(arrivalDistance, Math.max(0.5, Math.min(3, Number.isFinite(baseAhead) ? baseAhead : 0)))
            const sAhead = proj.s + passAheadMeters

            // Do not allow targetIndex to advance past the next docking waypoint.
            // This ensures that dock-enabled waypoints are treated as mandatory stops.
            const stopBarrierIndex = (() => {
              for (let i = Math.max(0, state.targetIndex); i <= endIndex; i += 1) {
                if (dockFlags[i] === true) return i
              }
              return endIndex
            })()

            // Advance monotonically; never move the target backwards.
            // IMPORTANT: allow advancing *to* stopBarrierIndex (inclusive), otherwise dock waypoints can
            // never become the active target in 'path' mode.
            let nextIndex = state.targetIndex
            while (nextIndex < stopBarrierIndex && (waypointS[nextIndex + 1] ?? 0) <= sAhead) {
              nextIndex += 1
            }
            const beforeIndex = state.targetIndex
            state.targetIndex = Math.max(state.targetIndex, Math.min(stopBarrierIndex, nextIndex))

            // End handling for non-looping tours: once progress reaches the end, enter stopping mode.
            if (!tourProps.loop && stopBarrierIndex === endIndex && proj.s >= polylineData3d.totalLength - Math.max(0.5, arrivalDistance)) {
              state.mode = 'stopping'
              state.targetIndex = endIndex
            } else if (tourProps.loop) {
              // Looping tours never stop; keep driving continuously.
              if (state.mode === 'seek-waypoint') {
                state.mode = 'path'
              }
            } else if (state.mode === 'seek-waypoint') {
              state.mode = 'path'
            }
          }
        }
      }

      // 获取当前目标点（可能已被快进修正）
      const target = points[state.targetIndex]!

      // 只在XZ平面上进行移动和到达检测
      // 这样可以避免仅Y轴不同导致的卡住（我们只在XZ上控制朝向）
      autoTourPlanarTarget.copy(target)
      autoTourPlanarTarget.y = autoTourCurrentPosition.y

      // 计算XZ平面上的方向向量
      autoTourDirection.copy(autoTourPlanarTarget).sub(autoTourCurrentPosition)
      autoTourDirection.y = 0
      // 计算XZ平面上的距离
      const distance = Math.sqrt(autoTourDirection.x * autoTourDirection.x + autoTourDirection.z * autoTourDirection.z)
      // 计算到达判定距离（基于速度和PurePursuit参数）
      /**
       * 计算到达距离（arrivalDistance）。
       *
       * 算法原理：
       * - 首先根据当前速度（speed）和到达距离速度因子（pursuitProps.arrivalDistanceSpeedFactor）计算一个基础距离。
       * - 然后将该基础距离限制在最小到达距离（pursuitProps.arrivalDistanceMinMeters）和最大到达距离（pursuitProps.arrivalDistanceMaxMeters）之间。
       * - 具体做法是：先用 `Math.min` 保证基础距离不超过最大值，再用 `Math.max` 保证结果不小于最小值。
       *
       * 这样可以根据速度动态调整到达距离，同时保证其在合理范围内，避免过大或过小导致异常行为。
       *
       * @remarks
       * 此算法常用于追踪或寻路系统中，根据目标速度自适应调整停止或减速的距离，提高运动的自然性和安全性。
       */
      const dockEnabledAtTarget = dockFlags[state.targetIndex] === true
      const isNonLoopTerminalEnd = !tourProps.loop && state.targetIndex >= endIndex
      const shouldDockStopHere = dockEnabledAtTarget || isNonLoopTerminalEnd

      if (!Number.isFinite(distance) || distance <= arrivalDistance) {
        // Snap to the waypoint visually for direct-move nodes to avoid leaving a visible gap.
        if (!shouldDriveAsVehicle) {
          state.smoothedWorldPosition.copy(autoTourPlanarTarget)
          if (nodeObject!.parent) {
            nodeObject!.parent.updateMatrixWorld(true)
            autoTourLocalPosition.copy(autoTourPlanarTarget)
            nodeObject!.parent.worldToLocal(autoTourLocalPosition)
            nodeObject!.position.copy(autoTourLocalPosition)
          } else {
            nodeObject!.position.copy(autoTourPlanarTarget)
          }
          syncNodeTransformFromObject(node, nodeObject!)
          deps.onNodeObjectTransformUpdated?.(node.id, nodeObject!)

          // If this is a vehicle node being moved via direct transforms, keep the physics chassis in sync.
          if (directMoveVehicle && hasVehicleInstance) {
            syncBodyFromObject(vehicleInstance!.vehicle.chassisBody, nodeObject!)
            holdVehicleBrakeSafe({
              vehicleInstance: vehicleInstance! as any,
              brakeForce: vehicleProps.brakeForceMax * 6,
            })
          }
        }

        // Direct-move vehicle nodes: allow docking via the shared stopping flow.
        if (directMoveVehicle) {
          if (shouldDockStopHere) {
            state.mode = 'stopping'
            state.dockStopIndex = state.targetIndex
          } else {
            if (state.targetIndex >= endIndex) {
              if (tourProps.loop) {
                state.targetIndex = 0
              } else {
                // Terminal stop: do not keep writing transforms/teleports after arrival.
                state.targetIndex = endIndex
                state.mode = 'stopped'
                finalizeTourTerminalStop({
                  nodeId: node.id,
                  reason: 'direct-move-vehicle-end',
                  key,
                  state,
                  tourProps,
                  pursuitProps,
                })
              }
            } else {
              state.targetIndex += 1
            }
            state.routeNodeId = routeNodeId
            state.routeWaypointCount = points.length
            continue
          }
        }

        // Docking: when enabled for the current waypoint (or forced terminal end in non-loop),
        // enter stopping mode immediately upon reaching the arrival threshold.
        if (shouldDockStopHere && state.mode !== 'stopping') {
          state.mode = 'stopping'
          state.dockStopIndex = state.targetIndex
        }

        // Advance state machine:
        // - Intermediate points: advance to next.
        // - End point: stop unless looping, in which case go to start.
        // - Docking waypoints: handled above via stopping mode.
        if (state.mode === 'seek-waypoint') {
          if (state.targetIndex >= endIndex) {
            if (tourProps.loop) {
              state.mode = 'loop-to-start'
              state.targetIndex = 0
            } else {
              // Ease into the end position before fully stopping.
              state.mode = 'stopping'
              state.targetIndex = endIndex
            }
          } else {
            state.mode = 'path'
            state.targetIndex = Math.min(state.targetIndex + 1, endIndex)
          }
        } else if (state.mode === 'loop-to-start') {
          // Arrived at start; continue along the route toward the end.
          state.mode = 'path'
          state.targetIndex = Math.min(1, endIndex)
        } else if (state.mode === 'path') {
          if (state.targetIndex >= endIndex) {
            if (tourProps.loop) {
              state.mode = 'loop-to-start'
              state.targetIndex = 0
            } else {
              // Enter stopping phase; keep target at end and allow easing/braking.
              state.mode = 'stopping'
              state.targetIndex = endIndex
            }
          } else {
            state.targetIndex += 1
          }
        } else if (state.mode === 'stopping') {
          // Once in stopping mode, do not advance indices on the coarse arrival threshold.
          state.targetIndex = typeof state.dockStopIndex === 'number' ? Math.floor(state.dockStopIndex) : endIndex
        }

        // Keep cache metadata in sync.
        state.routeNodeId = routeNodeId
        state.routeWaypointCount = points.length

        // If we transitioned into stopping mode, fall through to let the movement branch ease/brake.
        if (state.mode !== 'stopping') {
          continue
        }
      }

      // Vehicle branch (drive as a car).
      if (shouldDriveAsVehicle) {
        const isStopping = state.mode === 'stopping'
        const result = applyPurePursuitVehicleControlSafe({
          vehicleInstance: vehicleInstance! as any,
          points,
          loop: Boolean(tourProps.loop),
          deltaSeconds,
          speedMps: speed,
          pursuitProps,
          vehicleProps,
          state,
          modeStopping: isStopping,
          distanceToTarget: distance,
          stopIndex: isStopping
            ? (typeof state.dockStopIndex === 'number' && Number.isFinite(state.dockStopIndex)
              ? Math.floor(state.dockStopIndex)
              : endIndex)
            : undefined,
        })
        if (isStopping && result.reachedStop) {
          const stopIndex = typeof state.dockStopIndex === 'number' && Number.isFinite(state.dockStopIndex)
            ? Math.floor(state.dockStopIndex)
            : endIndex
          const isTerminal = !tourProps.loop && stopIndex >= endIndex
          if (isTerminal) {
            state.mode = 'stopped'
            finalizeTourTerminalStop({
              nodeId: node.id,
              reason: 'vehicle-reached-stop',
              key,
              state,
              tourProps,
              pursuitProps,
            })
          } else {
            // Docking stop: request host pause and hold here until resume.
            state.mode = 'dock-hold'
            state.dockHoldIndex = stopIndex
            if (state.dockLatchIndex !== stopIndex) {
              state.dockLatchIndex = stopIndex
              try {
                deps.onDockRequestedPause?.(node.id, { waypointIndex: stopIndex, terminal: false })
              } catch {
                // Ignore errors in host callback.
              }
            }
          }
        }
        continue
      }

      // Non-vehicle branch: move render object directly (runtime-only), with smoothing.
      autoTourDesiredDir.copy(autoTourDirection)
      if (autoTourDesiredDir.lengthSq() < 1e-10) {
        continue
      }
      autoTourDesiredDir.normalize()

      if (state.mode === 'stopping') {
        // Ease into the final endpoint by smoothing toward the exact target.
        autoTourNextWorldPosition.copy(autoTourPlanarTarget)
      } else {
        const stepDistance = speed * deltaSeconds
        const clampedStep = Number.isFinite(stepDistance) ? Math.max(0, stepDistance) : 0
        autoTourNextWorldPosition.copy(autoTourCurrentPosition)
        if (clampedStep > 0) {
          autoTourNextWorldPosition.addScaledVector(autoTourDesiredDir, Math.min(clampedStep, distance))
        }
      }

      if (!state.hasSmoothedState) {
        state.hasSmoothedState = true
        state.smoothedWorldPosition.copy(autoTourCurrentPosition)
        nodeObject!.getWorldQuaternion(autoTourObjectWorldQuaternion)
        state.smoothedYaw = getWorldYawRadiansFromQuaternion(autoTourObjectWorldQuaternion)
      }

      const positionAlpha = expSmoothingAlpha(AUTO_TOUR_POSITION_SMOOTHING, deltaSeconds)
      state.smoothedWorldPosition.lerp(autoTourNextWorldPosition, positionAlpha)

      if (nodeObject!.parent) {
        nodeObject!.parent.updateMatrixWorld(true)
        autoTourLocalPosition.copy(state.smoothedWorldPosition)
        nodeObject!.parent.worldToLocal(autoTourLocalPosition)
        nodeObject!.position.copy(autoTourLocalPosition)
      } else {
        nodeObject!.position.copy(state.smoothedWorldPosition)
      }

      if (tourProps.alignToPath) {
        // Align node local X+ (forward) to the path direction.
        const desiredYaw = Math.atan2(-autoTourDesiredDir.z, autoTourDesiredDir.x)
        const yawAlpha = expSmoothingAlpha(AUTO_TOUR_YAW_SMOOTHING, deltaSeconds)
        state.smoothedYaw = dampAngleRadians(state.smoothedYaw, desiredYaw, yawAlpha)
        autoTourWorldQuaternion.setFromAxisAngle(autoTourUp, state.smoothedYaw)
        if (nodeObject!.parent) {
          nodeObject!.parent.getWorldQuaternion(autoTourParentWorldQuaternion)
          autoTourLocalQuaternion.copy(autoTourParentWorldQuaternion).invert().multiply(autoTourWorldQuaternion)
          nodeObject!.quaternion.copy(autoTourLocalQuaternion)
        } else {
          nodeObject!.quaternion.copy(autoTourWorldQuaternion)
        }
      }

      syncNodeTransformFromObject(node, nodeObject!)

      deps.onNodeObjectTransformUpdated?.(node.id, nodeObject!)

      // Keep physics chassis in sync for vehicle nodes that are moved via direct transforms.
      if (directMoveVehicle && hasVehicleInstance) {
        syncBodyFromObject(vehicleInstance!.vehicle.chassisBody, nodeObject!)
        holdVehicleBrakeSafe({
          vehicleInstance: vehicleInstance! as any,
          brakeForce: vehicleProps.brakeForceMax * 6,
        })
      }

      if (state.mode === 'stopping') {
        if (state.smoothedWorldPosition.distanceToSquared(autoTourPlanarTarget) <= AUTO_TOUR_STOP_POSITION_EPSILON * AUTO_TOUR_STOP_POSITION_EPSILON) {
          // Snap exactly to endpoint and stop.
          state.smoothedWorldPosition.copy(autoTourPlanarTarget)
          if (nodeObject!.parent) {
            nodeObject!.parent.updateMatrixWorld(true)
            autoTourLocalPosition.copy(autoTourPlanarTarget)
            nodeObject!.parent.worldToLocal(autoTourLocalPosition)
            nodeObject!.position.copy(autoTourLocalPosition)
          } else {
            nodeObject!.position.copy(autoTourPlanarTarget)
          }
          deps.onNodeObjectTransformUpdated?.(node.id, nodeObject!)
          const stopIndex = typeof state.dockStopIndex === 'number' && Number.isFinite(state.dockStopIndex)
            ? Math.floor(state.dockStopIndex)
            : endIndex
          const isTerminal = !tourProps.loop && stopIndex >= endIndex
          if (isTerminal) {
            state.mode = 'stopped'
            finalizeTourTerminalStop({
              nodeId: node.id,
              reason: 'non-vehicle-snapped-end',
              key,
              state,
              tourProps,
              pursuitProps,
            })
          } else {
            state.mode = 'dock-hold'
            state.dockHoldIndex = stopIndex
            if (state.dockLatchIndex !== stopIndex) {
              state.dockLatchIndex = stopIndex
              try {
                deps.onDockRequestedPause?.(node.id, { waypointIndex: stopIndex, terminal: false })
              } catch {
                // Ignore errors in host callback.
              }
            }
          }
        }
      }
    }

  }

  return {
    update,
    reset: () => {
      autoTourPlaybackState.clear()
      activeTourNodes.clear()
      disabledTourNodes.clear()
      terminalBrakeHoldNodes.clear()
      terminalStoppedNodes.clear()
    },
    startTour: (nodeId: string) => {
      if (!nodeId) {
        return
      }
      terminalBrakeHoldNodes.delete(nodeId)
      terminalStoppedNodes.delete(nodeId)
      disabledTourNodes.delete(nodeId)
      if (requiresExplicitStart) {
        activeTourNodes.add(nodeId)
      }
      // Force a clean re-initialization on next update.
      clearPlaybackStateForNode(nodeId)
    },
    stopTour: (nodeId: string) => {
      if (!nodeId) {
        return
      }
      // Explicit stop should not keep "park" brakes applied forever.
      terminalBrakeHoldNodes.delete(nodeId)
      terminalStoppedNodes.delete(nodeId)
      if (requiresExplicitStart) {
        activeTourNodes.delete(nodeId)
      } else {
        disabledTourNodes.add(nodeId)
      }

      // Freeze any cached smoothing/controller state for this node so restart is clean.
      const prefix = `${nodeId}:`
      for (const [key, state] of autoTourPlaybackState.entries()) {
        if (!key.startsWith(prefix)) {
          continue
        }
        state.mode = 'stopped'
        state.speedIntegral = undefined
        state.lastSteerRad = undefined
        state.reverseActive = undefined

        const node = deps.resolveNodeById(nodeId)
        const object = deps.nodeObjectMap.get(nodeId) ?? null
        if (node && object) {
          object.getWorldPosition(state.smoothedWorldPosition)
          object.getWorldQuaternion(autoTourObjectWorldQuaternion)
          state.smoothedYaw = getWorldYawRadiansFromQuaternion(autoTourObjectWorldQuaternion)
          state.hasSmoothedState = true
          syncNodeTransformFromObject(node, object)
          deps.onNodeObjectTransformUpdated?.(nodeId, object)
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
