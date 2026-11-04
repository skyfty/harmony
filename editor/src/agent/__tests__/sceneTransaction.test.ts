import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSceneStore } from '@/stores/sceneStore'

describe('Agent scene transactions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const store = useSceneStore()
    store.currentSceneId = 'agent-transaction-test'
    store.currentSceneMeta = {
      name: 'Agent transaction test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
  })

  it('commits a batch as one undo entry and one revision', async () => {
    const store = useSceneStore()
    const initialUndoCount = store.undoStack.length
    const initialRevision = store.sceneRevision
    await store.runAgentTransaction(() => {
      const first = new THREE.Group()
      first.name = 'Agent Group A'
      store.addSceneNode({ nodeType: 'Group', object: first, name: first.name })
      const second = new THREE.Group()
      second.name = 'Agent Group B'
      store.addSceneNode({ nodeType: 'Group', object: second, name: second.name })
    })
    expect(store.undoStack).toHaveLength(initialUndoCount + 1)
    expect(store.sceneRevision).toBe(initialRevision + 1)
    expect(store.getNodeById(store.nodes.find((node) => node.name === 'Agent Group A')?.id ?? ''))
      .toBeTruthy()
    vi.clearAllTimers()
  })

  it('rolls back content and history when a batch fails', async () => {
    const store = useSceneStore()
    const initialNodeCount = store.nodes.length
    const initialUndoCount = store.undoStack.length
    const initialRevision = store.sceneRevision

    await expect(store.runAgentTransaction(() => {
      const group = new THREE.Group()
      group.name = 'Rolled Back Group'
      store.addSceneNode({ nodeType: 'Group', object: group, name: group.name })
      throw new Error('forced failure')
    })).rejects.toThrow('forced failure')

    expect(store.nodes).toHaveLength(initialNodeCount)
    expect(store.nodes.some((node) => node.name === 'Rolled Back Group')).toBe(false)
    expect(store.undoStack).toHaveLength(initialUndoCount)
    expect(store.sceneRevision).toBe(initialRevision)
    vi.clearAllTimers()
  })

  it('persists an Agent camera update as one revision without altering scene nodes', () => {
    const store = useSceneStore()
    const initialNodeCount = store.nodes.length
    const initialRevision = store.sceneRevision
    const changed = store.setAgentCameraState({
      position: { x: 12, y: 8, z: 14 },
      target: { x: 1, y: 0, z: 2 },
      fov: 55,
    }, {
      projection: 'orthographic',
      controlMode: 'orbit',
    })
    expect(changed).toBe(true)
    expect(store.sceneRevision).toBe(initialRevision + 1)
    expect(store.nodes).toHaveLength(initialNodeCount)
    expect(store.camera).toMatchObject({
      position: { x: 12, y: 8, z: 14 },
      target: { x: 1, y: 0, z: 2 },
      fov: 55,
    })
    expect(store.viewportSettings.cameraProjection).toBe('orthographic')
    expect(store.viewportSettings.cameraControlMode).toBe('orbit')
    vi.clearAllTimers()
  })
})
