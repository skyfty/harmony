import { describe, expect, it } from 'vitest'

import {
  PhysicsSceneAssetBuildAbortedError,
  buildPhysicsSceneAsset,
} from '@schema/physicsSceneAsset'
import { ComponentManager } from '@schema/components/componentManager'

function createNode(index: number) {
  return {
    id: `node-${index}`,
    name: `Node ${index}`,
    nodeType: 'Node',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    components: {},
    children: [],
  }
}

function createDocument(nodeCount: number) {
  return {
    id: 'cooperative-test',
    name: 'Cooperative test',
    nodes: Array.from({ length: nodeCount }, (_value, index) => createNode(index)),
  } as any
}

describe('buildPhysicsSceneAsset cooperative scheduling', () => {
  it('yields by elapsed time while visiting nodes', async () => {
    let nowMs = 0
    let yieldCount = 0
    const asset = await buildPhysicsSceneAsset(createDocument(6), {
      now: () => {
        nowMs += 4
        return nowMs
      },
      timeBudgetMs: 8,
      yieldToMainThread: async () => {
        yieldCount += 1
      },
    })

    expect(asset.bodies).toHaveLength(0)
    expect(yieldCount).toBeGreaterThanOrEqual(2)
  })

  it('aborts cooperative asset construction after a scene switch', async () => {
    let aborted = false
    const promise = buildPhysicsSceneAsset(createDocument(6), {
      now: () => 0,
      timeBudgetMs: 0,
      shouldAbort: () => aborted,
      yieldToMainThread: async () => {
        aborted = true
      },
    })

    await expect(promise).rejects.toBeInstanceOf(PhysicsSceneAssetBuildAbortedError)
  })
})

describe('ComponentManager cooperative scene sync', () => {
  it('yields while syncing scene nodes', async () => {
    let nowMs = 0
    let yieldCount = 0
    const manager = new ComponentManager()

    await manager.syncSceneCooperatively(createDocument(6).nodes, {
      now: () => {
        nowMs += 4
        return nowMs
      },
      timeBudgetMs: 8,
      yieldToMainThread: async () => {
        yieldCount += 1
      },
    })

    expect(yieldCount).toBeGreaterThanOrEqual(2)
  })

  it('stops syncing when the scene initialization token changes', async () => {
    let aborted = false
    const manager = new ComponentManager()
    const promise = manager.syncSceneCooperatively(createDocument(6).nodes, {
      now: () => 0,
      timeBudgetMs: 0,
      shouldAbort: () => aborted,
      yieldToMainThread: async () => {
        aborted = true
      },
    })

    await expect(promise).rejects.toBeInstanceOf(PhysicsSceneAssetBuildAbortedError)
  })
})
