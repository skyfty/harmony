import { describe, expect, it } from 'vitest'

import type {
  SceneJsonExportDocument,
  SceneNode,
  SceneNodeComponentState,
} from '@schema/core'
import type { AutoTourComponentProps } from '@schema/components'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  GUIDE_ROUTE_COMPONENT_TYPE,
  VEHICLE_COMPONENT_TYPE,
  clampAutoTourComponentProps,
  clampGuideRouteComponentProps,
} from '@schema/components'
import {
  buildSceneActorAutoTourComponentId,
  ensureSceneActorAutoTourComponents,
  resolveAutoTourActorNodeId,
  transferSceneActorAutoTourComponent,
} from '@schema/sceneActorAutoTour'

function createNode(overrides: Partial<SceneNode> & Pick<SceneNode, 'id'>): SceneNode {
  return {
    ...overrides,
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    nodeType: overrides.nodeType ?? 'Mesh',
    position: overrides.position ?? { x: 0, y: 0, z: 0 },
    rotation: overrides.rotation ?? { x: 0, y: 0, z: 0 },
    scale: overrides.scale ?? { x: 1, y: 1, z: 1 },
  }
}

function createRoute(id: string, startX: number): SceneNode {
  return createNode({
    id,
    name: id,
    dynamicMesh: {
      type: 'GuideRoute',
      vertices: [],
    },
    components: {
      [GUIDE_ROUTE_COMPONENT_TYPE]: {
        id: `component:${id}`,
        type: GUIDE_ROUTE_COMPONENT_TYPE,
        enabled: true,
        props: clampGuideRouteComponentProps({
          surfaceProviderNodeId: 'terrain',
          routeSource: 'drawn',
          sampleSpacingM: 2,
          roadLateralOffsetM: 0,
          waypoints: [
            { name: 'Start', position: { x: startX, y: 0, z: 0 } },
            { name: 'End', position: { x: startX + 20, y: 0, z: 0 } },
          ],
        }),
      },
    },
  })
}

function createActor(
  id: string,
  kind: 'character' | 'vehicle',
  overrides: Partial<SceneNode> = {},
): SceneNode {
  const { components: componentOverrides, ...nodeOverrides } = overrides
  return createNode({
    id,
    ...nodeOverrides,
    components: {
      [kind === 'character' ? CHARACTER_CONTROLLER_COMPONENT_TYPE : VEHICLE_COMPONENT_TYPE]: {
        id: `component:${id}`,
        type: kind === 'character' ? CHARACTER_CONTROLLER_COMPONENT_TYPE : VEHICLE_COMPONENT_TYPE,
        enabled: true,
        props: {},
      },
      ...componentOverrides,
    },
  })
}

function createDocument(nodes: SceneNode[]): SceneJsonExportDocument {
  return {
    id: 'scene',
    name: 'Scene',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes,
  }
}

function getAutoTour(node: SceneNode): SceneNodeComponentState<AutoTourComponentProps> {
  return node.components?.[AUTO_TOUR_COMPONENT_TYPE] as SceneNodeComponentState<AutoTourComponentProps>
}

describe('sceneActorAutoTour', () => {
  it('finds an enabled AutoTour actor without requiring a guide route or click event', () => {
    const character = createActor('character', 'character', {
      components: {
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'auto-tour',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: true,
          props: clampAutoTourComponentProps(null),
        },
      },
    })

    expect(resolveAutoTourActorNodeId([character])).toBe('character')
  })

  it('selects preferred AutoTour actors before scene order', () => {
    const first = createActor('first', 'vehicle', {
      components: {
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'auto-tour-first',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: true,
          props: clampAutoTourComponentProps(null),
        },
      },
    })
    const preferred = createActor('preferred', 'character', {
      components: {
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'auto-tour-preferred',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: true,
          props: clampAutoTourComponentProps(null),
        },
      },
    })

    expect(resolveAutoTourActorNodeId([first, preferred], {
      preferredNodeIds: [null, 'missing', 'preferred'],
    })).toBe('preferred')
    expect(resolveAutoTourActorNodeId([first, preferred])).toBe('first')
  })

  it('ignores disabled AutoTour, non-actors, and actors without runtime objects', () => {
    const disabled = createActor('disabled', 'vehicle', {
      components: {
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'auto-tour-disabled',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: false,
          props: clampAutoTourComponentProps(null),
        },
      },
    })
    const nonActor = createNode({
      id: 'mesh',
      components: {
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'auto-tour-mesh',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: true,
          props: clampAutoTourComponentProps(null),
        },
      },
    })
    const unavailable = createActor('unavailable', 'character', {
      components: {
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'auto-tour-unavailable',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: true,
          props: clampAutoTourComponentProps(null),
        },
      },
    })
    const fallback = createActor('fallback', 'character', {
      components: {
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'auto-tour-fallback',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: true,
          props: clampAutoTourComponentProps(null),
        },
      },
    })

    expect(resolveAutoTourActorNodeId(
      [disabled, nonActor, unavailable, fallback],
      { hasRuntimeObject: (nodeId) => nodeId !== 'unavailable' },
    )).toBe('fallback')
  })

  it('attaches an enabled AutoTour with a stable id to characters and vehicles', () => {
    const character = createActor('character', 'character')
    const vehicle = createActor('vehicle', 'vehicle')
    const mesh = createNode({ id: 'mesh' })
    const document = createDocument([createRoute('route', 0), character, vehicle, mesh])

    const result = ensureSceneActorAutoTourComponents(document)

    expect(result.actorNodeIds).toEqual(['character', 'vehicle'])
    expect(result.attachedNodeIds).toEqual(['character', 'vehicle'])
    expect(getAutoTour(character)).toMatchObject({
      id: buildSceneActorAutoTourComponentId('character'),
      enabled: true,
      props: { routeNodeId: 'route', loop: false },
    })
    expect(getAutoTour(vehicle).props.routeNodeId).toBe('route')
    expect(mesh.components?.[AUTO_TOUR_COMPONENT_TYPE]).toBeUndefined()
  })

  it('binds the nearest route using nested actor world coordinates', () => {
    const actor = createActor('actor', 'vehicle', {
      position: { x: 10, y: 0, z: 0 },
    })
    const group = createNode({
      id: 'group',
      position: { x: 100, y: 0, z: 0 },
      children: [actor],
    })
    const actorInGroup = actor
    actorInGroup.position = { x: 11, y: 0, z: 0 }
    const document = createDocument([
      createRoute('far-route', 1000),
      createRoute('near-route', 120),
      group,
    ])

    ensureSceneActorAutoTourComponents(document)

    expect(getAutoTour(actorInGroup).props.routeNodeId).toBe('near-route')
  })

  it('uses scene order to break equal-distance route ties', () => {
    const actor = createActor('actor', 'vehicle')
    const document = createDocument([
      createRoute('first-route', 0),
      createRoute('second-route', 0),
      actor,
    ])

    ensureSceneActorAutoTourComponents(document)

    expect(getAutoTour(actor).props.routeNodeId).toBe('first-route')
  })

  it('honors a valid preferred route when the actor has no existing binding', () => {
    const actor = createActor('actor', 'character')
    const document = createDocument([
      createRoute('near-route', 0),
      createRoute('preferred-route', 100),
      actor,
    ])

    ensureSceneActorAutoTourComponents(document, {
      preferredRouteNodeId: 'preferred-route',
    })

    expect(getAutoTour(actor).props.routeNodeId).toBe('preferred-route')
  })

  it('preserves an existing valid binding even when another route is nearer', () => {
    const actor = createActor('actor', 'character', {
      components: {
        [CHARACTER_CONTROLLER_COMPONENT_TYPE]: {
          id: 'controller',
          type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
          enabled: true,
          props: {},
        },
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'authored-auto-tour',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: 'far-route',
            speedMps: 7,
            loop: true,
            followCameraObstacleAvoidanceEnabled: true,
          }),
        },
      },
    })
    const document = createDocument([
      createRoute('far-route', 100),
      createRoute('near-route', 0),
      actor,
    ])

    const result = ensureSceneActorAutoTourComponents(document)

    expect(result.reboundNodeIds).toEqual([])
    expect(getAutoTour(actor)).toMatchObject({
      id: 'authored-auto-tour',
      enabled: true,
      props: {
        routeNodeId: 'far-route',
        speedMps: 7,
        loop: true,
        followCameraObstacleAvoidanceEnabled: true,
      },
    })
  })

  it('repairs an invalid binding without re-enabling a disabled AutoTour', () => {
    const actor = createActor('actor', 'vehicle', {
      components: {
        [VEHICLE_COMPONENT_TYPE]: {
          id: 'vehicle',
          type: VEHICLE_COMPONENT_TYPE,
          enabled: true,
          props: {},
        },
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'disabled-auto-tour',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: false,
          props: clampAutoTourComponentProps({
            routeNodeId: 'missing-route',
            speedMps: 4,
          }),
        },
      },
    })
    const document = createDocument([createRoute('route', 0), actor])

    const result = ensureSceneActorAutoTourComponents(document)

    expect(result.reboundNodeIds).toEqual(['actor'])
    expect(getAutoTour(actor)).toMatchObject({
      enabled: false,
      props: { routeNodeId: 'route', speedMps: 4 },
    })
  })

  it('still attaches AutoTour when the scene has no usable Guide Route', () => {
    const actor = createActor('actor', 'character')
    const document = createDocument([actor])

    const result = ensureSceneActorAutoTourComponents(document)

    expect(result.unboundNodeIds).toEqual(['actor'])
    expect(getAutoTour(actor)).toMatchObject({
      enabled: true,
      props: { routeNodeId: null },
    })
  })

  it('transfers authored AutoTour settings to a prefab actor that lacks the component', () => {
    const source = createActor('source', 'character', {
      components: {
        [CHARACTER_CONTROLLER_COMPONENT_TYPE]: {
          id: 'controller',
          type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
          enabled: true,
          props: {},
        },
        [AUTO_TOUR_COMPONENT_TYPE]: {
          id: 'authored-auto-tour',
          type: AUTO_TOUR_COMPONENT_TYPE,
          enabled: false,
          props: clampAutoTourComponentProps({
            routeNodeId: 'scene-route',
            speedMps: 6,
            loop: true,
            followCameraObstacleAvoidanceEnabled: true,
          }),
        },
      },
    })
    const prefabRoot = createNode({
      id: 'prefab-root',
      children: [createActor('prefab-actor', 'character')],
    })
    const target = prefabRoot.children![0]!
    const document = createDocument([createRoute('scene-route', 0), prefabRoot])

    expect(transferSceneActorAutoTourComponent(source, target)).toBe(true)
    ensureSceneActorAutoTourComponents(document)
    expect(getAutoTour(target)).toMatchObject({
      id: buildSceneActorAutoTourComponentId('prefab-actor'),
      enabled: false,
      props: {
        routeNodeId: 'scene-route',
        speedMps: 6,
        loop: true,
        followCameraObstacleAvoidanceEnabled: true,
      },
    })
    expect(Object.keys(target.components ?? {}).filter(
      (type) => type === AUTO_TOUR_COMPONENT_TYPE,
    )).toHaveLength(1)
  })
})
