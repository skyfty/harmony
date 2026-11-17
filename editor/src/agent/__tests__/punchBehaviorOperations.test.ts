import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BehaviorComponentProps, SceneNodeComponentState } from '@schema/core'
import { applySceneOperations } from '@/agent/operations'
import { useSceneStore } from '@/stores/sceneStore'

function createTestNode(
  store: ReturnType<typeof useSceneStore>,
  name: string,
) {
  const object = new THREE.Group()
  object.name = name
  return store.addSceneNode({
    nodeType: 'Group',
    object,
    name,
  })
}

function createPunchBehaviors(celebrationEffectId?: string) {
  return [{
    id: 'punch-step',
    name: 'Palace check-in',
    action: 'click',
    sequenceId: 'punch-sequence',
    script: {
      type: 'punch',
      params: celebrationEffectId === undefined
        ? {}
        : {
            celebrationEffectId,
            celebrationOnlyFirst: false,
          },
    },
  }]
}

describe('Punch behavior Agent operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const store = useSceneStore()
    store.currentSceneId = 'agent-punch-test'
    store.currentSceneMeta = {
      name: 'Agent punch test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
  })

  it('normalizes legacy Punch parameters through the semantic behavior operation', async () => {
    const store = useSceneStore()
    const node = createTestNode(store, 'Punch behavior test node')
    const flushSpy = vi.spyOn(store, 'flushPendingSceneAutoSave').mockResolvedValue(null)
    const beforeRevision = store.sceneRevision

    const result = await applySceneOperations(store, {
      expectedRevision: beforeRevision,
      label: 'Configure punch celebration',
      operations: [{
        op: 'domain.apply',
        domain: 'behavior',
        action: 'replace',
        args: {
          nodeId: node.id,
          behaviors: createPunchBehaviors(),
        },
      }],
    })

    const updated = store.getNodeById(node.id)
    const behavior = updated?.components?.behavior as
      | SceneNodeComponentState<BehaviorComponentProps>
      | undefined
    expect(result.afterRevision).toBe(beforeRevision + 1)
    expect(behavior?.props.behaviors[0]?.script).toEqual({
      type: 'punch',
      params: {
        celebrationEffectId: 'confettiBurst',
        celebrationOnlyFirst: true,
      },
    })
    expect(flushSpy).toHaveBeenCalledOnce()
    vi.clearAllTimers()
  })

  it('rejects an unknown Punch celebration without changing the scene revision', async () => {
    const store = useSceneStore()
    const node = createTestNode(store, 'Invalid punch behavior test node')
    const revision = store.sceneRevision

    await expect(applySceneOperations(store, {
      expectedRevision: revision,
      operations: [{
        op: 'domain.apply',
        domain: 'behavior',
        action: 'replace',
        args: {
          nodeId: node.id,
          behaviors: createPunchBehaviors('unknownEffect'),
        },
      }],
    })).rejects.toThrow('Punch celebrationEffectId')
    expect(store.sceneRevision).toBe(revision)
    vi.clearAllTimers()
  })
})
