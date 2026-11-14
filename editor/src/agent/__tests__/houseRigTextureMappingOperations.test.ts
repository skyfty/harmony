import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HOUSE_RIG_COMPONENT_TYPE } from '@schema/components'
import type { HouseRigComponentProps } from '@schema/houseRig'
import { createTextureSettings } from '@schema/material'
import { applySceneOperations } from '@/agent/operations'
import { useSceneStore } from '@/stores/sceneStore'
import { createHouseRigDefaultMaterial } from '@/utils/houseRigMaterialRuntime'

function createHouseRuntime(): THREE.Group {
  const root = new THREE.Group()
  for (const [index, name] of [
    '墙-前-内',
    '墙-前-外',
    '墙-后-内',
    '墙-后-外',
    '墙-左-内',
    '墙-左-外',
    '墙-右-内',
    '墙-右-外',
    '墙-上-内',
    '墙-上-外',
  ].entries()) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 2.8, 2.8),
      new THREE.MeshStandardMaterial(),
    )
    mesh.name = name
    mesh.position.y = 1.4
    mesh.position.x = (index % 2) * 0.02
    root.add(mesh)
  }
  return root
}

describe('Agent House Rig texture mapping operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  it('synchronizes repeat and physical tile size across House Rig PBR slots', async () => {
    const store = useSceneStore()
    store.currentSceneId = 'agent-house-rig-texture-test'
    store.currentSceneMeta = {
      name: 'Agent House Rig texture test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
    vi.spyOn(store, 'flushPendingSceneAutoSave').mockResolvedValue(null)
    const node = store.addSceneNode({
      nodeId: 'house-rig-texture-mapping',
      nodeType: 'Group',
      object: createHouseRuntime(),
      name: 'House Rig Texture Mapping',
      sourceAssetId: 'asset-house-rig',
    })
    const added = store.addNodeComponent(node.id, HOUSE_RIG_COMPONENT_TYPE)
    expect(added?.created).toBe(true)
    const component = added!.component
    const targetPart = {
      key: 'texture-mapping-part',
      objectPath: '0',
      meshName: '墙-前-外',
      role: 'wall' as const,
      side: 'front' as const,
      layer: 'outer' as const,
      material: null,
    }
    const material = createHouseRigDefaultMaterial(targetPart)
    material.textures = {
      albedo: {
        assetId: 'albedo-texture',
        settings: createTextureSettings({ repeat: { x: 3, y: 4 } }),
      },
      normal: {
        assetId: 'normal-texture',
        settings: createTextureSettings({ repeat: { x: 1, y: 1 } }),
      },
    }
    material.textureOverrides = ['albedo', 'normal']
    store.updateNodeComponentProps(node.id, component.id, {
      parts: [{ ...targetPart, material }],
    })
    vi.clearAllTimers()

    const revision = store.sceneRevision
    const undoCount = store.undoStack.length
    const refreshVersion = store.houseRigMaterialRefreshVersion
    const result = await applySceneOperations(store, {
      expectedRevision: revision,
      operations: [{
        op: 'domain.apply',
        domain: 'houseRig',
        action: 'set_texture_mapping',
        args: {
          nodeId: node.id,
          parts: [{
            partKey: targetPart.key,
            repeat: { x: 1, y: 1 },
            tileSizeMeters: { x: 5, y: 5 },
          }],
        },
      }],
    })

    expect(result.afterRevision).toBe(revision + 1)
    expect(store.undoStack).toHaveLength(undoCount + 1)
    expect(store.houseRigMaterialRefreshVersion).toBe(refreshVersion + 1)
    expect(store.houseRigMaterialRefreshNodeId).toBe(node.id)
    const updatedProps = store.getNodeById(node.id)
      ?.components?.[HOUSE_RIG_COMPONENT_TYPE]?.props as HouseRigComponentProps
    const updatedMaterial = updatedProps.parts[0]?.material
    expect(updatedMaterial?.textures.albedo?.settings?.repeat).toEqual({ x: 1, y: 1 })
    expect(updatedMaterial?.textures.normal?.settings?.repeat).toEqual({ x: 1, y: 1 })
    expect(updatedMaterial?.textures.albedo?.settings?.tileSizeMeters).toEqual({ x: 5, y: 5 })
    expect(updatedMaterial?.textures.normal?.settings?.tileSizeMeters).toEqual({ x: 5, y: 5 })
    expect(updatedMaterial?.textures.albedo?.settings?.wrapS).toBe('RepeatWrapping')
    expect(updatedMaterial?.textures.normal?.settings?.wrapT).toBe('RepeatWrapping')
    vi.clearAllTimers()
  })
})
