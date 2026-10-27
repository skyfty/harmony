import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  clampGuideRouteComponentProps,
  type GuideRouteBranchOrigin,
  type GuideRouteComponentProps,
  type GuideRouteStop,
  type GuideRouteTravelMode,
} from '@schema/components'
import {
  GUIDE_ROUTE_HANDOFF_STOP_PREFIX,
  buildGuideRouteJourneySpanWindow,
  planGuideRouteJourney,
} from '@schema/motion'

function createStop(
  id: string,
  legId: string,
  x: number,
  z: number,
): GuideRouteStop {
  return {
    id,
    name: id,
    thumbnailAssetId: null,
    anchor: { x, y: 0, z },
    legId,
    behavior: null,
    controlAnchorId: null,
  }
}

function createRouteNode(options: {
  id: string
  points: Array<{ x: number; z: number }>
  travelMode: GuideRouteTravelMode
  stop?: GuideRouteStop
  branchOrigin?: GuideRouteBranchOrigin | null
}) {
  const legId = `${options.id}-leg`
  const props = clampGuideRouteComponentProps({
    loop: false,
    legs: [{
      id: legId,
      kind: 'path',
      travelMode: options.travelMode,
      speedProfile: {
        cruiseSpeedMps: 4,
        lateralAccelLimitMps2: 2.5,
      },
      surfaceProviderNodeId: null,
      preserveAuthoredY: true,
      anchors: options.points.map((point, index) => ({
        id: `${options.id}-anchor-${index}`,
        x: point.x,
        y: 0,
        z: point.z,
      })),
    }],
    stops: options.stop ? [options.stop] : [],
    transitions: [],
    origin: null,
    branchOrigin: options.branchOrigin ?? null,
  } satisfies Partial<GuideRouteComponentProps>)
  return {
    id: options.id,
    name: options.id,
    nodeType: 'Mesh',
    dynamicMesh: { type: 'GuideRoute', vertices: [] },
    components: {
      guideRoute: {
        id: `${options.id}-component`,
        type: 'guideRoute',
        enabled: true,
        props,
      },
    },
  } as any
}

function createBranchTree(rootMode: GuideRouteTravelMode) {
  const rootLegId = 'root-leg'
  const childLegId = 'child-leg'
  const root = createRouteNode({
    id: 'root',
    points: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
    travelMode: rootMode,
    stop: createStop('stop1', rootLegId, 50, 0),
  })
  root.components.guideRoute.props.legs[0].id = rootLegId
  const child = createRouteNode({
    id: 'child',
    points: [{ x: 50, z: 0 }, { x: 50, z: 100 }],
    travelMode: 'character',
    stop: createStop('stop2', childLegId, 50, 100),
    branchOrigin: {
      routeNodeId: 'root',
      stopId: 'stop1',
    },
  })
  child.components.guideRoute.props.legs[0].id = childLegId
  return [root, child]
}

function planTree(rootMode: GuideRouteTravelMode = 'vehicle') {
  const nodes = createBranchTree(rootMode)
  return planGuideRouteJourney({
    iterNodes: () => nodes as any,
    nodeObjectMap: new Map([
      ['root', new THREE.Object3D()],
      ['child', new THREE.Object3D()],
    ]),
    targetRouteNodeId: 'child',
    destinationStopId: 'stop2',
    startActorNodeId: 'vehicle-1',
    startPosition: new THREE.Vector3(40, 0, 1),
    actors: [
      {
        nodeId: 'vehicle-1',
        kind: 'vehicle',
        position: { x: 40, y: 0, z: 1 },
      },
      {
        nodeId: 'character-1',
        kind: 'character',
        position: { x: 0, y: 0, z: 0 },
      },
    ],
  })
}

describe('Guide Route branch-tree planning', () => {
  it('switches actors only where the next route leg requires it', () => {
    const plan = planTree('vehicle')

    expect(plan).not.toBeNull()
    expect(plan?.switchCount).toBe(1)
    expect(plan?.controlSpans.map((span) => span.actorKind)).toEqual([
      'vehicle',
      'character',
    ])
    expect(plan?.handoffs).toHaveLength(1)
    expect(plan?.route.legs.map((leg) => leg.travelMode)).toEqual([
      'vehicle',
      'character',
    ])
    expect(plan?.route.stops.map((stop) => stop.definition.id)).toEqual([
      'stop1',
      'stop2',
    ])
  })

  it('uses a Both leg without introducing an extra actor switch', () => {
    const plan = planTree('both')

    expect(plan?.switchCount).toBe(1)
    expect(plan?.controlSpans[0]?.actorKind).toBe('vehicle')
    expect(plan?.handoffs[0]).toMatchObject({
      fromKind: 'vehicle',
      toKind: 'character',
    })
  })

  it('creates a handoff target for non-final control spans', () => {
    const plan = planTree('vehicle')
    const firstSpan = plan
      ? buildGuideRouteJourneySpanWindow(plan, 0)
      : null
    const secondSpan = plan
      ? buildGuideRouteJourneySpanWindow(plan, 1)
      : null

    expect(firstSpan?.destinationStopId.startsWith(GUIDE_ROUTE_HANDOFF_STOP_PREFIX)).toBe(true)
    expect(firstSpan?.route.legs.every((leg) => leg.travelMode === 'vehicle')).toBe(true)
    expect(firstSpan?.route.stops.map((stop) => stop.definition.id)).toContain('stop1')
    expect(firstSpan?.route.points[firstSpan.route.points.length - 1]?.distanceTo(
      secondSpan!.route.points[0]!,
    )).toBeLessThan(1e-5)
    expect(secondSpan?.destinationStopId).toBe('stop2')
  })

  it('trades a longer snap for a route that keeps the current actor', () => {
    const root = createRouteNode({
      id: 'root',
      points: [{ x: 0, z: 20 }, { x: 100, z: 20 }],
      travelMode: 'vehicle',
      stop: createStop('stop1', 'root-leg', 50, 20),
    })
    root.components.guideRoute.props.stops.push(createStop('target', 'root-leg', 100, 20))
    const child = createRouteNode({
      id: 'child',
      points: [{ x: 50, z: 20 }, { x: 50, z: 0 }],
      travelMode: 'character',
      branchOrigin: {
        routeNodeId: 'root',
        stopId: 'stop1',
      },
    })
    const plan = planGuideRouteJourney({
      iterNodes: () => [root, child] as any,
      nodeObjectMap: new Map([
        ['root', new THREE.Object3D()],
        ['child', new THREE.Object3D()],
      ]),
      targetRouteNodeId: 'root',
      destinationStopId: 'target',
      startActorNodeId: 'vehicle-1',
      startPosition: new THREE.Vector3(50, 0, 1),
      actors: [
        {
          nodeId: 'vehicle-1',
          kind: 'vehicle',
          position: { x: 50, y: 0, z: 1 },
        },
        {
          nodeId: 'character-1',
          kind: 'character',
          position: { x: 50, y: 0, z: 0 },
        },
      ],
    })

    expect(plan?.switchCount).toBe(0)
    expect(plan?.controlSpans).toHaveLength(1)
    expect(plan?.controlSpans[0]?.actorKind).toBe('vehicle')
  })

  it('can backtrack on a bidirectional route to reach a stop behind the vehicle', () => {
    const root = createRouteNode({
      id: 'root',
      points: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
      travelMode: 'vehicle',
      stop: createStop('target', 'root-leg', 40, 0),
    })
    const plan = planGuideRouteJourney({
      iterNodes: () => [root] as any,
      nodeObjectMap: new Map([['root', new THREE.Object3D()]]),
      targetRouteNodeId: 'root',
      destinationStopId: 'target',
      startActorNodeId: 'vehicle-1',
      startPosition: new THREE.Vector3(60, 0, 1),
      actors: [{
        nodeId: 'vehicle-1',
        kind: 'vehicle',
        position: { x: 60, y: 0, z: 1 },
      }],
    })

    expect(plan?.switchCount).toBe(0)
    expect(plan?.route.points[plan.route.points.length - 1]?.x).toBeCloseTo(40)
    expect(plan?.segments[0]?.direction).toBe(1)
  })

  it('carries the current actor through nested Both branches before switching', () => {
    const root = createRouteNode({
      id: 'root',
      points: [{ x: 0, z: 0 }, { x: 50, z: 0 }],
      travelMode: 'vehicle',
      stop: createStop('root-stop', 'root-leg', 50, 0),
    })
    const child = createRouteNode({
      id: 'child',
      points: [{ x: 50, z: 0 }, { x: 50, z: 50 }],
      travelMode: 'both',
      stop: createStop('child-stop', 'child-leg', 50, 50),
      branchOrigin: { routeNodeId: 'root', stopId: 'root-stop' },
    })
    const grandchild = createRouteNode({
      id: 'grandchild',
      points: [{ x: 50, z: 50 }, { x: 0, z: 50 }],
      travelMode: 'character',
      stop: createStop('target', 'grandchild-leg', 0, 50),
      branchOrigin: { routeNodeId: 'child', stopId: 'child-stop' },
    })
    const actors = [
      {
        nodeId: 'vehicle-1',
        kind: 'vehicle' as const,
        position: { x: 0, y: 0, z: 0 },
      },
      {
        nodeId: 'character-1',
        kind: 'character' as const,
        position: { x: 50, y: 0, z: 50 },
      },
    ]
    const plan = planGuideRouteJourney({
      iterNodes: () => [root, child, grandchild] as any,
      nodeObjectMap: new Map([
        ['root', new THREE.Object3D()],
        ['child', new THREE.Object3D()],
        ['grandchild', new THREE.Object3D()],
      ]),
      targetRouteNodeId: 'grandchild',
      destinationStopId: 'target',
      startActorNodeId: 'vehicle-1',
      startPosition: new THREE.Vector3(0, 0, 0),
      actors,
    })

    expect(plan?.switchCount).toBe(1)
    expect(plan?.controlSpans.map((span) => span.actorKind)).toEqual([
      'vehicle',
      'character',
    ])
    expect(plan?.controlSpans[0]?.endDistance).toBeCloseTo(100)

    expect(planGuideRouteJourney({
      iterNodes: () => [root, child, grandchild] as any,
      nodeObjectMap: new Map([
        ['root', new THREE.Object3D()],
        ['child', new THREE.Object3D()],
        ['grandchild', new THREE.Object3D()],
      ]),
      targetRouteNodeId: 'grandchild',
      destinationStopId: 'target',
      startActorNodeId: 'vehicle-1',
      startPosition: new THREE.Vector3(0, 0, 0),
      actors: [actors[0]!],
    })).toBeNull()
  })
})
