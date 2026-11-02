import { describe, expect, it } from 'vitest'
import type { SceneJsonExportDocument } from '@schema/core'
import { buildSceneGraph } from '@schema/sceneGraph'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components/definitions/proceduralLandscapeComponent'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'

function createResourceCache() {
  return {
    setContext() {},
    setHandlers() {},
    async acquireAssetEntry() {
      return null
    },
    getAssetBytes() {
      return null
    },
    releaseAssetBytes() {},
  }
}

describe('compiled road profile scene loading', () => {
  it('rejects a DEM generated road without a compiled profile', async () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'ground-1' })
    props.dem.assetId = 'dem-asset'
    props.dem.runtimeGridUrl = 'https://example.test/dem-grid.bin'
    props.road.generatedRoute = {
      waypoints: [{ x: 0, z: 0 }],
      strategy: 'seeded',
      termination: 'boundary',
      style: 'normal',
      seed: 1,
      waypointTolerance: 4,
      pathDeviation: 60,
      revision: 1,
      centerline: {
        pointsXZ: [0, 0, 10, 0],
        algorithmVersion: 2,
        authoringSampleStep: 1,
        authoringCellSize: 30,
      },
    }
    const document = {
      id: 'scene',
      name: 'Scene',
      createdAt: null,
      updatedAt: null,
      nodes: [{
        id: 'ground-1',
        name: 'Ground',
        nodeType: 'Mesh',
        dynamicMesh: { type: 'Ground', surfaceRevision: 0 },
        components: {
          [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
            id: 'landscape-component',
            type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
            enabled: true,
            props,
          },
        },
      }],
      assetRegistry: {},
      lazyLoadMeshes: false,
    } as unknown as SceneJsonExportDocument

    await expect(buildSceneGraph(document, createResourceCache() as never, {
      lazyLoadMeshes: false,
    })).rejects.toThrow('missing or stale compiled profile')
  })
})
