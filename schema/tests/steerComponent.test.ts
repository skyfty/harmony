import test from 'node:test'
import assert from 'node:assert/strict'
import type { SceneNode } from '../core.ts'
import {
  inferSteerTargetTypeFromNode,
  inferSteerTargetTypeFromNodeId,
  isAnySteerTargetNode,
  isSteerTargetNode,
} from '../components/definitions/steerComponent.ts'

type TestComponentState = {
  enabled?: boolean
}

function createNode(
  id: string,
  components: Record<string, TestComponentState | undefined> = {},
  children: SceneNode[] = [],
): SceneNode {
  return {
    id,
    name: id,
    nodeType: 'Group',
    children,
    components: components as SceneNode['components'],
  } as SceneNode
}

test('infers character targets before vehicle targets', () => {
  const node = createNode('hero', {
    vehicle: { enabled: true },
    characterController: { enabled: true },
  })

  assert.equal(inferSteerTargetTypeFromNode(node), 'character')
})

test('infers vehicle targets when only vehicle component is enabled', () => {
  const node = createNode('car', {
    vehicle: { enabled: true },
  })

  assert.equal(inferSteerTargetTypeFromNode(node), 'vehicle')
})

test('ignores disabled components and empty nodes', () => {
  const disabledVehicleNode = createNode('disabled-car', {
    vehicle: { enabled: false },
  })
  const emptyNode = createNode('empty')

  assert.equal(inferSteerTargetTypeFromNode(disabledVehicleNode), null)
  assert.equal(inferSteerTargetTypeFromNode(emptyNode), null)
  assert.equal(isAnySteerTargetNode(disabledVehicleNode), false)
  assert.equal(isSteerTargetNode(disabledVehicleNode, 'vehicle'), false)
})

test('resolves target type from node id within a hierarchy', () => {
  const nodes = [
    createNode('root', {}, [
      createNode('nested-character', {
        characterController: { enabled: true },
      }),
      createNode('nested-vehicle', {
        vehicle: { enabled: true },
      }),
    ]),
  ]

  assert.equal(inferSteerTargetTypeFromNodeId(nodes, 'nested-character'), 'character')
  assert.equal(inferSteerTargetTypeFromNodeId(nodes, 'nested-vehicle'), 'vehicle')
  assert.equal(inferSteerTargetTypeFromNodeId(nodes, 'missing'), null)
})
