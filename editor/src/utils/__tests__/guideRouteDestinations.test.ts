import { describe, expect, it } from 'vitest'

import type { SceneNode } from '@schema/core'
import {
  clampGuideRouteComponentProps,
  createGuidePathRouteLeg,
  type GuideRouteTravelMode,
} from '@schema/components'
import { collectGuideRouteDestinations } from '@schema/guideRouteDestinations'
import { selectNearestGuideRouteActorNodeId } from '@schema/guideRouteActorSelection'

function routeNode(id: string, name: string, travelMode: GuideRouteTravelMode): SceneNode {
  return {
    id,
    name,
    nodeType: 'Mesh',
    dynamicMesh: { type: 'GuideRoute', vertices: [] },
    components: {
      guideRoute: {
        id: `component-${id}`,
        type: 'guideRoute',
        enabled: true,
        props: clampGuideRouteComponentProps({
          loop: false,
          legs: [createGuidePathRouteLeg({
            id: `leg-${id}`,
            travelMode,
            anchors: [
              { x: 0, y: 0, z: 0 },
              { x: 10, y: 0, z: 0 },
            ],
          })],
          stops: [
            {
              id: `stop-${id}`,
              name: `Stop ${id}`,
              thumbnailAssetId: `thumb-${id}`,
              anchor: { x: 5, y: 0, z: 0 },
              legId: `leg-${id}`,
              behavior: null,
            },
            {
              id: `no-image-${id}`,
              name: 'No image',
              thumbnailAssetId: null,
              anchor: { x: 8, y: 0, z: 0 },
              legId: `leg-${id}`,
              behavior: null,
            },
          ],
          transitions: [],
        }),
      },
    },
  } as unknown as SceneNode
}

describe('Guide Route destination catalog', () => {
  it('collects thumbnail destinations across routes in scene order', () => {
    const destinations = collectGuideRouteDestinations([
      routeNode('a', 'Scenic A', 'vehicle'),
      routeNode('b', 'Scenic B', 'character'),
    ])
    expect(destinations).toEqual([
      expect.objectContaining({
        routeNodeId: 'a',
        stopId: 'stop-a',
        travelMode: 'vehicle',
      }),
      expect.objectContaining({
        routeNodeId: 'b',
        stopId: 'stop-b',
        travelMode: 'character',
      }),
    ])
  })

  it('ignores disabled routes', () => {
    const disabled = routeNode('disabled', 'Disabled', 'vehicle')
    disabled.components!.guideRoute!.enabled = false
    expect(collectGuideRouteDestinations([disabled])).toEqual([])
  })

  it('prefers the current actor and otherwise selects the nearest compatible actor', () => {
    const candidates = [
      { nodeId: 'vehicle-far', kind: 'vehicle' as const, position: { x: 50, y: 0, z: 0 } },
      { nodeId: 'vehicle-near', kind: 'vehicle' as const, position: { x: 4, y: 0, z: 0 } },
      { nodeId: 'character', kind: 'character' as const, position: { x: 1, y: 0, z: 0 } },
    ]
    expect(selectNearestGuideRouteActorNodeId({
      candidates,
      requiredMode: 'vehicle',
      referencePosition: { x: 0, y: 0, z: 0 },
    })).toBe('vehicle-near')
    expect(selectNearestGuideRouteActorNodeId({
      candidates,
      requiredMode: 'vehicle',
      preferredNodeId: 'vehicle-far',
      referencePosition: { x: 0, y: 0, z: 0 },
    })).toBe('vehicle-far')
  })

  it('supports Both as a route capability without inventing a Both actor', () => {
    const destinations = collectGuideRouteDestinations([
      routeNode('both', 'Shared route', 'both'),
    ])
    const candidates = [
      { nodeId: 'vehicle', kind: 'vehicle' as const, position: { x: 10, y: 0, z: 0 } },
      { nodeId: 'character', kind: 'character' as const, position: { x: 1, y: 0, z: 0 } },
    ]

    expect(destinations[0]?.travelMode).toBe('both')
    expect(selectNearestGuideRouteActorNodeId({
      candidates,
      requiredMode: 'both',
      preferredNodeId: 'vehicle',
      referencePosition: { x: 0, y: 0, z: 0 },
    })).toBe('vehicle')
    expect(selectNearestGuideRouteActorNodeId({
      candidates,
      requiredMode: 'both',
      referencePosition: { x: 0, y: 0, z: 0 },
    })).toBe('character')
  })
})
