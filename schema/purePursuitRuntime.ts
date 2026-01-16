import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { PurePursuitComponentProps, VehicleComponentProps } from './components'
import { buildPolylineMetricData, projectPointToPolyline, samplePolylineAtS } from './polylineProgress'

const VEHICLE_CONTROL_DEBUG_KEY = 'harmony:debug:vehicle-control'
const PURE_PURSUIT_DEBUG_KEY = 'harmony:debug:pure-pursuit'
const AUTO_TOUR_DEBUG_KEY = 'harmony:debug:auto-tour'

type VehicleControlDebugKind = 'pure-pursuit' | 'auto-tour'

export type VehicleControlDebugEvent = {
  ts: number
  dt?: number
  kind: VehicleControlDebugKind
  nodeId?: string
  reason: string
  modeStopping?: boolean
  dockActive?: boolean
  shouldBrakeNearEnd?: boolean
  distanceToEnd?: number
  brakeThreshold?: number
  arrivalDistance?: number
  speedMps?: number
  forwardSpeedMps?: number
  targetSpeedMps?: number
  speedError?: number
  control?: number
  integral?: number
  engineForce?: number
  brakeForce?: number
  steerRad?: number
  targetIndex?: number
  stopIndex?: number

  suppressedSwitches?: number
}

type VehicleControlDebugBuffer = {
  capacity: number
  eventsByNodeId: Map<string, VehicleControlDebugEvent[]>
}

type DebugFlagCacheEntry = { value: boolean; lastReadMs: number }
const debugFlagCache = new Map<string, DebugFlagCacheEntry>()
let debugStorageListenerRegistered = false

function ensureDebugStorageListener(): void {
  if (debugStorageListenerRegistered) {
    return
  }
  debugStorageListenerRegistered = true
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return
  }
  try {
    window.addEventListener('storage', (event) => {
      const key = event?.key
      if (!key) {
        return
      }
      if (key === VEHICLE_CONTROL_DEBUG_KEY || key === PURE_PURSUIT_DEBUG_KEY || key === AUTO_TOUR_DEBUG_KEY) {
        debugFlagCache.delete(key)
      }
    })
  } catch {
    // Ignore listener failures (e.g., sandboxed runtime).
  }
}

function readLocalStorageFlag(key: string): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    const storage = window.localStorage
    if (!storage) {
      return false
    }
    return storage.getItem(key) === '1'
  } catch {
    return false
  }
}

function readLocalStorageFlagCached(key: string, maxAgeMs = 500): boolean {
  const now = Date.now()
  const cached = debugFlagCache.get(key)
  if (cached && now - cached.lastReadMs <= maxAgeMs) {
    return cached.value
  }
  const value = readLocalStorageFlag(key)
  debugFlagCache.set(key, { value, lastReadMs: now })
  return value
}

export function isVehicleControlDebugEnabled(): boolean {
  ensureDebugStorageListener()
  return (
    readLocalStorageFlagCached(VEHICLE_CONTROL_DEBUG_KEY) ||
    readLocalStorageFlagCached(PURE_PURSUIT_DEBUG_KEY) ||
    readLocalStorageFlagCached(AUTO_TOUR_DEBUG_KEY)
  )
}

export function isPurePursuitDebugEnabled(): boolean {
  ensureDebugStorageListener()
  return readLocalStorageFlagCached(VEHICLE_CONTROL_DEBUG_KEY) || readLocalStorageFlagCached(PURE_PURSUIT_DEBUG_KEY)
}

export function isAutoTourDebugEnabled(): boolean {
  ensureDebugStorageListener()
  return readLocalStorageFlagCached(VEHICLE_CONTROL_DEBUG_KEY) || readLocalStorageFlagCached(AUTO_TOUR_DEBUG_KEY)
}

function getVehicleControlDebugBuffer(): VehicleControlDebugBuffer {
  const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : ({} as any)
  const existing = g.__HARMONY_VEHICLE_CONTROL_DEBUG_BUFFER__ as VehicleControlDebugBuffer | undefined
  if (existing && existing.eventsByNodeId instanceof Map) {
    return existing
  }
  const buffer: VehicleControlDebugBuffer = {
    capacity: 2000,
    eventsByNodeId: new Map(),
  }
  try {
    g.__HARMONY_VEHICLE_CONTROL_DEBUG_BUFFER__ = buffer
  } catch {
    // Ignore if globalThis is not writable.
  }
  return buffer
}

export function pushVehicleControlDebugEvent(event: VehicleControlDebugEvent): void {
  if (!isVehicleControlDebugEnabled()) {
    return
  }

  const buffer = getVehicleControlDebugBuffer()
  const nodeId = event.nodeId || '<unknown>'
  const list = buffer.eventsByNodeId.get(nodeId) ?? []
  list.push(event)
  if (list.length > buffer.capacity) {
    list.splice(0, list.length - buffer.capacity)
  }
  buffer.eventsByNodeId.set(nodeId, list)

  // Expose a tiny helper for interactive debugging.
  const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : ({} as any)
  if (!g.__HARMONY_VEHICLE_CONTROL_DEBUG__) {
    try {
      g.__HARMONY_VEHICLE_CONTROL_DEBUG__ = {
        dump: (id?: string) => dumpVehicleControlDebugLog(id),
        clear: (id?: string) => clearVehicleControlDebugLog(id),
        keys: {
          vehicle: VEHICLE_CONTROL_DEBUG_KEY,
          purePursuit: PURE_PURSUIT_DEBUG_KEY,
          autoTour: AUTO_TOUR_DEBUG_KEY,
        },
      }
    } catch {
      // ignore
    }
  }
}

export function dumpVehicleControlDebugLog(nodeId?: string): VehicleControlDebugEvent[] | Record<string, VehicleControlDebugEvent[]> {
  const buffer = getVehicleControlDebugBuffer()
  if (nodeId) {
    return buffer.eventsByNodeId.get(nodeId) ?? []
  }
  const result: Record<string, VehicleControlDebugEvent[]> = {}
  for (const [key, value] of buffer.eventsByNodeId.entries()) {
    result[key] = value
  }
  return result
}

export function clearVehicleControlDebugLog(nodeId?: string): void {
  const buffer = getVehicleControlDebugBuffer()
  if (nodeId) {
    buffer.eventsByNodeId.delete(nodeId)
    return
  }
  buffer.eventsByNodeId.clear()
}

export type PurePursuitVehicleInstanceLike = {
  vehicle: CANNON.RaycastVehicle
  wheelCount: number
  steerableWheelIndices: number[]
  axisForward: THREE.Vector3
}

export type PurePursuitVehicleControlState = {
  speedIntegral?: number
  lastSteerRad?: number
  reverseActive?: boolean

  /** Latched longitudinal mode for engine/brake hysteresis. */
  longitudinalUseEngine?: boolean

  debugLastUseEngine?: boolean
  debugLastDockActive?: boolean
  debugLastShouldBrakeNearEnd?: boolean
  debugLastSampleAtMs?: number
  debugSuppressedSwitches?: number
}

const DEFAULT_MAX_STEER_RADIANS = THREE.MathUtils.degToRad(26)

const upAxis = new THREE.Vector3(0, 1, 0)

const chassisQuat = new THREE.Quaternion()
const forwardWorld = new THREE.Vector3()
const lookaheadPoint = new THREE.Vector3()
const rearAxle = new THREE.Vector3()
const toLookahead = new THREE.Vector3()
const desiredDir = new THREE.Vector3()
const cross = new THREE.Vector3()
const planarVelocity = new THREE.Vector3()
const planarEnd = new THREE.Vector3()
const yawTargetQuat = new THREE.Quaternion()
const objectWorldQuat = new THREE.Quaternion()
const currentPositionThree = new THREE.Vector3()

// Longitudinal control tuning (runtime-local, intentionally conservative defaults).
// These values are designed to remove "engine/brake" chattering near zero error without affecting normal driving.
const PP_SPEED_ERROR_HYSTERESIS_MPS = 0.06
const PP_INTEGRAL_LEAK_THRESHOLD_MPS = 0.10
const PP_INTEGRAL_LEAK_RATE_PER_SEC = 1.6
const PP_INTEGRAL_SIGN_MISMATCH_LEAK_RATE_PER_SEC = 5.0

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function setCannonQuaternionFromThree(target: any, q: THREE.Quaternion): void {
  if (!target) {
    return
  }
  target.x = q.x
  target.y = q.y
  target.z = q.z
  target.w = q.w
}

export function applyPurePursuitVehicleControl(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  points: THREE.Vector3[]
  loop: boolean
  deltaSeconds: number
  speedMps: number
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  state: PurePursuitVehicleControlState
  modeStopping: boolean
  /** Optional index to treat as the stopping/docking target (defaults to route end). */
  stopIndex?: number
  /** Optional nodeId for debug log correlation. */
  debugNodeId?: string
}): { reachedStop: boolean } {
  const {
    vehicleInstance,
    points,
    loop,
    deltaSeconds,
    speedMps,
    pursuitProps,
    vehicleProps,
    state,
    modeStopping,
    stopIndex,
  } = params

  const instance = vehicleInstance
  const vehicle = instance.vehicle
  const chassisBody = vehicle.chassisBody

  const currentPosition = chassisBody.position
  const currentY = currentPosition.y

  const maxSteerRad = THREE.MathUtils.degToRad(
    Number.isFinite(vehicleProps.maxSteerDegrees)
      ? vehicleProps.maxSteerDegrees
      : THREE.MathUtils.radToDeg(DEFAULT_MAX_STEER_RADIANS),
  )
  const maxSteerRateRadPerSec = THREE.MathUtils.degToRad(
    Number.isFinite(vehicleProps.maxSteerRateDegPerSec) ? vehicleProps.maxSteerRateDegPerSec : 140,
  )
  const maxSteerStep = Math.max(0, maxSteerRateRadPerSec) * deltaSeconds

  chassisQuat
    .set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
    .normalize()

  forwardWorld.copy(instance.axisForward)
  forwardWorld.applyQuaternion(chassisQuat)
  forwardWorld.y = 0
  if (forwardWorld.lengthSq() < 1e-10) {
    forwardWorld.set(1, 0, 0)
  }
  forwardWorld.normalize()

  const polylineData = buildPolylineMetricData(points, { closed: Boolean(loop), mode: '3d' })
  if (!polylineData) {
    return { reachedStop: false }
  }

  currentPositionThree.set(currentPosition.x, currentPosition.y, currentPosition.z)
  const closest = projectPointToPolyline(points, polylineData, currentPositionThree)

  const lookaheadDistance = Math.max(
    pursuitProps.lookaheadMinMeters,
    Math.min(
      pursuitProps.lookaheadMaxMeters,
      pursuitProps.lookaheadBaseMeters + pursuitProps.lookaheadSpeedGain * speedMps,
    ),
  )

  samplePolylineAtS(points, polylineData, closest.s + lookaheadDistance, lookaheadPoint)

  const endIndex = points.length - 1
  const rawStopIndex = typeof stopIndex === 'number' && Number.isFinite(stopIndex) ? Math.floor(stopIndex) : endIndex
  const clampedStopIndex = Math.max(0, Math.min(endIndex, rawStopIndex))
  const stopPoint = points[clampedStopIndex]!
  planarEnd.set(stopPoint.x, currentY, stopPoint.z)
  const dxEnd = planarEnd.x - currentPosition.x
  const dzEnd = planarEnd.z - currentPosition.z
  const distanceToEnd = Math.sqrt(dxEnd * dxEnd + dzEnd * dzEnd)

  const dockActive = modeStopping && pursuitProps.dockingEnabled && distanceToEnd <= pursuitProps.dockStartDistanceMeters

  const debugEnabled = isPurePursuitDebugEnabled()
  if (debugEnabled) {
    const lastDock = state.debugLastDockActive
    if (lastDock !== dockActive) {
      state.debugLastDockActive = dockActive
      pushVehicleControlDebugEvent({
        ts: Date.now(),
        dt: deltaSeconds,
        kind: 'pure-pursuit',
        nodeId: params.debugNodeId,
        reason: dockActive ? 'dock_on' : 'dock_off',
        modeStopping,
        dockActive,
        distanceToEnd,
        stopIndex: clampedStopIndex,
      })
    }
  }

  const wheelbaseMeters = Math.max(0.01, vehicleProps.wheelbaseMeters)
  rearAxle.set(currentPosition.x, currentY, currentPosition.z)
  rearAxle.addScaledVector(forwardWorld, -wheelbaseMeters * 0.5)

  toLookahead.copy(lookaheadPoint).sub(rearAxle)
  toLookahead.y = 0
  const toTargetLen = toLookahead.length()
  if (!Number.isFinite(toTargetLen) || toTargetLen < 1e-6) {
    return { reachedStop: false }
  }

  desiredDir.copy(toLookahead).normalize()

  // For auto-tour behavior we prefer stability near the endpoint.
  // Disallow reversing entirely to avoid forward/backward oscillation when the lookahead point ends up behind the vehicle.
  state.reverseActive = false

  const crossY = cross.copy(forwardWorld).cross(desiredDir).dot(upAxis)
  const dot = THREE.MathUtils.clamp(forwardWorld.dot(desiredDir), -1, 1)
  const alpha = (crossY >= 0 ? 1 : -1) * Math.acos(dot)

  const safeMaxSteer = Number.isFinite(maxSteerRad) && maxSteerRad > 1e-6 ? maxSteerRad : DEFAULT_MAX_STEER_RADIANS
  let steering = Math.atan2(2 * wheelbaseMeters * Math.sin(alpha), Math.max(1e-6, toTargetLen))
  steering = THREE.MathUtils.clamp(steering, -safeMaxSteer, safeMaxSteer)

  const lastSteer = typeof state.lastSteerRad === 'number' ? state.lastSteerRad : 0
  steering = THREE.MathUtils.clamp(steering, lastSteer - maxSteerStep, lastSteer + maxSteerStep)
  state.lastSteerRad = steering

  const steerRatio = safeMaxSteer > 1e-6 ? Math.min(1, Math.abs(steering) / safeMaxSteer) : 0
  const turnFactor = 1 / (1 + Math.max(0, pursuitProps.curvatureSpeedFactor) * steerRatio)
  let speedTarget = Math.max(pursuitProps.minSpeedMps, speedMps * turnFactor)

  if (modeStopping) {
    const approachSpeed = Math.min(
      pursuitProps.dockMaxSpeedMps,
      Math.max(0, distanceToEnd * pursuitProps.dockVelocityKp),
    )
    speedTarget = Math.min(speedTarget, approachSpeed)
  }

  const desiredSpeedSigned = speedTarget

  planarVelocity.set(chassisBody.velocity.x, 0, chassisBody.velocity.z)
  const forwardSpeed = planarVelocity.dot(forwardWorld)
  const speedError = desiredSpeedSigned - forwardSpeed

  let integral = typeof state.speedIntegral === 'number' ? state.speedIntegral : 0
  integral += speedError * deltaSeconds
  const integralMax = Math.max(0, pursuitProps.speedIntegralMax)
  integral = integralMax > 0 ? THREE.MathUtils.clamp(integral, -integralMax, integralMax) : 0

  // Integral leak to reduce overshoot and eliminate sign-flip chatter near steady-state.
  const absSpeedError = Math.abs(speedError)
  if (Number.isFinite(absSpeedError) && absSpeedError <= PP_INTEGRAL_LEAK_THRESHOLD_MPS) {
    const leak = Math.exp(-PP_INTEGRAL_LEAK_RATE_PER_SEC * Math.max(0, deltaSeconds))
    integral *= leak
  }
  if (
    integral !== 0 &&
    Number.isFinite(absSpeedError) &&
    absSpeedError <= PP_INTEGRAL_LEAK_THRESHOLD_MPS * 2 &&
    Math.sign(integral) !== Math.sign(speedError)
  ) {
    const leak = Math.exp(-PP_INTEGRAL_SIGN_MISMATCH_LEAK_RATE_PER_SEC * Math.max(0, deltaSeconds))
    integral *= leak
  }

  state.speedIntegral = integral

  const control = pursuitProps.speedKp * speedError + pursuitProps.speedKi * integral

  const engineForceMax = Number.isFinite(vehicleProps.engineForceMax) ? Math.max(0, vehicleProps.engineForceMax) : 0
  const brakeForceMax = Number.isFinite(vehicleProps.brakeForceMax) ? Math.max(0, vehicleProps.brakeForceMax) : 0
  const engineForceCmd = THREE.MathUtils.clamp(control * engineForceMax, -engineForceMax, engineForceMax)

  // Hysteresis on longitudinal mode (engine vs brake) to avoid jitter from tiny sign changes around zero.
  // Decide direction from speed error (stable physical signal) and latch within a deadband.
  const desiredUseEngine = speedError > 0
  const lastUseEngine = typeof state.longitudinalUseEngine === 'boolean' ? state.longitudinalUseEngine : desiredUseEngine
  let useEngine = lastUseEngine
  if (Number.isFinite(absSpeedError) && absSpeedError > PP_SPEED_ERROR_HYSTERESIS_MPS) {
    useEngine = desiredUseEngine
  } else {
    // Suppress mode toggles within hysteresis band.
    if (desiredUseEngine !== lastUseEngine) {
      state.debugSuppressedSwitches = (state.debugSuppressedSwitches ?? 0) + 1
    }
  }
  state.longitudinalUseEngine = useEngine

  let engineForce = useEngine ? Math.max(0, engineForceCmd) : 0
  let brakeForce = useEngine ? 0 : Math.min(brakeForceMax, Math.max(0, Math.abs(control) * brakeForceMax))

  if (debugEnabled) {
    const lastUseEngine = state.debugLastUseEngine
    if (lastUseEngine !== useEngine) {
      state.debugLastUseEngine = useEngine
      pushVehicleControlDebugEvent({
        ts: Date.now(),
        dt: deltaSeconds,
        kind: 'pure-pursuit',
        nodeId: params.debugNodeId,
        reason: useEngine ? 'brake_to_engine' : 'engine_to_brake',
        modeStopping,
        dockActive,
        speedMps,
        forwardSpeedMps: forwardSpeed,
        targetSpeedMps: desiredSpeedSigned,
        speedError,
        control,
        integral,
        engineForce,
        brakeForce,
        steerRad: steering,
      })
    }
  }

  // NOTE: `distanceToTarget` in AutoTour is the distance to the *current waypoint*.
  // Applying a hard brake floor near every waypoint causes visible stutter on curves (dense waypoints).
  // We only apply this brake-distance rule while stopping near the end.
  const brakeThreshold = Math.max(
    pursuitProps.brakeDistanceMinMeters,
    speedMps * pursuitProps.brakeDistanceSpeedFactor,
  )
  const shouldBrakeNearEnd = modeStopping && distanceToEnd < brakeThreshold
  if (shouldBrakeNearEnd && !dockActive) {
    brakeForce = Math.max(brakeForce, Math.min(brakeForceMax, brakeForceMax * 0.35))
  }

  if (debugEnabled) {
    const lastNearEnd = state.debugLastShouldBrakeNearEnd
    if (lastNearEnd !== shouldBrakeNearEnd) {
      state.debugLastShouldBrakeNearEnd = shouldBrakeNearEnd
      pushVehicleControlDebugEvent({
        ts: Date.now(),
        dt: deltaSeconds,
        kind: 'pure-pursuit',
        nodeId: params.debugNodeId,
        reason: shouldBrakeNearEnd ? 'near_end_brake_on' : 'near_end_brake_off',
        modeStopping,
        dockActive,
        shouldBrakeNearEnd,
        distanceToEnd,
        brakeThreshold,
        speedMps,
        forwardSpeedMps: forwardSpeed,
        targetSpeedMps: desiredSpeedSigned,
        speedError,
        engineForce,
        brakeForce,
      })
    }

    const now = Date.now()
    const lastSample = typeof state.debugLastSampleAtMs === 'number' ? state.debugLastSampleAtMs : 0
    if (now - lastSample >= 500) {
      state.debugLastSampleAtMs = now
      pushVehicleControlDebugEvent({
        ts: now,
        dt: deltaSeconds,
        kind: 'pure-pursuit',
        nodeId: params.debugNodeId,
        reason: 'pp_sample',
        modeStopping,
        dockActive,
        shouldBrakeNearEnd,
        distanceToEnd,
        brakeThreshold,
        speedMps,
        forwardSpeedMps: forwardSpeed,
        targetSpeedMps: desiredSpeedSigned,
        speedError,
        control,
        integral,
        engineForce,
        brakeForce,
        steerRad: steering,
        stopIndex: clampedStopIndex,
        suppressedSwitches: state.debugSuppressedSwitches ?? 0,
      })

      state.debugSuppressedSwitches = 0
    }
  }

  if (dockActive) {
    steering = 0
    engineForce = 0
    brakeForce = Math.max(brakeForce, brakeForceMax * 6)

    // Do not directly overwrite linear velocity in docking mode.
    // Overwriting velocity can cause the direction to flip as the chassis crosses the endpoint, resulting in jitter.

    if (pursuitProps.dockYawEnabled) {
      const prevIndex = clampedStopIndex > 0 ? clampedStopIndex - 1 : Math.min(clampedStopIndex + 1, endIndex)
      const prev = points[prevIndex]!
      const tanX = stopPoint.x - prev.x
      const tanZ = stopPoint.z - prev.z
      const tanLen = Math.sqrt(tanX * tanX + tanZ * tanZ)
      const yaw = tanLen > 1e-6
        ? Math.atan2(tanX / tanLen, tanZ / tanLen)
        : Math.atan2(forwardWorld.x, forwardWorld.z)

      yawTargetQuat.setFromAxisAngle(upAxis, yaw)
      const alphaYaw = 1 - Math.exp(-Math.max(0, pursuitProps.dockYawSlerpRate) * deltaSeconds)

      objectWorldQuat.copy(chassisQuat)
      objectWorldQuat.slerp(yawTargetQuat, clamp01(alphaYaw)).normalize()
      setCannonQuaternionFromThree(chassisBody.quaternion, objectWorldQuat)
    }

    chassisBody.angularVelocity.x *= 0.85
    chassisBody.angularVelocity.y *= 0.6
    chassisBody.angularVelocity.z *= 0.85
  }

  for (let index = 0; index < instance.wheelCount; index += 1) {
    vehicle.setBrake(brakeForce, index)
    vehicle.applyEngineForce(engineForce, index)
    vehicle.setSteeringValue(0, index)
  }
  instance.steerableWheelIndices.forEach((wheelIndex) => {
    vehicle.setSteeringValue(steering, wheelIndex)
  })

  if (modeStopping) {
    const vx = chassisBody.velocity.x
    const vz = chassisBody.velocity.z
    const planarSpeed = Math.sqrt(vx * vx + vz * vz)

    // Tolerant stopping: once we're within the docking zone, we only require a sufficiently low planar speed.
    // This avoids hunting around the exact endpoint.
    const stopDistance = Math.max(pursuitProps.dockStopEpsilonMeters, pursuitProps.dockStartDistanceMeters)
    if (distanceToEnd <= stopDistance && planarSpeed <= pursuitProps.dockStopSpeedEpsilonMps) {
      if (debugEnabled) {
        pushVehicleControlDebugEvent({
          ts: Date.now(),
          dt: deltaSeconds,
          kind: 'pure-pursuit',
          nodeId: params.debugNodeId,
          reason: 'reached_stop',
          modeStopping,
          dockActive,
          shouldBrakeNearEnd,
          distanceToEnd,
          speedMps,
          forwardSpeedMps: forwardSpeed,
          targetSpeedMps: desiredSpeedSigned,
          engineForce,
          brakeForce,
          steerRad: steering,
          stopIndex: clampedStopIndex,
        })
      }
      chassisBody.velocity.x = 0
      chassisBody.velocity.z = 0
      chassisBody.angularVelocity.x = 0
      chassisBody.angularVelocity.y = 0
      chassisBody.angularVelocity.z = 0
      return { reachedStop: true }
    }
  }

  return { reachedStop: false }
}

export function applyPurePursuitVehicleControlSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  points: THREE.Vector3[]
  loop: boolean
  deltaSeconds: number
  speedMps: number
  pursuitProps: PurePursuitComponentProps
  vehicleProps: VehicleComponentProps
  state: PurePursuitVehicleControlState
  modeStopping: boolean
  distanceToTarget: number
  stopIndex?: number
  debugNodeId?: string
}): { reachedStop: boolean } {
  try {
    return applyPurePursuitVehicleControl(params)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[PurePursuitRuntime] vehicle control failed', error)
    return { reachedStop: false }
  }
}

export function holdVehicleBrakeSafe(params: {
  vehicleInstance: PurePursuitVehicleInstanceLike
  brakeForce: number
}): void {
  const { vehicleInstance, brakeForce } = params
  try {
    const vehicle = vehicleInstance.vehicle
    for (let index = 0; index < vehicleInstance.wheelCount; index += 1) {
      vehicle.setBrake(brakeForce, index)
      vehicle.applyEngineForce(0, index)
      vehicle.setSteeringValue(0, index)
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[PurePursuitRuntime] vehicle hold brake failed', error)
  }
}
