import {
  axisVectorForIndex,
  distanceBetween,
  normalizeVector,
  normalizeQuaternion,
  resolveCharacterProbeOffsets,
  resolveSteerableWheelIndices,
  resolvePhysicsCharacterMotorYawFromWorldQuaternion,
  rotateVectorByQuaternion,
  PhysicsWorldBase,
  type PhysicsWorldBodyState,
  type PhysicsWorldCharacterState,
  type PhysicsWorldVehicleControl,
  type PhysicsWorldVehicleState,
} from '@harmony/physics-core'
import {
  createPhysicsCharacterMotorState,
  stepPhysicsCharacterMotor,
  type PhysicsBodyDesc,
  type PhysicsBodyTransformCommand,
  type PhysicsBodyVelocityCommand,
  type PhysicsCharacterDesc,
  type PhysicsContactEvent,
  type PhysicsMaterialDesc,
  type PhysicsQuaternion,
  type PhysicsRaycastCommand,
  type PhysicsRaycastHit,
  type PhysicsShapeDesc,
  type PhysicsTransform,
  type PhysicsVector3,
  type PhysicsVehicleDesc,
  type PhysicsVehicleInputCommand,
} from '@harmony/physics-core'
import { createAmmoRigidBody } from './bodyFactory'
import type { AmmoApi } from './ammoHelpers'
import { createAmmoSceneShapeBindings } from './sceneShapeBindings'

type BodyState = PhysicsWorldBodyState<any>
type VehicleState = PhysicsWorldVehicleState<any, any>
type CharacterState = PhysicsWorldCharacterState<any>

const BT_DISABLE_DEACTIVATION = 4

export class AmmoPhysicsWorld extends PhysicsWorldBase<any, any, CharacterState, BodyState, VehicleState> {
  private ammo: AmmoApi | null = null
  private world: any | null = null
  private collisionConfiguration: any | null = null
  private dispatcher: any | null = null
  private broadphase: any | null = null
  private solver: any | null = null

  setModule(module: unknown): void {
    this.ammo = module as AmmoApi
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

  setBodyVelocity(command: PhysicsBodyVelocityCommand): void {
    const ammo = this.ammo
    const state = this.bodies.get(command.bodyId)
    if (!ammo || !state) {
      return
    }
    if (command.linearVelocity) {
      const linear = createAmmoVector3(ammo, command.linearVelocity)
      state.body.setLinearVelocity?.(linear)
      ammo.destroy(linear)
    }
    if (command.angularVelocity) {
      const angular = createAmmoVector3(ammo, command.angularVelocity)
      state.body.setAngularVelocity?.(angular)
      ammo.destroy(angular)
    }
    if (command.wakeUp !== false) {
      state.body.activate?.(true)
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

  disposeWorld(): void {
    super.disposeWorld()
    this.world = null
    this.solver = null
    this.broadphase = null
    this.dispatcher = null
    this.collisionConfiguration = null
  }

  protected ensureWorldReady(): void {
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
    this.applyWorldSettings()
  }

  protected hasWorld(): boolean {
    return this.world != null
  }

  protected applyWorldSettings(): void {
    const ammo = this.ammo
    if (!ammo || !this.world) {
      return
    }
    const gravity = createAmmoVector3(ammo, this.worldSettings.gravity)
    this.world.setGravity(gravity)
    ammo.destroy(gravity)
  }

  protected stepWorld(deltaSeconds: number): void {
    if (!this.world) {
      return
    }
    this.world.stepSimulation(
      deltaSeconds,
      Math.max(1, this.worldSettings.maxSubSteps | 0),
      Math.max(1 / 240, this.worldSettings.fixedTimeStepMs / 1000),
    )
  }

  protected destroyWorldInstance(): void {
    if (!this.ammo) {
      return
    }
    if (this.world) {
      this.ammo.destroy(this.world)
    }
    if (this.solver) {
      this.ammo.destroy(this.solver)
    }
    if (this.broadphase) {
      this.ammo.destroy(this.broadphase)
    }
    if (this.dispatcher) {
      this.ammo.destroy(this.dispatcher)
    }
    if (this.collisionConfiguration) {
      this.ammo.destroy(this.collisionConfiguration)
    }
  }

  protected createBodyState(
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
    const materials = materialMap ? Array.from(materialMap.values()) : scene?.materials ?? []
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

  protected disposeBodyState(state: BodyState): void {
    state.cleanup?.slice().reverse().forEach((cleanup) => cleanup())
  }

  protected createVehicleState(desc: PhysicsVehicleDesc): VehicleState {
    const ammo = this.ammo
    const world = this.world
    const body = this.bodies.get(desc.bodyId)?.body ?? null
    if (!ammo || !world || !body) {
      throw new Error(`Ammo vehicle chassis body is missing: ${desc.bodyId}`)
    }

    const tuning = new ammo.btVehicleTuning()
    const raycaster = new ammo.btDefaultVehicleRaycaster(world)
    const vehicle = new ammo.btRaycastVehicle(tuning, body, raycaster)
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

    return {
      desc,
      bodyId: desc.bodyId,
      body,
      vehicle,
      steerableWheelIndices: resolveSteerableWheelIndices(desc),
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

  protected disposeVehicleState(state: VehicleState): void {
    state.cleanup?.slice().reverse().forEach((cleanup) => cleanup())
  }

  protected createCharacterState(desc: PhysicsCharacterDesc, body: any): CharacterState {
    const ammo = this.ammo
    if (!ammo) {
      throw new Error('Ammo module is not loaded')
    }
    const motorYaw = resolvePhysicsCharacterMotorYawFromWorldQuaternion(body.quaternion, desc.forwardAxis)
    const zeroFactor = createAmmoVector3(ammo, [0, 0, 0])
    const zeroVelocity = createAmmoVector3(ammo, [0, 0, 0])
    body.setAngularFactor?.(zeroFactor)
    body.setAngularVelocity?.(zeroVelocity)
    ammo.destroy(zeroVelocity)
    ammo.destroy(zeroFactor)
    return {
      desc,
      bodyId: desc.bodyId,
      body,
      input: null,
      motorState: createPhysicsCharacterMotorState(motorYaw),
    }
  }

  protected wakeCharacterBody(state: CharacterState): void {
    state.body.activate?.(true)
  }

  protected wakeVehicleBody(state: VehicleState): void {
    state.body.activate?.(true)
  }

  protected readBodyTransform(body: any): PhysicsTransform {
    return readAmmoBodyTransform(body)
  }

  protected readBodyLinearVelocity(body: any): PhysicsVector3 {
    const linearVelocity = body.getLinearVelocity?.()
    return [
      linearVelocity?.x?.() ?? 0,
      linearVelocity?.y?.() ?? 0,
      linearVelocity?.z?.() ?? 0,
    ]
  }

  protected readBodyAngularVelocity(body: any): PhysicsVector3 {
    const angularVelocity = body.getAngularVelocity?.()
    return [
      angularVelocity?.x?.() ?? 0,
      angularVelocity?.y?.() ?? 0,
      angularVelocity?.z?.() ?? 0,
    ]
  }

  protected isBodySleeping(body: any): boolean {
    return body.getActivationState?.() === 2
  }

  protected readWheelTransform(vehicleState: VehicleState, wheelIndex: number): PhysicsTransform {
    vehicleState.vehicle.updateWheelTransform?.(wheelIndex, true)
    const wheelTransform = vehicleState.vehicle.getWheelTransformWS?.(wheelIndex)
    const origin = wheelTransform?.getOrigin?.()
    const rotation = wheelTransform?.getRotation?.()
    return {
      position: [origin?.x?.() ?? 0, origin?.y?.() ?? 0, origin?.z?.() ?? 0],
      rotation: [rotation?.x?.() ?? 0, rotation?.y?.() ?? 0, rotation?.z?.() ?? 0, rotation?.w?.() ?? 1],
    }
  }

  protected getVehicleForwardSpeed(state: VehicleState): number {
    const linearVelocity = this.readBodyLinearVelocity(state.body)
    const forwardVector = rotateVectorByQuaternion(
      axisVectorForIndex(state.desc.indexForwardAxis),
      state.body.quaternion,
    )
    return linearVelocity[0] * forwardVector[0]
      + linearVelocity[1] * forwardVector[1]
      + linearVelocity[2] * forwardVector[2]
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
    return speedForGovernor > 0.2
      || Math.abs(input?.throttle ?? 0) > 0.001
      || Math.abs(input?.steering ?? 0) > 0.001
  }

  protected resolveCharacterGroundProbe(characterState: CharacterState): {
    hit: boolean
    distance: number
    normalY: number
    normal?: [number, number, number]
  } {
    const ammo = this.ammo
    const world = this.world
    if (!ammo || !world) {
      return {
        hit: false,
        distance: Number.POSITIVE_INFINITY,
        normalY: 0,
      }
    }
    const transform = characterState.body.getWorldTransform?.()
    const origin = transform?.getOrigin?.()
    if (!origin) {
      return {
        hit: false,
        distance: Number.POSITIVE_INFINITY,
        normalY: 0,
      }
    }
    const radius = Math.max(0.05, characterState.desc.radius)
    const halfHeight = Math.max(radius, characterState.desc.height * 0.5)
    const probeRise = Math.max(0.08, Math.min(0.4, characterState.desc.stepHeight + 0.05))
    const probeDepth = Math.max(0.2, characterState.desc.stepHeight + radius + 0.12)
    const baseY = origin.y() - halfHeight + radius
    const offsets = resolveCharacterProbeOffsets(radius)
    let bestHit: { distance: number; normal: [number, number, number] } | null = null
    for (const [offsetX, offsetZ] of offsets) {
      const fromTuple: PhysicsVector3 = [origin.x() + offsetX, baseY + probeRise, origin.z() + offsetZ]
      const toTuple: PhysicsVector3 = [origin.x() + offsetX, baseY - probeDepth, origin.z() + offsetZ]
      const from = createAmmoVector3(ammo, fromTuple)
      const to = createAmmoVector3(ammo, toTuple)
      const callback = new ammo.ClosestRayResultCallback(from, to)
      world.rayTest(from, to, callback)
      if (callback.hasHit()) {
        const collisionObject = callback.get_m_collisionObject?.()
        const bodyId = collisionObject?.getUserIndex?.() ?? 0
        if (bodyId > 0 && bodyId !== characterState.bodyId) {
          const point = callback.get_m_hitPointWorld?.()
          const normal = callback.get_m_hitNormalWorld?.()
          const distance = distanceBetween(fromTuple, [point.x(), point.y(), point.z()])
          const normalTuple = normalizeVector([
            normal.x(),
            normal.y(),
            normal.z(),
          ])
          if (!bestHit || distance < bestHit.distance) {
            bestHit = { distance, normal: normalTuple }
          }
        }
      }
      ammo.destroy(callback)
      ammo.destroy(to)
      ammo.destroy(from)
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
    const ammo = this.ammo
    if (!ammo) {
      return
    }
    const linearVelocity = createAmmoVector3(ammo, result.linearVelocity)
    const angularVelocity = createAmmoVector3(ammo, [0, 0, 0])
    const yawQuaternion = createAmmoQuaternionFromYaw(ammo, result.yaw)
    const transform = state.body.getWorldTransform?.()
    state.body.setLinearVelocity?.(linearVelocity)
    state.body.setAngularVelocity?.(angularVelocity)
    if (transform && yawQuaternion) {
      transform.setRotation?.(yawQuaternion)
      state.body.setWorldTransform?.(transform)
      const motionState = state.body.getMotionState?.()
      motionState?.setWorldTransform?.(transform)
    }
    state.body.activate?.(true)
    ammo.destroy(linearVelocity)
    ammo.destroy(angularVelocity)
    ammo.destroy(yawQuaternion)
  }

  protected collectContacts(): PhysicsContactEvent[] {
    const ammo = this.ammo
    const dispatcher = this.dispatcher
    if (!ammo || !dispatcher) {
      return []
    }
    const contacts: PhysicsContactEvent[] = []
    this.lastContactNormalYByBodyId.clear()
    const manifoldCount = dispatcher.getNumManifolds?.() ?? 0
    for (let manifoldIndex = 0; manifoldIndex < manifoldCount; manifoldIndex += 1) {
      const manifold = dispatcher.getManifoldByIndexInternal?.(manifoldIndex)
      if (!manifold) {
        continue
      }
      const bodyA = manifold.getBody0?.()
      const bodyB = manifold.getBody1?.()
      const bodyIdA = bodyA?.getUserIndex?.() ?? 0
      const bodyIdB = bodyB?.getUserIndex?.() ?? 0
      if (!(bodyIdA > 0) || !(bodyIdB > 0)) {
        continue
      }
      const contactCount = manifold.getNumContacts?.() ?? 0
      for (let contactIndex = 0; contactIndex < contactCount; contactIndex += 1) {
        const contactPoint = manifold.getContactPoint?.(contactIndex)
        if (!contactPoint) {
          continue
        }
        const distance = contactPoint.getDistance?.() ?? 0
        if (distance > 0.05) {
          continue
        }
        const point = contactPoint.get_m_positionWorldOnB?.()
        const normal = contactPoint.get_m_normalWorldOnB?.()
        const normalTuple = normalizeVector([
          normal?.x?.() ?? 0,
          normal?.y?.() ?? 1,
          normal?.z?.() ?? 0,
        ])
        const absNormalY = Math.abs(normalTuple[1] ?? 0)
        if (absNormalY > (this.lastContactNormalYByBodyId.get(bodyIdA) ?? 0)) {
          this.lastContactNormalYByBodyId.set(bodyIdA, absNormalY)
        }
        if (absNormalY > (this.lastContactNormalYByBodyId.get(bodyIdB) ?? 0)) {
          this.lastContactNormalYByBodyId.set(bodyIdB, absNormalY)
        }
        contacts.push({
          bodyIdA,
          bodyIdB,
          point: [point?.x?.() ?? 0, point?.y?.() ?? 0, point?.z?.() ?? 0],
          normal: normalTuple,
          impulse: null,
          impactSpeed: null,
        })
        break
      }
    }
    return contacts
  }
}

function createAmmoVector3(ammo: AmmoApi, vector: PhysicsVector3): any {
  return new ammo.btVector3(vector[0], vector[1], vector[2])
}

function createAmmoQuaternion(ammo: AmmoApi, quaternion: PhysicsQuaternion): any {
  const normalized = normalizeQuaternion(quaternion)
  return new ammo.btQuaternion(normalized[0], normalized[1], normalized[2], normalized[3])
}

function createAmmoQuaternionFromYaw(ammo: AmmoApi, yaw: number): any {
  const halfYaw = (Number.isFinite(yaw) ? yaw : Math.PI) * 0.5
  return new ammo.btQuaternion(0, Math.sin(halfYaw), 0, Math.cos(halfYaw))
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
