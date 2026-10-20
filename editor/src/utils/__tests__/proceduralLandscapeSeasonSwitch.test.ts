import { describe, expect, it } from 'vitest'
import type { SceneNode } from '@schema/core'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'
import type { ProceduralLandscapeRuntimeStats } from '@schema/proceduralLandscape/runtime'
import {
  preloadProceduralLandscapeSeasonAssets,
  waitForProceduralLandscapeSeasonApplied,
  withProceduralLandscapeSeasonPreloadTimeout,
} from '@schema/proceduralLandscape/seasonSwitch'

function createStats(
  season: 'spring' | 'summer' | 'autumn' | 'winter',
  seasonAssetsReady: boolean,
): ProceduralLandscapeRuntimeStats {
  return {
    season,
    seasonAssetsReady,
  } as ProceduralLandscapeRuntimeStats
}

describe('procedural landscape season switch readiness', () => {
  it('reports missing core season textures before applying a switch', async () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    const node = {
      id: 'terrain',
      name: 'terrain',
      nodeType: 'Mesh',
      visible: true,
      children: [],
      components: {
        proceduralLandscape: {
          id: 'terrain-landscape',
          type: 'proceduralLandscape',
          enabled: true,
          props,
        },
      },
    } as unknown as SceneNode
    const progress: number[] = []
    const result = await preloadProceduralLandscapeSeasonAssets([node], 'winter', {
      assetStore: {
        textureSet: async (refs: unknown[], onProgress?: (loaded: number, total: number) => void) => {
          onProgress?.(refs.length, refs.length)
          return new Map()
        },
      } as never,
      onProgress: ({ loaded }) => progress.push(loaded),
    })

    expect(result.refs.length).toBeGreaterThan(0)
    expect(result.coreMissingIds.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toBe(result.refs.length)
  })

  it('waits until every landscape is on the target season with core textures bound', async () => {
    let attempts = 0
    const statsByNode = new Map<string, ProceduralLandscapeRuntimeStats>()
    const result = await waitForProceduralLandscapeSeasonApplied({
      nodeIds: ['a', 'b'],
      season: 'winter',
      getStats: (nodeId) => statsByNode.get(nodeId) ?? null,
      timeoutMs: 1000,
      pollIntervalMs: 1,
      now: () => attempts,
      sleep: async () => {
        attempts += 1
        if (attempts >= 2) {
          statsByNode.set('a', createStats('winter', true))
          statsByNode.set('b', createStats('winter', true))
        }
      },
    })

    expect(result.status).toBe('ready')
    expect(result.pendingNodeIds).toEqual([])
    expect(attempts).toBe(2)
  })

  it('reports unfinished nodes on timeout', async () => {
    let now = 0
    const result = await waitForProceduralLandscapeSeasonApplied({
      nodeIds: ['a'],
      season: 'autumn',
      getStats: () => createStats('spring', true),
      timeoutMs: 100,
      pollIntervalMs: 10,
      now: () => now,
      sleep: async () => {
        now += 100
      },
    })

    expect(result.status).toBe('timeout')
    expect(result.pendingNodeIds).toEqual(['a'])
  })

  it('aborts immediately when the scene changes', async () => {
    const result = await waitForProceduralLandscapeSeasonApplied({
      nodeIds: ['a'],
      season: 'summer',
      getStats: () => null,
      shouldAbort: () => true,
    })

    expect(result.status).toBe('aborted')
    expect(result.pendingNodeIds).toEqual(['a'])
  })

  it('cancels a stalled season preload without leaving the transition pending', async () => {
    await expect(
      withProceduralLandscapeSeasonPreloadTimeout(new Promise(() => {}), 10),
    ).rejects.toThrow('季节资源预载超时')
  })
})
