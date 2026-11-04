import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applySceneOperations } from '@/agent/operations'
import { useSceneStore } from '@/stores/sceneStore'

describe('Agent primitive operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const store = useSceneStore()
    store.currentSceneId = 'agent-primitive-test'
    store.currentSceneMeta = {
      name: 'Agent primitive test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
  })

  it('creates a Box primitive in one revision and one undo entry', async () => {
    const store = useSceneStore()
    const flushSpy = vi
      .spyOn(store, 'flushPendingSceneAutoSave')
      .mockResolvedValue(null)
    const initialRevision = store.sceneRevision
    const initialUndoCount = store.undoStack.length

    const result = await applySceneOperations(store, {
      expectedRevision: initialRevision,
      label: 'Create test box',
      operations: [
        {
          op: 'node.create',
          nodeType: 'Box',
          name: 'Agent test box',
          world: {
            position: { x: 2, y: 0, z: 3 },
          },
        },
      ],
    })

    const node = store.nodes.find((candidate) => candidate.name === 'Agent test box')
    expect(node?.nodeType).toBe('Box')
    expect(node?.position.x).toBeCloseTo(2)
    expect(node?.position.y).toBeCloseTo(0.5)
    expect(node?.position.z).toBeCloseTo(3)
    expect(result.beforeRevision).toBe(initialRevision)
    expect(result.afterRevision).toBe(initialRevision + 1)
    expect(store.undoStack).toHaveLength(initialUndoCount + 1)
    expect(flushSpy).toHaveBeenCalledOnce()
    vi.clearAllTimers()
  })
})
