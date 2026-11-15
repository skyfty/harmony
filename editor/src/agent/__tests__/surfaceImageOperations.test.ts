import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applySceneOperations } from '@/agent/operations'
import { queryScene } from '@/agent/query'
import {
  clearRuntimeObjectRegistry,
  registerRuntimeObject,
  resetSceneNodeIndexCache,
  useSceneStore,
} from '@/stores/sceneStore'
import {
  extractSurfaceImageMetadataFromUserData,
} from '@/utils/surfaceImageDecal'

function addSurfaceImageFixture() {
  const store = useSceneStore()
  const targetRoot = new THREE.Group()
  targetRoot.add(new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  ))
  registerRuntimeObject('surface-agent-target', targetRoot)
  store.nodes = [{
    id: 'surface-agent-target',
    name: 'Surface Agent Target',
    nodeType: 'Group',
    sourceAssetId: 'source-model',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
  }]
  store.bumpSceneGraphStructureVersion()
  const created = store.createSurfaceImageNode({
    assetId: 'surface-agent-image',
    targetNodeId: 'surface-agent-target',
    geometry: {
      version: 3,
      vertices: [
        -0.5, -0.25, 0,
        0.5, -0.25, 0,
        0.5, 0.25, 0,
      ],
      indices: [0, 1, 2],
      uvs: [0, 0, 1, 0, 1, 1],
    },
    worldCenter: new THREE.Vector3(0, 0, 0.002),
    worldQuaternion: new THREE.Quaternion(),
    widthMeters: 1,
    heightMeters: 0.5,
  })
  if (!created) {
    throw new Error('Failed to create Surface Image fixture')
  }
  return created.node
}

describe('Agent Surface Image operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    resetSceneNodeIndexCache()
    const store = useSceneStore()
    store.currentSceneId = 'agent-surface-image-test'
    store.currentSceneMeta = {
      name: 'Agent Surface Image test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
    vi.spyOn(store, 'flushPendingSceneAutoSave').mockResolvedValue(null)
  })

  it('moves a Surface Image through the semantic operation and persists metadata lookup', async () => {
    const store = useSceneStore()
    const node = addSurfaceImageFixture()
    const initialRevision = store.sceneRevision

    const result = await applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [{
        op: 'surface_image.move',
        nodeId: node.id,
        worldPosition: { x: 0.4, y: 0.2, z: 0.01 },
      }],
    })

    expect(result.afterRevision).toBe(initialRevision + 1)
    expect(result.results[0]).toMatchObject({
      changed: true,
      reason: 'MOVED',
      targetNodeId: 'surface-agent-target',
    })
    const moved = store.getNodeById(node.id)!
    expect(moved.position.x).toBeCloseTo(0.4, 2)
    expect(moved.position.y).toBeCloseTo(0.2, 2)
    expect(extractSurfaceImageMetadataFromUserData(moved.userData)?.targetNodeId)
      .toBe('surface-agent-target')
    expect(queryScene(store, {
      nodeId: node.id,
      includeGeometry: true,
    }).nodes[0]?.surfaceImage).toMatchObject({
      targetNodeId: 'surface-agent-target',
      attachmentMode: 'world',
      widthMeters: 1,
      heightMeters: 0.5,
    })
    clearRuntimeObjectRegistry()
    vi.clearAllTimers()
  })

  it('rejects rotation and scale on Surface Image node.update', async () => {
    const store = useSceneStore()
    const node = addSurfaceImageFixture()
    const initialRevision = store.sceneRevision

    await expect(applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [{
        op: 'node.update',
        nodeId: node.id,
        local: {
          rotation: { x: 0, y: 0.2, z: 0 },
        },
      }],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(store.sceneRevision).toBe(initialRevision)
    clearRuntimeObjectRegistry()
    vi.clearAllTimers()
  })

  it('leaves scene state unchanged when the requested position misses the target surface', async () => {
    const store = useSceneStore()
    const node = addSurfaceImageFixture()
    const initialRevision = store.sceneRevision
    const beforeNode = JSON.parse(JSON.stringify(store.getNodeById(node.id)))

    await expect(applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [{
        op: 'surface_image.move',
        nodeId: node.id,
        worldPosition: { x: 30, y: 30, z: 30 },
      }],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(store.sceneRevision).toBe(initialRevision)
    const unchangedNode = store.getNodeById(node.id)!
    expect(unchangedNode.position).toEqual(beforeNode.position)
    expect(unchangedNode.rotation.x).toBeCloseTo(beforeNode.rotation.x, 8)
    expect(unchangedNode.rotation.y).toBeCloseTo(beforeNode.rotation.y, 8)
    expect(unchangedNode.rotation.z).toBeCloseTo(beforeNode.rotation.z, 8)
    expect(unchangedNode.userData).toEqual(beforeNode.userData)
    clearRuntimeObjectRegistry()
    vi.clearAllTimers()
  })

  it('rejects a stale revision before touching scene state', async () => {
    const store = useSceneStore()
    const node = addSurfaceImageFixture()
    const initialRevision = store.sceneRevision

    await expect(applySceneOperations(store, {
      expectedRevision: initialRevision + 1,
      operations: [{
        op: 'surface_image.move',
        nodeId: node.id,
        worldPosition: { x: 0.2, y: 0.2, z: 0 },
      }],
    })).rejects.toMatchObject({ code: 'STALE_REVISION' })

    expect(store.sceneRevision).toBe(initialRevision)
    clearRuntimeObjectRegistry()
    vi.clearAllTimers()
  })
})
