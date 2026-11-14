import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { SceneNode } from '@schema/core'
import { Component, type ComponentRuntimeContext } from '@schema/components/Component'
import { ComponentManager } from '@schema/components/componentManager'

class AttachCountingComponent extends Component {
  static attachedCount = 0

  constructor(context: ComponentRuntimeContext) {
    super(context)
  }

  onRuntimeAttached(): void {
    AttachCountingComponent.attachedCount += 1
  }
}

function createNode(): SceneNode {
  return {
    id: 'runtime-attach-node',
    name: 'Runtime Attach Node',
    nodeType: 'Group',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    children: [],
    components: {
      behavior: {
        id: 'runtime-attach-component',
        type: 'behavior',
        enabled: true,
        props: {},
      },
    },
  }
}

describe('ComponentManager.ensureRuntimeAttached', () => {
  it('reuses component runtime resources while the object identity is unchanged', () => {
    AttachCountingComponent.attachedCount = 0
    const manager = new ComponentManager()
    manager.registerDefinition({
      type: 'behavior',
      label: 'Runtime attach test',
      canAttach: () => true,
      createDefaultProps: () => ({}),
      createInstance: (context) => new AttachCountingComponent(context),
    })
    const node = createNode()
    const object = new THREE.Group()

    manager.syncNode(node)
    manager.ensureRuntimeAttached(node, object)
    manager.ensureRuntimeAttached(node, object)

    expect(AttachCountingComponent.attachedCount).toBe(2)

    manager.ensureRuntimeAttached(node, new THREE.Group())
    expect(AttachCountingComponent.attachedCount).toBe(3)
  })
})
