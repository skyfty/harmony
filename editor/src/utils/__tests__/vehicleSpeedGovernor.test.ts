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

  it('normalizes engine force against chassis mass for acceleration', () => {
    const result = stepGovernor(createGovernorState(), {
      brakeInput: 0,
      forwardSpeed: 0,
      throttleInput: 1,
    })

    // The default rigidbody mass is 1400 kg. Two driven wheels must produce
    // the configured target acceleration instead of a fixed per-wheel force.
    expect(result.control.engineForce * 2 / 1400).toBeCloseTo(5.5, 5)
  })

  it('keeps acceleration stable when the chassis mass changes', () => {
    const lightState = createGovernorState()
    lightState.desc.mass = 150
    const heavyState = createGovernorState()
    heavyState.desc.mass = 1400

    const lightResult = stepGovernor(lightState, {
      brakeInput: 0,
      forwardSpeed: 0,
      throttleInput: 1,
    })
    const heavyResult = stepGovernor(heavyState, {
      brakeInput: 0,
      forwardSpeed: 0,
      throttleInput: 1,
    })

    expect(lightResult.control.engineForce * 2 / 150).toBeCloseTo(5.5, 5)
    expect(heavyResult.control.engineForce * 2 / 1400).toBeCloseTo(5.5, 5)
  })

  it('still lets authored engine tuning increase acceleration', () => {
    const state = createGovernorState()
    state.desc.engineForceMax = 680
    const result = stepGovernor(state, {
      brakeInput: 0,
      forwardSpeed: 0,
      throttleInput: 1,
    })

    expect(result.control.engineForce * 2 / 1400).toBeCloseTo(9, 5)
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
