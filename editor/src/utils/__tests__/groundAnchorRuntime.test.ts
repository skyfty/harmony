import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  collectGroundAnchorWorldPositions,
  collectGroundAnchorWorldTargets,
} from '@schema/groundAnchorRuntime'
import type { SceneJsonExportDocument, SceneNode } from '@schema/core'
import { GROUND_ANCHOR_COMPONENT_TYPE } from '@schema/components/definitions/groundAnchorComponent'

function createAnchorNode(id: string): SceneNode {
  return {
    id,
    name: id,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    children: [],
    components: {
      [GROUND_ANCHOR_COMPONENT_TYPE]: {
        id: `${id}-component`,
        type: GROUND_ANCHOR_COMPONENT_TYPE,
        enabled: true,
        props: { label: id },
      },
    },
  } as unknown as SceneNode
}

describe('ground anchor runtime collection', () => {
  it('merges authored and runtime-only anchors without duplicates', () => {
    const document = {
      id: 'scene',
      name: 'Scene',
      createdAt: '',
      updatedAt: '',
      nodes: [createAnchorNode('document-anchor')],
    } as unknown as SceneJsonExportDocument

    const sceneRoot = new THREE.Group()
    const documentObject = new THREE.Group()
    documentObject.userData.groundAnchor = true
    documentObject.userData.groundAnchorNodeId = 'document-anchor'
    documentObject.position.set(10, 0, 20)
    sceneRoot.add(documentObject)

    const runtimeObject = new THREE.Group()
    runtimeObject.userData.groundAnchor = true
    runtimeObject.userData.groundAnchorNodeId = 'runtime-anchor'
    runtimeObject.position.set(30, 0, 40)
    sceneRoot.add(runtimeObject)

    const hiddenObject = new THREE.Group()
    hiddenObject.userData.groundAnchor = true
    hiddenObject.position.set(100, 0, 100)
    hiddenObject.visible = false
    sceneRoot.add(hiddenObject)

    const params = {
      document,
      resolveObjectByNodeId: (nodeId: string) => (
        nodeId === 'document-anchor' ? documentObject : null
      ),
      runtimeRoots: sceneRoot,
    }
    const targets = collectGroundAnchorWorldTargets(params)

    expect(targets).toHaveLength(2)
    expect(targets.map((target) => target.source)).toEqual(['document', 'runtime'])
    expect(targets[0]?.position.toArray()).toEqual([10, 0, 20])
    expect(targets[1]?.position.toArray()).toEqual([30, 0, 40])
    expect(collectGroundAnchorWorldPositions(params)).toHaveLength(2)
  })

  it('keeps document-only collection backward compatible', () => {
    const document = {
      id: 'scene',
      name: 'Scene',
      createdAt: '',
      updatedAt: '',
      nodes: [createAnchorNode('document-anchor')],
    } as unknown as SceneJsonExportDocument
    const object = new THREE.Group()
    object.position.set(8, 0, -6)

    const positions = collectGroundAnchorWorldPositions({
      document,
      resolveObjectByNodeId: () => object,
    })

    expect(positions).toHaveLength(1)
    expect(positions[0]?.toArray()).toEqual([8, 0, -6])
  })
})
