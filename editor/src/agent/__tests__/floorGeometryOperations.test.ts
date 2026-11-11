import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FloorDynamicMesh, SceneNode } from '@schema/core'
import { applySceneOperations } from '@/agent/operations'
import { queryScene } from '@/agent/query'
import { useSceneStore } from '@/stores/sceneStore'

function addFloorNode(
  store: ReturnType<typeof useSceneStore>,
  options: {
    id: string
    vertices?: FloorDynamicMesh['vertices']
    position?: { x: number; y: number; z: number }
  },
): SceneNode {
  const runtime = new THREE.Group()
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 4),
    new THREE.MeshBasicMaterial(),
  )
  surface.rotation.x = -Math.PI / 2
  runtime.add(surface)
  return store.addSceneNode({
    nodeId: options.id,
    nodeType: 'Mesh',
    object: runtime,
    name: 'Geometry Floor',
    position: options.position ?? { x: 0, y: 0, z: 0 },
    dynamicMesh: {
      type: 'Floor',
      vertices: options.vertices ?? [[-1, -2], [1, -2], [1, 2], [-1, 2]],
      smooth: 0,
      thickness: 0.1,
      sideUvScale: { x: 1, y: 1 },
    },
  })
}

describe('Agent Floor geometry operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const store = useSceneStore()
    store.currentSceneId = 'agent-floor-geometry-test'
    store.currentSceneMeta = {
      name: 'Agent floor geometry test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
    vi.spyOn(store, 'flushPendingSceneAutoSave').mockResolvedValue(null)
  })

  it('queries serializable Floor vertices and local/world bounds', () => {
    const store = useSceneStore()
    const node = addFloorNode(store, {
      id: 'floor-geometry-query',
      position: { x: 5, y: 2, z: -3 },
    })

    const result = queryScene(store, {
      nodeId: node.id,
      includeGeometry: true,
    })
    const geometry = result.nodes[0]?.geometry

    expect(geometry?.floorVertices).toEqual([[-1, -2], [1, -2], [1, 2], [-1, 2]])
    expect(geometry?.worldFloorVertices?.[0]).toEqual({ x: 4, y: 2, z: -5 })
    expect(geometry?.worldBounds?.center).toMatchObject({ x: 5, y: 2, z: -3 })
    expect(geometry?.worldBounds?.size.x).toBeCloseTo(2)
    expect(geometry?.worldBounds?.size.z).toBeCloseTo(4)
    expect(() => JSON.stringify(result)).not.toThrow()
    vi.clearAllTimers()
  })

  it('updates Floor vertices in one revision and one undo entry', async () => {
    const store = useSceneStore()
    const node = addFloorNode(store, { id: 'floor-geometry-update' })
    const updateSpy = vi.spyOn(store, 'updateNodeDynamicMesh')
    const initialRevision = store.sceneRevision
    const initialUndoCount = store.undoStack.length
    const vertices = [[-2, -3], [0, -3], [1, 0], [0, 3], [-2, 3]]

    const result = await applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [{
        op: 'domain.apply',
        domain: 'builder',
        action: 'update_floor_geometry',
        args: {
          nodeId: node.id,
          vertices,
          thickness: 0.25,
          smooth: 0.2,
          sideUvScale: { x: 2, y: 3 },
        },
      }],
    })

    expect(updateSpy).toHaveBeenCalledOnce()
    expect(result.afterRevision).toBe(initialRevision + 1)
    expect(store.undoStack).toHaveLength(initialUndoCount + 1)
    expect(store.getNodeById(node.id)?.dynamicMesh).toMatchObject({
      type: 'Floor',
      vertices,
      thickness: 0.25,
      smooth: 0.2,
      sideUvScale: { x: 2, y: 3 },
    })
    vi.clearAllTimers()
  })

  it('rejects degenerate and self-intersecting polygons without changing history', async () => {
    const store = useSceneStore()
    const node = addFloorNode(store, { id: 'floor-geometry-invalid' })
    const initialRevision = store.sceneRevision
    const initialUndoCount = store.undoStack.length

    await expect(applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [{
        op: 'domain.apply',
        domain: 'builder',
        action: 'update_floor_geometry',
        args: {
          nodeId: node.id,
          vertices: [[0, 0], [1, 1], [0, 1], [1, 0]],
        },
      }],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(store.sceneRevision).toBe(initialRevision)
    expect(store.undoStack).toHaveLength(initialUndoCount)
    expect(store.getNodeById(node.id)?.dynamicMesh?.type).toBe('Floor')
    vi.clearAllTimers()
  })

  it('rolls back a mixed batch when geometry is invalid', async () => {
    const store = useSceneStore()
    const node = addFloorNode(store, { id: 'floor-geometry-rollback' })
    const initialRevision = store.sceneRevision
    const initialUndoCount = store.undoStack.length

    await expect(applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [
        {
          op: 'node.update',
          nodeId: node.id,
          local: {
            rotation: { x: 0.4, y: 0, z: 0 },
          },
        },
        {
          op: 'domain.apply',
          domain: 'builder',
          action: 'update_floor_geometry',
          args: {
            nodeId: node.id,
            vertices: [[0, 0], [0, 0], [1, 0]],
          },
        },
      ],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(store.sceneRevision).toBe(initialRevision)
    expect(store.undoStack).toHaveLength(initialUndoCount)
    expect(store.getNodeById(node.id)?.rotation.x).toBe(0)
    vi.clearAllTimers()
  })
})
