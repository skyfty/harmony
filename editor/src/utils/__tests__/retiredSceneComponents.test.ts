import { describe, expect, it } from 'vitest'

import type { SceneJsonExportDocument, SceneNode } from '@schema/core'
import { stripRetiredSceneComponents } from '@schema/sceneComponentCompatibility'

function createComponent(type: string, id: string) {
  return {
    id,
    type,
    enabled: true,
    props: {},
  }
}

function createDocument(nodes: SceneNode[]): SceneJsonExportDocument {
  return {
    id: 'scene',
    name: 'Scene',
    nodes,
  } as unknown as SceneJsonExportDocument
}

describe('retired scene components', () => {
  it('removes purePursuit from nested nodes while preserving active and unknown components', () => {
    const document = createDocument([
      {
        id: 'root',
        components: {
          futureSystem: createComponent('futureSystem', 'future-component'),
        },
        children: [
          {
            id: 'vehicle',
            components: {
              vehicle: createComponent('vehicle', 'vehicle-component'),
              purePursuit: createComponent('purePursuit', 'retired-component'),
              autoTour: createComponent('autoTour', 'tour-component'),
              rigidbody: createComponent('rigidbody', 'body-component'),
            },
          },
        ],
      } as unknown as SceneNode,
    ])

    const result = stripRetiredSceneComponents(document)

    expect(result).toEqual({
      removedCount: 1,
      removedTypes: ['purePursuit'],
    })
    expect(document.nodes[0]?.components?.futureSystem).toBeDefined()
    expect(document.nodes[0]?.children?.[0]?.components).toEqual({
      vehicle: createComponent('vehicle', 'vehicle-component'),
      autoTour: createComponent('autoTour', 'tour-component'),
      rigidbody: createComponent('rigidbody', 'body-component'),
    })
  })

  it('recognizes a retired state type under an unexpected component key', () => {
    const document = createDocument([
      {
        id: 'legacy',
        components: {
          legacyDrive: createComponent('purePursuit', 'retired-component'),
        },
      } as unknown as SceneNode,
    ])

    stripRetiredSceneComponents(document)

    expect(document.nodes[0]?.components).toBeUndefined()
  })
})
