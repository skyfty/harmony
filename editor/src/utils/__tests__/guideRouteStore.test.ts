import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as THREE from 'three'

import type { SceneNode } from '@schema/core'
import {
  GUIDE_ROUTE_COMPONENT_TYPE,
  PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
  createGuidePathRouteLeg,
  createGuideRoadRouteLeg,
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
  it('moves a pure path endpoint without replacing the route transform', () => {
    const store = useSceneStore()
    const route = createRoute(store)
    const originalPosition = { ...route.position }
    const props = route.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    const leg = props.legs[0]
    if (leg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    const endpoint = leg.anchors[leg.anchors.length - 1]!
    const moved = {
      x: endpoint.x + 5,
      y: endpoint.y + 2,
      z: endpoint.z - 3,
    }

    expect(store.moveGuideRoutePathAnchorByHandle(route.id, {
      legId: leg.id,
      anchorId: endpoint.id!,
      anchor: moved,
    })).toBe(true)

    const updatedNode = store.nodes.find((node) => node.id === route.id)!
    const updatedProps = updatedNode.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    const updatedLeg = updatedProps.legs[0]
    if (updatedLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(updatedLeg.anchors.slice(0, -1)).toEqual(leg.anchors.slice(0, -1))
    expect(updatedLeg.anchors[updatedLeg.anchors.length - 1]).toMatchObject(moved)
    expect(updatedNode.position).toEqual(originalPosition)
    expect(store.selectedGuideRouteWaypoint).toEqual({
      nodeId: route.id,
      waypointIndex: leg.anchors.length - 1,
    })
  })

  it('promotes either path endpoint to a stop without duplicating its anchor', () => {
    const store = useSceneStore()
    const route = createRoute(store)
    const props = route.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    const leg = props.legs[0]
    if (leg?.kind !== 'path') {
      throw new Error('expected path leg')
    }

    const start = store.addGuideRouteStopAtPathAnchor(route.id, {
      legId: leg.id,
      anchorId: leg.anchors[0]!.id!,
      name: 'Start stop',
    })
    const end = store.addGuideRouteStopAtPathAnchor(route.id, {
      legId: leg.id,
      anchorId: leg.anchors[leg.anchors.length - 1]!.id!,
      name: 'End stop',
    })

    expect(start?.created).toBe(true)
    expect(end?.created).toBe(true)
    const updatedProps = store.nodes
      .find((node) => node.id === route.id)
      ?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    const updatedLeg = updatedProps.legs[0]
    if (updatedLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(updatedLeg.anchors).toHaveLength(leg.anchors.length)
    expect(updatedProps.stops).toEqual([
      expect.objectContaining({
        id: start!.stopId,
        name: 'Start stop',
        anchor: {
          x: leg.anchors[0]!.x,
          y: leg.anchors[0]!.y,
          z: leg.anchors[0]!.z,
        },
        controlAnchorId: leg.anchors[0]!.id,
        thumbnailAssetId: null,
      }),
      expect.objectContaining({
        id: end!.stopId,
        name: 'End stop',
        anchor: {
          x: leg.anchors[leg.anchors.length - 1]!.x,
          y: leg.anchors[leg.anchors.length - 1]!.y,
          z: leg.anchors[leg.anchors.length - 1]!.z,
        },
        controlAnchorId: leg.anchors[leg.anchors.length - 1]!.id,
        thumbnailAssetId: null,
      }),
    ])

    expect(store.addGuideRouteStopAtPathAnchor(route.id, {
      legId: leg.id,
      anchorId: leg.anchors[0]!.id!,
    })).toEqual({ stopId: start!.stopId, created: false })
    expect(store.selectedGuideRouteStop).toEqual({
      nodeId: route.id,
      stopId: start!.stopId,
    })
  })

  it('deletes a selected anchor independently while preserving a linked stop', () => {
    const store = useSceneStore()
    const route = createRoute(store)
    const props = route.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    const leg = props.legs[0]
    if (leg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    const anchor = leg.anchors[1]!
    const stop = store.addGuideRouteStopAtPathAnchor(route.id, {
      legId: leg.id,
      anchorId: anchor.id!,
    })!

    expect(store.removeGuideRoutePathAnchorByHandle(route.id, {
      legId: leg.id,
      anchorId: anchor.id!,
    })).toBe(true)

    const updatedProps = store.nodes
      .find((node) => node.id === route.id)
      ?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    const updatedLeg = updatedProps.legs[0]
    if (updatedLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(updatedLeg.anchors).toHaveLength(2)
    expect(updatedProps.stops).toEqual([
      expect.objectContaining({
        id: stop.stopId,
        controlAnchorId: null,
        anchor: {
          x: anchor.x,
          y: anchor.y,
          z: anchor.z,
        },
      }),
    ])
    expect(store.removeGuideRoutePathAnchorByHandle(route.id, {
      legId: leg.id,
      anchorId: updatedLeg.anchors[0]!.id!,
    })).toBe(false)
  })

  it('edits only path anchors around an internal road leg and rejects attached boundaries', () => {
    const store = useSceneStore()
    const firstPath = createGuidePathRouteLeg({
      id: 'path-start',
      anchors: [
        { x: -20, y: 4, z: 0, id: 'start-1' },
        { x: -10, y: 4, z: 0, id: 'start-2' },
        { x: 0, y: 4, z: 0, id: 'start-connected' },
      ],
      preserveAuthoredY: true,
    })
    const road = createGuideRoadRouteLeg({
      id: 'road-1',
      providerNodeId: 'terrain-1',
    })
    const lastPath = createGuidePathRouteLeg({
      id: 'path-end',
      anchors: [
        { x: 10, y: 4, z: 0, id: 'end-connected' },
        { x: 20, y: 4, z: 0, id: 'end-2' },
        { x: 30, y: 4, z: 0, id: 'end-3' },
      ],
      preserveAuthoredY: true,
    })
    const route = store.createGuideRouteNode({
      points: [
        { x: -20, y: 4, z: 0 },
        { x: -10, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
        { x: 10, y: 4, z: 0 },
        { x: 20, y: 4, z: 0 },
        { x: 30, y: 4, z: 0 },
      ],
      legs: [firstPath, road, lastPath],
      name: 'Path Road Path',
    })!

    expect(store.moveGuideRoutePathAnchorByHandle(route.id, {
      legId: firstPath.id,
      anchorId: 'start-connected',
      anchor: { x: 1, y: 8, z: 1 },
    })).toBe(false)
    expect(store.moveGuideRoutePathAnchorByHandle(route.id, {
      legId: lastPath.id,
      anchorId: 'end-connected',
      anchor: { x: 11, y: 8, z: 1 },
    })).toBe(false)
    expect(store.moveGuideRoutePathAnchorByHandle(route.id, {
      legId: lastPath.id,
      anchorId: 'end-3',
      anchor: { x: 35, y: 6, z: 4 },
    })).toBe(true)

    const updatedProps = store.nodes
      .find((node) => node.id === route.id)
      ?.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    expect(updatedProps.legs[1]).toEqual(road)
    const updatedFirstPath = updatedProps.legs[0]
    const updatedLastPath = updatedProps.legs[2]
    if (updatedFirstPath?.kind !== 'path' || updatedLastPath?.kind !== 'path') {
      throw new Error('expected path legs')
    }
    expect(updatedFirstPath.anchors).toEqual(firstPath.anchors)
    expect(updatedLastPath.anchors[0]).toEqual(lastPath.anchors[0])
    expect(updatedLastPath.anchors[updatedLastPath.anchors.length - 1])
      .toMatchObject({ x: 35, y: 6, z: 4 })
  })

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

  it('keeps a branch origin locked while allowing its free terminal to move', () => {
    const store = useSceneStore()
    const parent = createRoute(store)
    const parentLeg = (
      parent.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    ).legs[0]!
    const added = store.addGuideRouteStopAtRoute(parent.id, {
      legId: parentLeg.id,
      anchor: { x: 10, y: 10, z: 0 },
      anchorIndex: 1,
    })!
    const branch = store.createGuideRouteBranchFromStop({
      parentRouteNodeId: parent.id,
      stopId: added.stopId,
      points: [
        { x: 10, y: 10, z: 0 },
        { x: 10, y: 10, z: 10 },
      ],
    })!
    const branchLeg = (
      branch.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props as GuideRouteComponentProps
    ).legs[0]
    if (branchLeg?.kind !== 'path') {
      throw new Error('expected branch path leg')
    }

    const lockedStop = store.addGuideRouteStopAtPathAnchor(branch.id, {
      legId: branchLeg.id,
      anchorId: branchLeg.anchors[0]!.id!,
      name: 'Branch start',
    })!
    expect(lockedStop.created).toBe(true)
    expect(store.moveGuideRouteStopAtPosition(branch.id, lockedStop.stopId, {
      x: 11,
      y: 10,
      z: 1,
    })).toBe(false)

    expect(store.moveGuideRoutePathAnchorByHandle(branch.id, {
      legId: branchLeg.id,
      anchorId: branchLeg.anchors[0]!.id!,
      anchor: { x: 11, y: 10, z: 1 },
    })).toBe(false)
    expect(store.moveGuideRoutePathAnchorByHandle(branch.id, {
      legId: branchLeg.id,
      anchorId: branchLeg.anchors[1]!.id!,
      anchor: { x: 12, y: 10, z: 12 },
    })).toBe(true)
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

  it('moves and deletes stop metadata while preserving anchors and branch nodes', () => {
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
        expect.objectContaining({ x: 12 }),
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
