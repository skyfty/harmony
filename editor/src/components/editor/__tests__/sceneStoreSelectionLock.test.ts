import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SceneNode } from '@schema/core'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components'
import { useSceneStore } from '@/stores/sceneStore'

const terrainNode = {
  id: 'terrain-1',
  name: 'Terrain',
  nodeType: 'Group',
  locked: false,
  components: {
    [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
      id: 'landscape-component',
      type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
      enabled: true,
      props: {},
    },
  },
} as unknown as SceneNode

beforeEach(() => {
  setActivePinia(createPinia())
})

function makeStore() {
  const store = useSceneStore()
  store.nodes = [terrainNode]
  store.selectedNodeIds = [terrainNode.id]
  store.selectedNodeId = terrainNode.id
  return store
}

describe('scene store selection locking', () => {
  it('clears a selected node by default when locking it', () => {
    const store = makeStore()
    store.setNodeSelectionLock(terrainNode.id, true)
    expect(store.selectedNodeIds).toEqual([])
    expect(store.selectedNodeId).toBeNull()
  })

  it('preserves the active landscape road selection when requested', () => {
    const store = makeStore()
    store.setNodeSelectionLock(terrainNode.id, true, { preserveSelection: true })
    expect(store.isNodeSelectionLocked(terrainNode.id)).toBe(true)
    expect(store.selectedNodeIds).toEqual([terrainNode.id])
    expect(store.selectedNodeId).toBe(terrainNode.id)
  })
})
