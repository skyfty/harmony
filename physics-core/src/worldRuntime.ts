import {
  createPhysicsCharacterMotorState,
  stepPhysicsCharacterMotor,
  type PhysicsCharacterMotorGroundProbe,
  type PhysicsCharacterMotorStepResult,
} from './characterMotor'
import type {
  PhysicsAddRuntimeBodiesCommand,
  PhysicsBodyDesc,
  PhysicsCharacterDesc,
  PhysicsCharacterInputCommand,
  PhysicsContactEvent,
  PhysicsMaterialDesc,
  PhysicsRemoveRuntimeBodiesCommand,
  PhysicsSceneAsset,
  PhysicsShapeDesc,
  PhysicsTransform,
  PhysicsVector3,
  PhysicsVehicleDesc,
  PhysicsVehicleInputCommand,
  PhysicsWorldSettings,
} from './types'
import type { PhysicsStepFrame } from './protocol'
import {
  stepPhysicsVehicleSpeedGovernor,
  shouldWakePhysicsVehicle,
  type PhysicsVehicleSpeedGovernorState,
  type PhysicsWorldVehicleControl,
} from './vehicleSpeedGovernor'

export const DEFAULT_PHYSICS_WORLD_SETTINGS: PhysicsWorldSettings = {
  gravity: [0, -9.8, 0],
  fixedTimeStepMs: 1000 / 60,
  maxSubSteps: 4,
}

export type PhysicsWorldBodyState<TBody> = {
  desc: PhysicsBodyDesc
  body: TBody
  cleanup?: Array<() => void>
}

export type PhysicsWorldVehicleState<TBody, TVehicle> = {
  bodyId: number
  body: TBody
  vehicle: TVehicle
  steerableWheelIndices: number[]
  cleanup?: Array<() => void>
} & PhysicsVehicleSpeedGovernorState

export type PhysicsWorldCharacterState<TBody> = {
  desc: PhysicsCharacterDesc
  bodyId: number
  body: TBody
  input: PhysicsCharacterInputCommand | null
  motorState: ReturnType<typeof createPhysicsCharacterMotorState>
}

export abstract class PhysicsWorldBase<
  TBody,
  TVehicle,
  TCharacterState extends PhysicsWorldCharacterState<TBody>,
  TBodyState extends PhysicsWorldBodyState<TBody> = PhysicsWorldBodyState<TBody>,
  TVehicleState extends PhysicsWorldVehicleState<TBody, TVehicle> = PhysicsWorldVehicleState<TBody, TVehicle>,
> {
  protected scene: PhysicsSceneAsset | null = null
  protected worldSettings: PhysicsWorldSettings = DEFAULT_PHYSICS_WORLD_SETTINGS
  protected frame = 0
  protected readonly bodies = new Map<number, TBodyState>()
  protected readonly shapes = new Map<number, PhysicsShapeDesc>()
  protected readonly runtimeBodies = new Map<number, TBodyState>()
  protected readonly runtimeShapes = new Map<number, PhysicsShapeDesc>()
  protected readonly runtimeMaterials = new Map<number, PhysicsMaterialDesc>()
  protected readonly vehicles = new Map<number, TVehicleState>()
  protected readonly vehicleInputs = new Map<number, PhysicsVehicleInputCommand>()
  protected readonly characters = new Map<number, TCharacterState>()
  protected readonly lastContactNormalYByBodyId = new Map<number, number>()

  setWorldSettings(settings: PhysicsWorldSettings): void {
    this.worldSettings = {
      gravity: [...settings.gravity],
      fixedTimeStepMs: settings.fixedTimeStepMs,
      maxSubSteps: settings.maxSubSteps,
    }
    this.applyWorldSettings()
  }

  loadScene(scene: PhysicsSceneAsset): { bodyCount: number; vehicleCount: number } {
    this.ensureWorldReady()
    this.disposeScene()
    this.scene = scene
    this.frame = 0

    scene.shapes.forEach((shape) => {
      this.shapes.set(shape.id, shape)
    })
    scene.bodies.forEach((body) => {
      this.bodies.set(body.id, this.createBodyState(body, this.shapes, null))
    })
    scene.vehicles.forEach((vehicle) => {
      this.vehicles.set(vehicle.id, this.createVehicleState(vehicle))
    })
    scene.characters.forEach((character) => {
      const body = this.bodies.get(character.bodyId)?.body ?? null
      if (!body) {
        return
      }
      this.characters.set(character.characterId, this.createCharacterState(character, body))
    })

    return {
      bodyCount: scene.bodies.length,
      vehicleCount: scene.vehicles.length,
    }
  }

  step(deltaMs: number): PhysicsStepFrame {
    if (!this.scene || !this.hasWorld()) {
      return createEmptyPhysicsStepFrame(this.frame)
    }

    this.frame += 1
    this.applyVehicleInputs()
    this.applyCharacterInputs(deltaMs)
    this.lastContactNormalYByBodyId.clear()

    const deltaSeconds = Math.max(0, deltaMs) / 1000
    if (deltaSeconds > 0) {
      this.stepWorld(deltaSeconds)
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
      const transform = physicsBody ? this.readBodyTransform(physicsBody) : body.transform
      const linearVelocity = physicsBody ? this.readBodyLinearVelocity(physicsBody) : null
      const angularVelocity = physicsBody ? this.readBodyAngularVelocity(physicsBody) : null
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
      bodyLinearVelocities[linearBase] = linearVelocity?.[0] ?? 0
      bodyLinearVelocities[linearBase + 1] = linearVelocity?.[1] ?? 0
      bodyLinearVelocities[linearBase + 2] = linearVelocity?.[2] ?? 0
      bodyAngularVelocities[linearBase] = angularVelocity?.[0] ?? 0
      bodyAngularVelocities[linearBase + 1] = angularVelocity?.[1] ?? 0
      bodyAngularVelocities[linearBase + 2] = angularVelocity?.[2] ?? 0
      bodySleeping[index] = physicsBody && this.isBodySleeping(physicsBody) ? 1 : 0
    })

    const contacts = this.collectContacts()

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
        const wheelTransform = this.readWheelTransform(vehicleState, wheelIndex)
        const base = wheelOffset * 9
        wheelTransforms[base] = vehicleDesc.id
        wheelTransforms[base + 1] = wheelIndex
        wheelTransforms[base + 2] = wheelTransform.position[0]
        wheelTransforms[base + 3] = wheelTransform.position[1]
        wheelTransforms[base + 4] = wheelTransform.position[2]
        wheelTransforms[base + 5] = wheelTransform.rotation[0]
        wheelTransforms[base + 6] = wheelTransform.rotation[1]
        wheelTransforms[base + 7] = wheelTransform.rotation[2]
        wheelTransforms[base + 8] = wheelTransform.rotation[3]
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
      contacts: contacts.length ? contacts : undefined,
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
    this.wakeCharacterBody(state)
  }

  addRuntimeBodies(command: PhysicsAddRuntimeBodiesCommand): void {
    this.ensureWorldReady()
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

  disposeScene(): void {
    Array.from(this.vehicles.values()).forEach((state) => {
      this.disposeVehicleState(state)
    })
    Array.from(this.bodies.values()).forEach((state) => {
      this.disposeBodyState(state)
    })
    Array.from(this.runtimeBodies.values()).forEach((state) => {
      this.disposeBodyState(state)
    })

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
    this.destroyWorldInstance()
  }

  protected removeRuntimeBodyById(bodyId: number): void {
    const state = this.runtimeBodies.get(bodyId)
    if (!state) {
      return
    }
    this.disposeBodyState(state)
    this.runtimeBodies.delete(bodyId)
    this.runtimeShapes.delete(state.desc.shapeId)
    if (state.desc.materialId != null) {
      this.runtimeMaterials.delete(state.desc.materialId)
    }
  }

  protected applyVehicleInputs(): void {
    this.vehicles.forEach((state, vehicleId) => {
      const input = this.vehicleInputs.get(vehicleId)
      const forwardSpeed = this.getVehicleForwardSpeed(state)
      const stepResult = stepPhysicsVehicleSpeedGovernor(state, {
        steeringInput: input?.steering ?? 0,
        throttleInput: input?.throttle ?? 0,
        brakeInput: input?.brake ?? 0,
        handbrakeInput: input?.handbrake ?? 0,
        forwardSpeed,
        deltaSeconds: Math.max(1 / 240, Math.min(0.25, this.worldSettings.fixedTimeStepMs / 1000)),
      })

      this.applyVehicleControls(state, stepResult.control)

      if (shouldWakePhysicsVehicle({
        steeringInput: input?.steering ?? 0,
        throttleInput: input?.throttle ?? 0,
        brakeInput: input?.brake ?? 0,
        handbrakeInput: input?.handbrake ?? 0,
      }, stepResult.speedForGovernor)) {
        this.wakeVehicleBody(state)
      }
    })
  }

  protected applyCharacterInputs(deltaMs: number): void {
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
      this.applyCharacterStep(characterState, stepResult)
    })
  }

  protected abstract ensureWorldReady(): void
  protected abstract hasWorld(): boolean
  protected abstract applyWorldSettings(): void
  protected abstract stepWorld(deltaSeconds: number): void
  protected abstract destroyWorldInstance(): void
  protected abstract createBodyState(
    desc: PhysicsBodyDesc,
    shapeMap?: Map<number, PhysicsShapeDesc>,
    materialMap?: Map<number, PhysicsMaterialDesc> | null,
  ): TBodyState
  protected abstract disposeBodyState(state: TBodyState): void
  protected abstract createVehicleState(desc: PhysicsVehicleDesc): TVehicleState
  protected abstract disposeVehicleState(state: TVehicleState): void
  protected abstract createCharacterState(desc: PhysicsCharacterDesc, body: TBody): TCharacterState
  protected abstract wakeCharacterBody(state: TCharacterState): void
  protected abstract wakeVehicleBody(state: TVehicleState): void
  protected abstract readBodyTransform(body: TBody): PhysicsTransform
  protected abstract readBodyLinearVelocity(body: TBody): PhysicsVector3
  protected abstract readBodyAngularVelocity(body: TBody): PhysicsVector3
  protected abstract isBodySleeping(body: TBody): boolean
  protected abstract readWheelTransform(vehicleState: TVehicleState, wheelIndex: number): PhysicsTransform
  protected abstract getVehicleForwardSpeed(state: TVehicleState): number
  protected abstract applyVehicleControls(state: TVehicleState, control: PhysicsWorldVehicleControl): void
  protected abstract resolveCharacterGroundProbe(state: TCharacterState): PhysicsCharacterMotorGroundProbe
  protected abstract applyCharacterStep(state: TCharacterState, result: PhysicsCharacterMotorStepResult): void
  protected abstract collectContacts(): PhysicsContactEvent[]
}

export function createEmptyPhysicsStepFrame(frame: number): PhysicsStepFrame {
  return {
    frame,
    bodyCount: 0,
    wheelCount: 0,
    bodyTransforms: new Float32Array(0),
    wheelTransforms: new Float32Array(0),
  }
}

export function resolveSteerableWheelIndices(vehicle: PhysicsVehicleDesc): number[] {
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
