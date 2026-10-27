import { describe, expect, it, vi } from 'vitest'

import { createSceneStoreFloorHelpers } from '@/stores/sceneStoreFloor'

function createFloorHelpers() {
  return createSceneStoreFloorHelpers({
    createFloorNodeMaterials: vi.fn(() => []),
    createNodeMaterial: vi.fn(),
    getRuntimeObject: vi.fn(() => null),
    updateFloorGroup: vi.fn(),
  } as never)
}

describe('floor placement center', () => {
  it('uses the sampled surface height at the polygon center', () => {
    const result = createFloorHelpers().buildFloorDynamicMeshFromWorldPoints([
      { x: 0, y: 20, z: 0 },
      { x: 40, y: 30, z: 0 },
      { x: 40, y: 35, z: 30 },
      { x: 0, y: 25, z: 30 },
    ], { centerY: 27.5 })

    expect(result?.center.x).toBeCloseTo(20)
    expect(result?.center.y).toBeCloseTo(27.5)
    expect(result?.center.z).toBeCloseTo(15)
  })

  it('preserves legacy first-point height when no center sample is supplied', () => {
    const result = createFloorHelpers().buildFloorDynamicMeshFromWorldPoints([
      { x: 0, y: 20, z: 0 },
      { x: 40, y: 30, z: 0 },
      { x: 40, y: 35, z: 30 },
    ])

    expect(result?.center.y).toBeCloseTo(20)
  })
})
