import {
  type PhysicsAddRuntimeBodiesCommand,
  type PhysicsBodyDesc,
  type PhysicsBodyTransformCommand,
  type PhysicsMaterialDesc,
  type PhysicsQuaternion,
  type PhysicsRaycastCommand,
  type PhysicsRaycastHit,
  type PhysicsRemoveRuntimeBodiesCommand,
  type PhysicsSceneAsset,
  type PhysicsShapeDesc,
  type PhysicsStepFrame,
  type PhysicsTransform,
  type PhysicsVector3,
  type PhysicsVehicleDesc,
  type PhysicsVehicleInputCommand,
  type PhysicsWorldSettings,
} from '@harmony/physics-core'
import { createAmmoRigidBody } from './bodyFactory'
import type { AmmoApi } from './ammoHelpers'
import { createAmmoSceneShapeBindings } from './sceneShapeBindings'

type BodyState = {
  desc: PhysicsBodyDesc
  body: any
  cleanup: Array<() => void>
}

type VehicleState = {
  desc: PhysicsVehicleDesc
  bodyId: number
  body: any
  vehicle: any
  steerableWheelIndices: number[]
  speedGovernorScale: number
  speedGovernorBrakeAssist: number
  speedGovernorOverHardCap: boolean
  speedGovernorSmoothedForwardSpeedAbs: number
  cleanup: Array<() => void>
}
const BT_DISABLE_DEACTIVATION = 4

const DEFAULT_WORLD_SETTINGS: PhysicsWorldSettings = {
  gravity: [0, -9.8, 0],
  fixedTimeStepMs: 1000 / 60,
  maxSubSteps: 4,
}

const VEHICLE_ENGINE_FORCE = 320
const VEHICLE_BRAKE_FORCE = 42
const VEHICLE_STEER_ANGLE = (26 * Math.PI) / 180
const VEHICLE_SPEED_GOVERNOR_SOFT_RATIO = 0.92
const VEHICLE_SPEED_GOVERNOR_BRAKE_ENTER_OFFSET = 0.45
const VEHICLE_SPEED_GOVERNOR_BRAKE_EXIT_OFFSET = 0.2
const VEHICLE_SPEED_GOVERNOR_BRAKE_DEADBAND = 0.35
const VEHICLE_SPEED_GOVERNOR_BRAKE_BAND = 1.8
const VEHICLE_SPEED_GOVERNOR_BRAKE_MAX_RATIO = 0.14
const VEHICLE_BRAKE_RELEASE_SPEED = 0.45
const VEHICLE_WAKE_SPEED_THRESHOLD = 0.2

export class AmmoPhysicsWorld {
  private ammo: AmmoApi | null = null
  private scene: PhysicsSceneAsset | null = null
  private worldSettings: PhysicsWorldSettings = DEFAULT_WORLD_SETTINGS
  private frame = 0
  private world: any | null = null
  private collisionConfiguration: any | null = null
  private dispatcher: any | null = null
  private broadphase: any | null = null
  private solver: any | null = null
  private readonly bodies = new Map<number, BodyState>()
  private readonly shapes = new Map<number, PhysicsShapeDesc>()
  private readonly runtimeBodies = new Map<number, BodyState>()
  private readonly runtimeShapes = new Map<number, PhysicsShapeDesc>()
  private readonly runtimeMaterials = new Map<number, PhysicsMaterialDesc>()
  private readonly vehicles = new Map<number, VehicleState>()
  private readonly vehicleInputs = new Map<number, PhysicsVehicleInputCommand>()

  setModule(module: unknown): void {
    this.ammo = module as AmmoApi
  }

  setWorldSettings(settings: PhysicsWorldSettings): void {
    this.worldSettings = {
      gravity: [...settings.gravity],
      fixedTimeStepMs: settings.fixedTimeStepMs,
      maxSubSteps: settings.maxSubSteps,
    }
    this.applyGravity()
  }

  loadScene(scene: PhysicsSceneAsset): { bodyCount: number; vehicleCount: number } {
    this.ensureWorld()
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

  async step(deltaMs: number): Promise<PhysicsStepFrame> {
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
    this.applyVehicleInputs()

    const deltaSeconds = Math.max(0, deltaMs) / 1000
    if (deltaSeconds > 0) {
      this.world.stepSimulation(
        deltaSeconds,
        Math.max(1, this.worldSettings.maxSubSteps | 0),
        Math.max(1 / 240, this.worldSettings.fixedTimeStepMs / 1000),
      )
    }

    const bodyCount = this.scene.bodies.length
    const bodyTransforms = new Float32Array(bodyCount * 8)
    const bodyMeta = new Uint32Array(bodyCount)
    this.scene.bodies.forEach((body, index) => {
      const state = this.bodies.get(body.id)
      const transform = state ? readAmmoBodyTransform(state.body) : body.transform
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
        vehicleState.vehicle.updateWheelTransform?.(wheelIndex, true)
        const wheelTransform = vehicleState.vehicle.getWheelTransformWS?.(wheelIndex)
        const origin = wheelTransform?.getOrigin?.()
        const rotation = wheelTransform?.getRotation?.()
        const base = wheelOffset * 9
        wheelTransforms[base] = vehicleDesc.id
        wheelTransforms[base + 1] = wheelIndex
        wheelTransforms[base + 2] = origin?.x?.() ?? 0
        wheelTransforms[base + 3] = origin?.y?.() ?? 0
        wheelTransforms[base + 4] = origin?.z?.() ?? 0
        wheelTransforms[base + 5] = rotation?.x?.() ?? 0
        wheelTransforms[base + 6] = rotation?.y?.() ?? 0
        wheelTransforms[base + 7] = rotation?.z?.() ?? 0
        wheelTransforms[base + 8] = rotation?.w?.() ?? 1
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
    }
  }

  setBodyTransform(command: PhysicsBodyTransformCommand): void {
    const ammo = this.ammo
    const state = this.bodies.get(command.bodyId)
    if (!ammo || !state) {
      return
    }
    const worldTransform = createAmmoTransform(ammo, command.transform)
    state.body.setWorldTransform(worldTransform)
    const motionState = state.body.getMotionState?.()
    if (motionState) {
      motionState.setWorldTransform(worldTransform)
    }
    state.body.activate?.(true)
    if (command.resetVelocity) {
      const zero = createAmmoVector3(ammo, [0, 0, 0])
      state.body.setLinearVelocity?.(zero)
      state.body.setAngularVelocity?.(zero)
      state.body.clearForces?.()
      ammo.destroy(zero)
    }
    ammo.destroy(worldTransform)
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
      this.runtimeBodies.set(entry.body.id, this.createBodyState(entry.body, this.runtimeShapes, this.runtimeMaterials))
    }
  }

  removeRuntimeBodies(command: PhysicsRemoveRuntimeBodiesCommand): void {
    for (const bodyId of command.bodyIds) {
      this.removeRuntimeBodyById(bodyId)
    }
  }

  raycast(command: PhysicsRaycastCommand): PhysicsRaycastHit | null {
    const ammo = this.ammo
    if (!ammo || !this.world) {
      return null
    }
    if (!(distanceBetween(command.origin, command.target) > 1e-6)) {
      return null
    }

    const from = createAmmoVector3(ammo, command.origin)
    const to = createAmmoVector3(ammo, command.target)
    const callback = new ammo.ClosestRayResultCallback(from, to)
    if (typeof command.collisionMask === 'number') {
      callback.set_m_collisionFilterMask?.(command.collisionMask)
    }

    this.world.rayTest(from, to, callback)
    if (!callback.hasHit()) {
      ammo.destroy(callback)
      ammo.destroy(to)
      ammo.destroy(from)
      return null
    }

    const collisionObject = callback.get_m_collisionObject()
    const point = callback.get_m_hitPointWorld()
    const normal = callback.get_m_hitNormalWorld()
    const hit: PhysicsRaycastHit = {
      bodyId: collisionObject?.getUserIndex?.() ?? 0,
      point: [point.x(), point.y(), point.z()],
      normal: normalizeVector([normal.x(), normal.y(), normal.z()]),
      distance: distanceBetween(command.origin, [point.x(), point.y(), point.z()]),
    }

    ammo.destroy(callback)
    ammo.destroy(to)
    ammo.destroy(from)
    return hit.bodyId > 0 ? hit : null
  }

  disposeScene(): void {
    this.scene = null
    this.frame = 0
    this.shapes.clear()
    this.runtimeShapes.clear()
    this.runtimeMaterials.clear()
    this.vehicleInputs.clear()

    Array.from(this.vehicles.values()).forEach((state) => {
      state.cleanup.slice().reverse().forEach((cleanup) => cleanup())
    })
    this.vehicles.clear()

    Array.from(this.bodies.values()).forEach((state) => {
      state.cleanup.slice().reverse().forEach((cleanup) => cleanup())
    })
    this.bodies.clear()
    Array.from(this.runtimeBodies.values()).forEach((state) => {
      state.cleanup.slice().reverse().forEach((cleanup) => cleanup())
    })
    this.runtimeBodies.clear()
  }

  disposeWorld(): void {
    if (!this.ammo) {
      return
    }
    this.disposeScene()
    if (this.world) {
      this.ammo.destroy(this.world)
      this.world = null
    }
    if (this.solver) {
      this.ammo.destroy(this.solver)
      this.solver = null
    }
    if (this.broadphase) {
      this.ammo.destroy(this.broadphase)
      this.broadphase = null
    }
    if (this.dispatcher) {
      this.ammo.destroy(this.dispatcher)
      this.dispatcher = null
    }
    if (this.collisionConfiguration) {
      this.ammo.destroy(this.collisionConfiguration)
      this.collisionConfiguration = null
    }
  }

  private ensureWorld(): void {
    if (!this.ammo) {
      throw new Error('Ammo module is not loaded')
    }
    if (this.world) {
      return
    }
    const ammo = this.ammo
    this.collisionConfiguration = new ammo.btDefaultCollisionConfiguration()
    this.dispatcher = new ammo.btCollisionDispatcher(this.collisionConfiguration)
    this.broadphase = new ammo.btDbvtBroadphase()
    this.solver = new ammo.btSequentialImpulseConstraintSolver()
    this.world = new ammo.btDiscreteDynamicsWorld(
      this.dispatcher,
      this.broadphase,
      this.solver,
      this.collisionConfiguration,
    )
    this.applyGravity()
  }

  private applyGravity(): void {
    const ammo = this.ammo
    if (!ammo || !this.world) {
      return
    }
    const gravity = createAmmoVector3(ammo, this.worldSettings.gravity)
    this.world.setGravity(gravity)
    ammo.destroy(gravity)
  }

  private createBodyState(
    desc: PhysicsBodyDesc,
    shapeMap: Map<number, PhysicsShapeDesc> = this.shapes,
    materialMap: Map<number, PhysicsMaterialDesc> | null = null,
  ): BodyState {
    const ammo = this.ammo
    const world = this.world
    const scene = this.scene
    if (!ammo || !world) {
      throw new Error('Ammo world is not initialized')
    }
    const materials = materialMap
      ? Array.from(materialMap.values())
      : scene?.materials ?? []
    const assembly = createAmmoRigidBody({
      ammo,
      world,
      materials,
      shapes: createAmmoSceneShapeBindings(ammo, shapeMap, desc.shapeId, desc.type === 'dynamic'),
      desc,
    })

    return {
      desc,
      body: assembly.body,
      cleanup: assembly.cleanup,
    }
  }

  private removeRuntimeBodyById(bodyId: number): void {
    const state = this.runtimeBodies.get(bodyId)
    if (!state) {
      return
    }
    state.cleanup.slice().reverse().forEach((cleanup) => cleanup())
    this.runtimeBodies.delete(bodyId)
    this.runtimeShapes.delete(state.desc.shapeId)
    if (state.desc.materialId != null) {
      this.runtimeMaterials.delete(state.desc.materialId)
    }
  }

  private createVehicleState(desc: PhysicsVehicleDesc): VehicleState {
    const ammo = this.ammo
    const world = this.world
    const body = this.bodies.get(desc.bodyId)?.body ?? null
    if (!ammo || !world || !body) {
      throw new Error(`Ammo vehicle chassis body is missing: ${desc.bodyId}`)
    }

    const tuning = new ammo.btVehicleTuning()
    const raycaster = new ammo.btDefaultVehicleRaycaster(world)
    const vehicle = new ammo.btRaycastVehicle(tuning, body, raycaster)
    // Ammo's raycast-vehicle binding in this build expects the scene forward axis
    // to be supplied in the first slot to preserve the same world-facing direction
    // we use in the Cannon backend.
    vehicle.setCoordinateSystem?.(desc.indexForwardAxis, desc.indexUpAxis, desc.indexRightAxis)
    body.setActivationState?.(BT_DISABLE_DEACTIVATION)
    world.addAction?.(vehicle)

    const connectionPoint = createAmmoVector3(ammo, [0, 0, 0])
    const direction = createAmmoVector3(ammo, [0, 0, 0])
    const axle = createAmmoVector3(ammo, [0, 0, 0])
    desc.wheels.forEach((wheel) => {
      connectionPoint.setValue(wheel.connectionPoint[0], wheel.connectionPoint[1], wheel.connectionPoint[2])
      direction.setValue(wheel.direction[0], wheel.direction[1], wheel.direction[2])
      axle.setValue(wheel.axle[0], wheel.axle[1], wheel.axle[2])
      const info = vehicle.addWheel(
        connectionPoint,
        direction,
        axle,
        Math.max(1e-3, wheel.suspensionRestLength),
        Math.max(1e-3, wheel.radius),
        tuning,
        wheel.isFrontWheel,
      )
      info.set_m_suspensionStiffness?.(Math.max(0, wheel.suspensionStiffness))
      info.set_m_wheelsDampingRelaxation?.(Math.max(0, wheel.dampingRelaxation))
      info.set_m_wheelsDampingCompression?.(Math.max(0, wheel.dampingCompression))
      info.set_m_frictionSlip?.(Math.max(1e-3, wheel.frictionSlip))
      info.set_m_rollInfluence?.(Math.max(0, wheel.rollInfluence))
      if (typeof wheel.maxSuspensionTravel === 'number') {
        info.set_m_maxSuspensionTravelCm?.(Math.max(0, wheel.maxSuspensionTravel * 100))
      }
      if (typeof wheel.maxSuspensionForce === 'number') {
        info.set_m_maxSuspensionForce?.(Math.max(0, wheel.maxSuspensionForce))
      }
    })

    const steerableWheelIndices = resolveSteerableWheelIndices(desc)
    return {
      desc,
      bodyId: desc.bodyId,
      body,
      vehicle,
      steerableWheelIndices,
      speedGovernorScale: 1,
      speedGovernorBrakeAssist: 0,
      speedGovernorOverHardCap: false,
      speedGovernorSmoothedForwardSpeedAbs: 0,
      cleanup: [
        () => ammo.destroy(tuning),
        () => ammo.destroy(raycaster),
        () => ammo.destroy(vehicle),
        () => ammo.destroy(connectionPoint),
        () => ammo.destroy(direction),
        () => ammo.destroy(axle),
        () => world.removeAction?.(vehicle),
      ],
    }
  }

  private applyVehicleInputs(): void {
    this.vehicles.forEach((state, vehicleId) => {
      const input = this.vehicleInputs.get(vehicleId)
      const steeringInput = clamp(input?.steering ?? 0, -1, 1)
      const throttleInput = clamp(input?.throttle ?? 0, -1, 1)
      const brakeInput = clamp(input?.brake ?? 0, 0, 1)
      const handbrakeInput = clamp(input?.handbrake ?? 0, 0, 1)
      const steeringValue = steeringInput * VEHICLE_STEER_ANGLE
      const dt = Math.max(1 / 240, Math.min(0.25, this.worldSettings.fixedTimeStepMs / 1000))
      const linearVelocity = state.body.getLinearVelocity?.()
      const forwardVector = rotateVectorByQuaternion(axisVectorForIndex(state.desc.indexForwardAxis), state.body.quaternion)
      const forwardSpeed = linearVelocity
        ? linearVelocity.x() * forwardVector[0]
          + linearVelocity.y() * forwardVector[1]
          + linearVelocity.z() * forwardVector[2]
        : 0
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

      const brakeForce = Math.min(
        VEHICLE_BRAKE_FORCE,
        Math.max(0, Math.max(brakeInput, handbrakeInput) * VEHICLE_BRAKE_FORCE * brakeBlend + brakeAssist),
      )

      const wheelCount = state.desc.wheels.length
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex += 1) {
        state.vehicle.setBrake?.(brakeForce, wheelIndex)
        const steerable = state.steerableWheelIndices.includes(wheelIndex)
        state.vehicle.setSteeringValue?.(steerable ? steeringValue : 0, wheelIndex)
        state.vehicle.applyEngineForce?.(steerable ? engineForce : 0, wheelIndex)
      }
      if (state.body && (speedForGovernor > VEHICLE_WAKE_SPEED_THRESHOLD || Math.abs(throttleInput) > 0.001 || Math.abs(steeringInput) > 0.001)) {
        state.body.activate?.(true)
      }
    })
  }
}

function resolveSteerableWheelIndices(vehicle: PhysicsVehicleDesc): number[] {
  const frontWheelIndices = vehicle.wheels.reduce<number[]>((indices, wheel, index) => {
    if (wheel.isFrontWheel) {
      indices.push(index)
    }
    return indices
  }, [])
  if (frontWheelIndices.length) {
    return frontWheelIndices
  }
  if (vehicle.wheels.length >= 2) {
    return [0, 1].filter((index) => index < vehicle.wheels.length)
  }
  return vehicle.wheels.map((_wheel, index) => index)
}

function createAmmoVector3(ammo: AmmoApi, vector: PhysicsVector3): any {
  return new ammo.btVector3(vector[0], vector[1], vector[2])
}

function createAmmoQuaternion(ammo: AmmoApi, quaternion: PhysicsQuaternion): any {
  const normalized = normalizeQuaternion(quaternion)
  return new ammo.btQuaternion(normalized[0], normalized[1], normalized[2], normalized[3])
}

function createAmmoTransform(ammo: AmmoApi, transform: PhysicsTransform): any {
  const position = createAmmoVector3(ammo, transform.position)
  const rotation = createAmmoQuaternion(ammo, transform.rotation)
  const ammoTransform = new ammo.btTransform()
  ammoTransform.setIdentity?.()
  ammoTransform.setOrigin(position)
  ammoTransform.setRotation(rotation)
  ammo.destroy(rotation)
  ammo.destroy(position)
  return ammoTransform
}

function readAmmoBodyTransform(body: any): PhysicsTransform {
  const transform = body.getWorldTransform()
  const origin = transform.getOrigin()
  const rotation = transform.getRotation()
  return {
    position: [origin.x(), origin.y(), origin.z()],
    rotation: normalizeQuaternion([rotation.x(), rotation.y(), rotation.z(), rotation.w()]),
  }
}

function distanceBetween(a: PhysicsVector3, b: PhysicsVector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function normalizeVector(vector: PhysicsVector3): PhysicsVector3 {
  const vectorLength = Math.hypot(vector[0], vector[1], vector[2])
  if (!(vectorLength > 1e-6)) {
    return [0, 1, 0]
  }
  return [vector[0] / vectorLength, vector[1] / vectorLength, vector[2] / vectorLength]
}

function normalizeQuaternion(quaternion: PhysicsQuaternion): PhysicsQuaternion {
  const quaternionLength = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
  if (!(quaternionLength > 1e-6)) {
    return [0, 0, 0, 1]
  }
  return [
    quaternion[0] / quaternionLength,
    quaternion[1] / quaternionLength,
    quaternion[2] / quaternionLength,
    quaternion[3] / quaternionLength,
  ]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

function axisVectorForIndex(axisIndex: 0 | 1 | 2): PhysicsVector3 {
  if (axisIndex === 1) {
    return [0, 1, 0]
  }
  if (axisIndex === 2) {
    return [0, 0, 1]
  }
  return [1, 0, 0]
}

function rotateVectorByQuaternion(
  vector: PhysicsVector3,
  quaternion: PhysicsQuaternion | { x?: number; y?: number; z?: number; w?: number } | null | undefined,
): PhysicsVector3 {
  const qx = Array.isArray(quaternion) ? quaternion[0] : quaternion?.x ?? 0
  const qy = Array.isArray(quaternion) ? quaternion[1] : quaternion?.y ?? 0
  const qz = Array.isArray(quaternion) ? quaternion[2] : quaternion?.z ?? 0
  const qw = Array.isArray(quaternion) ? quaternion[3] : quaternion?.w ?? 1
  const vx = vector[0]
  const vy = vector[1]
  const vz = vector[2]

  const ix = qw * vx + qy * vz - qz * vy
  const iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx
  const iw = -qx * vx - qy * vy - qz * vz

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}
