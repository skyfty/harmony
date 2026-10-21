import { describe, expect, it } from 'vitest'

import type { SceneNode } from '@schema/core'
import {
  canNodeUseRuntimeModelInstancing,
  collectRuntimeModelNodesByAssetId,
  refreshRuntimeModelInstancingPolicy,
} from '@schema/runtimeModelInstancing'
import { collectRuntimeModelNodesByAssetId as collectEditorRuntimeModelNodesByAssetId } from '@/utils/sceneAssetCollectors'

function createNode(
  id: string,
  overrides: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name: id,
    nodeType: 'Mesh',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    children: [],
    components: {},
    ...overrides,
  } as SceneNode
}

function createVehicleTree(vehicleEnabled = true): {
  nodes: SceneNode[]
  vehicle: SceneNode
  body: SceneNode
  wheel: SceneNode
  outside: SceneNode
} {
  const wheel = createNode('wheel', {
    sourceAssetId: 'wheel.glb',
  })
  const body = createNode('body', {
    sourceAssetId: 'body.glb',
    children: [wheel],
  })
  const vehicle = createNode('vehicle', {
    nodeType: 'Group',
    children: [body],
    components: {
      vehicle: {
        id: 'vehicle-component',
        type: 'vehicle',
        enabled: vehicleEnabled,
        props: {},
      },
    } as any,
  })
  const outside = createNode('outside', {
    sourceAssetId: 'body.glb',
  })
  return { nodes: [vehicle, outside], vehicle, body, wheel, outside }
}

describe('runtime model instancing policy', () => {
  it('forces an enabled Vehicle and all descendants to use real meshes', () => {
    const { nodes, vehicle, body, wheel, outside } = createVehicleTree()

    const forcedIds = refreshRuntimeModelInstancingPolicy(nodes)

    expect(forcedIds).toEqual(new Set([vehicle.id, body.id, wheel.id]))
    expect(canNodeUseRuntimeModelInstancing(vehicle)).toBe(false)
    expect(canNodeUseRuntimeModelInstancing(body)).toBe(false)
    expect(canNodeUseRuntimeModelInstancing(wheel)).toBe(false)
    expect(canNodeUseRuntimeModelInstancing(outside)).toBe(true)
    expect(JSON.stringify(vehicle)).not.toContain('forceRealModelInstancing')
  })

  it('restores normal instancing eligibility after Vehicle is disabled', () => {
    const { nodes, vehicle, body, wheel } = createVehicleTree()
    refreshRuntimeModelInstancingPolicy(nodes)

    const component = vehicle.components!.vehicle as any
    component.enabled = false
    refreshRuntimeModelInstancingPolicy(nodes)

    expect(canNodeUseRuntimeModelInstancing(vehicle)).toBe(true)
    expect(canNodeUseRuntimeModelInstancing(body)).toBe(true)
    expect(canNodeUseRuntimeModelInstancing(wheel)).toBe(true)
  })

  it('keeps Vehicle assets in both collectors while skipping instance preparation', () => {
    const { nodes } = createVehicleTree()

    refreshRuntimeModelInstancingPolicy(nodes)
    const sharedAssets = collectRuntimeModelNodesByAssetId(nodes)
    const editorAssets = collectEditorRuntimeModelNodesByAssetId(nodes)

    expect(sharedAssets.get('body.glb')?.map((node) => node.id).sort()).toEqual(['body', 'outside'])
    expect(sharedAssets.get('wheel.glb')?.map((node) => node.id)).toEqual(['wheel'])
    expect(editorAssets.get('body.glb')?.map((node) => node.id).sort()).toEqual(['body', 'outside'])
    expect(editorAssets.get('wheel.glb')?.map((node) => node.id)).toEqual(['wheel'])
  })
})
