import { describe, expect, it } from 'vitest'
import {
  stepPhysicsVehicleSpeedGovernor,
  type PhysicsVehicleSpeedGovernorState,
} from '@harmony/physics-core'

function createGovernorState(): PhysicsVehicleSpeedGovernorState {
  return {
    desc: {
      id: 1,
      bodyId: 1,
      indexRightAxis: 2,
      indexUpAxis: 1,
      indexForwardAxis: 0,
      maxSpeedKmh: 40,
      wheels: [],
    },
    speedGovernorScale: 1,
    speedGovernorBrakeAssist: 0,
    speedGovernorOverHardCap: false,
    speedGovernorSmoothedForwardSpeedAbs: 0,
  }
}

function stepGovernor(
  state: PhysicsVehicleSpeedGovernorState,
  input: {
    brakeInput: number
    forwardSpeed: number
    throttleInput?: number
  },
) {
  return stepPhysicsVehicleSpeedGovernor(state, {
    steeringInput: 0,
    throttleInput: input.throttleInput ?? 0,
    brakeInput: input.brakeInput,
    handbrakeInput: 0,
    forwardSpeed: input.forwardSpeed,
    deltaSeconds: 1 / 60,
  })
}

describe('vehicle speed governor brakes', () => {
  it('keeps the full explicit brake force at rest and low speed', () => {
    const atRest = stepGovernor(createGovernorState(), {
      brakeInput: 1,
      forwardSpeed: 0,
    })
    const rollingSlowly = stepGovernor(createGovernorState(), {
      brakeInput: 1,
      forwardSpeed: 0.25,
    })

    expect(atRest.control.brakeForce).toBeGreaterThan(0)
    expect(rollingSlowly.control.brakeForce).toBeCloseTo(atRest.control.brakeForce, 6)
  })

  it('does not brake when neither brake nor handbrake is requested', () => {
    const result = stepGovernor(createGovernorState(), {
      brakeInput: 0,
      forwardSpeed: 0,
    })

    expect(result.control.brakeForce).toBe(0)
  })

  it('uses the strengthened engine force for acceleration', () => {
    const result = stepGovernor(createGovernorState(), {
      brakeInput: 0,
      forwardSpeed: 0,
      throttleInput: 1,
    })

    expect(result.control.engineForce).toBe(765)
  })

  it('still applies speed-governor brake assist above the hard speed cap', () => {
    const state = createGovernorState()
    let result = stepGovernor(state, {
      brakeInput: 0,
      forwardSpeed: 12,
      throttleInput: 1,
    })

    for (let index = 0; index < 120; index += 1) {
      result = stepGovernor(state, {
        brakeInput: 0,
        forwardSpeed: 12,
        throttleInput: 1,
      })
    }

    expect(state.speedGovernorBrakeAssist).toBeGreaterThan(0)
    expect(result.control.brakeForce).toBeGreaterThan(0)
  })
})
