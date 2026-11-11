import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneMaterialProps, SceneNode, SceneNodeMaterial } from '@schema/core'
import { applySceneOperations } from '@/agent/operations'
import { queryScene } from '@/agent/query'
import { useSceneStore } from '@/stores/sceneStore'

const GLASS_PROPS: Partial<SceneMaterialProps> = {
  color: '#f4fbff',
  transparent: true,
  opacity: 0.42,
  transmission: 0.85,
  roughness: 0.08,
  metalness: 0,
  ior: 1.45,
  thickness: 0.08,
  clearcoat: 0.1,
  clearcoatRoughness: 0.04,
  attenuationColor: '#ffffff',
  attenuationDistance: 4,
  envMapIntensity: 0.65,
  side: 'double',
}

function createNodeMaterial(id = 'panel-material'): SceneNodeMaterial {
  return {
    id,
    name: 'Panel Material',
    type: 'MeshStandardMaterial',
    color: '#4b4f55',
    transparent: false,
    opacity: 1,
    side: 'front',
    wireframe: false,
    metalness: 0.1,
    roughness: 0.8,
    emissive: '#000000',
    emissiveIntensity: 0,
    aoStrength: 1,
    envMapIntensity: 1,
    textures: {},
  }
}

function addPanelNode(): { store: ReturnType<typeof useSceneStore>; node: SceneNode } {
  const store = useSceneStore()
  const object = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial(),
  )
  object.name = 'Glass Panel'
  const node = store.addSceneNode({
    nodeType: 'Plane',
    object,
    name: object.name,
  })
  node.materials = [createNodeMaterial()]
  return { store, node }
}

describe('Agent material operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const store = useSceneStore()
    store.currentSceneId = 'agent-material-test'
    store.currentSceneMeta = {
      name: 'Agent material test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
    vi.spyOn(store, 'flushPendingSceneAutoSave').mockResolvedValue(null)
  })

  it('creates a physical material with the standard glass defaults', async () => {
    const store = useSceneStore()
    const result = await applySceneOperations(store, {
      operations: [{
        op: 'material.create',
        name: 'Agent glass',
        type: 'MeshPhysicalMaterial',
      }],
    })

    const created = store.materials.find((material) => material.name === 'Agent glass')
    expect(created).toMatchObject({
      type: 'MeshPhysicalMaterial',
      transparent: true,
      transmission: 0.75,
      roughness: 0.02,
      side: 'double',
    })
    expect(result.afterRevision).toBe(result.beforeRevision + 1)
    vi.clearAllTimers()
  })

  it('changes type and properties in one revision and returns full query props', async () => {
    const { store, node } = addPanelNode()
    const material = node.materials![0]!
    material.textures = { albedo: { assetId: 'texture-panel' } }
    const initialRevision = store.sceneRevision
    const initialUndoCount = store.undoStack.length

    const result = await applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [{
        op: 'material.update',
        nodeId: node.id,
        nodeMaterialId: material.id,
        type: 'MeshPhysicalMaterial',
        patch: GLASS_PROPS,
      }],
    })

    expect(result.afterRevision).toBe(initialRevision + 1)
    expect(store.undoStack).toHaveLength(initialUndoCount + 1)
    expect(store.getNodeById(node.id)?.materials?.[0]).toMatchObject({
      type: 'MeshPhysicalMaterial',
      name: 'Panel Material',
      ...GLASS_PROPS,
      textures: { albedo: { assetId: 'texture-panel' } },
    })

    const query = queryScene(store, {
      nodeId: node.id,
      includeMaterials: true,
    })
    expect(query.nodes[0]?.materials?.[0]).toMatchObject({
      id: material.id,
      type: 'MeshPhysicalMaterial',
      textureAssetIds: ['texture-panel'],
      props: {
        ...GLASS_PROPS,
        textures: { albedo: { assetId: 'texture-panel' } },
      },
    })
    expect(() => JSON.stringify(query)).not.toThrow()
    vi.clearAllTimers()
  })

  it('rolls back the whole batch when a later material update is invalid', async () => {
    const { store, node } = addPanelNode()
    const material = node.materials![0]!
    const initialRevision = store.sceneRevision
    const initialUndoCount = store.undoStack.length

    await expect(applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [
        {
          op: 'material.update',
          nodeId: node.id,
          nodeMaterialId: material.id,
          type: 'MeshPhysicalMaterial',
        },
        {
          op: 'material.update',
          nodeId: node.id,
          nodeMaterialId: material.id,
          patch: { opacity: 1.5 },
        },
      ],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(store.sceneRevision).toBe(initialRevision)
    expect(store.undoStack).toHaveLength(initialUndoCount)
    expect(store.getNodeById(node.id)?.materials?.[0]).toMatchObject({
      type: 'MeshStandardMaterial',
      opacity: 1,
    })
    vi.clearAllTimers()
  })

  it('rejects unknown material types and slots without changing history', async () => {
    const { store, node } = addPanelNode()
    const initialRevision = store.sceneRevision
    const initialUndoCount = store.undoStack.length

    await expect(applySceneOperations(store, {
      operations: [{
        op: 'material.update',
        nodeId: node.id,
        nodeMaterialId: 'missing-material',
        type: 'MeshPhysicalMaterial',
      }],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    await expect(applySceneOperations(store, {
      operations: [{
        op: 'material.create',
        type: 'NotAMaterial' as never,
      }],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(store.sceneRevision).toBe(initialRevision)
    expect(store.undoStack).toHaveLength(initialUndoCount)
    vi.clearAllTimers()
  })
})
