import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { PointerDownResult } from '../types'
import { handlePointerDownSelection } from '../downSelection'

function createPointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 200,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as PointerEvent
}

function createContext(prefetchedHit: ReturnType<typeof createHit> | null | undefined) {
  const hit = createHit()
  const pickNodeAtPointer = vi.fn(() => hit)
  const createSelectionDrag = vi.fn(() => ({ nodeId: hit.nodeId }))
  return {
    ctx: {
      activeTool: 'select',
      selectedNodeIdProp: hit.nodeId,
      sceneSelectedNodeId: hit.nodeId,
      selectedNodeIds: [hit.nodeId],
      nodes: [{ id: hit.nodeId, nodeType: 'Group', children: [], components: {} }],
      findSceneNode: () => ({ id: hit.nodeId, nodeType: 'Group', children: [], components: {} }),
      isNodeSelectionLocked: () => false,
      isDescendant: () => false,
      duplicateNodes: () => [],
      ensureSceneAssetsReady: async () => {},
      nextTick: async () => {},
      objectMap: new Map([[hit.nodeId, hit.object]]),
      pickNodeAtPointer,
      pickActiveSelectionBoundingBoxHit: () => null,
      prefetchedHit,
      transformControlsDragging: false,
      transformControlsAxis: null,
      cameraControlMode: 'map' as const,
      createSelectionDragState: createSelectionDrag,
      disableOrbitForSelectDrag: vi.fn(),
    } as unknown as Parameters<typeof handlePointerDownSelection>[1],
    pickNodeAtPointer,
    createSelectionDrag,
  }
}

function createHit() {
  return {
    nodeId: 'selected-node',
    object: new THREE.Object3D(),
    point: new THREE.Vector3(1, 2, 3),
  }
}

describe('handlePointerDownSelection camera-aware picking', () => {
  it('reuses an active-selection hit without running a full scene pick', async () => {
    const hit = createHit()
    const { ctx, pickNodeAtPointer, createSelectionDrag } = createContext(hit)
    const result = await handlePointerDownSelection(createPointerEvent(), ctx)

    expect(pickNodeAtPointer).not.toHaveBeenCalled()
    expect(createSelectionDrag).toHaveBeenCalledOnce()
    expect((result as PointerDownResult).nextPointerTrackingState?.hitResult).toBe(hit)
  })

  it('still performs the normal pick when no prefetched selection hit is supplied', async () => {
    const { ctx, pickNodeAtPointer } = createContext(undefined)
    await handlePointerDownSelection(createPointerEvent(), ctx)

    expect(pickNodeAtPointer).toHaveBeenCalledOnce()
  })
})
