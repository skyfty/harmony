import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { SceneMaterial, SceneNodeMaterial } from '@/types/material'
import type {
  SceneNode,
  SceneMaterialTextureSlot,
  SceneNodeComponentState,
  SceneNodeComponentMap,
  SceneJsonExportDocument,
  NodeComponentType,
  SceneOutlineMeshMap,
  SceneOutlineMesh,
} from '@harmony/schema'
import type { SceneExportOptions, GLBExportSettings } from '@/types/scene-export'
import { findObjectByPath } from '@schema/modelAssetLoader'
import { getCachedModelObject, getOrLoadModelObject } from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'

import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { buildOutlineMeshFromObject } from '@/utils/outlineMesh'
import { createPrimitiveGeometry } from '@schema/geometry'
import { createGroundMesh } from '@schema/groundMesh'
import { createSurfaceMesh } from '@schema/surfaceMesh'
import { createWallGroup } from '@schema/wallMesh'
import {
  RIGIDBODY_COMPONENT_TYPE,
  type RigidbodyComponentProps,
  type RigidbodyComponentMetadata,
  type RigidbodyPhysicsShape,
  clampRigidbodyComponentProps,
  RIGIDBODY_METADATA_KEY,
} from '@schema/components'
import { isGroundDynamicMesh } from '@schema/groundHeightfield'

type RemovedSceneObject = {
    parent: THREE.Object3D
    object: THREE.Object3D
    index: number
}

const MATERIAL_TEXTURE_KEYS = [
  'map',
  'normalMap',
  'metalnessMap',
  'roughnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'lightMap',
  'specularMap',
  'envMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'displacementMap',
  'bumpMap',
  'gradientMap',
] as const

const EDITOR_HELPER_TYPES = new Set<string>([
    'GridHelper',
    'AxesHelper',
    'Box3Helper',
    'PointLightHelper',
    'SpotLightHelper',
    'DirectionalLightHelper',
    'RectAreaLightHelper',
    'HemisphereLightHelper',
    'TransformControls',
    'TransformControlsGizmo',
    'TransformControlsPlane',
])

const EDITOR_HELPER_NAMES = new Set<string>([
    'DragPreview',
    'GridHighlight',
])

const LIGHT_HELPER_NAME_SUFFIX = 'LightHelper'


function getAnimations(scene: THREE.Scene) {

    const animations: THREE.AnimationClip[] = [];

    scene.traverse(function (object) {

        animations.push(...object.animations);

    });

    return animations;

}

function shouldExcludeFromGLTF(object: THREE.Object3D) {
    if (!object.parent) {
        return false
    }

    const name = object.name ?? ''
    if (name && (EDITOR_HELPER_NAMES.has(name) || name.endsWith(LIGHT_HELPER_NAME_SUFFIX))) {
        return true
    }

    if (EDITOR_HELPER_TYPES.has(object.type)) {
        return true
    }

    if ((object as any).isTransformControlsRoot) {
        return true
    }

    return false
}

function collectEditorHelpers(root: THREE.Object3D) {
    const helpers: THREE.Object3D[] = []
    const stack: THREE.Object3D[] = [...root.children]

    while (stack.length > 0) {
        const current = stack.pop()
        if (!current) {
            continue
        }
        if (shouldExcludeFromGLTF(current)) {
            helpers.push(current)
            continue
        }

        for (const child of current.children) {
            stack.push(child)
        }
    }

    return helpers
}

function removeEditorHelpers(scene: THREE.Scene) {
    const helpers = collectEditorHelpers(scene)
    const removed: RemovedSceneObject[] = []

    for (const helper of helpers) {
        const parent = helper.parent
        if (!parent) {
            continue
        }

        const index = parent.children.indexOf(helper)
        if (index === -1) {
            continue
        }

        parent.remove(helper)
        removed.push({ parent, object: helper, index })
    }

    return removed
}

async function exportGLB(scene: THREE.Scene, settings?: GLBExportSettings) {
    const includeAnimations = settings?.includeAnimations !== false
    const animations = includeAnimations ? getAnimations(scene) : []
    const optimizedAnimations = []
    if (includeAnimations) {
        for ( const animation of animations ) {
            optimizedAnimations.push( animation.clone().optimize() );
        }
    }
    const exporter = new GLTFExporter()
    const result = await exporter.parseAsync( scene,{
        binary: true,
        animations: optimizedAnimations,
        onlyVisible: settings?.onlyVisible ?? true,
        includeCustomExtensions: settings?.includeCustomExtensions ?? true,
    });
    const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
    return blob;
}

function cloneMeshMaterials(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!(mesh as any)?.isMesh) {
      return
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      mesh.material = material.map((entry) => entry?.clone?.() ?? entry)
    } else if (material?.clone) {
      mesh.material = material.clone()
    }
  })
}

function stripMaterialTextures(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!(mesh as any)?.isMesh) {
      return
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      if (!material) {
        return
      }
  const matAny = material as unknown as Record<string, unknown>
      for (const key of MATERIAL_TEXTURE_KEYS) {
        if (matAny[key]) {
          matAny[key] = null
        }
      }
      material.needsUpdate = true
    })
  })
}

function removeLights(root: THREE.Object3D) {
  const collected: THREE.Object3D[] = []
  root.traverse((node) => {
    if ((node as any)?.isLight) {
      collected.push(node)
    }
  })
  collected.forEach((light) => light.parent?.remove(light))
}

function removeSkybox(scene: THREE.Scene) {
  const skybox = scene.getObjectByName('HarmonySky')
  if (skybox?.parent) {
    skybox.parent.remove(skybox)
  }
  scene.environment = null
  scene.background = null
}

function stripSkeletonData(root: THREE.Object3D) {
  const skinnedMeshes: THREE.SkinnedMesh[] = []
  const bones: THREE.Object3D[] = []

  root.traverse((node) => {
    if ((node as any)?.isSkinnedMesh) {
      skinnedMeshes.push(node as THREE.SkinnedMesh)
    } else if ((node as any)?.isBone) {
      bones.push(node)
    }
  })

  skinnedMeshes.forEach((skinned) => {
    const parent = skinned.parent ?? root
    const originalIndex = parent.children.indexOf(skinned)
    const geometry = skinned.geometry.clone()
    if ('deleteAttribute' in geometry) {
      if (geometry.getAttribute('skinIndex')) {
        geometry.deleteAttribute('skinIndex')
      }
      if (geometry.getAttribute('skinWeight')) {
        geometry.deleteAttribute('skinWeight')
      }
    }

    const replacement = new THREE.Mesh(geometry, skinned.material)
    replacement.name = skinned.name
    replacement.position.copy(skinned.position)
    replacement.quaternion.copy(skinned.quaternion)
    replacement.scale.copy(skinned.scale)
    replacement.castShadow = skinned.castShadow
    replacement.receiveShadow = skinned.receiveShadow
    replacement.visible = skinned.visible
    replacement.matrix.copy(skinned.matrix)
    replacement.matrixAutoUpdate = skinned.matrixAutoUpdate
    replacement.frustumCulled = skinned.frustumCulled
    replacement.renderOrder = skinned.renderOrder
    replacement.userData = { ...skinned.userData }
    if (skinned.morphTargetInfluences) {
      replacement.morphTargetInfluences = [...skinned.morphTargetInfluences]
    }
    if (skinned.morphTargetDictionary) {
      replacement.morphTargetDictionary = { ...skinned.morphTargetDictionary }
    }

    parent.remove(skinned)
    parent.add(replacement)

    if (originalIndex >= 0) {
      const currentIndex = parent.children.indexOf(replacement)
      if (currentIndex > -1 && currentIndex !== originalIndex) {
        parent.children.splice(currentIndex, 1)
        parent.children.splice(Math.min(originalIndex, parent.children.length), 0, replacement)
      }
    }
  })

  bones.forEach((bone) => bone.parent?.remove(bone))
}

function rotateSceneForCoordinateSystem(scene: THREE.Scene) {
  // Flip handedness by rotating every root node 180° around the Y axis
  if (!scene.children.length) {
    return
  }
  const rotation = new THREE.Matrix4().makeRotationY(Math.PI)
  for (const child of scene.children) {
    child.applyMatrix4(rotation)
    child.updateMatrixWorld(true)
  }
  scene.applyMatrix4(rotation)
  scene.updateMatrixWorld(true)
}

export async function prepareJsonSceneExport(snapshot: StoredSceneDocument, options: SceneExportOptions): Promise<SceneJsonExportDocument> {

  const exportDocument: SceneJsonExportDocument = {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    skybox: snapshot.skybox,
    environment: snapshot.environment,
    nodes: snapshot.nodes,
    materials: snapshot.materials,
    groundSettings: snapshot.groundSettings,
    assetIndex: snapshot.assetIndex,
    packageAssetMap: snapshot.packageAssetMap,
    resourceSummary: snapshot.resourceSummary,
    lazyLoadMeshes: options.lazyLoadMeshes ?? true,
  };
  return await sanitizeSceneDocumentForJsonExport(exportDocument, options)

}
export async function prepareGLBSceneExport(scene: THREE.Scene, options: SceneExportOptions): Promise<Blob> {
  if (!scene) {
    throw new Error('Scene not initialized')
  }
  const includeTextures = options.includeTextures ?? true
  const includeAnimations = options.includeAnimations ?? true
  const includeSkybox = options.includeSkybox ?? true
  const includeLights = options.includeLights ?? true
  const includeHiddenNodes = options.includeHiddenNodes ?? true
  const includeSkeletons = options.includeSkeletons ?? true
  const includeExtras = options.includeExtras ?? true


  const exportScene = clone(scene) as THREE.Scene
  removeEditorHelpers(exportScene)

  cloneMeshMaterials(exportScene)

  if (!includeSkybox) {
    removeSkybox(exportScene)
  }

  if (!includeLights) {
    removeLights(exportScene)
  }

  if (!includeSkeletons) {
    stripSkeletonData(exportScene)
  }

  if (!includeTextures) {
    stripMaterialTextures(exportScene)
  }

  if (options.rotateCoordinateSystem) {
    rotateSceneForCoordinateSystem(exportScene)
  }

  const blob = await exportGLB(exportScene, {
    includeAnimations,
    onlyVisible: includeHiddenNodes ? false : true,
    includeCustomExtensions: includeExtras,
  })

  return blob
}

type OutlineCandidate = {
  sourceNode: SceneNode
  sanitizedNode: SceneNode
}

type RigidbodyExportCandidate = {
  node: SceneNode
  component: SceneNodeComponentState<RigidbodyComponentProps>
}

async function sanitizeSceneDocumentForJsonExport(
  document: SceneJsonExportDocument,
  options: SceneExportOptions,
): Promise<SceneJsonExportDocument> {
  const removedNodeIds = new Set<string>()
  const outlineCandidates: OutlineCandidate[] = []
  const rigidbodyCandidates: RigidbodyExportCandidate[] = []
  const sanitizedMaterials = document.materials.map((material) => sanitizeSceneMaterial(material, options.includeTextures))
  const sanitizedNodes = sanitizeNodesForJsonExport(
    document.nodes,
    options,
    removedNodeIds,
    outlineCandidates,
    rigidbodyCandidates,
  )

  let outlineMeshMap: SceneOutlineMeshMap | undefined
  if (options.lazyLoadMeshes) {
    outlineMeshMap = await generateOutlineMeshesForCandidates(outlineCandidates, options)
  }

  await applyRigidbodyMetadata(sanitizedNodes,rigidbodyCandidates)

  const sanitizedDocument: SceneJsonExportDocument = {
    ...document,
    materials: sanitizedMaterials,
    nodes: sanitizedNodes,
  }

  if (!options.lazyLoadMeshes) {
    if ('outlineMeshMap' in sanitizedDocument) {
      delete sanitizedDocument.outlineMeshMap
    }
  } else if (outlineMeshMap && Object.keys(outlineMeshMap).length > 0) {
    sanitizedDocument.outlineMeshMap = outlineMeshMap
  } else if ('outlineMeshMap' in sanitizedDocument) {
    delete sanitizedDocument.outlineMeshMap
  }

  return sanitizedDocument
}

function sanitizeNodesForJsonExport(
  nodes: SceneNode[],
  options: SceneExportOptions,
  removedNodeIds: Set<string>,
  outlineCandidates: OutlineCandidate[],
  rigidbodyCandidates: RigidbodyExportCandidate[],
): SceneNode[] {
  const result: SceneNode[] = []
  for (const node of nodes) {
    if (shouldExcludeNodeForJsonExport(node, options)) {
      collectNodeTreeIds(node, removedNodeIds)
      continue
    }
    const sanitized = sanitizeNodeForJsonExport(
      node,
      options,
      removedNodeIds,
      outlineCandidates,
      rigidbodyCandidates,
    )
    result.push(sanitized)
  }
  return result
}

function shouldExcludeNodeForJsonExport(node: SceneNode, options: SceneExportOptions): boolean {
  if (!options.includeHiddenNodes && node.visible === false) {
    return true
  }
  if (!options.includeLights && (node.nodeType === 'Light' || Boolean(node.light))) {
    return true
  }
  if (!options.includeSkybox && node.name === 'HarmonySky') {
    return true
  }
  if (node.nodeType === 'Sky' || node.nodeType === 'Environment') {
    return true
  }
  return false
}

function shouldGenerateOutlineMeshForNode(node: SceneNode, options: SceneExportOptions): boolean {
  if (!options.lazyLoadMeshes) {
    return false
  }
  if (!node.sourceAssetId || typeof node.sourceAssetId !== 'string') {
    return false
  }
  if (node.dynamicMesh) {
    return false
  }
  if (node.editorFlags?.editorOnly) {
    return false
  }
  return true
}

function sanitizeNodeForJsonExport(
  node: SceneNode,
  options: SceneExportOptions,
  removedNodeIds: Set<string>,
  outlineCandidates: OutlineCandidate[],
  rigidbodyCandidates: RigidbodyExportCandidate[],
): SceneNode {
  const sanitized: SceneNode = { ...node }

  if ('outlineMesh' in sanitized) {
    delete sanitized.outlineMesh
  }

  if (node.children?.length) {
    const children = sanitizeNodesForJsonExport(
      node.children,
      options,
      removedNodeIds,
      outlineCandidates,
      rigidbodyCandidates,
    )
    if (children.length) {
      sanitized.children = children
    } else {
      delete sanitized.children
    }
  } else if ('children' in sanitized) {
    delete sanitized.children
  }

  if (node.materials?.length) {
    sanitized.materials = node.materials.map((material) => sanitizeSceneNodeMaterial(material, options.includeTextures))
  } else if ('materials' in sanitized) {
    delete sanitized.materials
  }

  if (!options.includeExtras) {
    if ('components' in sanitized) {
      delete sanitized.components
    }
    if (!options.lazyLoadMeshes) {
      if ('importMetadata' in sanitized) {
        delete sanitized.importMetadata
      }
      if ('sourceAssetId' in sanitized) {
        delete sanitized.sourceAssetId
      }
    }
  } else if (componentMapHasEntries(sanitized.components)) {
    const clonedComponents = cloneNodeComponentMap(sanitized.components!)
    const filteredComponents = sanitizeNodeComponentsForJsonExport(clonedComponents, options)
    if (componentMapHasEntries(filteredComponents)) {
      sanitized.components = filteredComponents
      const rigidbodyComponent = filteredComponents[RIGIDBODY_COMPONENT_TYPE] as
        | SceneNodeComponentState<RigidbodyComponentProps>
        | undefined
      if (rigidbodyComponent?.enabled) {
        rigidbodyCandidates.push({ node, component: rigidbodyComponent })
      }
    } else {
      delete sanitized.components
    }
  }

  if (!options.includeTextures && sanitized.dynamicMesh?.type === 'Ground') {
    sanitized.dynamicMesh = {
      ...sanitized.dynamicMesh,
      textureDataUrl: null,
      textureName: null,
    }
  }

  if (shouldGenerateOutlineMeshForNode(node, options)) {
    outlineCandidates.push({ sourceNode: node, sanitizedNode: sanitized })
  }

  return sanitized
}

async function generateOutlineMeshesForCandidates(
  candidates: OutlineCandidate[],
  options: SceneExportOptions,
): Promise<SceneOutlineMeshMap> {
  const outlineMeshMap: SceneOutlineMeshMap = {}
  if (!candidates.length || !options.lazyLoadMeshes) {
    return outlineMeshMap
  }
  const assetCacheStore = useAssetCacheStore()

  for (const entry of candidates) {
    const assetId = entry.sourceNode.sourceAssetId
    if (!assetId) {
      continue
    }

    if (!outlineMeshMap[assetId]) {
      let baseGroup = getCachedModelObject(assetId)
      if (!baseGroup) {
        let file = assetCacheStore.createFileFromCache(assetId)
        if (!file) {
          await assetCacheStore.loadFromIndexedDb(assetId)
          file = assetCacheStore.createFileFromCache(assetId)
        }
        if (file) {
          baseGroup = await getOrLoadModelObject(assetId, () => loadObjectFromFile(file))
        }
      }
      if (!baseGroup) {
        continue
      }
      const baseObject = baseGroup.object
      baseObject.updateMatrixWorld(true)
      const targetSource = findObjectByPath(baseObject, entry.sourceNode.importMetadata?.objectPath ?? null) ?? baseObject
      const targetClone = targetSource.clone(true)
      targetClone.updateMatrixWorld(true)

      const outline = buildOutlineMeshFromObject(targetClone)
      if (!outline) {
        continue
      }

      outlineMeshMap[assetId] = outline
    }

    if (!entry.sanitizedNode.sourceAssetId) {
      entry.sanitizedNode.sourceAssetId = entry.sourceNode.sourceAssetId
    }
    if (!entry.sanitizedNode.importMetadata && entry.sourceNode.importMetadata) {
      entry.sanitizedNode.importMetadata = { ...entry.sourceNode.importMetadata }
    }
  }

  return outlineMeshMap
}

async function applyRigidbodyMetadata(nodes: SceneNode[], candidates: RigidbodyExportCandidate[]): Promise<void> {
  if (!candidates.length) {
    return
  }
  const nodeLookup = buildSceneNodeLookup(nodes)
  const assetCacheStore = useAssetCacheStore()
  for (const entry of candidates) {
    const samplingNode = resolveRigidbodySamplingNode(entry, nodeLookup)
    if (!samplingNode || isGroundDynamicMesh(samplingNode.dynamicMesh)) {
      continue
    }
    let shape: RigidbodyPhysicsShape | null = null
    const samplingObject = await buildRigidbodySamplingObject(samplingNode, assetCacheStore)
    if (!samplingObject) {
      continue
    }
    const props = clampRigidbodyComponentProps(entry.component.props as Partial<RigidbodyComponentProps>)
    const outline = buildOutlineMeshFromObject(samplingObject)
    const buildConvex = () => (outline ? buildConvexShapeFromOutline(outline) : null)
    const buildBox = () => buildBoxShapeFromObject(samplingObject)
    if (props.colliderType === 'box') {
      shape = buildBox() ?? buildConvex()
    } else {
      shape = buildConvex() ?? buildBox()
    }
    if (!shape) {
      continue
    }
    entry.component.metadata = mergeRigidbodyMetadata(entry.component.metadata, shape)
  }
}

function buildSceneNodeLookup(nodes: SceneNode[]): Map<string, SceneNode> {
  const lookup = new Map<string, SceneNode>()
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current?.id) {
      continue
    }
    if (!lookup.has(current.id)) {
      lookup.set(current.id, current)
    }
    if (Array.isArray(current.children) && current.children.length) {
      for (const child of current.children) {
        stack.push(child)
      }
    }
  }
  return lookup
}

function resolveRigidbodySamplingNode(
  entry: RigidbodyExportCandidate,
  lookup: Map<string, SceneNode>,
): SceneNode | null {
  const rawTargetId = entry.component.props?.targetNodeId
  const targetNodeId = typeof rawTargetId === 'string' ? rawTargetId.trim() : null
  if (targetNodeId) {
    const resolved = lookup.get(targetNodeId)
    if (resolved) {
      return resolved
    }
  }
  return entry.node
}

function mergeRigidbodyMetadata(
  existing: Record<string, unknown> | undefined,
  shape: RigidbodyPhysicsShape,
): Record<string, unknown> {
  const nextMetadata: Record<string, unknown> = existing ? { ...existing } : {}
  const payload: RigidbodyComponentMetadata = {
    shape,
    generatedAt: new Date().toISOString(),
  }
  nextMetadata[RIGIDBODY_METADATA_KEY] = payload
  return nextMetadata
}

async function buildRigidbodySamplingObject(
  node: SceneNode,
  assetCacheStore: ReturnType<typeof useAssetCacheStore>,
): Promise<THREE.Object3D | null> {
  let sourceObject: THREE.Object3D | null = null
  if (node.sourceAssetId) {
    sourceObject = await loadAssetObjectForNode(node, assetCacheStore)
  } else if (node.dynamicMesh?.type) {
    sourceObject = buildDynamicMeshObject(node)
  } else if (node.nodeType === 'Group') {
    const empty = new THREE.Object3D()
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childObject = await buildRigidbodySamplingObject(child, assetCacheStore)
        if (!childObject) {
          continue
        }
        applyPositionAndRotationToObject(childObject, child)
        childObject.updateMatrixWorld(true)
        empty.add(childObject)
      }
    }
    if (empty.children.length > 0) {
      sourceObject = empty
    }
  } else {
    sourceObject = buildPrimitiveObject(node)
  }

  if (!sourceObject) {
    return null
  }

  const root = new THREE.Group()
  root.add(sourceObject)
  applyScaleToObject(root, node)
  root.updateMatrixWorld(true)
  return root
}

function getFiniteComponent(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function applyPositionAndRotationToObject(object: THREE.Object3D, node: SceneNode): void {
  const position = node.position as { x?: unknown; y?: unknown; z?: unknown } | undefined
  object.position.set(
    getFiniteComponent(position?.x),
    getFiniteComponent(position?.y),
    getFiniteComponent(position?.z),
  )

  const rotation = node.rotation as { x?: unknown; y?: unknown; z?: unknown } | undefined
  object.rotation.set(
    getFiniteComponent(rotation?.x),
    getFiniteComponent(rotation?.y),
    getFiniteComponent(rotation?.z),
  )
}

async function loadAssetObjectForNode(
  node: SceneNode,
  assetCacheStore: ReturnType<typeof useAssetCacheStore>,
): Promise<THREE.Object3D | null> {
  const assetId = node.sourceAssetId
  if (!assetId) {
    return null
  }

  let baseGroup = getCachedModelObject(assetId)
  if (!baseGroup) {
    let file = assetCacheStore.createFileFromCache(assetId)
    if (!file) {
      await assetCacheStore.loadFromIndexedDb(assetId)
      file = assetCacheStore.createFileFromCache(assetId)
    }
    if (file) {
      baseGroup = await getOrLoadModelObject(assetId, () => loadObjectFromFile(file!))
    }
  }

  const baseObject = baseGroup?.object ?? null
  if (!baseObject) {
    return null
  }
  const target = findObjectByPath(baseObject, node.importMetadata?.objectPath ?? null) ?? baseObject
  const clone = target.clone(true)
  clone.updateMatrixWorld(true)
  return clone
}

function buildDynamicMeshObject(node: SceneNode): THREE.Object3D | null {
  const mesh = node.dynamicMesh
  if (!mesh) {
    return null
  }
  switch (mesh.type) {
    case 'Ground':
      return createGroundMesh(mesh).clone(true)
    case 'Surface':
      return createSurfaceMesh(mesh).clone(true)
    case 'Wall':
      return createWallGroup(mesh).clone(true)
    default:
      return null
  }
}

function buildPrimitiveObject(node: SceneNode): THREE.Object3D | null {
  const geometry = createPrimitiveGeometry(node.nodeType)
  if (!geometry) {
    return null
  }
  const material = new THREE.MeshBasicMaterial({ color: '#cccccc', wireframe: true })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  return mesh
}

function applyScaleToObject(object: THREE.Object3D, node: SceneNode): void {
  const scale = node.scale
  if (scale) {
    object.scale.set(
      Number.isFinite(scale.x) ? scale.x : 1,
      Number.isFinite(scale.y) ? scale.y : 1,
      Number.isFinite(scale.z) ? scale.z : 1,
    )
  } else {
    object.scale.setScalar(1)
  }
}

function buildConvexShapeFromOutline(outline: SceneOutlineMesh): RigidbodyPhysicsShape | null {
  const positions = Array.isArray(outline.positions) ? outline.positions : []
  if (positions.length < 12) {
    return null
  }
  const vertices: [number, number, number][] = []
  for (let index = 0; index < positions.length; index += 3) {
    const vx = positions[index]
    const vy = positions[index + 1]
    const vz = positions[index + 2]
    if ([vx, vy, vz].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      vertices.push([vx as number, vy as number, vz as number])
    }
  }
  if (vertices.length < 4) {
    return null
  }

  const indices = Array.isArray(outline.indices) ? outline.indices : null
  const faces: number[][] = []
  if (indices && indices.length >= 3) {
    for (let index = 0; index + 2 < indices.length; index += 3) {
      const a = indices[index]
      const b = indices[index + 1]
      const c = indices[index + 2]
      if ([a, b, c].every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)) {
        faces.push([a as number, b as number, c as number])
      }
    }
  } else {
    for (let index = 0; index + 2 < vertices.length; index += 3) {
      faces.push([index, index + 1, index + 2])
    }
  }

  if (!faces.length) {
    return null
  }

  return {
    kind: 'convex',
    vertices,
    faces,
  }
}

function buildBoxShapeFromObject(object: THREE.Object3D): RigidbodyPhysicsShape | null {
  const box = new THREE.Box3().setFromObject(object)
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3())
    if ([size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
      const halfExtents: [number, number, number] = [
        Math.max(1e-4, size.x * 0.5),
        Math.max(1e-4, size.y * 0.5),
        Math.max(1e-4, size.z * 0.5),
      ]
      const center = box.getCenter(new THREE.Vector3())
      const offset: [number, number, number] = [center.x, center.y, center.z]
      return {
        kind: 'box',
        halfExtents,
        offset,
      }
    }
  }
  return null
}

function componentMapHasEntries(components?: SceneNodeComponentMap | null): boolean {
  return Boolean(components && Object.keys(components).length)
}

function cloneNodeComponentState(component: SceneNodeComponentState): SceneNodeComponentState {
  // 深度克隆 metadata 以确保完整复制
  let clonedMetadata: Record<string, unknown> | undefined
  if (component.metadata) {
    try {
      clonedMetadata = structuredClone(component.metadata)
    } catch (_error) {
      // 如果 structuredClone 失败，尝试使用 JSON 序列化
      try {
        clonedMetadata = JSON.parse(JSON.stringify(component.metadata)) as Record<string, unknown>
      } catch (_jsonError) {
        // 如果都失败了，使用浅拷贝作为最后手段
        console.warn('Failed to deeply clone component metadata for export, using shallow copy', _jsonError)
        clonedMetadata = { ...component.metadata }
      }
    }
  }
  
  return {
    ...component,
    props: { ...(component.props ?? {}) },
    metadata: clonedMetadata,
  }
}

function cloneNodeComponentMap(components: SceneNodeComponentMap): SceneNodeComponentMap {
  const cloned: SceneNodeComponentMap = {}
  Object.entries(components).forEach(([type, component]) => {
    if (!component) {
      return
    }
    cloned[type as NodeComponentType] = cloneNodeComponentState(component)
  })
  return cloned
}

function sanitizeNodeComponentsForJsonExport(
  components: SceneNodeComponentMap,
  options: SceneExportOptions,
): SceneNodeComponentMap {
  const filtered: SceneNodeComponentMap = {}
  Object.entries(components).forEach(([type, component]) => {
    if (!component) {
      return
    }
    if (!options.includeAnimations && /animation/i.test(component.type)) {
      return
    }
    if (!options.includeSkeletons && /skeleton/i.test(component.type)) {
      return
    }
    filtered[type as NodeComponentType] = component
  })
  return filtered
}

function collectNodeTreeIds(node: SceneNode, bucket: Set<string>) {
  bucket.add(node.id)
  if (node.children?.length) {
    for (const child of node.children) {
      collectNodeTreeIds(child, bucket)
    }
  }
}

function sanitizeSceneMaterial(material: SceneMaterial, includeTextures: boolean): SceneMaterial {
  const existingTextures = material.textures ?? {}
  return {
    ...material,
    textures: includeTextures ? { ...existingTextures } : reduceTexturesToNull(existingTextures),
  }
}

function sanitizeSceneNodeMaterial(material: SceneNodeMaterial, includeTextures: boolean): SceneNodeMaterial {
  const existingTextures = material.textures ?? {}
  return {
    ...material,
    textures: includeTextures ? { ...existingTextures } : reduceTexturesToNull(existingTextures),
  }
}

function reduceTexturesToNull(
  textures: Partial<Record<SceneMaterialTextureSlot, unknown>>,
): Partial<Record<SceneMaterialTextureSlot, null>> {
  const stripped: Partial<Record<SceneMaterialTextureSlot, null>> = {}
  for (const key of Object.keys(textures) as SceneMaterialTextureSlot[]) {
    stripped[key] = null
  }
  return stripped
}
