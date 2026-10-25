import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as THREE from 'three'

import type { SceneNode } from '@schema/core'
import {
  GUIDE_ROUTE_COMPONENT_TYPE,
  PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
  createProceduralLandscapeComponentState,
  type GuideRouteComponentProps,
} from '@schema/components'
import {
  registerRuntimeObject,
  useSceneStore,
} from '@/stores/sceneStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

function createRoute(store: ReturnType<typeof useSceneStore>) {
  return store.createGuideRouteNode({
    points: [
      { x: 0, y: 10, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 20, y: 10, z: 0 },
    ],
    surfaceProviderNodeId: null,
    travelMode: 'character',
    name: 'Parent Route',
  })!
}

describe('Guide Route stop and branch store actions', () => {
  it('keeps path stops and branch origins synchronized when a control anchor moves', () => {
    const store = useSceneStore()
    const parent = createRoute(store)
    const parentProps = parent.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    const leg = parentProps.legs[0]
    if (leg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    const added = store.addGuideRouteStopAtRoute(parent.id, {
      legId: leg.id,
      anchor: leg.anchors[1]!,
      anchorIndex: 1,
    })!
    const branch = store.createGuideRouteBranchFromStop({
      parentRouteNodeId: parent.id,
      stopId: added.stopId,
      points: [
        { x: leg.anchors[1]!.x, y: leg.anchors[1]!.y, z: leg.anchors[1]!.z },
        { x: leg.anchors[1]!.x, y: leg.anchors[1]!.y, z: 10 },
      ],
    })!
    const current = (
      store.nodes
        .find((node) => node.id === parent.id)
        ?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    )
    const currentLeg = current.legs[0]
    if (currentLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    const nextAnchors = currentLeg.anchors.map((anchor, index) => (
      index === 1 ? { ...anchor, x: anchor.x + 4, z: anchor.z + 2 } : { ...anchor }
    ))
    expect(store.updateGuideRouteWaypoints(parent.id, {
      vertices: nextAnchors,
      anchors: nextAnchors,
    })).toBe(true)
    const movedProps = (
      store.nodes
        .find((node) => node.id === parent.id)
        ?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    )
    const movedStop = movedProps.stops.find((stop) => stop.id === added.stopId)!
    expect(movedStop.anchor).toEqual({
      x: leg.anchors[1]!.x + 4,
      y: leg.anchors[1]!.y,
      z: leg.anchors[1]!.z + 2,
    })
    const branchProps = (
      store.nodes
        .find((node) => node.id === branch.id)
        ?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    )
    expect(branchProps.legs[0]).toMatchObject({
      anchors: [expect.objectContaining(movedStop.anchor), expect.any(Object)],
    })
  })

  it('creates one automatic road Guide Route per road revision', () => {
    const store = useSceneStore()
    const providerId = 'landscape-auto-route'
    const providerNode = {
      id: providerId,
      name: 'DEM Terrain',
      nodeType: 'Mesh',
      dynamicMesh: { type: 'StaticMesh' },
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    } as unknown as SceneNode
    const component = createProceduralLandscapeComponentState(providerNode, {
      road: {
        generatedRoute: {
          waypoints: [{ x: 0, z: 0 }],
          strategy: 'seeded',
          termination: 'dead-end',
          style: 'normal',
          seed: 1,
          waypointTolerance: 4,
          pathDeviation: 0,
          revision: 1,
          centerline: {
            pointsXZ: [0, 0, 10, 0, 20, 0],
            algorithmVersion: 2,
            authoringSampleStep: 2,
            authoringCellSize: 2,
            exclusionSignature: '',
          },
        },
      } as any,
    })
    component.id = 'landscape-component'
    providerNode.components = { [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: component }
    store.nodes = [providerNode]
    registerRuntimeObject(providerId, new THREE.Object3D())

    const first = store.ensureProceduralLandscapeRoadGuideRoute(providerId)
    const second = store.ensureProceduralLandscapeRoadGuideRoute(providerId)
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    const routes = store.nodes.filter((node) => node.dynamicMesh?.type === 'GuideRoute')
    expect(routes).toHaveLength(1)
    const props = routes[0]?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    expect(props.origin).toMatchObject({
      kind: 'procedural-landscape-road',
      providerNodeId: providerId,
      sourceRevision: 1,
    })
    expect(props.legs[0]).toMatchObject({
      kind: 'road',
      providerNodeId: providerId,
      startT: 0,
      endT: 1,
    })

    const stop = store.addGuideRouteStopAtRoute(first.node!.id, {
      legId: (props.legs[0] as any).id,
      anchor: { x: 10, y: 0, z: 0 },
      thumbnailAssetId: 'image-keep',
      name: 'Temporary',
    })!
    expect(store.moveGuideRouteStopAtPosition(first.node!.id, stop.stopId, {
      x: 120,
      y: 0,
      z: 0,
    })).toBe(false)
    const unchangedStop = (
      store.nodes
        .find((node) => node.id === first.node!.id)
        ?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    ).stops.find((entry) => entry.id === stop.stopId)!
    expect(unchangedStop.anchor).toEqual({ x: 10, y: 0, z: 0 })
    const branch = store.createGuideRouteBranchFromStop({
      parentRouteNodeId: first.node!.id,
      stopId: stop.stopId,
      points: [
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
      ],
    })!
    expect(store.resetProceduralLandscapeRoadGuideRoute(providerId)).toBe(true)
    const resetNode = store.nodes.find((node) => node.id === first.node!.id)!
    const resetProps = resetNode.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    expect(resetProps.stops).toEqual([])
    const branchProps = store.nodes
      .find((node) => node.id === branch.id)
      ?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    expect(branchProps.branchOrigin).toBeNull()
  })

  it('moves and deletes a stop atomically while preserving branch nodes', () => {
    const store = useSceneStore()
    const parent = createRoute(store)
    const added = store.addGuideRouteStopAtRoute(parent.id, {
      legId: (parent.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps).legs[0]!.id,
      anchor: { x: 10, y: 10, z: 0 },
      anchorIndex: 1,
      name: 'Lookout',
      thumbnailAssetId: 'shared-image-asset',
    })!
    const branch = store.createGuideRouteBranchFromStop({
      parentRouteNodeId: parent.id,
      stopId: added.stopId,
      points: [
        { x: 10, y: 10, z: 0 },
        { x: 10, y: 10, z: 8 },
      ],
      name: 'Branch Route',
    })!

    expect(store.moveGuideRouteStopAtPosition(parent.id, added.stopId, {
      x: 12,
      y: 10,
      z: 2,
    })).toBe(true)
    const movedBranch = store.nodes.find((node) => node.id === branch.id)!
    const movedBranchProps = movedBranch.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    expect(movedBranchProps.legs[0]).toMatchObject({
      anchors: [expect.objectContaining({ x: 12, y: 10, z: 2 }), expect.any(Object)],
    })

    expect(store.removeGuideRouteStopWithLinks(parent.id, added.stopId)).toBe(true)
    const parentAfterDelete = store.nodes.find((node) => node.id === parent.id)!
    const parentProps = parentAfterDelete.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    expect(parentProps.stops).toEqual([])
    expect(parentProps.legs[0]).toMatchObject({
      anchors: [
        expect.objectContaining({ x: 0 }),
        expect.objectContaining({ x: 10 }),
        expect.objectContaining({ x: 20 }),
      ],
    })
    const branchAfterDelete = store.nodes.find((node) => node.id === branch.id)
    expect(branchAfterDelete).toBeTruthy()
    const branchProps = branchAfterDelete?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    expect(branchProps.branchOrigin).toBeNull()
    expect(store.selectedGuideRouteStop).toBeNull()
  })
})
