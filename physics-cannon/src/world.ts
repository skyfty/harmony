import * as CANNON from 'cannon-es'
import {
  type PhysicsAddRuntimeBodiesCommand,
  type PhysicsBodyDesc,
  type PhysicsBodyTransformCommand,
  type PhysicsBodyVelocityCommand,
  type PhysicsContactEvent,
  type PhysicsMaterialDesc,
  type PhysicsRemoveRuntimeBodiesCommand,
  type PhysicsRaycastCommand,
  type PhysicsRaycastHit,
  type PhysicsSceneAsset,
  type PhysicsShapeDesc,
  type PhysicsStepFrame,
  type PhysicsTransform,
  type PhysicsVector3,
  type PhysicsVehicleDesc,
  type PhysicsVehicleInputCommand,
  type PhysicsWorldSettings,
} from '@harmony/physics-core'
import type { PhysicsContactSettings } from '@harmony/physics-bridge'
import { createCannonSceneRigidBody } from './sceneRigidBodyFactory'

type BodyState = {
  desc: PhysicsBodyDesc
  body: CANNON.Body
}

type VehicleState = {
  desc: PhysicsVehicleDesc
  bodyId: number
  body: CANNON.Body
  vehicle: CANNON.RaycastVehicle
  steerableWheelIndices: number[]
  speedGovernorScale: number
  speedGovernorBrakeAssist: number
  speedGovernorOverHardCap: boolean
  speedGovernorSmoothedForwardSpeedAbs: number
}

const DEFAULT_WORLD_SETTINGS: PhysicsWorldSettings = {
  gravity: [0, -9.8, 0],
  fixedTimeStepMs: 1000 / 60,
  maxSubSteps: 4,
}

const VEHICLE_ENGINE_FORCE = 320
const VEHICLE_BRAKE_FORCE = 36
const VEHICLE_STEER_ANGLE = (26 * Math.PI) / 180
const VEHICLE_SPEED_GOVERNOR_SOFT_RATIO = 0.92
const VEHICLE_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET = 0.45
const VEHICLE_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET = 0.2
const VEHICLE_SPEED_GOVERNOR_BRAKE_DEADBAND = 0.35
const VEHICLE_SPEED_GOVERNOR_BRAKE_BAND = 1.8
const VEHICLE_SPEED_GOVERNOR_BRAKE_MAX_RATIO = 0.14
const VEHICLE_BRAKE_RELEASE_SPEED = 0.45
const VEHICLE_WAKE_SPEED_THRESHOLD = 0.2

export class CannonPhysicsWorld {
  private scene: PhysicsSceneAsset | null = null
  private worldSettings: PhysicsWorldSettings = DEFAULT_WORLD_SETTINGS
  private frame = 0
  private world: CANNON.World | null = null
  private readonly bodies = new Map<number, BodyState>()
  private readonly shapes = new Map<number, PhysicsShapeDesc>()
  private readonly runtimeBodies = new Map<number, BodyState>()
  private readonly runtimeShapes = new Map<number, PhysicsShapeDesc>()
  private readonly runtimeMaterials = new Map<number, PhysicsMaterialDesc>()
  private readonly vehicles = new Map<number, VehicleState>()
  private readonly vehicleInputs = new Map<number, PhysicsVehicleInputCommand>()
  private readonly bodyContactListeners = new Map<number, (event: unknown) => void>()
  private stepContacts: PhysicsContactEvent[] = []

  setWorldSettings(settings: PhysicsWorldSettings): void {
    this.worldSettings = {
      gravity: [...settings.gravity],
      fixedTimeStepMs: settings.fixedTimeStepMs,
      maxSubSteps: settings.maxSubSteps,
    }
    if (this.world) {
      this.world.gravity.set(...this.worldSettings.gravity)
    }
  }

  loadScene(scene: PhysicsSceneAsset): { bodyCount: number; vehicleCount: number } {
    this.ensureWorld()
    this.disposeScene()
    this.scene = scene
    this.frame = 0
    scene.shapes.forEach((shape) => {
      this.shapes.set(shape.id, shape)
    })
    scene.bodies.forEach((body) => {
      this.bodies.set(body.id, this.createBodyState(body))
    })
    scene.vehicles.forEach((vehicle) => {
      this.vehicles.set(vehicle.id, this.createVehicleState(vehicle))
    })
    return {
      bodyCount: scene.bodies.length,
      vehicleCount: scene.vehicles.length,
    }
  }

  step(deltaMs: number): PhysicsStepFrame {
    if (!this.scene || !this.world) {
      return {
        frame: this.frame,
        bodyCount: 0,
        wheelCount: 0,
        bodyTransforms: new Float32Array(0),
        wheelTransforms: new Float32Array(0),
      };
    }
    this.frame += 1
    this.stepContacts = []
    this.applyVehicleInputs()

    const deltaSeconds = Math.max(0, deltaMs) / 1000
    if (deltaSeconds > 0) {
      this.world.step(
        Math.max(1 / 240, this.worldSettings.fixedTimeStepMs / 1000),
        deltaSeconds,
        Math.max(1, this.worldSettings.maxSubSteps | 0),
      )
    }

    const bodyCount = this.scene.bodies.length
    const bodyTransforms = new Float32Array(bodyCount * 8)
    const bodyMeta = new Uint32Array(bodyCount)
    const bodyLinearVelocities = new Float32Array(bodyCount * 3)
    const bodyAngularVelocities = new Float32Array(bodyCount * 3)
    const bodySleeping = new Uint8Array(bodyCount)
    this.scene.bodies.forEach((body, index) => {
      const state = this.bodies.get(body.id)
      const physicsBody = state?.body ?? null
      const transform = physicsBody ? readBodyTransform(physicsBody) : body.transform
      const base = index * 8
      bodyTransforms[base] = transform.position[0]
      bodyTransforms[base + 1] = transform.position[1]
      bodyTransforms[base + 2] = transform.position[2]
      bodyTransforms[base + 3] = transform.rotation[0]
      bodyTransforms[base + 4] = transform.rotation[1]
      bodyTransforms[base + 5] = transform.rotation[2]
      bodyTransforms[base + 6] = transform.rotation[3]
      bodyTransforms[base + 7] = body.type === 'dynamic' ? 1 : body.type === 'kinematic' ? 2 : 0
      bodyMeta[index] = body.id
      const linearBase = index * 3
      bodyLinearVelocities[linearBase] = physicsBody?.velocity.x ?? 0
      bodyLinearVelocities[linearBase + 1] = physicsBody?.velocity.y ?? 0
      bodyLinearVelocities[linearBase + 2] = physicsBody?.velocity.z ?? 0
      bodyAngularVelocities[linearBase] = physicsBody?.angularVelocity.x ?? 0
      bodyAngularVelocities[linearBase + 1] = physicsBody?.angularVelocity.y ?? 0
      bodyAngularVelocities[linearBase + 2] = physicsBody?.angularVelocity.z ?? 0
      bodySleeping[index] = physicsBody?.sleepState === CANNON.Body.SLEEPING ? 1 : 0
    })

    const totalWheelCount = this.scene.vehicles.reduce((count, vehicle) => count + vehicle.wheels.length, 0)
    const wheelTransforms = new Float32Array(totalWheelCount * 9)
    let wheelOffset = 0
    this.scene.vehicles.forEach((vehicleDesc) => {
      const vehicleState = this.vehicles.get(vehicleDesc.id)
      if (!vehicleState) {
        wheelOffset += vehicleDesc.wheels.length
        return
      }
      for (let wheelIndex = 0; wheelIndex < vehicleDesc.wheels.length; wheelIndex += 1) {
        vehicleState.vehicle.updateWheelTransform(wheelIndex)
        const worldTransform = vehicleState.vehicle.wheelInfos[wheelIndex]?.worldTransform
        const base = wheelOffset * 9
        wheelTransforms[base] = vehicleDesc.id
        wheelTransforms[base + 1] = wheelIndex
        wheelTransforms[base + 2] = worldTransform?.position.x ?? 0
        wheelTransforms[base + 3] = worldTransform?.position.y ?? 0
        wheelTransforms[base + 4] = worldTransform?.position.z ?? 0
        wheelTransforms[base + 5] = worldTransform?.quaternion.x ?? 0
        wheelTransforms[base + 6] = worldTransform?.quaternion.y ?? 0
        wheelTransforms[base + 7] = worldTransform?.quaternion.z ?? 0
        wheelTransforms[base + 8] = worldTransform?.quaternion.w ?? 1
        wheelOffset += 1
      }
    })

    return {
      frame: this.frame,
      bodyCount,
      wheelCount: totalWheelCount,
      bodyTransforms,
      wheelTransforms,
      bodyMeta,
      bodyLinearVelocities,
      bodyAngularVelocities,
      bodySleeping,
      contacts: this.stepContacts.length ? [...this.stepContacts] : undefined,
    }
  }

  setBodyTransform(command: PhysicsBodyTransformCommand): void {
    const state = this.bodies.get(command.bodyId)
    if (!state) {
      return
    }
    state.body.position.set(...command.transform.position)
    state.body.quaternion.set(...command.transform.rotation)
    state.body.aabbNeedsUpdate = true
    state.body.wakeUp()
    if (command.resetVelocity) {
      state.body.velocity.set(0, 0, 0)
      state.body.angularVelocity.set(0, 0, 0)
      state.body.force.set(0, 0, 0)
      state.body.torque.set(0, 0, 0)
    }
  }

  setBodyVelocity(command: PhysicsBodyVelocityCommand): void {
    const state = this.bodies.get(command.bodyId)
    if (!state) {
      return
    }
    if (command.linearVelocity) {
      state.body.velocity.set(command.linearVelocity[0], command.linearVelocity[1], command.linearVelocity[2])
    }
    if (command.angularVelocity) {
      state.body.angularVelocity.set(command.angularVelocity[0], command.angularVelocity[1], command.angularVelocity[2])
    }
    if (command.wakeUp !== false) {
      state.body.wakeUp()
    }
  }

  setVehicleInput(command: PhysicsVehicleInputCommand): void {
    this.vehicleInputs.set(command.vehicleId, command)
  }

  addRuntimeBodies(command: PhysicsAddRuntimeBodiesCommand): void {
    this.ensureWorld()
    for (const entry of command.bodies) {
      for (const material of entry.materials ?? []) {
        this.runtimeMaterials.set(material.id, material)
      }
      for (const shape of entry.shapes) {
        this.runtimeShapes.set(shape.id, shape)
      }
      this.removeRuntimeBodyById(entry.body.id)
      this.runtimeBodies.set(entry.body.id, this.createBodyState(entry.body, this.runtimeShapes))
    }
  }

  removeRuntimeBodies(command: PhysicsRemoveRuntimeBodiesCommand): void {
    for (const bodyId of command.bodyIds) {
      this.removeRuntimeBodyById(bodyId)
    }
  }

  raycast(command: PhysicsRaycastCommand): PhysicsRaycastHit | null {
    if (!this.world) {
      return null
    }
    const origin = vec3FromTuple(command.origin)
    const target = vec3FromTuple(command.target)
    if (distanceSquared(origin, target) <= 1e-12) {
      return null
    }
    const result = new CANNON.RaycastResult()
    const hit = this.world.raycastClosest(
      origin,
      target,
      {
        collisionFilterMask: command.collisionMask ?? -1,
        skipBackfaces: true,
      },
      result,
    )
    if (!hit || !result.hasHit || !result.body) {
      return null
    }
    const bodyId = resolveBodyId(result.body)
    if (bodyId === null) {
      return null
    }
    return {
      bodyId,
      point: [result.hitPointWorld.x, result.hitPointWorld.y, result.hitPointWorld.z],
      normal: [result.hitNormalWorld.x, result.hitNormalWorld.y, result.hitNormalWorld.z],
      distance: result.hitPointWorld.distanceTo(origin),
    }
  }

  disposeScene(): void {
    if (this.world) {
      this.vehicles.forEach((state) => {
        try {
          state.vehicle.removeFromWorld(this.world!)
        } catch {}
      })
      this.bodies.forEach((state) => {
        try {
          this.world!.removeBody(state.body)
        } catch {}
      })
      this.runtimeBodies.forEach((state) => {
        try {
          this.world!.removeBody(state.body)
        } catch {}
      })
    }
    this.vehicles.clear()
    this.vehicleInputs.clear()
    this.bodyContactListeners.forEach((listener, bodyId) => {
      const state = this.bodies.get(bodyId) ?? this.runtimeBodies.get(bodyId) ?? null
      try {
        (state?.body as CANNON.Body | null)?.removeEventListener?.('collide', listener as never)
      } catch {}
    })
    this.bodyContactListeners.clear()
    this.bodies.clear()
    this.shapes.clear()
    this.runtimeBodies.clear()
    this.runtimeShapes.clear()
    this.runtimeMaterials.clear()
    this.scene = null
    this.frame = 0
  }

  disposeWorld(): void {
    this.disposeScene()
    this.world = null
  }

  getWorld(): CANNON.World | null {
    return this.world
  }

  private ensureWorld(): CANNON.World {
    if (this.world) {
      return this.world
    }
    const world = new CANNON.World()
    world.gravity.set(...this.worldSettings.gravity)
    world.broadphase = new CANNON.SAPBroadphase(world)
    world.allowSleep = true
    this.world = world
    return world
  }

  private createBodyState(
    desc: PhysicsBodyDesc,
    shapeMap: Map<number, PhysicsShapeDesc> = this.shapes,
  ): BodyState {
    const world = this.ensureWorld()
    const body = createCannonSceneRigidBody({
      world,
      shapeMap,
      desc,
    })
    this.attachBodyContactListener(body, desc.id)
    return { desc, body }
  }

  private attachBodyContactListener(body: CANNON.Body, bodyId: number): void {
    if (this.bodyContactListeners.has(bodyId)) {
      return
    }
    const listener = (event: unknown) => {
      const contact = event as {
        body?: CANNON.Body | null
        contact?: {
          ri?: CANNON.Vec3 | null
          rj?: CANNON.Vec3 | null
          ni?: CANNON.Vec3 | null
        } | null
      }
      const otherBody = contact.body ?? null
      if (!otherBody) {
        return
      }
      const otherBodyId = resolveBodyId(otherBody)
      if (otherBodyId === null || otherBodyId === bodyId) {
        return
      }
      const bodyPosition = body.position
      const otherPosition = otherBody.position
      const normal = contact.contact?.ni ?? null
      const contactPoint = contact.contact?.ri ?? null
      const fallbackContactPoint = contact.contact?.rj ?? null
      const relativeVelocity = new CANNON.Vec3(
        body.velocity.x - otherBody.velocity.x,
        body.velocity.y - otherBody.velocity.y,
        body.velocity.z - otherBody.velocity.z,
      )
      const normalizedNormal = normal
        ? normalizePhysicsVector([normal.x, normal.y, normal.z])
        : normalizePhysicsVector([
            otherPosition.x - bodyPosition.x,
            otherPosition.y - bodyPosition.y,
            otherPosition.z - bodyPosition.z,
          ])
      const impactSpeed = Math.max(
        0,
        -(relativeVelocity.x * normalizedNormal[0] + relativeVelocity.y * normalizedNormal[1] + relativeVelocity.z * normalizedNormal[2]),
      )
      const worldContactPoint = contactPoint
        ? [
            bodyPosition.x + contactPoint.x,
            bodyPosition.y + contactPoint.y,
            bodyPosition.z + contactPoint.z,
          ] as [number, number, number]
        : fallbackContactPoint
          ? [
              otherPosition.x + fallbackContactPoint.x,
              otherPosition.y + fallbackContactPoint.y,
              otherPosition.z + fallbackContactPoint.z,
            ] as [number, number, number]
          : [bodyPosition.x, bodyPosition.y, bodyPosition.z] as [number, number, number]
      const key = bodyId < otherBodyId
        ? `${bodyId}:${otherBodyId}`
        : `${otherBodyId}:${bodyId}`
      const existing = this.stepContacts.find((entry) => {
        const pairKey = entry.bodyIdA < entry.bodyIdB
          ? `${entry.bodyIdA}:${entry.bodyIdB}`
          : `${entry.bodyIdB}:${entry.bodyIdA}`
        return pairKey === key
      })
      if (existing) {
        return
      }
      this.stepContacts.push({
        bodyIdA: bodyId,
        bodyIdB: otherBodyId,
        point: worldContactPoint,
        normal: normalizedNormal,
        impulse: null,
        impactSpeed,
      } as PhysicsContactEvent)
    }
    this.bodyContactListeners.set(bodyId, listener)
    body.addEventListener?.('collide', listener as never)
  }

  private removeRuntimeBodyById(bodyId: number): void {
    const state = this.runtimeBodies.get(bodyId)
    if (!state) {
      return
    }
    const listener = this.bodyContactListeners.get(bodyId) ?? null
    if (listener) {
      try {
        (state.body as CANNON.Body | null)?.removeEventListener?.('collide', listener as never)
      } catch {}
      this.bodyContactListeners.delete(bodyId)
    }
    try {
      this.world?.removeBody?.(state.body)
    } catch {}
    this.runtimeBodies.delete(bodyId)
    this.runtimeShapes.delete(state.desc.shapeId)
    if (state.desc.materialId != null) {
      this.runtimeMaterials.delete(state.desc.materialId)
    }
  }

  private createVehicleState(desc: PhysicsVehicleDesc): VehicleState {
    const world = this.ensureWorld()
    const bodyState = this.bodies.get(desc.bodyId)
    if (!bodyState) {
      throw new Error(`Unknown physics body for vehicle: ${desc.bodyId}`)
    }
    const vehicle = new CANNON.RaycastVehicle({
      chassisBody: bodyState.body,
      indexRightAxis: desc.indexRightAxis,
      indexUpAxis: desc.indexUpAxis,
      indexForwardAxis: desc.indexForwardAxis,
    })
    desc.wheels.forEach((wheel) => {
      vehicle.addWheel({
        radius: wheel.radius,
        directionLocal: vec3FromTuple(wheel.direction),
        axleLocal: vec3FromTuple(wheel.axle),
        chassisConnectionPointLocal: vec3FromTuple(wheel.connectionPoint),
        suspensionRestLength: wheel.suspensionRestLength,
        suspensionStiffness: wheel.suspensionStiffness,
        dampingRelaxation: wheel.dampingRelaxation,
        dampingCompression: wheel.dampingCompression,
        frictionSlip: wheel.frictionSlip,
        rollInfluence: wheel.rollInfluence,
        maxSuspensionTravel: wheel.maxSuspensionTravel,
        maxSuspensionForce: wheel.maxSuspensionForce,
        isFrontWheel: wheel.isFrontWheel,
      })
    })
    vehicle.addToWorld(world)
      return {
        desc,
        bodyId: desc.bodyId,
        body: bodyState.body,
        vehicle,
        steerableWheelIndices: desc.wheels.reduce<number[]>((indices, wheel, index) => {
          if (wheel.isFrontWheel) {
            indices.push(index)
          }
          return indices
        }, []),
        speedGovernorScale: 1,
        speedGovernorBrakeAssist: 0,
        speedGovernorOverHardCap: false,
        speedGovernorSmoothedForwardSpeedAbs: 0,
      }
  }

  /**
   * 应用所有车辆的输入（转向、油门、刹车、手刹），并将其作用到物理车辆对象上。
   * 遍历所有注册的车辆，根据输入值计算实际的物理参数，
   * 并分别设置每个轮子的刹车、转向和发动机动力。
   * 最后唤醒车辆刚体，确保物理引擎能正确模拟。
   */
  private applyVehicleInputs(): void {
    this.vehicles.forEach((state, vehicleId) => {
      // 获取当前车辆的输入（如未设置则使用默认值0）
      const input = this.vehicleInputs.get(vehicleId)
      // 转向输入，范围[-1, 1]
      const steeringInput = clamp(input?.steering ?? 0, -1, 1)
      // 油门输入，范围[-1, 1]
      const throttleInput = clamp(input?.throttle ?? 0, -1, 1)
      // 刹车输入，范围[0, 1]
      const brakeInput = clamp(input?.brake ?? 0, 0, 1)
      // 手刹输入，范围[0, 1]
      const handbrakeInput = clamp(input?.handbrake ?? 0, 0, 1)
      // 实际转向角度
      const steeringValue = steeringInput * VEHICLE_STEER_ANGLE
      const dt = Math.max(1 / 240, Math.min(0.25, this.worldSettings.fixedTimeStepMs / 1000))
      const forwardWorld = getForwardVector(state.body, state.desc.indexForwardAxis)
      const forwardSpeed = state.body.velocity.dot(forwardWorld)
      const forwardSpeedAbs = Math.abs(forwardSpeed)
      const speedSmoothAlpha = 1 - Math.exp(-6 * dt)
      state.speedGovernorSmoothedForwardSpeedAbs += (forwardSpeedAbs - state.speedGovernorSmoothedForwardSpeedAbs) * speedSmoothAlpha
      const speedForGovernor = Math.max(forwardSpeedAbs, state.speedGovernorSmoothedForwardSpeedAbs)
      const throttleSign = Math.sign(throttleInput)
      const brakeBlend = smoothstep(0.08, VEHICLE_BRAKE_RELEASE_SPEED, speedForGovernor)

      let engineForce = throttleInput * VEHICLE_ENGINE_FORCE
      let brakeAssist = state.speedGovernorBrakeAssist
      const maxSpeedMps = resolveVehicleMaxSpeedMps(state.desc.maxSpeedKmh)
      if (Math.abs(throttleInput) > 0.05 && Number.isFinite(maxSpeedMps)) {
        const hardCap = Math.max(0.1, maxSpeedMps)
        const softCap = Math.max(0.1, hardCap * VEHICLE_SPEED_GOVERNOR_SOFT_RATIO)
        const acceleratingSameDirection = throttleSign !== 0 && Math.sign(forwardSpeed) === throttleSign
        if (acceleratingSameDirection) {
          const range = Math.max(0.1, hardCap - softCap)
          const excess = Math.max(0, speedForGovernor - softCap)
          const t = Math.min(1, excess / range)
          const smooth = t * t * (3 - 2 * t)
          const scaleTarget = Math.max(0, 1 - smooth)
          const scaleAlpha = 1 - Math.exp(-14 * dt)
          state.speedGovernorScale += (scaleTarget - state.speedGovernorScale) * scaleAlpha
          engineForce *= state.speedGovernorScale

          const hardCapEnter = hardCap + VEHICLE_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET
          const hardCapExit = hardCap + VEHICLE_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET
          if (!state.speedGovernorOverHardCap) {
            if (speedForGovernor > hardCapEnter) {
              state.speedGovernorOverHardCap = true
            }
          } else if (speedForGovernor < hardCapExit) {
            state.speedGovernorOverHardCap = false
          }

          const over = state.speedGovernorOverHardCap
            ? Math.max(0, speedForGovernor - (hardCap + VEHICLE_SPEED_GOVERNOR_BRAKE_DEADBAND))
            : 0
          const brakeRatio = Math.min(1, over / VEHICLE_SPEED_GOVERNOR_BRAKE_BAND)
          const brakeTarget = brakeRatio * VEHICLE_BRAKE_FORCE * VEHICLE_SPEED_GOVERNOR_BRAKE_MAX_RATIO
          const brakeAlpha = 1 - Math.exp(-4 * dt)
          state.speedGovernorBrakeAssist += (brakeTarget - state.speedGovernorBrakeAssist) * brakeAlpha
          brakeAssist = state.speedGovernorBrakeAssist
        } else {
          const relaxAlpha = 1 - Math.exp(-6 * dt)
          state.speedGovernorScale += (1 - state.speedGovernorScale) * relaxAlpha
          state.speedGovernorBrakeAssist += (0 - state.speedGovernorBrakeAssist) * relaxAlpha
          state.speedGovernorOverHardCap = false
          brakeAssist = state.speedGovernorBrakeAssist
        }
      } else {
        const relaxAlpha = 1 - Math.exp(-6 * dt)
        state.speedGovernorScale += (1 - state.speedGovernorScale) * relaxAlpha
        state.speedGovernorBrakeAssist += (0 - state.speedGovernorBrakeAssist) * relaxAlpha
        state.speedGovernorOverHardCap = false
        brakeAssist = state.speedGovernorBrakeAssist
      }
      // 实际发动机动力
      // 实际刹车力度，取刹车和手刹的最大值
      const brakeForce = Math.min(
        VEHICLE_BRAKE_FORCE,
        Math.max(0, Math.max(brakeInput, handbrakeInput) * VEHICLE_BRAKE_FORCE * brakeBlend + brakeAssist),
      )

      // 遍历每个轮子，分别设置刹车、转向和动力
      for (let wheelIndex = 0; wheelIndex < state.desc.wheels.length; wheelIndex += 1) {
        // 判断该轮子是否可转向
        const steerable = state.steerableWheelIndices.includes(wheelIndex)
        // 设置转向角度（仅对可转向轮有效）
        state.vehicle.setSteeringValue(steerable ? steeringValue : 0, wheelIndex)
        // 设置发动机动力（仅对可转向轮有效）
        state.vehicle.applyEngineForce(steerable ? engineForce : 0, wheelIndex)

        // 设置当前轮子的刹车力度
        state.vehicle.setBrake(brakeForce, wheelIndex)

      }
      // 唤醒车辆刚体，防止休眠导致物理效果不生效
      if (speedForGovernor > VEHICLE_WAKE_SPEED_THRESHOLD || Math.abs(throttleInput) > 0.001 || Math.abs(steeringInput) > 0.001) {
        state.body.wakeUp()
      }
    })
  }
}

function getForwardVector(body: CANNON.Body, axisIndex: 0 | 1 | 2): CANNON.Vec3 {
  const axis = axisIndex === 1
    ? new CANNON.Vec3(0, 1, 0)
    : axisIndex === 2
      ? new CANNON.Vec3(0, 0, 1)
      : new CANNON.Vec3(1, 0, 0)
  const worldForward = new CANNON.Vec3()
  body.quaternion.vmult(axis, worldForward)
  return worldForward
}

function resolveVehicleMaxSpeedMps(maxSpeedKmh: number | null | undefined): number {
  if (typeof maxSpeedKmh !== 'number' || !Number.isFinite(maxSpeedKmh) || maxSpeedKmh <= 0) {
    return 45 / 3.6
  }
  return maxSpeedKmh / 3.6
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function createCannonWorld(settings: PhysicsWorldSettings): CANNON.World {
  const world = new CANNON.World()
  world.gravity.set(...settings.gravity)
  world.broadphase = new CANNON.SAPBroadphase(world)
  world.allowSleep = true
  return world
}

export type EnsureCannonWorldParams = {
  world: CANNON.World | null
  setWorld: (world: CANNON.World) => void
  gravity: CANNON.Vec3
  solverIterations: number
  solverTolerance: number
  contactFriction: number
  contactRestitution: number
  contactSettings: PhysicsContactSettings
  quatNormalizeFast?: boolean
  quatNormalizeSkip?: number
}

export function ensureCannonWorld(params: EnsureCannonWorldParams): CANNON.World {
  if (params.world) {
    return params.world
  }
  const world = createCannonWorld({
    gravity: [params.gravity.x, params.gravity.y, params.gravity.z],
    fixedTimeStepMs: 1000 / 60,
    maxSubSteps: 4,
  })
  const solver = new CANNON.GSSolver()
  solver.iterations = params.solverIterations
  solver.tolerance = params.solverTolerance
  world.solver = solver
  world.quatNormalizeFast = params.quatNormalizeFast ?? false
  world.quatNormalizeSkip = params.quatNormalizeSkip ?? 0
  world.defaultContactMaterial.friction = params.contactFriction
  world.defaultContactMaterial.restitution = params.contactRestitution
  world.defaultContactMaterial.contactEquationStiffness = params.contactSettings.contactEquationStiffness
  world.defaultContactMaterial.contactEquationRelaxation = params.contactSettings.contactEquationRelaxation
  world.defaultContactMaterial.frictionEquationStiffness = params.contactSettings.frictionEquationStiffness
  world.defaultContactMaterial.frictionEquationRelaxation = params.contactSettings.frictionEquationRelaxation
  params.setWorld(world)
  return world
}

function resolveBodyId(body: CANNON.Body): number | null {
  const typed = body as CANNON.Body & { physicsBodyId?: unknown }
  return typeof typed.physicsBodyId === 'number' ? typed.physicsBodyId : null
}

function readBodyTransform(body: CANNON.Body): PhysicsTransform {
  return {
    position: [body.position.x, body.position.y, body.position.z],
    rotation: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
  }
}

function vec3FromTuple(tuple: PhysicsVector3): CANNON.Vec3 {
  return new CANNON.Vec3(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0)
}

function distanceSquared(a: CANNON.Vec3, b: CANNON.Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function normalizePhysicsVector(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (!Number.isFinite(length) || length <= 1e-12) {
    return [0, 1, 0]
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}
