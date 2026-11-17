import { describe, expect, it } from 'vitest'

import type { SceneNode } from '@schema/core'
import { resolveDefaultSteerBindingFromNodes } from '@schema/steerBindingIndex'

function createSteerNode(params: {
  id: string
  targetNodeId: string
  targetType: 'vehicle' | 'character'
  defaultIdentifier?: string | null
  autoEnterOnSceneLoad?: boolean
}): SceneNode {
  return {
    id: params.id,
    name: params.id,
    nodeType: 'Empty',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    components: {
      steer: {
        id: `${params.id}-steer`,
        type: 'steer',
        enabled: true,
        props: {
          targetNodeId: params.targetNodeId,
          targetType: params.targetType,
          defaultIdentifier: params.defaultIdentifier ?? null,
          autoEnterOnSceneLoad: params.autoEnterOnSceneLoad !== false,
        },
      },
    },
  } as SceneNode
}

describe('default steer binding selection', () => {
  it('falls back to the scene actor kind when the requested kind is absent', () => {
    const binding = resolveDefaultSteerBindingFromNodes([
      createSteerNode({
        id: 'vehicle-steer',
        targetNodeId: 'vehicle-actor',
        targetType: 'vehicle',
      }),
    ], '男人', 'character')

    expect(binding?.steerNodeId).toBe('vehicle-steer')
    expect(binding?.steerProps.targetType).toBe('vehicle')
  })

  it('prefers the requested actor kind over an identifier match of another kind', () => {
    const binding = resolveDefaultSteerBindingFromNodes([
      createSteerNode({
        id: 'vehicle-steer',
        targetNodeId: 'vehicle-actor',
        targetType: 'vehicle',
        defaultIdentifier: '男人',
      }),
      createSteerNode({
        id: 'character-steer',
        targetNodeId: 'character-actor',
        targetType: 'character',
        defaultIdentifier: '另一个角色',
      }),
    ], '男人', 'character')

    expect(binding?.steerNodeId).toBe('character-steer')
  })

  it('prefers an exact identifier within the requested actor kind', () => {
    const binding = resolveDefaultSteerBindingFromNodes([
      createSteerNode({
        id: 'default-character-steer',
        targetNodeId: 'default-character',
        targetType: 'character',
        defaultIdentifier: '默认角色',
      }),
      createSteerNode({
        id: 'requested-character-steer',
        targetNodeId: 'requested-character',
        targetType: 'character',
        defaultIdentifier: '男人',
      }),
    ], '男人', 'character')

    expect(binding?.steerNodeId).toBe('requested-character-steer')
  })

  it('ignores bindings that do not auto-enter or have no target', () => {
    const binding = resolveDefaultSteerBindingFromNodes([
      createSteerNode({
        id: 'manual-steer',
        targetNodeId: 'character-actor',
        targetType: 'character',
        autoEnterOnSceneLoad: false,
      }),
      createSteerNode({
        id: 'missing-target-steer',
        targetNodeId: '   ',
        targetType: 'character',
      }),
    ], '男人', 'character')

    expect(binding).toBeNull()
  })
})
