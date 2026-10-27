import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { PhysicsContactEvent } from '@harmony/physics-core'
import type { SceneNode } from '@schema/core'
import {
  ANIMATION_COMPONENT_TYPE,
  clampAnimationComponentProps,
} from '@schema/components/definitions/animationComponent'
import {
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  clampCharacterControllerComponentProps,
} from '@schema/components/definitions/characterControllerComponent'
import {
  CharacterControllerAnimationRuntimeManager,
  type CharacterControllerAnimationInputState,
  type CharacterControllerMotorGroundState,
} from '@schema/characterControllerAnimationRuntime'
import { SceneAnimationRuntimeManager } from '@schema/sceneAnimationRuntime'

function createNode(
  id: string,
  components: NonNullable<SceneNode['components']>,
): SceneNode {
  return {
    id,
    name: id,
    nodeType: 'Group',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    components,
  }
}

function createAnimationRuntime(): SceneAnimationRuntimeManager {
  const root = new THREE.Group()
  const bone = new THREE.Object3D()
  bone.name = 'bone'
  root.add(bone)
  Object.assign(root, {
    animations: [
      new THREE.AnimationClip('Idol', 1, [
        new THREE.NumberKeyframeTrack('bone.position[x]', [0, 1], [0, 1]),
      ]),
      new THREE.AnimationClip('Walk', 1, [
        new THREE.NumberKeyframeTrack('bone.position[y]', [0, 1], [0, 1]),
      ]),
      new THREE.AnimationClip('Run', 2, [
        new THREE.NumberKeyframeTrack('bone.position[z]', [0, 2], [0, 2]),
      ]),
    ],
  })

  const runtime = new SceneAnimationRuntimeManager()
  runtime.sync({
    nodeId: 'animation',
    sourceNodeId: 'animation',
    runtimeObject: root,
    defaultClipName: 'Idol',
    autoplay: true,
    loop: true,
    timeScale: 1,
  })
  return runtime
}

function createCharacterMotorState(grounded: boolean): CharacterControllerMotorGroundState {
  return {
    grounded,
    groundNormal: grounded ? [0, 1, 0] : null,
    linearVelocity: [0, 0, 0],
  }
}

describe('CharacterControllerAnimationRuntimeManager', () => {
  it('plays locomotion when the physics motor is grounded by probe without contacts', () => {
    const nodeAnimationRuntime = createAnimationRuntime()
    const controllerNode = createNode('controller', {
      [CHARACTER_CONTROLLER_COMPONENT_TYPE]: {
        id: 'controller-component',
        type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
        enabled: true,
        props: clampCharacterControllerComponentProps({
          targetNodeId: 'animation',
          animationBindings: [
            { slot: 'idle', clipName: 'Idol' },
            { slot: 'walk', clipName: 'Walk' },
          ],
        }),
      },
    })
    const animationNode = createNode('animation', {
      [ANIMATION_COMPONENT_TYPE]: {
        id: 'animation-component',
        type: ANIMATION_COMPONENT_TYPE,
        enabled: true,
        props: clampAnimationComponentProps({ defaultClipName: 'Idol' }),
      },
    })
    const nodes = new Map([
      [controllerNode.id, controllerNode],
      [animationNode.id, animationNode],
    ])
    const motorState = createCharacterMotorState(true)
    const runtime = new CharacterControllerAnimationRuntimeManager()
    const host = {
      nodeAnimationRuntime,
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      resolveInput: () => ({
        moveX: 0,
        moveZ: 0.5,
        turn: 0,
        jump: false,
        crouch: false,
        interact: false,
      }),
      resolveGroundContacts: () => [],
      resolveCharacterMotorState: () => motorState,
    }

    runtime.refresh(host)
    runtime.update(host, 1000)

    expect(nodeAnimationRuntime.get('animation')?.activeClipName).toBe('Walk')
  })

  it('uses contact-based grounding when a frame has no character motor state', () => {
    const nodeAnimationRuntime = createAnimationRuntime()
    const controllerNode = createNode('controller', {
      [CHARACTER_CONTROLLER_COMPONENT_TYPE]: {
        id: 'controller-component',
        type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
        enabled: true,
        props: clampCharacterControllerComponentProps({
          targetNodeId: 'animation',
          animationBindings: [
            { slot: 'idle', clipName: 'Idol' },
            { slot: 'walk', clipName: 'Walk' },
          ],
        }),
      },
    })
    const animationNode = createNode('animation', {
      [ANIMATION_COMPONENT_TYPE]: {
        id: 'animation-component',
        type: ANIMATION_COMPONENT_TYPE,
        enabled: true,
        props: clampAnimationComponentProps({ defaultClipName: 'Idol' }),
      },
    })
    const nodes = new Map([
      [controllerNode.id, controllerNode],
      [animationNode.id, animationNode],
    ])
    const runtime = new CharacterControllerAnimationRuntimeManager()
    const contacts: PhysicsContactEvent[] = [{
      bodyIdA: 2,
      bodyIdB: 1,
      normal: [0, 1, 0],
      point: [0, 0, 0],
    }]
    const host = {
      nodeAnimationRuntime,
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      resolveInput: () => ({
        moveX: 0,
        moveZ: 0.5,
        turn: 0,
        jump: false,
        crouch: false,
        interact: false,
      }),
      resolveGroundContacts: () => contacts,
    }

    runtime.refresh(host)
    runtime.update(host, 1000)

    expect(nodeAnimationRuntime.get('animation')?.activeClipName).toBe('Walk')
  })

  it('uses explicit gait, preserves locomotion phase and warps animation speed', () => {
    const nodeAnimationRuntime = createAnimationRuntime()
    const controllerNode = createNode('controller', {
      [CHARACTER_CONTROLLER_COMPONENT_TYPE]: {
        id: 'controller-component',
        type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
        enabled: true,
        props: clampCharacterControllerComponentProps({
          targetNodeId: 'animation',
          animationBindings: [
            { slot: 'idle', clipName: 'Idol' },
            { slot: 'walk', clipName: 'Walk' },
            { slot: 'run', clipName: 'Run' },
          ],
        }),
      },
    })
    const animationNode = createNode('animation', {
      [ANIMATION_COMPONENT_TYPE]: {
        id: 'animation-component',
        type: ANIMATION_COMPONENT_TYPE,
        enabled: true,
        props: clampAnimationComponentProps({ defaultClipName: 'Idol' }),
      },
    })
    const nodes = new Map([
      [controllerNode.id, controllerNode],
      [animationNode.id, animationNode],
    ])
    const motorState = createCharacterMotorState(true)
    let input: CharacterControllerAnimationInputState = {
      moveX: 0,
      moveZ: 1,
      turn: 0,
      jump: false,
      gait: 'walk',
      crouch: false,
      interact: false,
    }
    const runtime = new CharacterControllerAnimationRuntimeManager()
    const host = {
      nodeAnimationRuntime,
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      resolveInput: () => input,
      resolveGroundContacts: () => [],
      resolveCharacterMotorState: () => motorState,
    }

    runtime.refresh(host)
    runtime.update(host, 1000)
    nodeAnimationRuntime.update(0.3)
    expect(nodeAnimationRuntime.get('animation')?.activeClipName).toBe('Walk')

    input = { ...input, gait: 'run' }
    motorState.linearVelocity = [0, 0, 5.2]
    runtime.update(host, 1100)
    const running = nodeAnimationRuntime.get('animation')
    expect(running?.activeClipName).toBe('Run')
    expect(running?.activeAction?.time).toBeCloseTo(0.6, 2)
    expect(running?.activeAction?.timeScale).toBeCloseTo(1, 2)

    motorState.linearVelocity = [0, 0, 2.6]
    runtime.update(host, 1200)
    const slowRunning = nodeAnimationRuntime.get('animation')
    expect(slowRunning?.activeClipName).toBe('Run')
    expect(slowRunning?.activeAction?.timeScale).toBeCloseTo(0.65, 2)
  })
})
