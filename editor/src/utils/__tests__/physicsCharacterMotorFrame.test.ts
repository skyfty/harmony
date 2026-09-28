import { describe, expect, it } from 'vitest'
import {
  createPhysicsCharacterMotorState,
  PhysicsWorldBase,
  type PhysicsBodyDesc,
  type PhysicsCharacterDesc,
  type PhysicsContactEvent,
  type PhysicsSceneAsset,
  type PhysicsTransform,
  type PhysicsVehicleDesc,
  type PhysicsVector3,
  type PhysicsWorldBodyState,
  type PhysicsWorldCharacterState,
  type PhysicsWorldVehicleState,
  type PhysicsCharacterMotorStepResult,
} from '@harmony/physics-core'

type TestBody = {
  position: PhysicsVector3
  rotation: [number, number, number, number]
  velocity: PhysicsVector3
  angularVelocity: PhysicsVector3
}

type TestVehicle = Record<string, never>
type TestBodyState = PhysicsWorldBodyState<TestBody>
type TestCharacterState = PhysicsWorldCharacterState<TestBody>
type TestVehicleState = PhysicsWorldVehicleState<TestBody, TestVehicle>

class ProbeGroundedWorld extends PhysicsWorldBase<
  TestBody,
  TestVehicle,
  TestCharacterState,
  TestBodyState,
  TestVehicleState
> {
  protected ensureWorldReady(): void {}

  protected hasWorld(): boolean {
    return true
  }

  protected applyWorldSettings(): void {}

  protected stepWorld(): void {}

  protected destroyWorldInstance(): void {}

  protected createBodyState(desc: PhysicsBodyDesc): TestBodyState {
    return {
      desc,
      body: {
        position: [...desc.transform.position],
        rotation: [...desc.transform.rotation],
        velocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
      },
    }
  }

  protected disposeBodyState(): void {}

  protected createVehicleState(desc: PhysicsVehicleDesc): TestVehicleState {
    return {
      desc,
      bodyId: desc.bodyId,
      body: {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        velocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
      },
      vehicle: {},
      steerableWheelIndices: [],
      speedGovernorScale: 1,
      speedGovernorBrakeAssist: 0,
      speedGovernorOverHardCap: false,
      speedGovernorSmoothedForwardSpeedAbs: 0,
    }
  }

  protected disposeVehicleState(): void {}

  protected createCharacterState(desc: PhysicsCharacterDesc, body: TestBody): TestCharacterState {
    return {
      desc,
      bodyId: desc.bodyId,
      body,
      input: null,
      motorState: createPhysicsCharacterMotorState(),
    }
  }

  protected wakeCharacterBody(): void {}

  protected wakeVehicleBody(): void {}

  protected readBodyTransform(body: TestBody): PhysicsTransform {
    return {
      position: body.position,
      rotation: body.rotation,
    }
  }

  protected readBodyLinearVelocity(body: TestBody): PhysicsVector3 {
    return body.velocity
  }

  protected readBodyAngularVelocity(body: TestBody): PhysicsVector3 {
    return body.angularVelocity
  }

  protected isBodySleeping(): boolean {
    return false
  }

  protected readWheelTransform(): PhysicsTransform {
    return {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    }
  }

  protected getVehicleForwardSpeed(): number {
    return 0
  }

  protected applyVehicleControls(): void {}

  protected resolveCharacterGroundProbe(): {
    hit: boolean
    distance: number
    normalY: number
    normal: PhysicsVector3
  } {
    return {
      hit: true,
      distance: 0.1,
      normalY: 1,
      normal: [0, 1, 0],
    }
  }

  protected applyCharacterStep(state: TestCharacterState, result: PhysicsCharacterMotorStepResult): void {
    state.body.velocity = result.linearVelocity
  }

  protected collectContacts(): PhysicsContactEvent[] {
    return []
  }
}

describe('PhysicsCharacterMotorFrameState', () => {
  it('returns probe grounding even when the physics step has no contact events', () => {
    const scene: PhysicsSceneAsset = {
      format: 'harmony-physics',
      materials: [],
      shapes: [{ id: 1, kind: 'sphere', radius: 0.35 }],
      bodies: [{
        id: 7,
        type: 'dynamic',
        mass: 1,
        materialId: null,
        shapeId: 1,
        transform: {
          position: [0, 1, 0],
          rotation: [0, 0, 0, 1],
        },
      }],
      vehicles: [],
      characters: [{
        characterId: 3,
        bodyId: 7,
        radius: 0.35,
        height: 1.7,
        stepHeight: 0.3,
        slopeLimitDegrees: 50,
        jumpImpulse: 6.5,
        airControl: 0.35,
        walkSpeed: 2.4,
        runSpeed: 4.8,
        sprintSpeed: 6.4,
      }],
    }
    const world = new ProbeGroundedWorld()
    world.loadScene(scene)

    const frame = world.step(1000 / 60)

    expect(frame.contacts).toBeUndefined()
    expect(frame.characterMotorStates).toEqual([{
      characterId: 3,
      bodyId: 7,
      grounded: true,
      probeGrounded: true,
      contactGrounded: false,
      groundNormal: [0, 1, 0],
      linearVelocity: [0, 0, 0],
    }])
  })
})
