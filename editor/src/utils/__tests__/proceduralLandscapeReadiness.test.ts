import { describe, expect, it } from 'vitest'
import type { ProceduralLandscapeRuntimeStats } from '@schema/proceduralLandscape/runtime'
import {
  resolveProceduralLandscapeSceneNodeReadiness,
  waitForProceduralLandscapeSceneReady,
} from '@schema/proceduralLandscape/readiness'

function makeStats(
  overrides: Partial<ProceduralLandscapeRuntimeStats> = {},
): ProceduralLandscapeRuntimeStats {
  return {
    phase: 'streaming',
    demStatus: 'ready',
    seasonAssetsReady: true,
    progress: 1,
    ...overrides,
  } as ProceduralLandscapeRuntimeStats
}

describe('procedural landscape scene readiness', () => {
  it('requires DEM, initial world and season materials', () => {
    expect(resolveProceduralLandscapeSceneNodeReadiness(null).status).toBe('missing-runtime')
    expect(resolveProceduralLandscapeSceneNodeReadiness(makeStats()).ready).toBe(true)
    expect(resolveProceduralLandscapeSceneNodeReadiness(
      makeStats({ demStatus: 'loading' }),
    ).status).toBe('dem-loading')
    expect(resolveProceduralLandscapeSceneNodeReadiness(
      makeStats({ demStatus: 'building' }),
    ).status).toBe('dem-building')
    expect(resolveProceduralLandscapeSceneNodeReadiness(
      makeStats({ phase: 'generating' }),
    ).status).toBe('world-building')
    expect(resolveProceduralLandscapeSceneNodeReadiness(
      makeStats({ seasonAssetsReady: false }),
    ).status).toBe('textures-loading')
    expect(resolveProceduralLandscapeSceneNodeReadiness(
      makeStats({ demStatus: 'inactive' }),
    ).ready).toBe(true)
  })

  it('waits for every node and reports status changes', async () => {
    let nowMs = 0
    let sleepCount = 0
    const stats = new Map<string, ProceduralLandscapeRuntimeStats>([
      ['a', makeStats({ demStatus: 'building', seasonAssetsReady: false, progress: 0.4 })],
      ['b', makeStats({ phase: 'generating', progress: 0.7 })],
    ])
    const pendingSignatures: string[] = []

    const result = await waitForProceduralLandscapeSceneReady({
      nodeIds: ['a', 'b', 'a'],
      getStats: (nodeId) => stats.get(nodeId) ?? null,
      timeoutMs: 1000,
      pollIntervalMs: 10,
      now: () => nowMs,
      sleep: async (delayMs) => {
        nowMs += delayMs
        sleepCount += 1
        if (sleepCount === 1) {
          stats.set('a', makeStats({ progress: 1 }))
        } else {
          stats.set('b', makeStats({ progress: 1 }))
        }
      },
      onPending: (pendingNodeIds) => {
        pendingSignatures.push(pendingNodeIds.join(','))
      },
    })

    expect(result.status).toBe('ready')
    expect(result.pendingNodeIds).toEqual([])
    expect(pendingSignatures).toEqual(['a,b', 'b'])
  })

  it('returns pending nodes on timeout without waiting forever', async () => {
    let nowMs = 0
    const result = await waitForProceduralLandscapeSceneReady({
      nodeIds: ['missing'],
      getStats: () => null,
      timeoutMs: 25,
      pollIntervalMs: 10,
      now: () => nowMs,
      sleep: async (delayMs) => {
        nowMs += delayMs
      },
    })

    expect(result.status).toBe('timeout')
    expect(result.pendingNodeIds).toEqual(['missing'])
    expect(result.statuses.missing).toBe('missing-runtime')
  })

  it('keeps waiting while DEM progress advances beyond the former total timeout', async () => {
    let nowMs = 0
    let progress = 0.1
    const result = await waitForProceduralLandscapeSceneReady({
      nodeIds: ['large-dem'],
      getStats: () => makeStats({
        demStatus: progress >= 1 ? 'ready' : 'building',
        phase: progress >= 1 ? 'streaming' : 'generating',
        seasonAssetsReady: progress >= 1,
        progress,
      }),
      stallTimeoutMs: 30_000,
      pollIntervalMs: 5_000,
      now: () => nowMs,
      sleep: async () => {
        nowMs += 5_000
        progress = Math.min(1, progress + 0.1)
      },
    })

    expect(result.status).toBe('ready')
    expect(nowMs).toBeGreaterThan(30_000)
  })

  it('aborts immediately and treats runtime errors as non-blocking failures', async () => {
    const aborted = await waitForProceduralLandscapeSceneReady({
      nodeIds: ['a'],
      getStats: () => makeStats(),
      shouldAbort: () => true,
    })
    expect(aborted.status).toBe('aborted')

    const failed = await waitForProceduralLandscapeSceneReady({
      nodeIds: ['failed', 'ready'],
      getStats: (nodeId) => (
        nodeId === 'failed'
          ? makeStats({ phase: 'error' })
          : makeStats()
      ),
      timeoutMs: 1000,
    })
    expect(failed.status).toBe('ready')
    expect(failed.failedNodeIds).toEqual(['failed'])
    expect(failed.statuses.failed).toBe('error')
  })
})
