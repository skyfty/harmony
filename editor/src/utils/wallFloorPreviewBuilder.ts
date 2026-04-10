import * as THREE from 'three'
import type {
  FloorDynamicMesh,
  SceneNode,
  SceneNodeMaterial,
  SceneMaterialTextureRef,
  WallDynamicMesh,
} from '@schema'
import { applyMirroredScaleToObject } from '@schema'
import { loadObjectFromFile } from '@schema/assetImport'
import { FLOOR_COMPONENT_TYPE } from '@schema/components/definitions/floorComponent'
import { WALL_COMPONENT_TYPE, clampWallProps } from '@schema/components/definitions/wallComponent'
import { createFloorGroup } from '@schema/floorMesh'
import { applyMaterialOverrides, type MaterialTextureAssignmentOptions } from '@schema/material'
import {
  createWallRenderGroup,
  type WallRenderAssetObjects,
  type WallRenderOptions,
} from '@schema/wallMesh'
import { applyAirWallVisualToWallGroup } from '@/components/editor/WallRenderer'
import { prepareWallPreviewImportedObject } from '@/utils/wallPresetSceneGraphPreview'

export type PreviewAssetFileResolver = (assetId: string) => Promise<File | null>

function applyNodeTransform(object: THREE.Object3D, node: SceneNode): void {
  if (node.position) {
    object.position.set(node.position.x, node.position.y, node.position.z)
  }
  if (node.rotation) {
    object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  }
  applyMirroredScaleToObject(object, node.scale ?? null, node.mirror)
}

function applyNodeVisibility(object: THREE.Object3D, node: SceneNode): void {
  if (typeof node.visible === 'boolean') {
    object.visible = node.visible
  }
}

function applyPreviewNodeMetadata(object: THREE.Object3D, node: SceneNode): void {
  const metadata = object.userData ?? (object.userData = {})
  metadata.nodeId = node.id
  metadata.nodeType = node.nodeType ?? (node.dynamicMesh ? 'Mesh' : 'Group')
  metadata.dynamicMeshType = node.dynamicMesh?.type ?? null
  metadata.sourceAssetId = node.sourceAssetId ?? null
}

function collectWallAssetIds(node: SceneNode): string[] {
  const wallState = node.components?.[WALL_COMPONENT_TYPE]
  const wallProps = clampWallProps((wallState?.props ?? null) as Record<string, unknown> | null | undefined)
  return Array.from(
    new Set(
      [
        wallProps.bodyAssetId,
        wallProps.headAssetId,
        wallProps.footAssetId,
        wallProps.bodyEndCapAssetId,
        wallProps.headEndCapAssetId,
        wallProps.footEndCapAssetId,
        ...((wallProps.cornerModels ?? []).flatMap((entry) => [entry.bodyAssetId, entry.headAssetId, entry.footAssetId])),
      ]
        .map((assetId) => (typeof assetId === 'string' ? assetId.trim() : ''))
        .filter((assetId) => assetId.length > 0),
    ),
  )
}

function buildWallRenderAssetsFromNode(node: SceneNode, loadedAssetObjects: Map<string, THREE.Object3D>): WallRenderAssetObjects {
  const wallState = node.components?.[WALL_COMPONENT_TYPE]
  const wallProps = clampWallProps((wallState?.props ?? null) as Record<string, unknown> | null | undefined)

  const resolveAsset = (assetId: string | null | undefined): THREE.Object3D | null => {
    const normalized = typeof assetId === 'string' ? assetId.trim() : ''
    return normalized ? loadedAssetObjects.get(normalized) ?? null : null
  }

  const resolveCornerAssetMap = (assetIds: string[]): Record<string, THREE.Object3D | null> | null => {
    if (!assetIds.length) {
      return null
    }
    const map: Record<string, THREE.Object3D | null> = {}
    assetIds.forEach((assetId) => {
      const resolved = resolveAsset(assetId)
      if (resolved) {
        map[assetId] = resolved
      }
    })
    return Object.keys(map).length ? map : null
  }

  const bodyCornerAssetIds = Array.from(new Set((wallProps.cornerModels ?? []).map((entry) => entry.bodyAssetId).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)))
  const headCornerAssetIds = Array.from(new Set((wallProps.cornerModels ?? []).map((entry) => entry.headAssetId).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)))
  const footCornerAssetIds = Array.from(new Set((wallProps.cornerModels ?? []).map((entry) => entry.footAssetId).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)))

  const assets: WallRenderAssetObjects = {}
  const bodyObject = resolveAsset(wallProps.bodyAssetId)
  if (bodyObject) assets.bodyObject = bodyObject
  const headObject = resolveAsset(wallProps.headAssetId)
  if (headObject) assets.headObject = headObject
  const footObject = resolveAsset(wallProps.footAssetId)
  if (footObject) assets.footObject = footObject
  const bodyEndCapObject = resolveAsset(wallProps.bodyEndCapAssetId)
  if (bodyEndCapObject) assets.bodyEndCapObject = bodyEndCapObject
  const headEndCapObject = resolveAsset(wallProps.headEndCapAssetId)
  if (headEndCapObject) assets.headEndCapObject = headEndCapObject
  const footEndCapObject = resolveAsset(wallProps.footEndCapAssetId)
  if (footEndCapObject) assets.footEndCapObject = footEndCapObject

  const bodyCornerMap = resolveCornerAssetMap(bodyCornerAssetIds)
  if (bodyCornerMap) assets.bodyCornerObjectsByAssetId = bodyCornerMap
  const headCornerMap = resolveCornerAssetMap(headCornerAssetIds)
  if (headCornerMap) assets.headCornerObjectsByAssetId = headCornerMap
  const footCornerMap = resolveCornerAssetMap(footCornerAssetIds)
  if (footCornerMap) assets.footCornerObjectsByAssetId = footCornerMap

  return assets
}

function buildWallRenderOptionsFromNode(node: SceneNode, definition: WallDynamicMesh): WallRenderOptions {
  const wallState = node.components?.[WALL_COMPONENT_TYPE]
  const wallProps = clampWallProps((wallState?.props ?? null) as Record<string, unknown> | null | undefined)
  const fallbackNodeMaterialConfigId = Array.isArray(node.materials)
    ? (node.materials.find((entry) => typeof entry?.id === 'string' && entry.id.trim().length > 0)?.id ?? null)
    : null

  return {
    bodyMaterialConfigId: wallProps.bodyMaterialConfigId ?? definition.bodyMaterialConfigId ?? fallbackNodeMaterialConfigId,
    cornerModels: wallProps.cornerModels ?? [],
    wallRenderMode: wallProps.wallRenderMode,
    repeatInstanceStep: wallProps.repeatInstanceStep,
    headAssetHeight: Number.isFinite(wallProps.headAssetHeight) ? Number(wallProps.headAssetHeight) : undefined,
    footAssetHeight: Number.isFinite(wallProps.footAssetHeight) ? Number(wallProps.footAssetHeight) : undefined,
    bodyUvAxis: wallProps.bodyUvAxis,
    headUvAxis: wallProps.headUvAxis,
    footUvAxis: wallProps.footUvAxis,
    bodyOrientation: wallProps.bodyOrientation,
    headOrientation: wallProps.headOrientation,
    footOrientation: wallProps.footOrientation,
    bodyEndCapOffsetLocal: wallProps.bodyEndCapOffsetLocal,
    bodyEndCapOrientation: wallProps.bodyEndCapOrientation,
    headEndCapOffsetLocal: wallProps.headEndCapOffsetLocal,
    headEndCapOrientation: wallProps.headEndCapOrientation,
    footEndCapOffsetLocal: wallProps.footEndCapOffsetLocal,
    footEndCapOrientation: wallProps.footEndCapOrientation,
  }
}

export async function loadPreviewModelObjectFromFile(file: File): Promise<THREE.Object3D | null> {
  const object = await loadObjectFromFile(file, undefined)
  return prepareWallPreviewImportedObject(object)
}

export function createPreviewMaterialTextureResolver(resolveAssetFile: PreviewAssetFileResolver) {
  return async (ref: SceneMaterialTextureRef): Promise<THREE.Texture | null> => {
    const assetId = typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''
    if (!assetId) {
      return null
    }
    const file = await resolveAssetFile(assetId)
    if (!file) {
      return null
    }
    const blobUrl = URL.createObjectURL(file)
    try {
      const loader = new THREE.TextureLoader()
      const texture = await loader.loadAsync(blobUrl)
      texture.name = ref.name ?? file.name ?? assetId
      texture.needsUpdate = true
      return texture
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }
}

export function createPreviewMaterialOverrideOptions(
  resolveAssetFile: PreviewAssetFileResolver,
  warn?: (message: string) => void,
): MaterialTextureAssignmentOptions {
  return {
    resolveTexture: createPreviewMaterialTextureResolver(resolveAssetFile),
    warn,
  }
}

export async function buildWallPreviewObjectFromNode(options: {
  node: SceneNode
  resolveAssetFile: PreviewAssetFileResolver
  materialOverrideOptions?: MaterialTextureAssignmentOptions
}): Promise<THREE.Object3D | null> {
  const definition = options.node.dynamicMesh
  if (!definition || definition.type !== 'Wall') {
    return null
  }

  const wallState = options.node.components?.[WALL_COMPONENT_TYPE]
  if (!wallState || wallState.enabled === false) {
    return null
  }
  const wallProps = clampWallProps((wallState.props ?? null) as Record<string, unknown> | null | undefined)

  const loadedAssetObjects = new Map<string, THREE.Object3D>()
  const assetIds = collectWallAssetIds(options.node)
  for (const assetId of assetIds) {
    const file = await options.resolveAssetFile(assetId)
    if (!file) {
      continue
    }
    const object = await loadPreviewModelObjectFromFile(file)
    if (object) {
      loadedAssetObjects.set(assetId, object)
    }
  }

  const wallObject = createWallRenderGroup(
    definition,
    buildWallRenderAssetsFromNode(options.node, loadedAssetObjects),
    buildWallRenderOptionsFromNode(options.node, definition),
  )
  wallObject.name = options.node.name || 'Wall'
  applyNodeTransform(wallObject, options.node)
  applyNodeVisibility(wallObject, options.node)
  applyPreviewNodeMetadata(wallObject, options.node)

  const nodeMaterials = Array.isArray(options.node.materials)
    ? options.node.materials.filter((entry): entry is SceneNodeMaterial => Boolean(entry))
    : []
  if (nodeMaterials.length > 0 && options.materialOverrideOptions) {
    applyMaterialOverrides(wallObject, nodeMaterials, options.materialOverrideOptions)
  }
  applyAirWallVisualToWallGroup(wallObject, Boolean(wallProps.isAirWall))
  return wallObject
}

export async function buildFloorPreviewObjectFromNode(options: {
  node: SceneNode
  materialOverrideOptions?: MaterialTextureAssignmentOptions
}): Promise<THREE.Object3D | null> {
  const definition = options.node.dynamicMesh
  if (!definition || definition.type !== 'Floor') {
    return null
  }

  const floorState = options.node.components?.[FLOOR_COMPONENT_TYPE]
  if (floorState && floorState.enabled === false) {
    return null
  }

  const floorObject = createFloorGroup(definition as FloorDynamicMesh)
  floorObject.name = options.node.name || 'Floor'
  applyNodeTransform(floorObject, options.node)
  applyNodeVisibility(floorObject, options.node)
  applyPreviewNodeMetadata(floorObject, options.node)

  const nodeMaterials = Array.isArray(options.node.materials)
    ? options.node.materials.filter((entry): entry is SceneNodeMaterial => Boolean(entry))
    : []
  if (nodeMaterials.length > 0 && options.materialOverrideOptions) {
    applyMaterialOverrides(floorObject, nodeMaterials, options.materialOverrideOptions)
  }

  return floorObject
}