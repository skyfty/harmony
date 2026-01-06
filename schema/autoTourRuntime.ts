import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode } from './index'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import { applyPurePursuitVehicleControlSafe, holdVehicleBrakeSafe } from './purePursuitRuntime'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  GUIDE_ROUTE_COMPONENT_TYPE,
  clampAutoTourComponentProps,
  clampGuideRouteComponentProps,
  PURE_PURSUIT_COMPONENT_TYPE,
  clampPurePursuitComponentProps,
  type AutoTourComponentProps,
  type GuideRouteComponentProps,
  type PurePursuitComponentProps,
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
}

export type AutoTourRuntime = {
  update: (deltaSeconds: number) => void
  reset: () => void
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
      const autoTour = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
      if (!autoTour) {
        continue
      }
      const tourProps = clampAutoTourComponentProps(autoTour.props)
      const purePursuit = resolveEnabledComponentState<PurePursuitComponentProps>(node, PURE_PURSUIT_COMPONENT_TYPE)
      const pursuitProps = clampPurePursuitComponentProps((purePursuit?.props ?? (autoTour.props as any)) ?? null)
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
      const hasVehicle = Boolean(vehicleInstance?.vehicle?.chassisBody)
      const nodeObject = hasVehicle ? null : (deps.nodeObjectMap.get(node.id) ?? null)
      if (!hasVehicle && !nodeObject) {
        continue
      }

      if (!state || state.routeNodeId !== routeNodeId || state.routeWaypointCount !== points.length) {
        const initReason = !state
          ? 'missing-state'
          : (state.routeNodeId !== routeNodeId ? 'route-changed' : 'waypoint-count-changed')
        // Initialize by heading to the nearest waypoint (includes start/end/intermediate).
        const positionSample = autoTourCurrentPosition
        if (hasVehicle) {
          const body = vehicleInstance!.vehicle.chassisBody
          positionSample.set(body.position.x, body.position.y, body.position.z)
        } else {
          nodeObject!.getWorldPosition(positionSample)
        }

        const nearestWaypointIndex = findClosestWaypointIndex(points, positionSample)

        let initialYaw = 0
        if (hasVehicle) {
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

      // When stopped and not looping:
      // - non-vehicle: do nothing (object already at final position)
      // - vehicle: keep holding brake to avoid rolling
      if (state.mode === 'stopped') {
        if (tourProps.loop) {
          state.mode = 'loop-to-start'
          state.targetIndex = 0
        } else {
          if (hasVehicle) {
            holdVehicleBrakeSafe({
              vehicleInstance: vehicleInstance! as any,
              brakeForce: pursuitProps.brakeForceMax * 6,
            })
          }
          continue
        }
      }

      // Safety clamp.
      if (!Number.isFinite(state.targetIndex)) {
        state.targetIndex = 0
      }
      state.targetIndex = Math.max(0, Math.min(endIndex, Math.floor(state.targetIndex)))

      const target = points[state.targetIndex]!
      if (hasVehicle) {
        const chassisBody = vehicleInstance!.vehicle.chassisBody
        autoTourCurrentPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
      } else {
        nodeObject!.getWorldPosition(autoTourCurrentPosition)
      }

      // Use planar (XZ) movement and arrival checks.
      // This avoids getting stuck when the waypoint differs only in Y (we intentionally drive yaw-only on XZ).
      autoTourPlanarTarget.copy(target)
      autoTourPlanarTarget.y = autoTourCurrentPosition.y

      autoTourDirection.copy(autoTourPlanarTarget).sub(autoTourCurrentPosition)
      autoTourDirection.y = 0
      const distance = Math.sqrt(autoTourDirection.x * autoTourDirection.x + autoTourDirection.z * autoTourDirection.z)
      const arrivalDistance = Math.max(
        pursuitProps.arrivalDistanceMinMeters,
        Math.min(pursuitProps.arrivalDistanceMaxMeters, speed * pursuitProps.arrivalDistanceSpeedFactor),
      )
      if (!Number.isFinite(distance) || distance <= arrivalDistance) {
        const beforeIndex = state.targetIndex
        const beforeMode = state.mode
        // Snap to the waypoint visually for non-vehicle nodes to avoid leaving a visible gap.
        if (!hasVehicle) {
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
      if (hasVehicle) {
        const isStopping = state.mode === 'stopping'
        const result = applyPurePursuitVehicleControlSafe({
          vehicleInstance: vehicleInstance! as any,
          points,
          loop: Boolean(tourProps.loop),
          deltaSeconds,
          speedMps: speed,
          pursuitProps,
          state,
          modeStopping: isStopping,
          distanceToTarget: distance,
        })
        if (isStopping && result.reachedStop) {
          state.mode = 'stopped'
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
        const desiredYaw = Math.atan2(autoTourDesiredDir.x, autoTourDesiredDir.z)
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
          state.mode = 'stopped'
        }
      }
    }

  }

  return {
    update,
    reset: () => {
      autoTourPlaybackState.clear()
    },
  }
}
