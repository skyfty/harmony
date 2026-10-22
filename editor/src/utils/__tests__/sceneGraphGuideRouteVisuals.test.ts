import { describe, expect, it } from 'vitest'
import type { Object3D } from 'three'
import type { SceneJsonExportDocument } from '@schema/core'
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph'

const ROUTE_NODE_ID = 'guide-route'

function createGuideRouteDocument(): SceneJsonExportDocument {
  return {
    id: 'scene',
    name: 'scene',
    createdAt: null,
    updatedAt: null,
    nodes: [
      {
        id: ROUTE_NODE_ID,
        name: 'Guide Route',
        nodeType: 'Mesh',
        position: { x: 12, y: 3, z: -4 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        dynamicMesh: {
          type: 'GuideRoute',
          vertices: [
            { x: -5, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
        },
      },
    ],
    assetRegistry: {},
    assetPreload: { mesh: { all: [], essential: [] } },
    lazyLoadMeshes: false,
  } as unknown as SceneJsonExportDocument
}

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

async function buildRoute(options: SceneGraphBuildOptions) {
  const result = await buildSceneGraph(
    createGuideRouteDocument(),
    createResourceCache() as never,
    {
      lazyLoadMeshes: false,
      ...options,
    },
  )
  const routes: Object3D[] = []
  result.root.traverse((object) => {
    if (object.userData?.nodeId === ROUTE_NODE_ID) {
      routes.push(object)
    }
  })
  const route = routes[0]
  if (!route) {
    throw new Error('Guide Route runtime container was not built')
  }
  return route
}

describe('scene graph Guide Route visuals', () => {
  it('builds route segments and waypoints by default', async () => {
    const route = await buildRoute({})

    expect(route.getObjectByName('GuideRouteSegments')).toBeTruthy()
    expect(route.getObjectByName('GuideRouteWaypoints')).toBeTruthy()
  })

  it('keeps a transformed navigation container without route visuals', async () => {
    const route = await buildRoute({ renderGuideRouteVisuals: false })

    expect(route.name).toBe('Guide Route')
    expect(route.position.toArray()).toEqual([12, 3, -4])
    expect(route.children).toHaveLength(0)
    expect(route.getObjectByName('GuideRouteSegments')).toBeUndefined()
    expect(route.getObjectByName('GuideRouteWaypoints')).toBeUndefined()
  })
})
