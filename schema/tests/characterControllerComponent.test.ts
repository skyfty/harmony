import test from 'node:test'
import assert from 'node:assert/strict'
import type { SceneNode } from '../core.ts'
import { ANIMATION_COMPONENT_TYPE } from '../components/definitions/animationComponent.ts'
import { characterControllerComponentDefinition } from '../components/definitions/characterControllerComponent.ts'

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

test('defaults targetNodeId to the current node when it has animation', () => {
  const node = createNode('hero', {
    [ANIMATION_COMPONENT_TYPE]: { enabled: true },
  })

  const defaults = characterControllerComponentDefinition.createDefaultProps(node)

  assert.equal(defaults.targetNodeId, 'hero')
})

test('defaults targetNodeId to the first animated descendant when the current node has none', () => {
  const node = createNode('root', {}, [
    createNode('child-a'),
    createNode(
      'child-b',
      {
        [ANIMATION_COMPONENT_TYPE]: { enabled: true },
      },
      [
        createNode('grandchild', {
          [ANIMATION_COMPONENT_TYPE]: { enabled: true },
        }),
      ],
    ),
  ])

  const defaults = characterControllerComponentDefinition.createDefaultProps(node)

  assert.equal(defaults.targetNodeId, 'child-b')
})

test('keeps targetNodeId empty when no animation component exists in the subtree', () => {
  const node = createNode('root', {}, [
    createNode('child-a'),
    createNode('child-b', {}, [createNode('grandchild')]),
  ])

  const defaults = characterControllerComponentDefinition.createDefaultProps(node)

  assert.equal(defaults.targetNodeId, null)
})
