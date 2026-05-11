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
const steeringQuaternionHelper = new THREE.Quaternion()

const DEFAULT_SUSPENSION_STIFFNESS = 3200
const DEFAULT_SUSPENSION_DAMPING = 420
const DEFAULT_MAX_SUSPENSION_FORCE = 24000
const DEFAULT_LATERAL_GRIP = 2800
const DEFAULT_BRAKE_GRIP = 4200
const DEFAULT_AIR_DRAG = 0.12
const DEFAULT_ROLLING_DRAG = 0.9

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

export function stepHybridVehicleInstance(params: {
  instance: VehicleInstance
  deltaSeconds: number
  resolveSurfaceSample: (x: number, z: number, preferredHeight?: number | null) => VehicleSurfaceSample | null
  active?: boolean
}): void {
  const { instance, deltaSeconds, resolveSurfaceSample, active = false } = params
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
  wheelVelocityHelper.set(chassisBody.velocity.x, chassisBody.velocity.y, chassisBody.velocity.z)
  angularVelocityHelper.set(chassisBody.angularVelocity.x, chassisBody.angularVelocity.y, chassisBody.angularVelocity.z)

  const bodyMass = Number.isFinite(chassisBody.mass) && (chassisBody.mass as number) > 0 ? (chassisBody.mass as number) : 900
  let groundedWheelCount = 0

  wheelSupportPoints.forEach((wheel, index) => {
    const info = vehicle.wheelInfos[index]
    if (!info) {
      return
    }

    contactPointHelper.copy(wheel.point).applyQuaternion(worldQuaternionHelper).add(worldPositionHelper)
    const preferredHeight = contactPointHelper.y - wheel.radius
    const surface = resolveSurfaceSample(contactPointHelper.x, contactPointHelper.z, preferredHeight)
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