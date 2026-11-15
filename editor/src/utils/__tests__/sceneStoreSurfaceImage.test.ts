import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SceneNode } from '@schema/core'
import {
  extractCompiledStaticMeshMetadataFromUserData,
  type CompiledStaticMeshMetadata,
} from '@schema/compiledStaticMesh'
import {
  clearRuntimeObjectRegistry,
  getRuntimeObject,
  registerRuntimeObject,
  resetSceneNodeIndexCache,
  useSceneStore,
} from '@/stores/sceneStore'
import {
  SURFACE_IMAGE_USERDATA_KEY,
  createSurfaceImageRuntimeMesh,
  extractSurfaceImageMetadataFromUserData,
} from '@/utils/surfaceImageDecal'

const geometry: CompiledStaticMeshMetadata = {
  version: 3,
  vertices: [
    -0.5, -0.25, 0,
    0.5, -0.25, 0,
    0.5, 0.25, 0,
  ],
  indices: [0, 1, 2],
  uvs: [0, 0, 1, 0, 1, 1],
}

function makeNode(payload: Partial<SceneNode> & Pick<SceneNode, 'id' | 'name' | 'nodeType'>): SceneNode {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    ...payload,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetSceneNodeIndexCache()
})

describe('scene store surface images', () => {
  it('creates one compiled mesh node under the nearest capable ancestor and preserves world position', async () => {
    const store = useSceneStore()
    const group = makeNode({
      id: 'surface-parent',
      name: 'Decor Parent',
      nodeType: 'Group',
      position: { x: 10, y: 0, z: 0 },
      groupExpanded: true,
      children: [
        makeNode({
          id: 'surface-target',
          name: 'Wall',
          nodeType: 'Mesh',
        }),
      ],
    })
    store.nodes = [group]

    const result = store.createSurfaceImageNode({
      assetId: 'image-1',
      assetName: 'mural.png',
      targetNodeId: 'surface-target',
      geometry,
      worldCenter: new THREE.Vector3(12, 2, 3),
      worldQuaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      widthMeters: 1,
      heightMeters: 0.5,
    })

    expect(result).not.toBeNull()
    expect(result!.attachmentMode).toBe('ancestor')
    expect(result!.node.position.x).toBeCloseTo(2, 6)
    expect(result!.node.position.y).toBeCloseTo(2, 6)
    expect(result!.node.position.z).toBeCloseTo(3, 6)
    expect(result!.node.userData?.[SURFACE_IMAGE_USERDATA_KEY]).toBeTruthy()
    expect(extractCompiledStaticMeshMetadataFromUserData(result!.node.userData)).toEqual(geometry)
    expect(result!.node.materials?.[0]?.type).toBe('MeshBasicMaterial')
    expect(extractSurfaceImageMetadataFromUserData(result!.node.userData)).toEqual({
      version: 1,
      assetId: 'image-1',
      targetNodeId: 'surface-target',
      attachmentMode: 'ancestor',
      widthMeters: 1,
      heightMeters: 0.5,
    })
    expect(store.nodes[0]?.children?.some((node) => node.id === result!.node.id)).toBe(true)
    clearRuntimeObjectRegistry()
    expect(getRuntimeObject(result!.node.id)).toBeNull()
    const fallbackRuntime = createSurfaceImageRuntimeMesh(result!.node)
    expect(fallbackRuntime?.geometry.getAttribute('position').count).toBe(3)
    expect(fallbackRuntime?.geometry.getAttribute('uv').count).toBe(3)
    expect(store.rebuildGeneratedMeshRuntimes()).toBeGreaterThan(0)
    const rebuiltRuntime = getRuntimeObject(result!.node.id) as THREE.Mesh | null
    expect(rebuiltRuntime?.isMesh).toBe(true)
    expect(rebuiltRuntime?.geometry.getAttribute('position').count).toBe(3)
    expect(rebuiltRuntime?.geometry.getAttribute('uv').count).toBe(3)
    expect(store.canUndo).toBe(true)
    await store.undo()
    expect(store.nodes[0]?.children?.some((node) => node.id === result!.node.id) ?? false).toBe(false)
    expect(store.canUndo).toBe(false)
  })

  it('falls back to a world-space node when no scene ancestor can contain children', () => {
    const store = useSceneStore()
    store.nodes = [
      makeNode({
        id: 'world-target',
        name: 'Wall',
        nodeType: 'Mesh',
      }),
    ]

    const result = store.createSurfaceImageNode({
      assetId: 'image-2',
      targetNodeId: 'world-target',
      geometry,
      worldCenter: new THREE.Vector3(1, 2, 3),
      worldQuaternion: new THREE.Quaternion(),
      widthMeters: 1,
      heightMeters: 1,
    })

    expect(result?.attachmentMode).toBe('world')
    expect(result?.node.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(extractSurfaceImageMetadataFromUserData(result?.node.userData)?.attachmentMode).toBe('world')
  })

  it('uses world space when a non-uniform parent transform would shear the decal', () => {
    const store = useSceneStore()
    store.nodes = [
      makeNode({
        id: 'scaled-parent',
        name: 'Scaled Parent',
        nodeType: 'Group',
        scale: { x: 2, y: 1, z: 1 },
        groupExpanded: true,
        children: [
          makeNode({
            id: 'scaled-target',
            name: 'Scaled Wall',
            nodeType: 'Mesh',
          }),
        ],
      }),
    ]

    const result = store.createSurfaceImageNode({
      assetId: 'image-3',
      targetNodeId: 'scaled-target',
      geometry,
      worldCenter: new THREE.Vector3(2, 3, 4),
      worldQuaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4),
      widthMeters: 1,
      heightMeters: 0.5,
    })

    expect(result?.attachmentMode).toBe('world')
    expect(result?.node.position).toEqual({ x: 2, y: 3, z: 4 })
  })

  it('preserves the surface image local transform when copying and pasting its parent group', async () => {
    const store = useSceneStore()
    const group = makeNode({
      id: 'copy-group',
      name: 'Group 1',
      nodeType: 'Group',
      position: { x: 6, y: 2, z: -4 },
      rotation: { x: 0.1, y: 0.45, z: -0.2 },
      scale: { x: 1, y: 1, z: 1 },
      groupExpanded: true,
      children: [
        makeNode({
          id: 'copy-wall',
          name: 'Wall',
          nodeType: 'Mesh',
          position: { x: 2, y: 1, z: 0.5 },
        }),
      ],
    })
    store.nodes = [group]

    const surface = store.createSurfaceImageNode({
      assetId: 'copy-image',
      targetNodeId: 'copy-wall',
      geometry,
      worldCenter: new THREE.Vector3(8.5, 4.25, -3),
      worldQuaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.35),
      widthMeters: 1,
      heightMeters: 0.5,
    })
    expect(surface).not.toBeNull()

    const originalSurface = store.getNodeById(surface!.node.id)!
    const originalTransform = {
      position: { ...originalSurface.position },
      rotation: { ...originalSurface.rotation },
      scale: { ...originalSurface.scale },
    }
    expect(store.copyNodes([group.id])).toBe(true)
    expect(await store.pasteClipboard(null)).toBe(true)

    const pastedGroup = store.nodes.find((node) => node.id !== group.id && node.name === group.name)
    expect(pastedGroup).toBeTruthy()
    const pastedSurface = pastedGroup!.children?.find(
      (node) => extractSurfaceImageMetadataFromUserData(node.userData)?.assetId === 'copy-image',
    )
    expect(pastedSurface).toBeTruthy()
    expect(pastedSurface!.position.x).toBeCloseTo(originalTransform.position.x, 8)
    expect(pastedSurface!.position.y).toBeCloseTo(originalTransform.position.y, 8)
    expect(pastedSurface!.position.z).toBeCloseTo(originalTransform.position.z, 8)
    expect(pastedSurface!.rotation.x).toBeCloseTo(originalTransform.rotation.x, 8)
    expect(pastedSurface!.rotation.y).toBeCloseTo(originalTransform.rotation.y, 8)
    expect(pastedSurface!.rotation.z).toBeCloseTo(originalTransform.rotation.z, 8)
    expect(pastedSurface!.scale.x).toBeCloseTo(originalTransform.scale.x, 8)
    expect(pastedSurface!.scale.y).toBeCloseTo(originalTransform.scale.y, 8)
    expect(pastedSurface!.scale.z).toBeCloseTo(originalTransform.scale.z, 8)
  })

  it('moves a Surface Image and rebuilds its geometry in one undoable operation', async () => {
    const store = useSceneStore()
    store.currentSceneId = 'scene-store-surface-move'
    store.currentSceneMeta = {
      name: 'Scene Store Surface Move',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'scene-store-test',
    }
    store.isSceneReady = true
    const targetRoot = new THREE.Group()
    const targetMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    )
    targetRoot.add(targetMesh)
    registerRuntimeObject('move-target', targetRoot)
    store.nodes = [
      makeNode({
        id: 'move-target',
        name: 'Move Target',
        nodeType: 'Group',
        sourceAssetId: 'source-model',
      }),
    ]
    store.bumpSceneGraphStructureVersion()

    const created = store.createSurfaceImageNode({
      assetId: 'move-image',
      targetNodeId: 'move-target',
      geometry,
      worldCenter: new THREE.Vector3(0, 0, 0.002),
      worldQuaternion: new THREE.Quaternion(),
      widthMeters: 1,
      heightMeters: 0.5,
    })
    expect(created).not.toBeNull()
    const initialPosition = { ...created!.node.position }
    const beforeGeometry = extractCompiledStaticMeshMetadataFromUserData(created!.node.userData)
    const beforeRevision = store.sceneRevision
    const beforeUndoCount = store.undoStack.length

    const moved = store.moveSurfaceImageNode({
      nodeId: created!.node.id,
      worldPosition: new THREE.Vector3(0.45, 0.25, 0.01),
    })

    expect(moved).toMatchObject({
      changed: true,
      reason: 'MOVED',
      targetNodeId: 'move-target',
    })
    expect(moved.worldPosition?.z).toBeCloseTo(0, 3)
    const movedNode = store.getNodeById(created!.node.id)!
    expect(movedNode.position.x).toBeCloseTo(0.45, 2)
    expect(movedNode.position.y).toBeCloseTo(0.25, 2)
    expect(extractCompiledStaticMeshMetadataFromUserData(movedNode.userData)).not.toEqual(beforeGeometry)
    expect(store.sceneRevision).toBe(beforeRevision + 1)
    expect(store.undoStack).toHaveLength(beforeUndoCount + 1)

    await store.undo()
    const restored = store.getNodeById(created!.node.id)!
    expect(restored.position).toEqual(initialPosition)
    expect(extractCompiledStaticMeshMetadataFromUserData(restored.userData)).toEqual(beforeGeometry)
    clearRuntimeObjectRegistry()
  })

  it('does not change history or revision when a Surface Image leaves its target surface', () => {
    const store = useSceneStore()
    store.currentSceneId = 'scene-store-surface-invalid'
    store.currentSceneMeta = {
      name: 'Scene Store Surface Invalid',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'scene-store-test',
    }
    store.isSceneReady = true
    const targetRoot = new THREE.Group()
    targetRoot.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    ))
    registerRuntimeObject('limited-target', targetRoot)
    store.nodes = [
      makeNode({
        id: 'limited-target',
        name: 'Limited Target',
        nodeType: 'Group',
        sourceAssetId: 'source-model',
      }),
    ]
    store.bumpSceneGraphStructureVersion()
    const created = store.createSurfaceImageNode({
      assetId: 'limited-image',
      targetNodeId: 'limited-target',
      geometry,
      worldCenter: new THREE.Vector3(0, 0, 0.002),
      worldQuaternion: new THREE.Quaternion(),
      widthMeters: 1,
      heightMeters: 0.5,
    })!
    const beforeRevision = store.sceneRevision
    const beforeUndoCount = store.undoStack.length
    const beforeNode = JSON.parse(JSON.stringify(store.getNodeById(created.node.id)))

    const moved = store.moveSurfaceImageNode({
      nodeId: created.node.id,
      worldPosition: new THREE.Vector3(20, 20, 20),
    })

    expect(moved).toMatchObject({
      changed: false,
      reason: 'OUTSIDE_TARGET_SURFACE',
    })
    expect(store.sceneRevision).toBe(beforeRevision)
    expect(store.undoStack).toHaveLength(beforeUndoCount)
    const unchangedNode = store.getNodeById(created.node.id)!
    expect(unchangedNode.position).toEqual(beforeNode.position)
    expect(unchangedNode.rotation.x).toBeCloseTo(beforeNode.rotation.x, 8)
    expect(unchangedNode.rotation.y).toBeCloseTo(beforeNode.rotation.y, 8)
    expect(unchangedNode.rotation.z).toBeCloseTo(beforeNode.rotation.z, 8)
    expect(unchangedNode.scale).toEqual(beforeNode.scale)
    expect(unchangedNode.userData).toEqual(beforeNode.userData)
    clearRuntimeObjectRegistry()
  })
})
