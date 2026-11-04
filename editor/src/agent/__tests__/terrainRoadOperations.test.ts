import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'
import { useSceneStore } from '@/stores/sceneStore'
import { applySceneOperations } from '../operations'

function createTerrainNode(store: ReturnType<typeof useSceneStore>) {
  const props = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
  props.generationRevision = 4
  props.road.generatedRoute = {
    waypoints: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
    strategy: 'seeded',
    termination: 'dead-end',
    style: 'normal',
    seed: props.seed,
    waypointTolerance: 4,
    pathDeviation: 60,
    revision: 7,
    centerline: {
      pointsXZ: [0, 0, 10, 0],
      algorithmVersion: 2,
      authoringSampleStep: 1,
      authoringCellSize: 10,
      exclusionSignature: '',
      compiledProfile: {
        sourceSignature: 'regenerated-signature',
        pointsLocalXYZ: [0, 20, 0, 10, 20, 0],
      },
    },
  }
  const node = store.addSceneNode({
    nodeId: 'terrain-a',
    nodeType: 'Group',
    object: new THREE.Group(),
    name: 'Terrain',
    sourceAssetId: 'terrain-asset',
    components: {
      [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
        id: 'landscape-component',
        type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
        enabled: true,
        props,
      },
    },
  })
  return {
    node,
    componentId: node.components![PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]!.id,
    props,
  }
}

function createRequest(
  nodeId: string,
  expectedRevision?: number,
  args: Record<string, unknown> = {},
) {
  return {
    expectedRevision,
    operations: [{
      op: 'domain.apply',
      domain: 'terrain',
      action: 'regenerate_road',
      args: {
        nodeId,
        ...args,
      },
    }],
  } as never
}

describe('terrain regenerate_road operation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useSceneStore()
    store.currentSceneId = 'terrain-road-operation-test'
    store.currentSceneMeta = {
      name: 'Terrain road operation test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
  })

  it('regenerates the current draft and preserves the Guide Route by default', async () => {
    const store = useSceneStore()
    const { node } = createTerrainNode(store)
    const generate = vi.spyOn(store, 'generateProceduralLandscapeRoad').mockReturnValue({
      accepted: true,
      failureReason: null,
    })

    const result = await applySceneOperations(store, createRequest(node.id))

    expect(generate).toHaveBeenCalledWith(node.id, {
      guideRoutePolicy: 'preserve',
    })
    expect(result.applied).toBe(1)
    expect(generate.mock.results[0]?.value).toEqual({
      accepted: true,
      failureReason: null,
    })
  })

  it('returns a structured failure and leaves the previous road committed', async () => {
    const store = useSceneStore()
    const { node, props } = createTerrainNode(store)
    const previousRoute = structuredClone(props.road.generatedRoute)
    vi.spyOn(store, 'generateProceduralLandscapeRoad').mockReturnValue({
      accepted: false,
      failureReason: 'road-forward-grade-limit',
      unreachableWaypointIndex: 1,
    })

    const result = await applySceneOperations(store, createRequest(node.id))
    const component = store.getNodeById(node.id)!
      .components![PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]!

    expect(result.applied).toBe(1)
    expect((component.props as typeof props).road.generatedRoute).toEqual(previousRoute)
  })

  it('rejects an unsupported Guide Route policy before regeneration', async () => {
    const store = useSceneStore()
    const { node } = createTerrainNode(store)
    const generate = vi.spyOn(store, 'generateProceduralLandscapeRoad')

    await expect(applySceneOperations(
      store,
      createRequest(node.id, undefined, { guideRoutePolicy: 'replace' }),
    )).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('honors expectedRevision before invoking road generation', async () => {
    const store = useSceneStore()
    const { node } = createTerrainNode(store)
    const generate = vi.spyOn(store, 'generateProceduralLandscapeRoad')

    await expect(applySceneOperations(
      store,
      createRequest(node.id, Math.max(0, store.sceneRevision - 1)),
    )).rejects.toMatchObject({
      code: 'STALE_REVISION',
    })
    expect(generate).not.toHaveBeenCalled()
  })
})
