import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SceneNode } from '@schema/core'
import {
  createWallComponentState,
  resolveWallComponentPropsFromMesh,
} from '@schema/components'
import { buildWallDynamicMeshFromWorldSegments } from '@/stores/wallUtils'
import { useSceneStore } from '@/stores/sceneStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('wall corner texture updates', () => {
  it('commits a corner texture asset change through the scene store', () => {
    const built = buildWallDynamicMeshFromWorldSegments(
      [
        { start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 0, z: 0 } },
        { start: { x: 5, y: 0, z: 0 }, end: { x: 5, y: 0, z: 5 } },
      ],
      { height: 3, width: 0.2, thickness: 0.2 },
    )
    if (!built) {
      throw new Error('Failed to build wall fixture')
    }

    const node = {
      id: 'wall-corner-update',
      name: 'Wall',
      nodeType: 'Mesh',
      position: { x: built.center.x, y: built.center.y, z: built.center.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      dynamicMesh: built.definition,
    } as SceneNode
    const base = resolveWallComponentPropsFromMesh(built.definition)
    const component = createWallComponentState(
      node,
      {
        ...base,
        wallRenderMode: 'texture',
        cornerModels: [{
          bodyAssetId: null,
          headAssetId: null,
          footAssetId: null,
          bodyTextureAssetId: null,
          headTextureAssetId: null,
          footTextureAssetId: null,
          bodyOffsetLocal: { x: 0, y: 0, z: 0 },
          headOffsetLocal: { x: 0, y: 0, z: 0 },
          footOffsetLocal: { x: 0, y: 0, z: 0 },
          bodyForwardAxis: '+z',
          bodyYawDeg: 0,
          headForwardAxis: '+z',
          headYawDeg: 0,
          footForwardAxis: '+z',
          footYawDeg: 0,
          angle: 90,
          tolerance: 5,
          jointTrim: { start: 0, end: 0 },
        }],
      },
      { id: 'wall-component' },
    )
    node.components = { wall: component }

    const store = useSceneStore()
    store.nodes = [node]
    store.selectedNodeIds = [node.id]
    store.selectedNodeId = node.id

    const changed = store.updateNodeComponentProps(node.id, component.id, {
      cornerModels: [{
        ...component.props.cornerModels[0]!,
        bodyTextureAssetId: 'a.png',
      }],
    })

    expect(changed).toBe(true)
    const updated = store.getNodeById(node.id)
      ?.components?.wall as typeof component | undefined
    expect(updated?.props.cornerModels[0]?.bodyTextureAssetId).toBe('a.png')
  })
})
