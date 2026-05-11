import * as THREE from 'three'
import type { VehicleDriveVehicle, VehicleInstance } from './VehicleDriveController'
import type { VehicleSurfaceSample } from './vehicleSurfaceSampler'

export type HybridVehicleWheelInfo = {
  steering: number
  brake: number
  engineForce: number
  grounded: boolean
  compression: number
  contactPoint: THREE.Vector3 | null
  contactNormal: THREE.Vector3 | null
  surfaceKind: VehicleSurfaceSample['kind'] | null
}

export type HybridVehicleRuntime = VehicleDriveVehicle & {
  wheelInfos: HybridVehicleWheelInfo[]
}

type BodyLike = VehicleDriveVehicle['chassisBody'] & {
  mass?: number
  wakeUp?: () => void
  sleepState?: number
  applyForce?: (force: { x: number; y: number; z: number }, relativePoint: { x: number; y: number; z: number }) => void
  applyTorque?: (torque: { x: number; y: number; z: number }) => void
}

type StepHybridVehicleInstanceParams = {
  instance: VehicleInstance
  deltaSeconds: number
  resolveSurfaceSample: (x: number, z: number, preferredHeight?: number | null, edgeMargin?: number | null) => VehicleSurfaceSample | null
  active?: boolean
}

const worldQuaternionHelper = new THREE.Quaternion()
const worldPositionHelper = new THREE.Vector3()
const contactPointHelper = new THREE.Vector3()
const supportNormalHelper = new THREE.Vector3()
const wheelAxisWorldHelper = new THREE.Vector3()
const wheelForwardWorldHelper = new THREE.Vector3()
const wheelVelocityHelper = new THREE.Vector3()
const angularVelocityHelper = new THREE.Vector3()
const pointVelocityHelper = new THREE.Vector3()
const radiusVectorHelper = new THREE.Vector3()
const suspensionForceHelper = new THREE.Vector3()
const driveForceHelper = new THREE.Vector3()
const lateralForceHelper = new THREE.Vector3()
const totalForceHelper = new THREE.Vector3()
const chassisUpWorldHelper = new THREE.Vector3()
const chassisForwardWorldHelper = new THREE.Vector3()
const averageSupportNormalHelper = new THREE.Vector3()
const uprightTargetUpHelper = new THREE.Vector3()
const steeringQuaternionHelper = new THREE.Quaternion()

const DEFAULT_SUSPENSION_STIFFNESS = 2900
const DEFAULT_SUSPENSION_DAMPING = 260
const DEFAULT_MAX_SUSPENSION_FORCE = 24000
const DEFAULT_LATERAL_GRIP = 1700
const DEFAULT_BRAKE_GRIP = 3200
const DEFAULT_AIR_DRAG = 0.12
const DEFAULT_ROLLING_DRAG = 0.12
const DEFAULT_STEER_YAW_GAIN = 0.95
const DEFAULT_STEER_YAW_RESPONSE = 7.5
const DEFAULT_STEER_YAW_MAX_RATE = 2.8
const DEFAULT_UPRIGHT_TORQUE_GAIN = 2200
const DEFAULT_UPRIGHT_TORQUE_DAMPING = 260
const DEFAULT_UPRIGHT_TORQUE_MAX = 8500

export function createHybridVehicleRuntimeVehicle(chassisBody: VehicleDriveVehicle['chassisBody'], wheelCount: number): HybridVehicleRuntime {
  const wheelInfos: HybridVehicleWheelInfo[] = Array.from({ length: Math.max(0, wheelCount) }, () => ({
    steering: 0,
    brake: 0,
    engineForce: 0,
    grounded: false,
    compression: 0,
    contactPoint: null,
    contactNormal: null,
    surfaceKind: null,
  }))

  return {
    chassisBody,
    wheelInfos,
    applyEngineForce(force: number, wheelIndex: number) {
      const info = wheelInfos[wheelIndex]
      if (!info) {
        return
      }
      info.engineForce = Number.isFinite(force) ? force : 0
    },
    setSteeringValue(value: number, wheelIndex: number) {
      const info = wheelInfos[wheelIndex]
      if (!info) {
        return
      }
      info.steering = Number.isFinite(value) ? value : 0
    },
    setBrake(brake: number, wheelIndex: number) {
      const info = wheelInfos[wheelIndex]
      if (!info) {
        return
      }
      info.brake = Number.isFinite(brake) ? Math.max(0, brake) : 0
    },
  }
}

function setWheelInfoContact(info: HybridVehicleWheelInfo, sample: VehicleSurfaceSample | null, compression: number): void {
  info.grounded = Boolean(sample)
  info.compression = compression
  info.contactPoint = sample ? sample.point.clone() : null
  info.contactNormal = sample ? sample.normal.clone() : null
  info.surfaceKind = sample?.kind ?? null
}

export function stepHybridVehicleInstance(params: StepHybridVehicleInstanceParams): void {
  const { instance, deltaSeconds, resolveSurfaceSample: surfaceSampleResolver, active = false } = params
  const vehicle = instance.vehicle as HybridVehicleRuntime
  const chassisBody = vehicle?.chassisBody as BodyLike | null
  const wheelSupportPoints = instance.wheelSupportPoints ?? []
  if (!chassisBody || !wheelSupportPoints.length || deltaSeconds <= 0 || !Number.isFinite(deltaSeconds)) {
    return
  }

  worldPositionHelper.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
  worldQuaternionHelper.set(
    chassisBody.quaternion.x,
    chassisBody.quaternion.y,
    chassisBody.quaternion.z,
    chassisBody.quaternion.w,
  ).normalize()
  chassisUpWorldHelper.set(0, 1, 0).applyQuaternion(worldQuaternionHelper).normalize()
  chassisForwardWorldHelper.copy(instance.axisForward).applyQuaternion(worldQuaternionHelper)
  if (chassisForwardWorldHelper.lengthSq() <= 1e-8) {
    chassisForwardWorldHelper.set(0, 0, 1)
  }
  chassisForwardWorldHelper.normalize()
  wheelVelocityHelper.set(chassisBody.velocity.x, chassisBody.velocity.y, chassisBody.velocity.z)
  angularVelocityHelper.set(chassisBody.angularVelocity.x, chassisBody.angularVelocity.y, chassisBody.angularVelocity.z)

  const bodyMass = Number.isFinite(chassisBody.mass) && (chassisBody.mass as number) > 0 ? (chassisBody.mass as number) : 900
  let groundedWheelCount = 0
  averageSupportNormalHelper.set(0, 0, 0)

  wheelSupportPoints.forEach((wheel, index) => {
    const info = vehicle.wheelInfos[index]
    if (!info) {
      return
    }

    contactPointHelper.copy(wheel.point).applyQuaternion(worldQuaternionHelper).add(worldPositionHelper)
    const preferredHeight = contactPointHelper.y - wheel.radius
    const surface = surfaceSampleResolver(contactPointHelper.x, contactPointHelper.z, preferredHeight, wheel.radius)
    if (!surface) {
      setWheelInfoContact(info, null, 0)
      return
    }

    supportNormalHelper.copy(surface.normal)
    if (supportNormalHelper.lengthSq() <= 1e-8) {
      supportNormalHelper.set(0, 1, 0)
    } else {
      supportNormalHelper.normalize()
    }

    const distanceToSurface = contactPointHelper.y - surface.point.y
    const suspensionLength = Math.max(0, distanceToSurface - wheel.radius)
    const compression = Math.max(0, wheel.suspensionRestLength - suspensionLength)
    if (compression <= 0) {
      setWheelInfoContact(info, null, 0)
      return
    }

    groundedWheelCount += 1
    averageSupportNormalHelper.add(supportNormalHelper)
    setWheelInfoContact(info, surface, compression)

    wheelAxisWorldHelper.copy(wheel.axle).applyQuaternion(worldQuaternionHelper)
    wheelAxisWorldHelper.addScaledVector(supportNormalHelper, -wheelAxisWorldHelper.dot(supportNormalHelper))
    if (wheelAxisWorldHelper.lengthSq() <= 1e-8) {
      wheelAxisWorldHelper.set(1, 0, 0)
      wheelAxisWorldHelper.addScaledVector(supportNormalHelper, -wheelAxisWorldHelper.dot(supportNormalHelper))
    }
    wheelAxisWorldHelper.normalize()

    wheelForwardWorldHelper.crossVectors(supportNormalHelper, wheelAxisWorldHelper)
    if (wheelForwardWorldHelper.lengthSq() <= 1e-8) {
      wheelForwardWorldHelper.copy(instance.axisForward).applyQuaternion(worldQuaternionHelper)
      wheelForwardWorldHelper.addScaledVector(supportNormalHelper, -wheelForwardWorldHelper.dot(supportNormalHelper))
    }
    if (wheelForwardWorldHelper.lengthSq() <= 1e-8) {
      wheelForwardWorldHelper.set(0, 0, 1)
    }
    wheelForwardWorldHelper.normalize()

    if (info.steering !== 0 && wheel.isFrontWheel) {
      steeringQuaternionHelper.setFromAxisAngle(supportNormalHelper, info.steering)
      wheelForwardWorldHelper.applyQuaternion(steeringQuaternionHelper).normalize()
      wheelAxisWorldHelper.crossVectors(wheelForwardWorldHelper, supportNormalHelper).normalize()
    }

    radiusVectorHelper.copy(surface.point).sub(worldPositionHelper)
    pointVelocityHelper.copy(angularVelocityHelper).cross(radiusVectorHelper).add(wheelVelocityHelper)
    const longitudinalVelocity = pointVelocityHelper.dot(wheelForwardWorldHelper)
    const lateralVelocity = pointVelocityHelper.dot(wheelAxisWorldHelper)

    const suspensionForce = Math.min(
      DEFAULT_MAX_SUSPENSION_FORCE,
      Math.max(0, compression * DEFAULT_SUSPENSION_STIFFNESS - pointVelocityHelper.dot(supportNormalHelper) * DEFAULT_SUSPENSION_DAMPING),
    )
    suspensionForceHelper.copy(supportNormalHelper).multiplyScalar(suspensionForce)

    const engineForce = Number.isFinite(info.engineForce) ? info.engineForce : 0
    const brakeForce = Number.isFinite(info.brake) ? info.brake : 0
    let driveForce = engineForce
    if (brakeForce > 0 && Math.abs(longitudinalVelocity) > 1e-4) {
      driveForce += -Math.sign(longitudinalVelocity) * Math.min(brakeForce, DEFAULT_BRAKE_GRIP)
    }
    driveForceHelper.copy(wheelForwardWorldHelper).multiplyScalar(driveForce)

    const lateralForce = THREE.MathUtils.clamp(-lateralVelocity * bodyMass * 6, -DEFAULT_LATERAL_GRIP, DEFAULT_LATERAL_GRIP)
    lateralForceHelper.copy(wheelAxisWorldHelper).multiplyScalar(lateralForce)

    totalForceHelper.copy(suspensionForceHelper).add(driveForceHelper).add(lateralForceHelper)
    chassisBody.applyForce?.(totalForceHelper as any, surface.point as any)
  })

  let steeringSum = 0
  let steeringWheelCount = 0
  let minForwardProjection = Number.POSITIVE_INFINITY
  let maxForwardProjection = Number.NEGATIVE_INFINITY
  wheelSupportPoints.forEach((wheel, index) => {
    const info = vehicle.wheelInfos[index]
    if (!info) {
      return
    }
    const forwardProjection = wheel.point.dot(instance.axisForward)
    if (forwardProjection < minForwardProjection) {
      minForwardProjection = forwardProjection
    }
    if (forwardProjection > maxForwardProjection) {
      maxForwardProjection = forwardProjection
    }
    if (wheel.isFrontWheel) {
      steeringSum += Number.isFinite(info.steering) ? info.steering : 0
      steeringWheelCount += 1
    }
  })

  const wheelBase = Number.isFinite(minForwardProjection) && Number.isFinite(maxForwardProjection)
    ? Math.max(0.35, maxForwardProjection - minForwardProjection)
    : 0.35
  const averageSteering = steeringWheelCount > 0 ? steeringSum / steeringWheelCount : 0
  const forwardSpeed = wheelVelocityHelper.dot(chassisForwardWorldHelper)
  const desiredYawRate = THREE.MathUtils.clamp(
    Math.tan(averageSteering) * forwardSpeed * DEFAULT_STEER_YAW_GAIN / wheelBase,
    -DEFAULT_STEER_YAW_MAX_RATE,
    DEFAULT_STEER_YAW_MAX_RATE,
  )
  const currentYawRate = angularVelocityHelper.dot(chassisUpWorldHelper)
  const yawRateError = desiredYawRate - currentYawRate
  const yawRateDelta = THREE.MathUtils.clamp(
    yawRateError * DEFAULT_STEER_YAW_RESPONSE * deltaSeconds,
    -DEFAULT_STEER_YAW_MAX_RATE * deltaSeconds,
    DEFAULT_STEER_YAW_MAX_RATE * deltaSeconds,
  )
  chassisBody.angularVelocity.x += chassisUpWorldHelper.x * yawRateDelta
  chassisBody.angularVelocity.y += chassisUpWorldHelper.y * yawRateDelta
  chassisBody.angularVelocity.z += chassisUpWorldHelper.z * yawRateDelta

  if (groundedWheelCount > 0 || active) {
    chassisBody.wakeUp?.()
  }

  const speedSq = wheelVelocityHelper.lengthSq()
  if (speedSq > 1e-8) {
    const dragScale = groundedWheelCount > 0 ? DEFAULT_ROLLING_DRAG : DEFAULT_AIR_DRAG
    const damping = Math.exp(-dragScale * deltaSeconds)
    chassisBody.velocity.set(
      wheelVelocityHelper.x * damping,
      wheelVelocityHelper.y * (groundedWheelCount > 0 ? Math.max(0.98, damping) : damping),
      wheelVelocityHelper.z * damping,
    )
  }

  if (active || groundedWheelCount > 0) {
    if (groundedWheelCount > 0 && averageSupportNormalHelper.lengthSq() > 1e-8) {
      uprightTargetUpHelper.copy(averageSupportNormalHelper).normalize()
    } else {
      uprightTargetUpHelper.set(0, 1, 0)
    }
    const tiltAxisX = chassisUpWorldHelper.y * uprightTargetUpHelper.z - chassisUpWorldHelper.z * uprightTargetUpHelper.y
    const tiltAxisY = chassisUpWorldHelper.z * uprightTargetUpHelper.x - chassisUpWorldHelper.x * uprightTargetUpHelper.z
    const tiltAxisZ = chassisUpWorldHelper.x * uprightTargetUpHelper.y - chassisUpWorldHelper.y * uprightTargetUpHelper.x
    const tiltMagnitude = Math.sqrt(tiltAxisX * tiltAxisX + tiltAxisY * tiltAxisY + tiltAxisZ * tiltAxisZ)
    if (tiltMagnitude > 1e-4) {
      const invTiltMagnitude = 1 / tiltMagnitude
      const axisX = tiltAxisX * invTiltMagnitude
      const axisY = tiltAxisY * invTiltMagnitude
      const axisZ = tiltAxisZ * invTiltMagnitude
      const angularAlongAxis = angularVelocityHelper.x * axisX + angularVelocityHelper.y * axisY + angularVelocityHelper.z * axisZ
      const torqueMagnitude = THREE.MathUtils.clamp(
        (tiltMagnitude * DEFAULT_UPRIGHT_TORQUE_GAIN) - (angularAlongAxis * DEFAULT_UPRIGHT_TORQUE_DAMPING),
        -DEFAULT_UPRIGHT_TORQUE_MAX,
        DEFAULT_UPRIGHT_TORQUE_MAX,
      )
      chassisBody.applyTorque?.({
        x: axisX * torqueMagnitude,
        y: axisY * torqueMagnitude,
        z: axisZ * torqueMagnitude,
      })
    }
  }

  if (!active && groundedWheelCount === 0) {
    return
  }

  if (groundedWheelCount > 0 && active) {
    chassisBody.angularVelocity.set(
      chassisBody.angularVelocity.x * 0.995,
      chassisBody.angularVelocity.y,
      chassisBody.angularVelocity.z * 0.995,
    )
  }
}

export function clearHybridVehicleCommands(vehicle: VehicleDriveVehicle | null | undefined, wheelCount: number): void {
  if (!vehicle) {
    return
  }
  const count = Math.max(0, wheelCount)
  for (let index = 0; index < count; index += 1) {
    vehicle.applyEngineForce(0, index)
    vehicle.setSteeringValue(0, index)
    vehicle.setBrake(0, index)
  }
}

export function cloneHybridWheelContact(sample: VehicleSurfaceSample | null): VehicleSurfaceSample | null {
  if (!sample) {
    return null
  }
  return {
    ...sample,
    point: sample.point.clone(),
    normal: sample.normal.clone(),
  }
}
