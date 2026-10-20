import { describe, expect, it } from 'vitest'
import {
  VehicleDriveController,
  type VehicleDriveControllerBindings,
  type VehicleDriveControllerDeps,
  type VehicleDriveControlFlags,
  type VehicleDriveInputState,
} from '@schema/VehicleDriveController'

function createController(): {
  controller: VehicleDriveController
  input: VehicleDriveInputState
} {
  const inputFlags: VehicleDriveControlFlags = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
  }
  const input: VehicleDriveInputState = {
    throttle: 0,
    steering: 0,
    brake: 0,
  }
  const bindings = {
    state: {
      active: true,
      nodeId: 'vehicle',
      token: null,
      vehicle: null,
      steerableWheelIndices: [],
      wheelCount: 0,
      seatNodeId: null,
      sourceEvent: null,
    },
    inputFlags,
    input,
    uiOverride: { value: 'auto' },
    promptBusy: { value: false },
    exitBusy: { value: false },
    steeringKeyboardValue: { value: 0 },
  } as unknown as VehicleDriveControllerBindings

  return {
    controller: new VehicleDriveController(
      {} as VehicleDriveControllerDeps,
      bindings,
    ),
    input,
  }
}

describe('vehicle steering direction', () => {
  it('maps the left control to positive steering', () => {
    const { controller, input } = createController()

    controller.setControlFlag('left', true)

    expect(input.steering).toBeGreaterThan(0)
  })

  it('maps the right control to negative steering', () => {
    const { controller, input } = createController()

    controller.setControlFlag('right', true)

    expect(input.steering).toBeLessThan(0)
  })
})
