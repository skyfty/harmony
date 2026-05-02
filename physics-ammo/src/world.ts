import {
  PHYSICS_BODY_TRANSFORM_STRIDE,
  createEmptyStepFrame,
  type PhysicsBodyTransformCommand,
  type PhysicsSceneAsset,
  type PhysicsStepFrame,
  type PhysicsTransform,
  type PhysicsVector3,
  type PhysicsVehicleInputCommand,
} from '@harmony/physics-core'

type BodyState = {
  transform: PhysicsTransform
  linearVelocity: PhysicsVector3
}

type VehicleState = {
  bodyId: number
  indexUpAxis: 0 | 1 | 2
  indexForwardAxis: 0 | 1 | 2
}

export class AmmoPhysicsWorld {
  private scene: PhysicsSceneAsset | null = null
  private frame = 0
  private readonly bodies = new Map<number, BodyState>()
  private readonly vehicles = new Map<number, VehicleState>()
  private readonly vehicleInputs = new Map<number, PhysicsVehicleInputCommand>()

  loadScene(scene: PhysicsSceneAsset): { bodyCount: number; vehicleCount: number } {
    this.scene = scene
    this.frame = 0
    this.bodies.clear()
    this.vehicles.clear()
    this.vehicleInputs.clear()
    scene.bodies.forEach((body) => {
      this.bodies.set(body.id, {
        transform: {
          position: [...body.transform.position],
          rotation: [...body.transform.rotation],
        },
        linearVelocity: [0, 0, 0],
      })
    })
    scene.vehicles.forEach((vehicle) => {
      this.vehicles.set(vehicle.id, {
        bodyId: vehicle.bodyId,
        indexUpAxis: vehicle.indexUpAxis,
        indexForwardAxis: vehicle.indexForwardAxis,
      })
    })
    return {
      bodyCount: scene.bodies.length,
      vehicleCount: scene.vehicles.length,
    }
  }

  async step(deltaMs: number): Promise<PhysicsStepFrame> {
    if (!this.scene) {
      return createEmptyStepFrame(this.frame)
    }
    this.frame += 1
    this.integrateVehicles(deltaMs)
    const bodyCount = this.scene.bodies.length
    const bodyTransforms = new Float32Array(bodyCount * PHYSICS_BODY_TRANSFORM_STRIDE)
    const bodyMeta = new Uint32Array(bodyCount)
    this.scene.bodies.forEach((body, index) => {
      const state = this.bodies.get(body.id)
      const transform = state?.transform ?? body.transform
      const base = index * PHYSICS_BODY_TRANSFORM_STRIDE
      bodyTransforms[base] = transform.position[0]
      bodyTransforms[base + 1] = transform.position[1]
      bodyTransforms[base + 2] = transform.position[2]
      bodyTransforms[base + 3] = transform.rotation[0]
      bodyTransforms[base + 4] = transform.rotation[1]
      bodyTransforms[base + 5] = transform.rotation[2]
      bodyTransforms[base + 6] = transform.rotation[3]
      bodyTransforms[base + 7] = body.type === 'dynamic' ? 1 : 0
      bodyMeta[index] = body.id
    })
    return {
      frame: this.frame,
      bodyCount,
      wheelCount: 0,
      bodyTransforms,
      wheelTransforms: new Float32Array(0),
      bodyMeta,
    }
  }

  setBodyTransform(command: PhysicsBodyTransformCommand): void {
    const state = this.bodies.get(command.bodyId)
    if (!state) {
      return
    }
    state.transform = {
      position: [...command.transform.position],
      rotation: [...command.transform.rotation],
    }
    if (command.resetVelocity) {
      state.linearVelocity = [0, 0, 0]
    }
  }

  setVehicleInput(command: PhysicsVehicleInputCommand): void {
    this.vehicleInputs.set(command.vehicleId, command)
  }

  disposeScene(): void {
    this.scene = null
    this.bodies.clear()
    this.vehicles.clear()
    this.vehicleInputs.clear()
    this.frame = 0
  }

  private integrateVehicles(deltaMs: number): void {
    const deltaSeconds = Math.max(0, deltaMs) / 1000
    if (!(deltaSeconds > 0)) {
      return
    }
    this.vehicleInputs.forEach((input, vehicleId) => {
      const vehicle = this.vehicles.get(vehicleId)
      if (!vehicle) {
        return
      }
      const body = this.bodies.get(vehicle.bodyId)
      if (!body) {
        return
      }

      const throttle = clampScalar(input.throttle)
      const brake = Math.max(0, input.brake)
      const steering = clampScalar(input.steering)
      const upAxis = getAxisVector(vehicle.indexUpAxis)
      const forwardAxis = getAxisVector(vehicle.indexForwardAxis)
      const worldUp = rotateVectorByQuaternion(upAxis, body.transform.rotation)
      const turnAngle = steering * Math.min(0.12, deltaSeconds * 1.8)
      if (Math.abs(turnAngle) > 1e-6) {
        body.transform.rotation = normalizeQuaternion(
          multiplyQuaternions(
            axisAngleToQuaternion(worldUp, turnAngle),
            body.transform.rotation,
          ),
        )
      }

      const worldForward = rotateVectorByQuaternion(forwardAxis, body.transform.rotation)
      const targetSpeed = throttle * 8
      const currentForwardSpeed = dot(body.linearVelocity, worldForward)
      const speedDelta = targetSpeed - currentForwardSpeed
      const acceleration = speedDelta * Math.min(1, deltaSeconds * 6)
      const nextForwardSpeed = currentForwardSpeed + acceleration - brake * deltaSeconds * 10
      const clampedSpeed = Math.max(0, nextForwardSpeed)
      body.linearVelocity = scaleVector(worldForward, clampedSpeed)
      body.transform.position = addVectors(
        body.transform.position,
        scaleVector(body.linearVelocity, deltaSeconds),
      )
    })
  }
}

function clampScalar(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(-1, Math.min(1, value))
}

function getAxisVector(index: 0 | 1 | 2): PhysicsVector3 {
  if (index === 1) {
    return [0, 1, 0]
  }
  if (index === 2) {
    return [0, 0, 1]
  }
  return [1, 0, 0]
}

function dot(a: PhysicsVector3, b: PhysicsVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function scaleVector(vector: PhysicsVector3, scalar: number): PhysicsVector3 {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar]
}

function addVectors(a: PhysicsVector3, b: PhysicsVector3): PhysicsVector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function normalizeVector(vector: PhysicsVector3): PhysicsVector3 {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (!(length > 1e-6)) {
    return [0, 1, 0]
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function normalizeQuaternion(quaternion: PhysicsTransform['rotation']): PhysicsTransform['rotation'] {
  const length = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
  if (!(length > 1e-6)) {
    return [0, 0, 0, 1]
  }
  return [
    quaternion[0] / length,
    quaternion[1] / length,
    quaternion[2] / length,
    quaternion[3] / length,
  ]
}

function axisAngleToQuaternion(axis: PhysicsVector3, angle: number): PhysicsTransform['rotation'] {
  const normalizedAxis = normalizeVector(axis)
  const halfAngle = angle * 0.5
  const sinHalf = Math.sin(halfAngle)
  return normalizeQuaternion([
    normalizedAxis[0] * sinHalf,
    normalizedAxis[1] * sinHalf,
    normalizedAxis[2] * sinHalf,
    Math.cos(halfAngle),
  ])
}

function multiplyQuaternions(
  left: PhysicsTransform['rotation'],
  right: PhysicsTransform['rotation'],
): PhysicsTransform['rotation'] {
  const [lx, ly, lz, lw] = left
  const [rx, ry, rz, rw] = right
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ]
}

function rotateVectorByQuaternion(
  vector: PhysicsVector3,
  quaternion: PhysicsTransform['rotation'],
): PhysicsVector3 {
  const q = normalizeQuaternion(quaternion)
  const x = vector[0]
  const y = vector[1]
  const z = vector[2]
  const qx = q[0]
  const qy = q[1]
  const qz = q[2]
  const qw = q[3]

  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}
