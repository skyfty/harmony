import * as CANNON from 'cannon-es'
import {
  PHYSICS_BODY_TRANSFORM_STRIDE,
  PHYSICS_WHEEL_TRANSFORM_STRIDE,
  createEmptyStepFrame,
  type PhysicsBodyDesc,
  type PhysicsBodyTransformCommand,
  type PhysicsCompoundShapeDesc,
  type PhysicsConvexHullShapeDesc,
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
}

type ShapeBinding = {
  shape: CANNON.Shape
  position: CANNON.Vec3
  quaternion: CANNON.Quaternion
}

const DEFAULT_WORLD_SETTINGS: PhysicsWorldSettings = {
  gravity: [0, -9.8, 0],
  fixedTimeStepMs: 1000 / 60,
  maxSubSteps: 4,
}

const VEHICLE_ENGINE_FORCE = 320
const VEHICLE_BRAKE_FORCE = 42
const VEHICLE_STEER_ANGLE = (26 * Math.PI) / 180

const heightfieldQuaternion = new CANNON.Quaternion()
heightfieldQuaternion.setFromEuler(-Math.PI / 2, 0, 0, 'XYZ')
const cylinderShapeRotation = new CANNON.Quaternion()
cylinderShapeRotation.setFromEuler(Math.PI / 2, 0, 0, 'XYZ')

export class CannonPhysicsWorld {
  private scene: PhysicsSceneAsset | null = null
  private worldSettings: PhysicsWorldSettings = DEFAULT_WORLD_SETTINGS
  private frame = 0
  private world: CANNON.World | null = null
  private readonly bodies = new Map<number, BodyState>()
  private readonly shapes = new Map<number, PhysicsShapeDesc>()
  private readonly vehicles = new Map<number, VehicleState>()
  private readonly vehicleInputs = new Map<number, PhysicsVehicleInputCommand>()

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
      return createEmptyStepFrame(this.frame)
    }
    this.frame += 1
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
    const bodyTransforms = new Float32Array(bodyCount * PHYSICS_BODY_TRANSFORM_STRIDE)
    const bodyMeta = new Uint32Array(bodyCount)
    this.scene.bodies.forEach((body, index) => {
      const state = this.bodies.get(body.id)
      const transform = state ? readBodyTransform(state.body) : body.transform
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
        vehicleState.vehicle.updateWheelTransform(wheelIndex)
        const worldTransform = vehicleState.vehicle.wheelInfos[wheelIndex]?.worldTransform
        const base = wheelOffset * PHYSICS_WHEEL_TRANSFORM_STRIDE
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

  setVehicleInput(command: PhysicsVehicleInputCommand): void {
    this.vehicleInputs.set(command.vehicleId, command)
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
    }
    this.vehicles.clear()
    this.vehicleInputs.clear()
    this.bodies.clear()
    this.shapes.clear()
    this.scene = null
    this.frame = 0
  }

  disposeWorld(): void {
    this.disposeScene()
    this.world = null
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

  private createBodyState(desc: PhysicsBodyDesc): BodyState {
    const world = this.ensureWorld()
    const body = new CANNON.Body({
      mass: desc.type === 'dynamic' ? Math.max(0, desc.mass) : 0,
      type: mapBodyType(desc.type),
    })
    ;(body as CANNON.Body & { physicsBodyId?: number }).physicsBodyId = desc.id
    body.position.set(...desc.transform.position)
    body.quaternion.set(...desc.transform.rotation)
    body.linearDamping = desc.linearDamping ?? 0.01
    body.angularDamping = desc.angularDamping ?? 0.01
    const bindings = this.buildShapeBindings(desc.shapeId)
    bindings.forEach((binding) => {
      body.addShape(binding.shape, binding.position, binding.quaternion)
    })
    body.updateMassProperties()
    world.addBody(body)
    return { desc, body }
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

      for (let wheelIndex = 0; wheelIndex < state.desc.wheels.length; wheelIndex += 1) {
        state.vehicle.setBrake(brakeForce, wheelIndex)
        const steerable = state.steerableWheelIndices.includes(wheelIndex)
        state.vehicle.setSteeringValue(steerable ? steeringValue : 0, wheelIndex)
        state.vehicle.applyEngineForce(steerable ? engineForce : 0, wheelIndex)
      }
      state.body.wakeUp()
    })
  }

  private buildShapeBindings(shapeId: number): ShapeBinding[] {
    const shapeDesc = this.shapes.get(shapeId)
    if (!shapeDesc) {
      throw new Error(`Unknown physics shape: ${shapeId}`)
    }

    if (shapeDesc.kind === 'compound') {
      return shapeDesc.children.flatMap((child) => {
        const childBindings = this.buildShapeBindings(child.shapeId)
        return childBindings.map((binding) => composeShapeBinding(binding, child.transform))
      })
    }

    if (shapeDesc.kind === 'heightfield') {
      return [{
        shape: createHeightfieldShape(shapeDesc),
        position: vec3FromTuple(shapeDesc.localOffset ?? [0, 0, 0]),
        quaternion: quatClone(heightfieldQuaternion),
      }]
    }

    return [{
      shape: this.createShape(shapeDesc),
      position: new CANNON.Vec3(0, 0, 0),
      quaternion: new CANNON.Quaternion(0, 0, 0, 1),
    }]
  }

  private createShape(shapeDesc: Exclude<PhysicsShapeDesc, PhysicsCompoundShapeDesc>): CANNON.Shape {
    switch (shapeDesc.kind) {
      case 'box':
        return new CANNON.Box(vec3FromTuple(shapeDesc.halfExtents))
      case 'sphere':
        return new CANNON.Sphere(shapeDesc.radius)
      case 'cylinder': {
        const cylinder = new CANNON.Cylinder(
          shapeDesc.radiusTop,
          shapeDesc.radiusBottom,
          shapeDesc.height,
          Math.max(3, Math.trunc(shapeDesc.segments ?? 16)),
        )
        cylinder.transformAllPoints(new CANNON.Vec3(0, 0, 0), cylinderShapeRotation)
        return cylinder
      }
      case 'convex-hull':
        return createConvexHullShape(shapeDesc)
      case 'static-mesh':
        return createStaticMeshShape(shapeDesc)
      case 'heightfield':
        return createHeightfieldShape(shapeDesc)
      default: {
        const exhaustive: never = shapeDesc
        throw new Error(`Unsupported cannon shape: ${String(exhaustive)}`)
      }
    }
  }
}

function createHeightfieldShape(shapeDesc: Extract<PhysicsShapeDesc, { kind: 'heightfield' }>): CANNON.Heightfield {
  const matrix: number[][] = []
  let offset = 0
  for (let column = 0; column < shapeDesc.columns; column += 1) {
    const values: number[] = []
    for (let row = 0; row < shapeDesc.rows; row += 1) {
      values.push(shapeDesc.heights[offset] ?? 0)
      offset += 1
    }
    matrix.push(values)
  }
  return new CANNON.Heightfield(matrix, { elementSize: shapeDesc.elementSize })
}

function createConvexHullShape(shapeDesc: PhysicsConvexHullShapeDesc): CANNON.ConvexPolyhedron {
  const vertices: CANNON.Vec3[] = []
  for (let index = 0; index < shapeDesc.vertices.length; index += 3) {
    vertices.push(new CANNON.Vec3(
      shapeDesc.vertices[index] ?? 0,
      shapeDesc.vertices[index + 1] ?? 0,
      shapeDesc.vertices[index + 2] ?? 0,
    ))
  }
  const faces = Array.isArray(shapeDesc.faces) && shapeDesc.faces.length
    ? shapeDesc.faces.map((face) => face.map((value) => Math.trunc(value)))
    : inferConvexHullFaces(vertices.length)
  return new CANNON.ConvexPolyhedron({ vertices, faces })
}

function createStaticMeshShape(shapeDesc: PhysicsStaticMeshDesc): CANNON.Trimesh {
  return new CANNON.Trimesh(Array.from(shapeDesc.vertices), Array.from(shapeDesc.indices))
}

function inferConvexHullFaces(vertexCount: number): number[][] {
  if (vertexCount === 8) {
    return [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0],
    ]
  }
  throw new Error('Convex hull faces are required for non-box cannon shapes')
}

function composeShapeBinding(binding: ShapeBinding, transform: PhysicsTransform): ShapeBinding {
  const parentPosition = vec3FromTuple(transform.position)
  const parentQuaternion = quatFromTuple(transform.rotation)
  const composedPosition = parentQuaternion.vmult(binding.position)
  composedPosition.vadd(parentPosition, composedPosition)
  const composedQuaternion = new CANNON.Quaternion()
  parentQuaternion.mult(binding.quaternion, composedQuaternion)
  return {
    shape: binding.shape,
    position: composedPosition,
    quaternion: composedQuaternion,
  }
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

function quatFromTuple(tuple: PhysicsQuaternion): CANNON.Quaternion {
  return new CANNON.Quaternion(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0, tuple[3] ?? 1)
}

function quatClone(source: CANNON.Quaternion): CANNON.Quaternion {
  return new CANNON.Quaternion(source.x, source.y, source.z, source.w)
}

function distanceSquared(a: CANNON.Vec3, b: CANNON.Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function mapBodyType(type: PhysicsBodyDesc['type']): CANNON.BodyType {
  if (type === 'static') {
    return CANNON.Body.STATIC
  }
  if (type === 'kinematic') {
    return CANNON.Body.KINEMATIC
  }
  return CANNON.Body.DYNAMIC
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}
