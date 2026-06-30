import * as CANNON from 'cannon-es'
import {
  createPhysicsCharacterMotorState,
  stepPhysicsCharacterMotor,
  type PhysicsAddRuntimeBodiesCommand,
  type PhysicsBodyDesc,
  type PhysicsBodyTransformCommand,
  type PhysicsBodyVelocityCommand,
  type PhysicsCharacterDesc,
  type PhysicsCharacterInputCommand,
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

type CharacterState = {
  desc: PhysicsCharacterDesc
  bodyId: number
  body: CANNON.Body
  input: PhysicsCharacterInputCommand | null
  motorState: ReturnType<typeof createPhysicsCharacterMotorState>
  groundProbeRadius: number
  groundProbeBaseOffsetY: number
}

const DEFAULT_WORLD_SETTINGS: PhysicsWorldSettings = {
  gravity: [0, -9.8, 0],
  fixedTimeStepMs: 1000 / 60,
  maxSubSteps: 4,
}

const VEHICLE_ENGINE_FORCE = 420
const VEHICLE_BRAKE_FORCE = 42
const VEHICLE_STEER_ANGLE = (26 * Math.PI) / 180
const VEHICLE_SPEED_GOVERNOR_SOFT_RATIO = 0.96
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
  private readonly characters = new Map<number, CharacterState>()
  private lastContactNormalYByBodyId = new Map<number, number>()

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
    scene.characters.forEach((character) => {
      const body = this.bodies.get(character.bodyId)?.body ?? null
      if (!body) {
        return
      }
      const groundProbe = resolveCharacterGroundProbeGeometry(body, character)
      body.material = new CANNON.Material(`character:${character.characterId}`)
      body.material.friction = 0
      body.material.restitution = 0
      body.linearDamping = 0
      body.angularDamping = 0
      body.fixedRotation = true
      body.updateMassProperties()
      body.angularVelocity.set(0, 0, 0)
      this.characters.set(character.characterId, {
        desc: character,
        bodyId: character.bodyId,
        body,
        input: null,
        motorState: createPhysicsCharacterMotorState(),
        groundProbeRadius: groundProbe.radius,
        groundProbeBaseOffsetY: groundProbe.baseOffsetY,
      })
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
    this.applyVehicleInputs()
    this.applyCharacterInputs(deltaMs)
    this.lastContactNormalYByBodyId.clear()

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
    const contacts = this.collectContacts()

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
      contacts: contacts.length ? contacts : undefined,
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

  setCharacterInput(command: PhysicsCharacterInputCommand): void {
    const state = this.characters.get(command.characterId)
    if (!state) {
      return
    }
    state.input = command
    state.body.wakeUp()
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
    this.characters.clear()
    this.lastContactNormalYByBodyId.clear()
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
    return { desc, body }
  }

  private applyCharacterInputs(deltaMs: number): void {
    if (!this.characters.size) {
      return
    }
    const deltaSeconds = Math.max(0, deltaMs) / 1000
    this.characters.forEach((characterState) => {
      const input = characterState.input ?? {
        characterId: characterState.desc.characterId,
        moveX: 0,
        moveZ: 0,
        yaw: characterState.motorState.yaw,
        jump: false,
        sprint: false,
        crouch: false,
        interact: false,
      }
      const contactNormalY = this.lastContactNormalYByBodyId.get(characterState.bodyId) ?? null
      const probe = this.resolveCharacterGroundProbe(characterState)
      const stepResult = stepPhysicsCharacterMotor(characterState.desc, characterState.motorState, {
        moveX: input.moveX,
        moveZ: input.moveZ,
        yaw: input.yaw,
        jump: input.jump,
        sprint: input.sprint,
        crouch: input.crouch,
        interact: input.interact,
        deltaSeconds,
        gravityY: this.worldSettings.gravity[1] ?? -9.8,
        probe,
        contactNormalY,
      })
      characterState.body.velocity.set(
        stepResult.linearVelocity[0],
        stepResult.linearVelocity[1],
        stepResult.linearVelocity[2],
      )
      characterState.body.angularVelocity.set(0, 0, 0)
      characterState.body.quaternion.setFromEuler(0, stepResult.yaw, 0, 'YXZ')
      characterState.body.aabbNeedsUpdate = true
      characterState.body.wakeUp()
    })
  }

  private resolveCharacterGroundProbe(characterState: CharacterState): {
    hit: boolean
    distance: number
    normalY: number
    normal?: [number, number, number]
  } {
    const body = characterState.body
    const radius = Math.max(0.05, characterState.groundProbeRadius)
    const probeRise = Math.max(0.08, Math.min(0.4, characterState.desc.stepHeight + 0.05))
    const probeDepth = Math.max(0.2, characterState.desc.stepHeight + radius + 0.12)
    const baseY = body.position.y + characterState.groundProbeBaseOffsetY
    const offsets = resolveCharacterProbeOffsets(radius)
    const candidates = [
      ...this.bodies.values(),
      ...this.runtimeBodies.values(),
    ]
      .map((state) => state.body)
      .filter((candidateBody) => candidateBody !== body)
    let bestHit: { distance: number; normal: [number, number, number] } | null = null
    for (const [offsetX, offsetZ] of offsets) {
      const from = new CANNON.Vec3(body.position.x + offsetX, baseY + probeRise, body.position.z + offsetZ)
      const to = new CANNON.Vec3(body.position.x + offsetX, baseY - probeDepth, body.position.z + offsetZ)
      const ray = new CANNON.Ray(from, to)
      ray.mode = CANNON.Ray.CLOSEST
      ray.skipBackfaces = false
      ray.checkCollisionResponse = true
      const result = new CANNON.RaycastResult()
      ray.intersectBodies(candidates, result)
      if (!result.hasHit || !result.body || result.body === body) {
        continue
      }
      const distance = Math.max(0, from.distanceTo(result.hitPointWorld))
      const normal = normalizePhysicsVector([
        result.hitNormalWorld.x,
        result.hitNormalWorld.y,
        result.hitNormalWorld.z,
      ])
      if (!bestHit || distance < bestHit.distance) {
        bestHit = { distance, normal }
      }
    }
    if (!bestHit) {
      return {
        hit: false,
        distance: Number.POSITIVE_INFINITY,
        normalY: 0,
      }
    }
    return {
      hit: true,
      distance: bestHit.distance,
      normalY: bestHit.normal[1] ?? 0,
      normal: bestHit.normal,
    }
  }

  private collectContacts(): PhysicsContactEvent[] {
    const world = this.world
    if (!world) {
      return []
    }
    const contacts: PhysicsContactEvent[] = []
    this.lastContactNormalYByBodyId.clear()
    const seenPairs = new Set<string>()
    const equations = ((world as CANNON.World & {
      contacts?: Array<{
        bi: CANNON.Body
        bj: CANNON.Body
        ni: CANNON.Vec3
        ri: CANNON.Vec3
        rj: CANNON.Vec3
      }>
    }).contacts ?? [])
    equations.forEach((equation) => {
      const bodyA = equation.bi as CANNON.Body | null | undefined
      const bodyB = equation.bj as CANNON.Body | null | undefined
      const bodyIdA = bodyA ? resolveBodyId(bodyA) : null
      const bodyIdB = bodyB ? resolveBodyId(bodyB) : null
      if (bodyIdA == null || bodyIdB == null || bodyIdA === bodyIdB) {
        return
      }
      if (!bodyA || !bodyB) {
        return
      }
      const normalTuple = normalizePhysicsVector([
        equation.ni.x,
        equation.ni.y,
        equation.ni.z,
      ])
      const absNormalY = Math.abs(normalTuple[1] ?? 0)
      if (absNormalY > (this.lastContactNormalYByBodyId.get(bodyIdA) ?? 0)) {
        this.lastContactNormalYByBodyId.set(bodyIdA, absNormalY)
      }
      if (absNormalY > (this.lastContactNormalYByBodyId.get(bodyIdB) ?? 0)) {
        this.lastContactNormalYByBodyId.set(bodyIdB, absNormalY)
      }
      const key = bodyIdA < bodyIdB
        ? `${bodyIdA}:${bodyIdB}`
        : `${bodyIdB}:${bodyIdA}`
      if (seenPairs.has(key)) {
        return
      }
      seenPairs.add(key)
      const point = [
        bodyA.position.x + equation.ri.x,
        bodyA.position.y + equation.ri.y,
        bodyA.position.z + equation.ri.z,
      ] as [number, number, number]
      const relativeVelocity = new CANNON.Vec3(
        bodyA.velocity.x - bodyB.velocity.x,
        bodyA.velocity.y - bodyB.velocity.y,
        bodyA.velocity.z - bodyB.velocity.z,
      )
      const impactSpeed = Math.max(
        0,
        -(relativeVelocity.x * normalTuple[0] + relativeVelocity.y * normalTuple[1] + relativeVelocity.z * normalTuple[2]),
      )
      contacts.push({
        bodyIdA,
        bodyIdB,
        point,
        normal: normalTuple,
        impulse: null,
        impactSpeed,
      })
    })
    return contacts
  }

  private removeRuntimeBodyById(bodyId: number): void {
    const state = this.runtimeBodies.get(bodyId)
    if (!state) {
      return
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
      const input = this.vehicleInputs.get(vehicleId)
      const steeringInput = input?.steering ?? 0
      const throttleInput = input?.throttle ?? 0
      const brakeInput = input?.brake ?? 0
      const handbrakeInput = input?.handbrake ?? 0

      const steeringValue = steeringInput * VEHICLE_STEER_ANGLE
      const dt = Math.max(1 / 240, Math.min(0.25, this.worldSettings.fixedTimeStepMs / 1000))
      const forwardWorld = worldForwardFromQuaternion(state.body.quaternion)
      const forwardSpeed = state.body.velocity.x * forwardWorld.x
        + state.body.velocity.y * forwardWorld.y
        + state.body.velocity.z * forwardWorld.z
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
      const vehicle = state.vehicle
      const wheelCount = Math.max(0, vehicle.wheelInfos?.length ?? 0)
      const steerableWheelIndices = new Set(state.steerableWheelIndices)

      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex += 1) {
        const applyControlToWheel = steerableWheelIndices.has(wheelIndex)
        vehicle.setSteeringValue(applyControlToWheel ? steeringValue : 0, wheelIndex)
        vehicle.applyEngineForce(applyControlToWheel ? engineForce : 0, wheelIndex)
        vehicle.setBrake(brakeForce, wheelIndex)
      }
      if (
        speedForGovernor > VEHICLE_WAKE_SPEED_THRESHOLD
        || Math.abs(throttleInput) > 0.001
        || Math.abs(steeringInput) > 0.001
        || Math.abs(brakeInput) > 0.001
        || Math.abs(handbrakeInput) > 0.001
      ) {
        state.body.wakeUp()
      }
    })
  }
}

function worldForwardFromQuaternion(quaternion: CANNON.Quaternion): CANNON.Vec3 {
  const forward = new CANNON.Vec3(1, 0, 0)
  const result = quaternion.vmult(forward)
  const length = result.length()
  if (!(length > 1e-6)) {
    return new CANNON.Vec3(1, 0, 0)
  }
  return result.scale(1 / length, result)
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

function resolveCharacterGroundProbeGeometry(
  body: CANNON.Body,
  desc: PhysicsCharacterDesc,
): { radius: number; baseOffsetY: number } {
  let radius = Math.max(0.05, desc.radius)
  let baseOffsetY = -Math.max(radius, desc.height * 0.5) + radius
  let foundShape = false
  body.shapes.forEach((shape, index) => {
    const offset = body.shapeOffsets[index] ?? new CANNON.Vec3()
    if (shape instanceof CANNON.Box) {
      const halfExtents = shape.halfExtents
      radius = Math.max(radius, halfExtents.x, halfExtents.z)
      baseOffsetY = foundShape
        ? Math.min(baseOffsetY, offset.y - halfExtents.y)
        : offset.y - halfExtents.y
      foundShape = true
      return
    }
    if (shape instanceof CANNON.Sphere) {
      const sphereRadius = Math.max(0.05, shape.radius)
      radius = Math.max(radius, sphereRadius)
      baseOffsetY = foundShape
        ? Math.min(baseOffsetY, offset.y - sphereRadius)
        : offset.y - sphereRadius
      foundShape = true
      return
    }
    const boundRadius = Math.max(0.05, shape.boundingSphereRadius || radius)
    radius = Math.max(radius, boundRadius)
    baseOffsetY = foundShape
      ? Math.min(baseOffsetY, offset.y - boundRadius)
      : offset.y - boundRadius
    foundShape = true
  })
  return {
    radius,
    baseOffsetY,
  }
}

function resolveCharacterProbeOffsets(radius: number): Array<[number, number]> {
  const ring = Math.max(0.06, radius + 0.02)
  const diagonal = ring * Math.SQRT1_2
  return [
    [0, 0],
    [ring, 0],
    [-ring, 0],
    [0, ring],
    [0, -ring],
    [diagonal, diagonal],
    [diagonal, -diagonal],
    [-diagonal, diagonal],
    [-diagonal, -diagonal],
  ]
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

