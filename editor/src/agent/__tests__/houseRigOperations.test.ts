import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applySceneOperations } from '@/agent/operations'
import { useSceneStore } from '@/stores/sceneStore'
import { HOUSE_RIG_COMPONENT_TYPE } from '@schema/components'
import type { HouseRigComponentProps } from '@schema/houseRig'
import {
  createHouseRigDefaultMaterial,
  createHouseRigMaterialSeedFromThreeMaterial,
} from '@/utils/houseRigMaterialRuntime'

const NAMES = [
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
]

function createHouseRuntime(): THREE.Group {
  const root = new THREE.Group()
  NAMES.forEach((name, index) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        name.includes('上') ? 3 : 0.04,
        name.includes('上') ? 1.2 : 2.8,
        name.includes('上') ? 3 : 2.8,
      ),
      new THREE.MeshStandardMaterial(),
    )
    mesh.name = name
    mesh.position.y = name.includes('上') ? 2.4 : 1.4
    mesh.position.x = (index % 2) * 0.02
    root.add(mesh)
  })
  return root
}

function setupStore() {
  setActivePinia(createPinia())
  const store = useSceneStore()
  store.currentSceneId = 'agent-house-rig-test'
  store.currentSceneMeta = {
    name: 'Agent House Rig test',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    projectId: 'agent-test-project',
  }
  store.isSceneReady = true
  vi.spyOn(store, 'flushPendingSceneAutoSave').mockResolvedValue(null)
  return store
}

describe('Agent House Rig operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('inspects without a revision change and applies dimensions atomically', async () => {
    const store = setupStore()
    const node = store.addSceneNode({
      nodeId: 'house-rig-agent',
      nodeType: 'Group',
      object: createHouseRuntime(),
      name: 'House Rig Agent',
      sourceAssetId: 'asset-house-rig',
    })
    const added = store.addNodeComponent(node.id, HOUSE_RIG_COMPONENT_TYPE)
    expect(added?.created).toBe(true)
    const component = store.getNodeById(node.id)?.components?.[HOUSE_RIG_COMPONENT_TYPE]
    const initialProps = component?.props as HouseRigComponentProps
    expect(initialProps.parts).toHaveLength(10)
    expect(initialProps.scriptId).toBe('basic-naming')

    const initialRevision = store.sceneRevision
    const initialUndo = store.undoStack.length
    const initialMaterialRefreshVersion = store.houseRigMaterialRefreshVersion
    const inspected = await applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [{
        op: 'domain.apply',
        domain: 'houseRig',
        action: 'inspect',
        args: { nodeId: node.id },
      }],
    })
    expect(inspected.afterRevision).toBe(initialRevision)
    expect(store.undoStack).toHaveLength(initialUndo)
    const inspection = inspected.results[0] as {
      parts: Array<{ meshName: string }>
      dimensions: { width: number; depth: number; wallHeight: number }
      limits: {
        width: { max: number | null }
        depth: { max: number | null }
        wallHeight: { max: number | null }
      }
      handles: Record<string, { x: number; y: number; z: number }>
    }
    expect(inspection.parts).toHaveLength(10)
    expect(inspection.handles).toHaveProperty('width')
    expect(inspection.limits.width.max).toBeNull()
    expect(inspection.limits.depth.max).toBeNull()
    expect(inspection.limits.wallHeight.max).toBeNull()

    const targetDimensions = {
      width: inspection.dimensions.width * 10,
      depth: inspection.dimensions.depth * 20,
      wallHeight: inspection.dimensions.wallHeight * 30,
    }
    const changed = await applySceneOperations(store, {
      expectedRevision: initialRevision,
      operations: [{
        op: 'domain.apply',
        domain: 'houseRig',
        action: 'set_dimensions',
        args: {
          nodeId: node.id,
          dimensions: targetDimensions,
        },
      }],
    })
    expect(changed.afterRevision).toBe(initialRevision + 1)
    expect(store.undoStack).toHaveLength(initialUndo + 1)
    expect(store.houseRigMaterialRefreshVersion).toBe(initialMaterialRefreshVersion + 1)
    const next = store.getNodeById(node.id)?.components?.[HOUSE_RIG_COMPONENT_TYPE]
      ?.props as HouseRigComponentProps
    expect(next.dimensions.width).toBeCloseTo(targetDimensions.width, 5)
    expect(next.dimensions.depth).toBeCloseTo(targetDimensions.depth, 5)
    expect(next.dimensions.wallHeight).toBeCloseTo(targetDimensions.wallHeight, 5)
    vi.clearAllTimers()
  })

  it('rejects stale revisions and unknown scripts without mutating the component', async () => {
    const store = setupStore()
    const node = store.addSceneNode({
      nodeId: 'house-rig-invalid',
      nodeType: 'Group',
      object: createHouseRuntime(),
      name: 'House Rig Invalid',
      sourceAssetId: 'asset-house-rig',
    })
    const added = store.addNodeComponent(node.id, HOUSE_RIG_COMPONENT_TYPE)
    expect(added?.created).toBe(true)
    const before = JSON.stringify(store.getNodeById(node.id)?.components?.[HOUSE_RIG_COMPONENT_TYPE]?.props)
    const revision = store.sceneRevision

    await expect(applySceneOperations(store, {
      expectedRevision: revision - 1,
      operations: [{
        op: 'domain.apply',
        domain: 'houseRig',
        action: 'set_dimensions',
        args: { nodeId: node.id, width: 5 },
      }],
    })).rejects.toMatchObject({ code: 'STALE_REVISION' })

    await expect(applySceneOperations(store, {
      expectedRevision: revision,
      operations: [{
        op: 'domain.apply',
        domain: 'houseRig',
        action: 'set_script',
        args: { nodeId: node.id, scriptId: 'missing-script' },
      }],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(JSON.stringify(store.getNodeById(node.id)?.components?.[HOUSE_RIG_COMPONENT_TYPE]?.props))
      .toBe(before)
    vi.clearAllTimers()
  })

  it('creates and updates one inherited part material lazily without touching siblings', () => {
    const store = setupStore()
    const node = store.addSceneNode({
      nodeId: 'house-rig-part-material',
      nodeType: 'Group',
      object: createHouseRuntime(),
      name: 'House Rig Part Material',
      sourceAssetId: 'asset-house-rig',
    })
    const added = store.addNodeComponent(node.id, HOUSE_RIG_COMPONENT_TYPE)
    expect(added?.created).toBe(true)
    const component = added!.component
    const part = {
      key: 'test-part',
      objectPath: '0',
      meshName: '墙-前-外',
      role: 'wall' as const,
      side: 'front' as const,
      layer: 'outer' as const,
      material: null,
    }
    expect(store.updateNodeComponentProps(node.id, component.id, { parts: [part] })).toBe(true)

    const seed = createHouseRigMaterialSeedFromThreeMaterial(
      new THREE.MeshStandardMaterial({ color: '#336699', roughness: 0.45 }),
      part,
    )
    const initialRevision = store.sceneRevision
    const initialUndo = store.undoStack.length
    const initialMaterialRefreshVersion = store.houseRigMaterialRefreshVersion
    const created = store.updateHouseRigPartMaterial(
      node.id,
      component!.id,
      part.key,
      {
        props: { color: '#5aa46f' },
        seed,
      },
      { autoSaveMode: 'interactive' },
    )

    expect(created?.color).toBe('#5aa46f')
    expect(created?.roughness).toBeCloseTo(0.45, 5)
    expect(created?.textureOverrides).toEqual([])
    expect(created?.editorPreviewEnvironment).toBe('neutral-pbr')
    expect(store.sceneRevision).toBe(initialRevision + 1)
    expect(store.undoStack).toHaveLength(initialUndo + 1)
    expect(store.houseRigMaterialRefreshVersion).toBe(initialMaterialRefreshVersion + 1)
    expect(store.houseRigMaterialRefreshNodeId).toBe(node.id)

    const updated = store.updateHouseRigPartMaterial(
      node.id,
      component!.id,
      part.key,
      {
        props: { roughness: 0.82 },
        metadata: { name: 'Front Wall Paint' },
      },
    )
    expect(updated?.id).toBe(created?.id)
    expect(updated?.name).toBe('Front Wall Paint')
    expect(updated?.roughness).toBeCloseTo(0.82, 5)
    expect(updated?.editorPreviewEnvironment).toBe('neutral-pbr')
    expect(store.houseRigMaterialRefreshVersion).toBe(initialMaterialRefreshVersion + 2)

    const nextProps = store.nodes.find((entry) => entry.id === node.id)
      ?.components?.[HOUSE_RIG_COMPONENT_TYPE]
      ?.props as HouseRigComponentProps
    expect(nextProps.parts[0]?.material?.id).toBe(created?.id)
    expect(nextProps.parts.slice(1).every((entry) => entry.material === null)).toBe(true)

    expect(store.clearHouseRigPartMaterial(node.id, component!.id, part.key)).toBe(true)
    const restored = store.nodes.find((entry) => entry.id === node.id)
      ?.components?.[HOUSE_RIG_COMPONENT_TYPE]
      ?.props as HouseRigComponentProps
    expect(restored.parts[0]?.material).toBeNull()

    const defaultSeed = createHouseRigDefaultMaterial(part)
    const defaultEdited = store.updateHouseRigPartMaterial(
      node.id,
      component!.id,
      part.key,
      {
        props: { roughness: 0.64 },
        seed: defaultSeed,
      },
    )
    expect(defaultEdited).toMatchObject({
      type: 'MeshStandardMaterial',
      color: '#ffffff',
      metalness: 0.1,
      roughness: 0.64,
      textureOverrides: [],
      editorPreviewEnvironment: 'neutral-pbr',
    })
    vi.clearAllTimers()
  })

  it('serializes pinned rig data into prefab payloads and isolates duplicated instances', () => {
    const store = setupStore()
    const node = store.addSceneNode({
      nodeId: 'house-rig-prefab',
      nodeType: 'Group',
      object: createHouseRuntime(),
      name: 'House Rig Prefab',
      sourceAssetId: 'asset-house-rig',
    })
    const added = store.addNodeComponent(node.id, HOUSE_RIG_COMPONENT_TYPE)
    expect(added?.created).toBe(true)
    const component = added!.component
    const props = component.props as unknown as HouseRigComponentProps
    store.updateNodeComponentProps(node.id, component!.id, {
      dimensions: {
        ...props.dimensions,
        width: props.dimensions.width * 1.25,
      },
    })

    const payload = store.createClipboardPrefabPayload([node.id], 'copy')
    expect(payload).toBeTruthy()
    const parsed = JSON.parse(payload!.serialized) as {
      roots: Array<{
        components?: Record<string, { props: HouseRigComponentProps }>
      }>
    }
    const serializedRig = parsed.roots[0]?.components?.houseRig?.props
    expect(serializedRig).toMatchObject({
      scriptId: 'basic-naming',
      scriptVersion: '1.0.0',
      dimensions: {
        width: props.dimensions.width * 1.25,
      },
    })
    expect(serializedRig?.parts).toHaveLength(10)

    const duplicateId = store.duplicateNodes([node.id], { select: false })[0]!
    const originalRig = store.getNodeById(node.id)?.components?.[HOUSE_RIG_COMPONENT_TYPE]
      ?.props as HouseRigComponentProps
    const duplicateRig = store.getNodeById(duplicateId)?.components?.[HOUSE_RIG_COMPONENT_TYPE]
      ?.props as HouseRigComponentProps
    expect(duplicateRig).not.toBe(originalRig)
    expect(duplicateRig.dimensions.width).toBeCloseTo(originalRig.dimensions.width, 6)

    store.updateNodeComponentProps(node.id, component!.id, {
      dimensions: {
        ...originalRig.dimensions,
        width: originalRig.dimensions.width * 1.5,
      },
    })
    const duplicateAfter = store.getNodeById(duplicateId)?.components?.[HOUSE_RIG_COMPONENT_TYPE]
      ?.props as HouseRigComponentProps
    expect(duplicateAfter.dimensions.width).toBeCloseTo(originalRig.dimensions.width, 6)
    vi.clearAllTimers()
  })
})
