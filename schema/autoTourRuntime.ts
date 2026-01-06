import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode } from './index'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  GUIDE_ROUTE_COMPONENT_TYPE,
  clampAutoTourComponentProps,
  clampGuideRouteComponentProps,
  type AutoTourComponentProps,
  type GuideRouteComponentProps,
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
}

const AUTO_TOUR_MAX_STEER_RADIANS = THREE.MathUtils.degToRad(26)
const AUTO_TOUR_ENGINE_FORCE = 320
const AUTO_TOUR_BRAKE_FORCE = 16
const AUTO_TOUR_POSITION_SMOOTHING = 14
const AUTO_TOUR_YAW_SMOOTHING = 12
const AUTO_TOUR_STOP_POSITION_EPSILON = 0.03
const AUTO_TOUR_STOP_VEHICLE_SPEED_EPSILON = 0.25

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
  const autoTourForward = new THREE.Vector3()
  const autoTourDesiredDir = new THREE.Vector3()
  const autoTourCross = new THREE.Vector3()
  const autoTourChassisQuaternion = new THREE.Quaternion()
  const autoTourObjectWorldQuaternion = new THREE.Quaternion()
  const autoTourParentWorldQuaternion = new THREE.Quaternion()
  const autoTourWorldQuaternion = new THREE.Quaternion()
  const autoTourLocalQuaternion = new THREE.Quaternion()
  const autoTourUp = new THREE.Vector3(0, 1, 0)
  const autoTourNextWorldPosition = new THREE.Vector3()
  const autoTourLocalPosition = new THREE.Vector3()

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
    if (deltaSeconds <= 0) {
      return
    }
    if (deps.isManualDriveActive()) {
      return
    }

    for (const node of deps.iterNodes()) {
      const autoTour = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
      if (!autoTour) {
        continue
      }
      const props = clampAutoTourComponentProps(autoTour.props)
      const routeNodeId = props.routeNodeId
      if (!routeNodeId) {
        continue
      }
      const points = getGuideRouteWorldWaypoints(routeNodeId)
      if (!points) {
        continue
      }

      const endIndex = points.length - 1

      const speed = Math.max(0, props.speedMps)
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
        if (props.loop) {
          state.mode = 'loop-to-start'
          state.targetIndex = 0
        } else {
          if (hasVehicle) {
            try {
              const vehicle = vehicleInstance!.vehicle
              for (let index = 0; index < vehicleInstance!.wheelCount; index += 1) {
                vehicle.setBrake(AUTO_TOUR_BRAKE_FORCE * 6, index)
                vehicle.applyEngineForce(0, index)
                vehicle.setSteeringValue(0, index)
              }
            } catch (error) {
              console.warn('[AutoTourRuntime] AutoTour vehicle hold brake failed', error)
            }
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

      autoTourDirection.copy(target).sub(autoTourCurrentPosition)
      const distance = autoTourDirection.length()
      const arrivalDistance = Math.max(0.35, Math.min(1.25, speed * 0.2))
      if (!Number.isFinite(distance) || distance <= arrivalDistance) {
        // Snap to the waypoint visually for non-vehicle nodes to avoid leaving a visible gap.
        if (!hasVehicle) {
          state.smoothedWorldPosition.copy(target)
          if (nodeObject!.parent) {
            nodeObject!.parent.updateMatrixWorld(true)
            autoTourLocalPosition.copy(target)
            nodeObject!.parent.worldToLocal(autoTourLocalPosition)
            nodeObject!.position.copy(autoTourLocalPosition)
          } else {
            nodeObject!.position.copy(target)
          }
          deps.onNodeObjectTransformUpdated?.(node.id, nodeObject!)
        }

        // Advance state machine:
        // - Intermediate points (including start): no stop, advance to next.
        // - End point: stop unless looping, in which case go to start.
        if (state.mode === 'seek-waypoint') {
          if (state.targetIndex >= endIndex) {
            if (props.loop) {
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
            if (props.loop) {
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
        const instance = vehicleInstance!
        const vehicle = instance.vehicle
        const chassisBody = vehicle.chassisBody
        autoTourDesiredDir.copy(autoTourDirection)
        autoTourDesiredDir.y = 0
        if (autoTourDesiredDir.lengthSq() < 1e-10) {
          continue
        }
        autoTourDesiredDir.normalize()

        autoTourChassisQuaternion
          .set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
          .normalize()
        autoTourForward.copy(instance.axisForward)
        autoTourForward.applyQuaternion(autoTourChassisQuaternion)
        autoTourForward.y = 0
        if (autoTourForward.lengthSq() < 1e-10) {
          autoTourForward.set(0, 0, 1)
        }
        autoTourForward.normalize()

        const crossY = autoTourCross.copy(autoTourForward).cross(autoTourDesiredDir).dot(autoTourUp)
        const dot = THREE.MathUtils.clamp(autoTourForward.dot(autoTourDesiredDir), -1, 1)
        const angle = Math.acos(dot)
        const signedAngle = crossY >= 0 ? angle : -angle
        const steering =
          THREE.MathUtils.clamp(signedAngle / AUTO_TOUR_MAX_STEER_RADIANS, -1, 1) * AUTO_TOUR_MAX_STEER_RADIANS

        const steeringPenalty = Math.min(1, Math.abs(signedAngle) / Math.PI)
        const throttle = THREE.MathUtils.clamp(1 - steeringPenalty * 1.4, 0, 1)
        const shouldBrake = distance < Math.max(2.5, speed * 0.9)
        const isStopping = state.mode === 'stopping'
        const engineForce = isStopping ? 0 : AUTO_TOUR_ENGINE_FORCE * throttle
        const brakeForce = isStopping ? AUTO_TOUR_BRAKE_FORCE * 6 : (shouldBrake ? AUTO_TOUR_BRAKE_FORCE : 0)

        try {
          for (let index = 0; index < instance.wheelCount; index += 1) {
            vehicle.setBrake(brakeForce, index)
            vehicle.applyEngineForce(engineForce, index)
            vehicle.setSteeringValue(0, index)
          }
          instance.steerableWheelIndices.forEach((wheelIndex) => {
            vehicle.setSteeringValue(steering, wheelIndex)
          })
        } catch (error) {
          console.warn('[AutoTourRuntime] AutoTour vehicle drive failed', error)
        }

        if (isStopping) {
          const vx = chassisBody.velocity.x
          const vz = chassisBody.velocity.z
          const planarSpeed = Math.sqrt(vx * vx + vz * vz)
          if (distance <= AUTO_TOUR_STOP_POSITION_EPSILON && planarSpeed <= AUTO_TOUR_STOP_VEHICLE_SPEED_EPSILON) {
            state.mode = 'stopped'
          }
        }
        continue
      }

      // Non-vehicle branch: move render object directly (runtime-only), with smoothing.
      autoTourDesiredDir.copy(autoTourDirection)
      autoTourDesiredDir.y = 0
      if (autoTourDesiredDir.lengthSq() < 1e-10) {
        continue
      }
      autoTourDesiredDir.normalize()

      if (state.mode === 'stopping') {
        // Ease into the final endpoint by smoothing toward the exact target.
        autoTourNextWorldPosition.copy(target)
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

      if (props.alignToPath) {
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

      deps.onNodeObjectTransformUpdated?.(node.id, nodeObject!)

      if (state.mode === 'stopping') {
        if (state.smoothedWorldPosition.distanceToSquared(target) <= AUTO_TOUR_STOP_POSITION_EPSILON * AUTO_TOUR_STOP_POSITION_EPSILON) {
          // Snap exactly to endpoint and stop.
          state.smoothedWorldPosition.copy(target)
          if (nodeObject!.parent) {
            nodeObject!.parent.updateMatrixWorld(true)
            autoTourLocalPosition.copy(target)
            nodeObject!.parent.worldToLocal(autoTourLocalPosition)
            nodeObject!.position.copy(autoTourLocalPosition)
          } else {
            nodeObject!.position.copy(target)
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
