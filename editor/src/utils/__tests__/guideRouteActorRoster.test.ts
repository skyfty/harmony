import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  createGuidePathRouteLeg,
  createGuideRouteComponentState,
  type GuideRouteComponentProps,
} from '@schema/components'
import type {
  ExternalControllableAsset,
  SceneJsonExportDocument,
  SceneNode,
} from '@schema/core'
import {
  collectGuideRouteActorRequirements,
  collectGuideRouteActorRoster,
  ensureGuideRouteDebugActors,
  GUIDE_ROUTE_ACTOR_SOURCE_USER_DATA_KEY,
  selectGuideRoutePlayerActorAsset,
} from '@schema/guideRouteActorRoster'
import { planGuideRouteJourney } from '@schema/motion'
import {
  ensureSceneActorAutoTourComponents,
  resolveSceneActorKind,
} from '@schema/sceneActorAutoTour'

function createRouteNode(): SceneNode {
  const vehicleLeg = createGuidePathRouteLeg({
    id: 'vehicle-leg',
    travelMode: 'vehicle',
    preserveAuthoredY: true,
    anchors: [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ],
  })
  const characterLeg = createGuidePathRouteLeg({
    id: 'character-leg',
    travelMode: 'character',
    preserveAuthoredY: true,
    anchors: [
      { x: 100, y: 0, z: 0 },
      { x: 200, y: 0, z: 0 },
    ],
  })
  const props: Partial<GuideRouteComponentProps> = {
    loop: false,
    legs: [vehicleLeg, characterLeg],
    stops: [
      {
        id: 'vehicle-stop',
        name: 'Vehicle stop',
        thumbnailAssetId: 'vehicle-thumb',
        anchor: { x: 40, y: 0, z: 0 },
        legId: vehicleLeg.id,
        behavior: null,
        controlAnchorId: null,
      },
      {
        id: 'character-stop',
        name: 'Character stop',
        thumbnailAssetId: 'character-thumb',
        anchor: { x: 200, y: 0, z: 0 },
        legId: characterLeg.id,
        behavior: null,
        controlAnchorId: null,
      },
    ],
    transitions: [],
    origin: null,
    branchOrigin: null,
  }
  const node: SceneNode = {
    id: 'route',
    name: 'Route',
    nodeType: 'Mesh',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    dynamicMesh: { type: 'GuideRoute', vertices: [] },
    components: {},
  }
  node.components!.guideRoute = createGuideRouteComponentState(node, props, {
    id: 'route-component',
  })
  return node
}

function createDocument(nodes: SceneNode[]): SceneJsonExportDocument {
  return {
    id: 'scene',
    updatedAt: '2026-11-06T00:00:00.000Z',
    nodes,
  } as SceneJsonExportDocument
}

function flatten(nodes: SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ?? [])])
}

describe('Guide Route actor roster', () => {
  it('derives both required actor kinds from thumbnail destinations', () => {
    expect(collectGuideRouteActorRequirements([createRouteNode()])).toEqual([
      { kind: 'vehicle', routeNodeIds: ['route'] },
      { kind: 'character', routeNodeIds: ['route'] },
    ])
  })

  it('adds missing local debug actors idempotently and binds Auto Tour', () => {
    const document = createDocument([createRouteNode()])
    const first = ensureGuideRouteDebugActors(document)
    ensureSceneActorAutoTourComponents(document)
    const second = ensureGuideRouteDebugActors(document)

    expect(first.addedKinds).toEqual(['vehicle', 'character'])
    expect(second.addedKinds).toEqual([])
    expect(document.nodes).toHaveLength(3)
    expect(flatten(document.nodes ?? [])
      .filter((node) => resolveSceneActorKind(node))
      .map((node) => node.userData?.[GUIDE_ROUTE_ACTOR_SOURCE_USER_DATA_KEY])).toEqual([
      'debug-proxy',
      'debug-proxy',
    ])
    expect(collectGuideRouteActorRoster(flatten(document.nodes ?? []))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'vehicle', source: 'debug-proxy' }),
        expect.objectContaining({ kind: 'character', source: 'debug-proxy' }),
      ]),
    )
  })

  it('plans a vehicle-to-character handoff with local debug actors', () => {
    const document = createDocument([createRouteNode()])
    ensureGuideRouteDebugActors(document)
    ensureSceneActorAutoTourComponents(document)
    const nodes = flatten(document.nodes ?? [])
    const vehicle = nodes.find((node) => resolveSceneActorKind(node) === 'vehicle')!
    const character = nodes.find((node) => resolveSceneActorKind(node) === 'character')!
    const route = nodes.find((node) => node.id === 'route')!
    const vehicleObject = new THREE.Object3D()
    vehicleObject.position.set(0, 0, 0)
    const characterObject = new THREE.Object3D()
    characterObject.position.set(200, 0, 0)
    const plan = planGuideRouteJourney({
      iterNodes: () => nodes,
      nodeObjectMap: new Map([
        ['route', new THREE.Object3D()],
        [vehicle.id, vehicleObject],
        [character.id, characterObject],
      ]),
      targetRouteNodeId: route.id,
      destinationStopId: 'character-stop',
      startActorNodeId: vehicle.id,
      startPosition: new THREE.Vector3(0, 0, 0),
      actors: [
        { nodeId: vehicle.id, kind: 'vehicle', position: { x: 0, y: 0, z: 0 } },
        { nodeId: character.id, kind: 'character', position: { x: 200, y: 0, z: 0 } },
      ],
    })

    expect(plan?.switchCount).toBe(1)
    expect(plan?.controlSpans.map((span) => span.actorKind)).toEqual(['vehicle', 'character'])
    expect(plan?.handoffs).toHaveLength(1)
  })

  it('selects the current player asset before the default fallback', () => {
    const assets: ExternalControllableAsset[] = [
      { id: 'default', identifier: 'default-character', type: 'character', isDefault: true, isActive: true, owned: true },
      { id: 'selected', identifier: 'selected-character', type: 'character', isSelected: true, isActive: true, owned: true },
    ]
    expect(selectGuideRoutePlayerActorAsset(assets, 'character')?.id).toBe('selected')
    expect(selectGuideRoutePlayerActorAsset(assets.slice(0, 1), 'character')?.id).toBe('default')
  })
})
