import { describe, expect, it } from 'vitest'

import {
  createPhysicsCharacterMotorState,
  stepPhysicsCharacterMotor,
  type PhysicsCharacterDesc,
  type PhysicsCharacterGait,
} from '@harmony/physics-core'
import {
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  clampCharacterControllerComponentProps,
  type CharacterControllerComponentProps,
} from '@schema/components'
import type { SceneNode, SceneNodeComponentMap } from '@schema/core'
import {
  resolveCharacterControlLocomotionSlot,
  resolveCharacterControlSpeed,
  resolveKeyboardCharacterGait,
} from '@schema/characterControlRuntime'
import { normalizeNodeComponents } from '@/stores/normalizeNodeComponentsUtils'

const characterDesc: PhysicsCharacterDesc = {
  characterId: 1,
  bodyId: 1,
  radius: 0.35,
  height: 1.7,
  stepHeight: 0.3,
  slopeLimitDegrees: 50,
  jumpImpulse: 6.5,
  airControl: 0.35,
  walkSpeed: 2.4,
  runSpeed: 5.2,
}

const characterProps = clampCharacterControllerComponentProps({
  walkSpeed: 2.4,
  runSpeed: 5.2,
})
type LegacyCharacterControllerProps = Partial<CharacterControllerComponentProps> & {
  sprintSpeed?: number
}

function simulateHorizontalSpeed(gait: PhysicsCharacterGait, magnitude = 1): number {
  const state = createPhysicsCharacterMotorState(0)
  for (let index = 0; index < 180; index += 1) {
    stepPhysicsCharacterMotor(characterDesc, state, {
      moveX: 0,
      moveZ: magnitude,
      yaw: 0,
      jump: false,
      gait,
      crouch: false,
      deltaSeconds: 1 / 60,
      gravityY: -9.8,
      probe: {
        hit: true,
        distance: 0,
        normalY: 1,
        normal: [0, 1, 0],
      },
      contactNormalY: 1,
      contactNormal: [0, 1, 0],
    })
  }
  return Math.hypot(state.horizontalVelocityX, state.horizontalVelocityZ)
}

describe('character locomotion runtime', () => {
  it('maps keyboard movement to walk and run', () => {
    expect(resolveKeyboardCharacterGait({ moving: true })).toBe('walk')
    expect(resolveKeyboardCharacterGait({ moving: true, runHeld: true })).toBe('run')
    expect(resolveKeyboardCharacterGait({ moving: false, runHeld: true })).toBe('analog')
  })

  it('uses exact speeds for explicit gait and a continuous analog curve', () => {
    expect(resolveCharacterControlSpeed(characterProps, 1, { gait: 'walk' })).toBe(2.4)
    expect(resolveCharacterControlSpeed(characterProps, 1, { gait: 'run' })).toBe(5.2)
    expect(resolveCharacterControlSpeed(characterProps, 0.25)).toBeCloseTo(1.2, 5)
    expect(resolveCharacterControlSpeed(characterProps, 0.5)).toBeCloseTo(2.4, 5)
    expect(resolveCharacterControlSpeed(characterProps, 1)).toBeCloseTo(5.2, 5)
  })

  it('accelerates the physics motor to each selected gait speed', () => {
    expect(simulateHorizontalSpeed('walk')).toBeCloseTo(2.4, 1)
    expect(simulateHorizontalSpeed('run')).toBeCloseTo(5.2, 1)
    expect(simulateHorizontalSpeed('analog', 0.25)).toBeCloseTo(1.2, 1)
  })

  it('applies hysteresis around the analog walk/run threshold', () => {
    expect(resolveCharacterControlLocomotionSlot(0.52)).toBe('walk')
    expect(resolveCharacterControlLocomotionSlot(0.53)).toBe('run')
    expect(resolveCharacterControlLocomotionSlot(0.48, {
      previousLocomotionSlot: 'run',
    })).toBe('run')
    expect(resolveCharacterControlLocomotionSlot(0.46, {
      previousLocomotionSlot: 'run',
    })).toBe('walk')
    expect(resolveCharacterControlLocomotionSlot(1)).toBe('run')
  })

  it('migrates only the exact legacy default speed tuple', () => {
    const legacy = clampCharacterControllerComponentProps({
      walkSpeed: 2.4,
      runSpeed: 4.8,
      sprintSpeed: 6.4,
    } as LegacyCharacterControllerProps)
    expect(legacy.walkSpeed).toBe(2.4)
    expect(legacy.runSpeed).toBe(5.2)
    expect('sprintSpeed' in legacy).toBe(false)

    const intermediate = clampCharacterControllerComponentProps({
      walkSpeed: 1.4,
      runSpeed: 3.6,
      sprintSpeed: 6.4,
    } as LegacyCharacterControllerProps)
    expect(intermediate.walkSpeed).toBe(2.4)
    expect(intermediate.runSpeed).toBe(5.2)

    const custom = clampCharacterControllerComponentProps({
      walkSpeed: 2.4,
      runSpeed: 4.9,
      sprintSpeed: 6.4,
    } as LegacyCharacterControllerProps)
    expect(custom.walkSpeed).toBe(2.4)
    expect(custom.runSpeed).toBe(4.9)

    const node: SceneNode = {
      id: 'character',
      name: 'Character',
      nodeType: 'Group',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      components: {},
    }
    const normalized = normalizeNodeComponents(node, {
      [CHARACTER_CONTROLLER_COMPONENT_TYPE]: {
        id: 'character-controller',
        type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
        enabled: true,
        props: {
          walkSpeed: 2.4,
          runSpeed: 4.8,
          sprintSpeed: 6.4,
        },
      },
    } as SceneNodeComponentMap)
    expect(normalized?.[CHARACTER_CONTROLLER_COMPONENT_TYPE]?.props?.walkSpeed).toBe(2.4)
    expect(normalized?.[CHARACTER_CONTROLLER_COMPONENT_TYPE]?.props?.runSpeed).toBe(5.2)
  })

  it('keeps character component type compatibility', () => {
    const state: CharacterControllerComponentProps = clampCharacterControllerComponentProps({
      type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
    } as Partial<CharacterControllerComponentProps>)
    expect(state.walkSpeed).toBe(2.4)
    expect(state.runSpeed).toBe(5.2)
  })
})
