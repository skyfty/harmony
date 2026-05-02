import {
  PHYSICS_BODY_TRANSFORM_STRIDE,
  PHYSICS_WHEEL_TRANSFORM_STRIDE,
  createEmptyStepFrame,
  type PhysicsBodyDesc,
  type PhysicsBodyTransformCommand,
  type PhysicsCompoundShapeDesc,
  type PhysicsHeightfieldDesc,
  type PhysicsQuaternion,
  type PhysicsRaycastCommand,
  type PhysicsRaycastHit,
  type PhysicsSceneAsset,
  type PhysicsShapeDesc,
  type PhysicsStaticMeshDesc,
  type PhysicsStepFrame,
  type PhysicsTransform,
  type PhysicsVector3,
  type PhysicsVehicleDesc,
  type PhysicsVehicleInputCommand,
  type PhysicsWorldSettings,
} from '@harmony/physics-core'

type AmmoApi = {
  destroy: (object: unknown) => void
  btVector3: new (x?: number, y?: number, z?: number) => any
  btQuaternion: new (x?: number, y?: number, z?: number, w?: number) => any
  btTransform: new () => any
  btDefaultMotionState: new (transform?: unknown) => any
  btRigidBodyConstructionInfo: new (mass: number, motionState: unknown, shape: unknown, localInertia?: unknown) => any
  btRigidBody: new (info: unknown) => any
  btBoxShape: new (halfExtents: unknown) => any
  btSphereShape: new (radius: number) => any
  btCylinderShape: new (halfExtents: unknown) => any
  btConvexHullShape: new () => any
  btCompoundShape: new (enableDynamicAabbTree?: boolean) => any
  btTriangleMesh: new (use32bitIndices?: boolean, use4componentVertices?: boolean) => any
  btBvhTriangleMeshShape: new (meshInterface: unknown, useQuantizedAabbCompression: boolean, buildBvh?: boolean) => any
  btConvexTriangleMeshShape?: new (meshInterface: unknown, calcAabb?: boolean) => any
  btVehicleTuning: new () => any
  btDefaultVehicleRaycaster: new (world: unknown) => any
  btRaycastVehicle: new (tuning: unknown, chassisBody: unknown, raycaster: unknown) => any
  btDefaultCollisionConfiguration: new () => any
  btCollisionDispatcher: new (configuration: unknown) => any
  btDbvtBroadphase: new () => any
  btSequentialImpulseConstraintSolver: new () => any
  btDiscreteDynamicsWorld: new (
    dispatcher: unknown,
    broadphase: unknown,
    solver: unknown,
    configuration: unknown,
  ) => any
  ClosestRayResultCallback: new (from: unknown, to: unknown) => any
}

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
  cleanup: Array<() => void>
}

type BuiltAmmoShape = {
  shape: any
  cleanup: Array<() => void>
}

const BT_COLLISION_FLAG_KINEMATIC_OBJECT = 2
const BT_DISABLE_DEACTIVATION = 4

const DEFAULT_WORLD_SETTINGS: PhysicsWorldSettings = {
  gravity: [0, -9.8, 0],
  fixedTimeStepMs: 1000 / 60,
  maxSubSteps: 4,
}

const VEHICLE_ENGINE_FORCE = 320
const VEHICLE_BRAKE_FORCE = 42
const VEHICLE_STEER_ANGLE = (26 * Math.PI) / 180

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

  async step(deltaMs: number): Promise<PhysicsStepFrame> {
    if (!this.scene || !this.world) {
      return createEmptyStepFrame(this.frame)
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
    const bodyTransforms = new Float32Array(bodyCount * PHYSICS_BODY_TRANSFORM_STRIDE)
    const bodyMeta = new Uint32Array(bodyCount)
    this.scene.bodies.forEach((body, index) => {
      const state = this.bodies.get(body.id)
      const transform = state ? readAmmoBodyTransform(state.body) : body.transform
      const base = index * PHYSICS_BODY_TRANSFORM_STRIDE
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
    const wheelTransforms = new Float32Array(totalWheelCount * PHYSICS_WHEEL_TRANSFORM_STRIDE)
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
        const base = wheelOffset * PHYSICS_WHEEL_TRANSFORM_STRIDE
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
    this.vehicleInputs.clear()

    Array.from(this.vehicles.values()).forEach((state) => {
      state.cleanup.slice().reverse().forEach((cleanup) => cleanup())
    })
    this.vehicles.clear()

    Array.from(this.bodies.values()).forEach((state) => {
      state.cleanup.slice().reverse().forEach((cleanup) => cleanup())
    })
    this.bodies.clear()
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

  private createBodyState(desc: PhysicsBodyDesc): BodyState {
    const ammo = this.ammo
    const world = this.world
    const scene = this.scene
    if (!ammo || !world || !scene) {
      throw new Error('Ammo world is not initialized')
    }

    const shape = this.buildShape(desc.shapeId, desc.type === 'dynamic')
    const startTransform = createAmmoTransform(ammo, desc.transform)
    const motionState = new ammo.btDefaultMotionState(startTransform)

    const localInertia = createAmmoVector3(ammo, [0, 0, 0])
    const dynamicMass = desc.type === 'dynamic' ? Math.max(0, desc.mass) : 0
    if (dynamicMass > 0) {
      shape.shape.calculateLocalInertia(dynamicMass, localInertia)
    }

    const constructionInfo = new ammo.btRigidBodyConstructionInfo(
      dynamicMass,
      motionState,
      shape.shape,
      localInertia,
    )
    const material = desc.materialId == null ? null : scene.materials.find((entry) => entry.id === desc.materialId) ?? null
    if (material) {
      constructionInfo.set_m_friction?.(material.friction)
      constructionInfo.set_m_restitution?.(material.restitution)
    }
    constructionInfo.set_m_linearDamping?.(Math.max(0, desc.linearDamping ?? 0))
    constructionInfo.set_m_angularDamping?.(Math.max(0, desc.angularDamping ?? 0))

    const body = new ammo.btRigidBody(constructionInfo)
    body.setUserIndex?.(desc.id)
    body.setDamping?.(
      Math.max(0, desc.linearDamping ?? 0),
      Math.max(0, desc.angularDamping ?? 0),
    )
    if (material) {
      body.setFriction?.(material.friction)
      body.setRestitution?.(material.restitution)
    }
    if (desc.type === 'kinematic') {
      body.setCollisionFlags((body.getCollisionFlags?.() ?? 0) | BT_COLLISION_FLAG_KINEMATIC_OBJECT)
      body.setActivationState?.(BT_DISABLE_DEACTIVATION)
    }

    world.addRigidBody(body)

    return {
      desc,
      body,
      cleanup: [
        ...shape.cleanup,
        () => ammo.destroy(startTransform),
        () => ammo.destroy(motionState),
        () => ammo.destroy(localInertia),
        () => ammo.destroy(constructionInfo),
        () => ammo.destroy(body),
        () => world.removeRigidBody(body),
      ],
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
    vehicle.setCoordinateSystem?.(desc.indexRightAxis, desc.indexUpAxis, desc.indexForwardAxis)
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
      const engineForce = throttleInput * VEHICLE_ENGINE_FORCE
      const brakeForce = Math.max(brakeInput, handbrakeInput) * VEHICLE_BRAKE_FORCE

      const wheelCount = state.desc.wheels.length
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex += 1) {
        state.vehicle.setBrake?.(brakeForce, wheelIndex)
        const steerable = state.steerableWheelIndices.includes(wheelIndex)
        state.vehicle.setSteeringValue?.(steerable ? steeringValue : 0, wheelIndex)
        state.vehicle.applyEngineForce?.(steerable ? engineForce : 0, wheelIndex)
      }
      if (state.body) {
        state.body.activate?.(true)
      }
    })
  }

  private buildShape(shapeId: number, dynamic: boolean): BuiltAmmoShape {
    const ammo = this.ammo
    const shapeDesc = this.shapes.get(shapeId)
    if (!ammo || !shapeDesc) {
      throw new Error(`Unknown physics shape: ${shapeId}`)
    }

    if (shapeDesc.kind === 'box') {
      const halfExtents = createAmmoVector3(ammo, shapeDesc.halfExtents)
      const shape = new ammo.btBoxShape(halfExtents)
      return {
        shape,
        cleanup: [
          () => ammo.destroy(shape),
          () => ammo.destroy(halfExtents),
        ],
      }
    }

    if (shapeDesc.kind === 'sphere') {
      const shape = new ammo.btSphereShape(shapeDesc.radius)
      return {
        shape,
        cleanup: [() => ammo.destroy(shape)],
      }
    }

    if (shapeDesc.kind === 'cylinder') {
      const halfExtents = createAmmoVector3(ammo, [
        Math.max(shapeDesc.radiusTop, shapeDesc.radiusBottom),
        Math.max(1e-4, shapeDesc.height * 0.5),
        Math.max(shapeDesc.radiusTop, shapeDesc.radiusBottom),
      ])
      const shape = new ammo.btCylinderShape(halfExtents)
      return {
        shape,
        cleanup: [
          () => ammo.destroy(shape),
          () => ammo.destroy(halfExtents),
        ],
      }
    }

    if (shapeDesc.kind === 'convex-hull') {
      const shape = new ammo.btConvexHullShape()
      const point = createAmmoVector3(ammo, [0, 0, 0])
      for (let index = 0; index < shapeDesc.vertices.length; index += 3) {
        point.setValue(
          shapeDesc.vertices[index] ?? 0,
          shapeDesc.vertices[index + 1] ?? 0,
          shapeDesc.vertices[index + 2] ?? 0,
        )
        shape.addPoint(point, false)
      }
      shape.recalcLocalAabb?.()
      return {
        shape,
        cleanup: [
          () => ammo.destroy(shape),
          () => ammo.destroy(point),
        ],
      }
    }

    if (shapeDesc.kind === 'heightfield') {
      return this.buildTriangleMeshShape(buildHeightfieldMesh(shapeDesc), dynamic)
    }

    if (shapeDesc.kind === 'static-mesh') {
      return this.buildTriangleMeshShape(shapeDesc, dynamic)
    }

    if (shapeDesc.kind === 'compound') {
      return this.buildCompoundShape(shapeDesc, dynamic)
    }

    throw new Error(`Unsupported Ammo physics shape: ${(shapeDesc as PhysicsShapeDesc).kind}`)
  }

  private buildCompoundShape(shapeDesc: PhysicsCompoundShapeDesc, dynamic: boolean): BuiltAmmoShape {
    const ammo = this.ammo
    if (!ammo) {
      throw new Error('Ammo module is not loaded')
    }
    const shape = new ammo.btCompoundShape(true)
    const cleanup: Array<() => void> = [() => ammo.destroy(shape)]
    shapeDesc.children.forEach((child) => {
      const childShape = this.buildShape(child.shapeId, dynamic)
      const childTransform = createAmmoTransform(ammo, child.transform)
      shape.addChildShape(childTransform, childShape.shape)
      cleanup.push(...childShape.cleanup)
      cleanup.push(() => ammo.destroy(childTransform))
    })
    return {
      shape,
      cleanup,
    }
  }

  private buildTriangleMeshShape(meshDesc: PhysicsStaticMeshDesc, dynamic: boolean): BuiltAmmoShape {
    const ammo = this.ammo
    if (!ammo) {
      throw new Error('Ammo module is not loaded')
    }
    const triangleMesh = new ammo.btTriangleMesh(true, false)
    const vertexA = createAmmoVector3(ammo, [0, 0, 0])
    const vertexB = createAmmoVector3(ammo, [0, 0, 0])
    const vertexC = createAmmoVector3(ammo, [0, 0, 0])

    if (meshDesc.indices.length >= 3) {
      for (let index = 0; index < meshDesc.indices.length; index += 3) {
        const ia = (meshDesc.indices[index] ?? 0) * 3
        const ib = (meshDesc.indices[index + 1] ?? 0) * 3
        const ic = (meshDesc.indices[index + 2] ?? 0) * 3
        vertexA.setValue(meshDesc.vertices[ia] ?? 0, meshDesc.vertices[ia + 1] ?? 0, meshDesc.vertices[ia + 2] ?? 0)
        vertexB.setValue(meshDesc.vertices[ib] ?? 0, meshDesc.vertices[ib + 1] ?? 0, meshDesc.vertices[ib + 2] ?? 0)
        vertexC.setValue(meshDesc.vertices[ic] ?? 0, meshDesc.vertices[ic + 1] ?? 0, meshDesc.vertices[ic + 2] ?? 0)
        triangleMesh.addTriangle(vertexA, vertexB, vertexC, false)
      }
    } else {
      for (let index = 0; index + 8 < meshDesc.vertices.length; index += 9) {
        vertexA.setValue(meshDesc.vertices[index] ?? 0, meshDesc.vertices[index + 1] ?? 0, meshDesc.vertices[index + 2] ?? 0)
        vertexB.setValue(meshDesc.vertices[index + 3] ?? 0, meshDesc.vertices[index + 4] ?? 0, meshDesc.vertices[index + 5] ?? 0)
        vertexC.setValue(meshDesc.vertices[index + 6] ?? 0, meshDesc.vertices[index + 7] ?? 0, meshDesc.vertices[index + 8] ?? 0)
        triangleMesh.addTriangle(vertexA, vertexB, vertexC, false)
      }
    }

    const shape = dynamic
      ? this.buildDynamicTriangleShape(meshDesc, triangleMesh)
      : new ammo.btBvhTriangleMeshShape(triangleMesh, true, true)

    return {
      shape,
      cleanup: [
        () => ammo.destroy(shape),
        () => ammo.destroy(triangleMesh),
        () => ammo.destroy(vertexC),
        () => ammo.destroy(vertexB),
        () => ammo.destroy(vertexA),
      ],
    }
  }

  private buildDynamicTriangleShape(meshDesc: PhysicsStaticMeshDesc, triangleMesh: any): any {
    const ammo = this.ammo
    if (!ammo) {
      throw new Error('Ammo module is not loaded')
    }
    if (ammo.btConvexTriangleMeshShape) {
      return new ammo.btConvexTriangleMeshShape(triangleMesh, true)
    }
    const hull = new ammo.btConvexHullShape()
    const point = createAmmoVector3(ammo, [0, 0, 0])
    for (let index = 0; index < meshDesc.vertices.length; index += 3) {
      point.setValue(
        meshDesc.vertices[index] ?? 0,
        meshDesc.vertices[index + 1] ?? 0,
        meshDesc.vertices[index + 2] ?? 0,
      )
      hull.addPoint(point, false)
    }
    hull.recalcLocalAabb?.()
    ammo.destroy(point)
    return hull
  }
}

function buildHeightfieldMesh(shape: PhysicsHeightfieldDesc): PhysicsStaticMeshDesc {
  const triangleCount = Math.max(0, (shape.columns - 1) * (shape.rows - 1) * 2)
  const vertices = new Float32Array(triangleCount * 9)
  let offset = 0
  const baseOffset = shape.localOffset ?? [0, 0, 0]

  const writeVertex = (x: number, y: number, z: number): void => {
    vertices[offset] = x + baseOffset[0]
    vertices[offset + 1] = y + baseOffset[1]
    vertices[offset + 2] = z + baseOffset[2]
    offset += 3
  }

  for (let row = 0; row < shape.rows - 1; row += 1) {
    for (let column = 0; column < shape.columns - 1; column += 1) {
      const x0 = column * shape.elementSize
      const x1 = (column + 1) * shape.elementSize
      const z0 = row * shape.elementSize
      const z1 = (row + 1) * shape.elementSize
      const h00 = getHeightfieldHeight(shape, row, column)
      const h10 = getHeightfieldHeight(shape, row, column + 1)
      const h01 = getHeightfieldHeight(shape, row + 1, column)
      const h11 = getHeightfieldHeight(shape, row + 1, column + 1)

      writeVertex(x0, h00, z0)
      writeVertex(x1, h10, z0)
      writeVertex(x0, h01, z1)

      writeVertex(x1, h10, z0)
      writeVertex(x1, h11, z1)
      writeVertex(x0, h01, z1)
    }
  }

  return {
    id: shape.id,
    kind: 'static-mesh',
    vertices,
    indices: new Uint32Array(0),
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

function getHeightfieldHeight(shape: PhysicsHeightfieldDesc, row: number, column: number): number {
  return shape.heights[column * shape.rows + row] ?? 0
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
