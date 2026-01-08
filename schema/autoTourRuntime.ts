import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode } from './index'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import { applyPurePursuitVehicleControlSafe, holdVehicleBrakeSafe } from './purePursuitRuntime'
import { syncBodyFromObject } from './physicsEngine'
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
  mode: 'seek-waypoint' | 'path' | 'loop-to-start' | 'stopped' | 'stopping'
  targetIndex: number
  routeNodeId: string
  routeWaypointCount: number
  hasSmoothedState: boolean
  smoothedWorldPosition: THREE.Vector3
  smoothedYaw: number

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

export function createAutoTourRuntime(deps: AutoTourRuntimeDeps): AutoTourRuntime {
  const autoTourPlaybackState = new Map<string, AutoTourPlaybackState>()
  const requiresExplicitStart = deps.requiresExplicitStart === true
  const activeTourNodes = new Set<string>()
  const disabledTourNodes = new Set<string>()
  

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
      activeTourNodes.delete(nodeId)
    } else {
      disabledTourNodes.add(nodeId)
    }

    // Apply a one-time hard stop so the node truly "parks" at the end even if physics is active.
    stopVehicleImmediately(nodeId)
    deps.stopNodeMotion?.(nodeId)

    // Free cached state; restart will re-init cleanly via startTour().
    clearPlaybackStateForNode(nodeId)
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

  function getGuideRouteWorldWaypoints(routeNodeId: string): THREE.Vector3[] | null {
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
    const result: THREE.Vector3[] = []
    props.waypoints.forEach((wp) => {
      autoTourTargetPosition.set(wp.position.x, wp.position.y, wp.position.z)
      result.push(routeObject.localToWorld(autoTourTargetPosition.clone()))
    })
    return result.length >= 2 ? result : null
  }

  function update(deltaSeconds: number): void {
    const manualDriveActive = deps.isManualDriveActive()

    if (deltaSeconds <= 0) {
      return
    }
    if (manualDriveActive) {
      return
    }

    for (const node of deps.iterNodes()) {
      if (disabledTourNodes.has(node.id)) {
        continue
      }
      if (requiresExplicitStart && !activeTourNodes.has(node.id)) {
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
      const points = getGuideRouteWorldWaypoints(routeNodeId)
      if (!points) {
        continue
      }

      const endIndex = points.length - 1

      const speed = Math.max(0, tourProps.speedMps)
      if (speed <= 0) {
        continue
      }

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
        const initReason = !state
          ? 'missing-state'
          : (state.routeNodeId !== routeNodeId ? 'route-changed' : 'waypoint-count-changed')
        // Initialize by heading to the nearest waypoint (includes start/end/intermediate).
        const positionSample = autoTourCurrentPosition
        if (hasVehicleInstance) {
          const body = vehicleInstance!.vehicle.chassisBody
          positionSample.set(body.position.x, body.position.y, body.position.z)
        } else {
          nodeObject!.getWorldPosition(positionSample)
        }

        const nearestWaypointIndex = findClosestWaypointIndex(points, positionSample)

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
          targetIndex: nearestWaypointIndex,
          routeNodeId,
          routeWaypointCount: points.length,
          hasSmoothedState: true,
          smoothedWorldPosition: positionSample.clone(),
          smoothedYaw: initialYaw,
        }
        autoTourPlaybackState.set(key, state)
      }

      if (!state) {
        continue
      }

      // Vehicle nodes that are moving via direct node transforms should not use the
      // stopping/stopped state machine (they can still respect loop via index wrap).
      if (directMoveVehicle) {
        if (state.mode === 'stopping' || state.mode === 'loop-to-start') {
          state.mode = 'path'
        }
        // When direct-moving a vehicle and not looping, fully stop updating once we
        // have reached the final waypoint.
        if (!tourProps.loop && state.mode === 'stopped') {
          continue
        }
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

      // 获取当前目标点
      const target = points[state.targetIndex]!
      if (hasVehicleInstance) {
        // 如果是物理车辆，直接读取底盘的世界坐标
        const chassisBody = vehicleInstance!.vehicle.chassisBody
        autoTourCurrentPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
      } else {
        // 否则用Three.js对象的世界坐标
        nodeObject!.getWorldPosition(autoTourCurrentPosition)
      }

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
      const arrivalDistance = Math.max(pursuitProps.arrivalDistanceMinMeters,pursuitProps.arrivalDistanceMaxMeters)
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

        // Direct-move vehicle nodes: advance indices simply (no stopping/stopped/loop-to-start modes).
        if (directMoveVehicle) {
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

        // Advance state machine:
        // - Intermediate points (including start): no stop, advance to next.
        // - End point: stop unless looping, in which case go to start.
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
          state.targetIndex = endIndex
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
        })
        if (isStopping && result.reachedStop) {
          state.mode = 'stopped'
          finalizeTourTerminalStop({
            nodeId: node.id,
            reason: 'vehicle-reached-stop',
            key,
            state,
            tourProps,
            pursuitProps,
          })
        }
        continue
      }

      // Non-vehicle branch: move render object directly (runtime-only), with smoothing.
      autoTourDesiredDir.copy(autoTourDirection)
      if (autoTourDesiredDir.lengthSq() < 1e-10) {
        continue
      }
      autoTourDesiredDir.normalize()

      if (!directMoveVehicle && state.mode === 'stopping') {
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
          const before = state.mode
          state.mode = 'stopped'
          finalizeTourTerminalStop({
            nodeId: node.id,
            reason: 'non-vehicle-snapped-end',
            key,
            state,
            tourProps,
            pursuitProps,
          })
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
    },
    startTour: (nodeId: string) => {
      if (!nodeId) {
        return
      }
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
