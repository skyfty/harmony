import * as CANNON from 'cannon-es'
import {
  axisVectorForIndex,
  normalizeVector,
  resolveCharacterProbeOffsets,
  resolveSteerableWheelIndices,
  rotateVectorByQuaternion,
  PhysicsWorldBase,
  type PhysicsWorldBodyState,
  type PhysicsWorldCharacterState,
  type PhysicsWorldVehicleControl,
  type PhysicsWorldVehicleState,
} from '@harmony/physics-core'
import type { PhysicsContactSettings } from '@harmony/physics-bridge'
import {
  createPhysicsCharacterMotorState,
  stepPhysicsCharacterMotor,
  type PhysicsBodyDesc,
  type PhysicsBodyTransformCommand,
  type PhysicsBodyVelocityCommand,
  type PhysicsCharacterDesc,
  type PhysicsContactEvent,
  type PhysicsRaycastCommand,
  type PhysicsRaycastHit,
  type PhysicsShapeDesc,
  type PhysicsTransform,
  type PhysicsVector3,
  type PhysicsVehicleDesc,
  type PhysicsVehicleInputCommand,
} from '@harmony/physics-core'
import { createCannonSceneRigidBody } from './sceneRigidBodyFactory'

type BodyState = PhysicsWorldBodyState<CANNON.Body>
type VehicleState = PhysicsWorldVehicleState<CANNON.Body, CANNON.RaycastVehicle>
type CharacterState = PhysicsWorldCharacterState<CANNON.Body> & {
  groundProbeRadius: number
  groundProbeBaseOffsetY: number
}

const VEHICLE_WAKE_SPEED_THRESHOLD = 0.2

export class CannonPhysicsWorld extends PhysicsWorldBase<CANNON.Body, CANNON.RaycastVehicle, CharacterState, BodyState, VehicleState> {
  private world: CANNON.World | null = null

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

  getWorld(): CANNON.World | null {
    return this.world
  }

  protected ensureWorldReady(): void {
    if (this.world) {
      return
    }
    const world = new CANNON.World()
    world.gravity.set(...this.worldSettings.gravity)
    world.broadphase = new CANNON.SAPBroadphase(world)
    world.allowSleep = true
    this.world = world
  }

  protected hasWorld(): boolean {
    return this.world != null
  }

  protected applyWorldSettings(): void {
    if (this.world) {
      this.world.gravity.set(...this.worldSettings.gravity)
    }
  }

  protected stepWorld(deltaSeconds: number): void {
    if (!this.world) {
      return
    }
    this.world.step(
      Math.max(1 / 240, this.worldSettings.fixedTimeStepMs / 1000),
      deltaSeconds,
      Math.max(1, this.worldSettings.maxSubSteps | 0),
    )
  }

  protected destroyWorldInstance(): void {
    this.world = null
  }

  protected createBodyState(
    desc: PhysicsBodyDesc,
    shapeMap: Map<number, PhysicsShapeDesc> = this.shapes,
  ): BodyState {
    this.ensureWorldReady()
    const world = this.world
    if (!world) {
      throw new Error('Cannon world is not initialized')
    }
    const body = createCannonSceneRigidBody({
      world,
      shapeMap,
      desc,
    })
    return { desc, body }
  }

  protected disposeBodyState(state: BodyState): void {
    try {
      this.world?.removeBody(state.body)
    } catch {
      // ignore removal races during cleanup
    }
  }

  protected createVehicleState(desc: PhysicsVehicleDesc): VehicleState {
    this.ensureWorldReady()
    const world = this.world
    if (!world) {
      throw new Error('Cannon world is not initialized')
    }
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
      steerableWheelIndices: resolveSteerableWheelIndices(desc),
      speedGovernorScale: 1,
      speedGovernorBrakeAssist: 0,
      speedGovernorOverHardCap: false,
      speedGovernorSmoothedForwardSpeedAbs: 0,
    }
  }

  protected disposeVehicleState(state: VehicleState): void {
    if (!this.world) {
      return
    }
    try {
      state.vehicle.removeFromWorld(this.world)
    } catch {
      // ignore removal races during cleanup
    }
  }

  protected createCharacterState(desc: PhysicsCharacterDesc, body: CANNON.Body): CharacterState {
    const groundProbe = resolveCharacterGroundProbeGeometry(body, desc)
    body.material = new CANNON.Material(`character:${desc.characterId}`)
    body.material.friction = 0
    body.material.restitution = 0
    body.linearDamping = 0
    body.angularDamping = 0
    body.fixedRotation = true
    body.updateMassProperties()
    body.angularVelocity.set(0, 0, 0)
    return {
      desc,
      bodyId: desc.bodyId,
      body,
      input: null,
      motorState: createPhysicsCharacterMotorState(),
      groundProbeRadius: groundProbe.radius,
      groundProbeBaseOffsetY: groundProbe.baseOffsetY,
    }
  }

  protected wakeCharacterBody(state: CharacterState): void {
    state.body.wakeUp()
  }

  protected wakeVehicleBody(state: VehicleState): void {
    state.body.wakeUp()
  }

  protected readBodyTransform(body: CANNON.Body): PhysicsTransform {
    return {
      position: [body.position.x, body.position.y, body.position.z],
      rotation: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
    }
  }

  protected readBodyLinearVelocity(body: CANNON.Body): PhysicsVector3 {
    return [body.velocity.x, body.velocity.y, body.velocity.z]
  }

  protected readBodyAngularVelocity(body: CANNON.Body): PhysicsVector3 {
    return [body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z]
  }

  protected isBodySleeping(body: CANNON.Body): boolean {
    return body.sleepState === CANNON.Body.SLEEPING
  }

  protected readWheelTransform(vehicleState: VehicleState, wheelIndex: number): PhysicsTransform {
    vehicleState.vehicle.updateWheelTransform(wheelIndex)
    const worldTransform = vehicleState.vehicle.wheelInfos[wheelIndex]?.worldTransform
    return {
      position: [worldTransform?.position.x ?? 0, worldTransform?.position.y ?? 0, worldTransform?.position.z ?? 0],
      rotation: [
        worldTransform?.quaternion.x ?? 0,
        worldTransform?.quaternion.y ?? 0,
        worldTransform?.quaternion.z ?? 0,
        worldTransform?.quaternion.w ?? 1,
      ],
    }
  }

  protected getVehicleForwardSpeed(state: VehicleState): number {
    const forwardWorld = rotateVectorByQuaternion(
      axisVectorForIndex(state.desc.indexForwardAxis),
      state.body.quaternion,
    )
    return state.body.velocity.x * forwardWorld[0]
      + state.body.velocity.y * forwardWorld[1]
      + state.body.velocity.z * forwardWorld[2]
  }

  protected applyVehicleControls(state: VehicleState, control: PhysicsWorldVehicleControl): void {
    const vehicle = state.vehicle
    const wheelCount = Math.max(0, vehicle.wheelInfos?.length ?? 0)
    const steerableWheelIndices = new Set(state.steerableWheelIndices)
    for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex += 1) {
      const applyControlToWheel = steerableWheelIndices.has(wheelIndex)
      vehicle.setSteeringValue(applyControlToWheel ? control.steeringValue : 0, wheelIndex)
      vehicle.applyEngineForce(applyControlToWheel ? control.engineForce : 0, wheelIndex)
      vehicle.setBrake(control.brakeForce, wheelIndex)
    }
  }

  protected shouldWakeVehicle(
    _state: VehicleState,
    input: PhysicsVehicleInputCommand | undefined,
    speedForGovernor: number,
  ): boolean {
    return speedForGovernor > VEHICLE_WAKE_SPEED_THRESHOLD
      || Math.abs(input?.throttle ?? 0) > 0.001
      || Math.abs(input?.steering ?? 0) > 0.001
      || Math.abs(input?.brake ?? 0) > 0.001
      || Math.abs(input?.handbrake ?? 0) > 0.001
  }

  protected resolveCharacterGroundProbe(characterState: CharacterState): {
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
      .map((stateEntry) => stateEntry.body)
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
      const normal = normalizeVector([
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

  protected applyCharacterStep(state: CharacterState, result: ReturnType<typeof stepPhysicsCharacterMotor>): void {
    state.body.velocity.set(
      result.linearVelocity[0],
      result.linearVelocity[1],
      result.linearVelocity[2],
    )
    state.body.angularVelocity.set(0, 0, 0)
    state.body.quaternion.setFromEuler(0, result.yaw, 0, 'YXZ')
    state.body.aabbNeedsUpdate = true
    state.body.wakeUp()
  }

  protected collectContacts(): PhysicsContactEvent[] {
    if (!this.world) {
      return []
    }
    const contacts: PhysicsContactEvent[] = []
    this.lastContactNormalYByBodyId.clear()
    const seenPairs = new Set<string>()
    const equations = ((this.world as CANNON.World & {
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
      const normalTuple = normalizeVector([
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
}

export function createCannonWorld(settings: {
  gravity: [number, number, number]
  fixedTimeStepMs: number
  maxSubSteps: number
}): CANNON.World {
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

function resolveBodyId(body: CANNON.Body): number | null {
  const typed = body as CANNON.Body & { physicsBodyId?: unknown }
  return typeof typed.physicsBodyId === 'number' ? typed.physicsBodyId : null
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
