import * as THREE from 'three'
import type { SceneMaterial, SceneMaterialTextureRef, WallDynamicMesh } from '@schema'
import { applyMaterialOverrides, type MaterialTextureAssignmentOptions } from '@schema/material'
import {
  createWallRenderGroup,
  type WallRenderAssetObjects,
  type WallRenderOptions,
} from '@schema/wallMesh'
import { buildWallDynamicMeshFromWorldSegments } from '@/stores/wallUtils'
import { disposeThumbnailObject, renderObjectThumbnailDataUrl } from '@/utils/objectThumbnailRenderer'
import { buildWallNodeMaterialsFromPreset } from '@/utils/wallPresetNodeMaterials'
import type { WallPresetData } from '@/utils/wallPreset'

export const WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY = '__harmonyWallPresetPreviewSharedAsset'


function hasRenderableMesh(object: THREE.Object3D | null | undefined): boolean {
  if (!object) {
    return false
  }
  let found = false
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      found = true
    }
  })
  return found
}

function summarizeObjectBounds(object: THREE.Object3D | null | undefined): {
  size: { x: number; y: number; z: number } | null
  meshCount: number
} {
  if (!object) {
    return { size: null, meshCount: 0 }
  }
  const box = new THREE.Box3().setFromObject(object)
  let meshCount = 0
  object.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      meshCount += 1
    }
  })
  if (box.isEmpty()) {
    return { size: null, meshCount }
  }
  const size = box.getSize(new THREE.Vector3())
  return {
    size: { x: size.x, y: size.y, z: size.z },
    meshCount,
  }
}

type WallPreviewMeshStats = {
  totalMeshes: number
  bodyMeshes: number
  headMeshes: number
  footMeshes: number
  bodyEndCapMeshes: number
  headEndCapMeshes: number
  footEndCapMeshes: number
  cornerMeshes: number
  proceduralMeshes: number
}

function collectWallPreviewMeshStats(object: THREE.Object3D | null | undefined): WallPreviewMeshStats {
  const stats: WallPreviewMeshStats = {
    totalMeshes: 0,
    bodyMeshes: 0,
    headMeshes: 0,
    footMeshes: 0,
    bodyEndCapMeshes: 0,
    headEndCapMeshes: 0,
    footEndCapMeshes: 0,
    cornerMeshes: 0,
    proceduralMeshes: 0,
  }
  if (!object) {
    return stats
  }
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    stats.totalMeshes += 1
    const name = typeof mesh.name === 'string' ? mesh.name : ''
    if (name.startsWith('WallBodyMesh')) {
      stats.bodyMeshes += 1
    } else if (name.startsWith('WallHeadMesh')) {
      stats.headMeshes += 1
    } else if (name.startsWith('WallFootMesh')) {
      stats.footMeshes += 1
    } else if (name.startsWith('WallBodyEndCapMesh')) {
      stats.bodyEndCapMeshes += 1
    } else if (name.startsWith('WallHeadEndCapMesh')) {
      stats.headEndCapMeshes += 1
    } else if (name.startsWith('WallFootEndCapMesh')) {
      stats.footEndCapMeshes += 1
    } else if (name.includes('CornerMesh')) {
      stats.cornerMeshes += 1
    } else if (name.startsWith('WallMesh')) {
      stats.proceduralMeshes += 1
    }
  })
  return stats
}

function collectWallPresetAssetIds(preset: WallPresetData): string[] {
  return Array.from(
    new Set(
      [
        preset.wallProps.bodyAssetId,
        preset.wallProps.headAssetId,
        preset.wallProps.footAssetId,
        preset.wallProps.bodyEndCapAssetId,
        preset.wallProps.headEndCapAssetId,
        preset.wallProps.footEndCapAssetId,
        ...((preset.wallProps.cornerModels ?? []).flatMap((entry) => [entry.bodyAssetId, entry.headAssetId, entry.footAssetId])),
      ]
        .map((assetId) => (typeof assetId === 'string' ? assetId.trim() : ''))
        .filter((assetId) => assetId.length > 0),
    ),
  )
}

function buildWallRenderAssetsFromPreset(preset: WallPresetData, loadedAssetObjects: Map<string, THREE.Object3D>): WallRenderAssetObjects {
  const wallProps = preset.wallProps
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

function buildWallRenderOptionsFromPreset(preset: WallPresetData, definition: WallDynamicMesh): WallRenderOptions {
  return {
    bodyMaterialConfigId: preset.wallProps.bodyMaterialConfigId ?? definition.bodyMaterialConfigId ?? preset.materialOrder?.[0] ?? null,
    cornerModels: preset.wallProps.cornerModels ?? [],
    wallRenderMode: preset.wallProps.wallRenderMode,
    repeatInstanceStep: preset.wallProps.repeatInstanceStep,
    headAssetHeight: Number.isFinite(preset.wallProps.headAssetHeight) ? Number(preset.wallProps.headAssetHeight) : undefined,
    footAssetHeight: Number.isFinite(preset.wallProps.footAssetHeight) ? Number(preset.wallProps.footAssetHeight) : undefined,
    bodyUvAxis: preset.wallProps.bodyUvAxis,
    headUvAxis: preset.wallProps.headUvAxis,
    footUvAxis: preset.wallProps.footUvAxis,
    bodyOrientation: preset.wallProps.bodyOrientation,
    headOrientation: preset.wallProps.headOrientation,
    footOrientation: preset.wallProps.footOrientation,
    bodyEndCapOffsetLocal: preset.wallProps.bodyEndCapOffsetLocal,
    bodyEndCapOrientation: preset.wallProps.bodyEndCapOrientation,
    headEndCapOffsetLocal: preset.wallProps.headEndCapOffsetLocal,
    headEndCapOrientation: preset.wallProps.headEndCapOrientation,
    footEndCapOffsetLocal: preset.wallProps.footEndCapOffsetLocal,
    footEndCapOrientation: preset.wallProps.footEndCapOrientation,
  }
}

export function prepareWallPreviewImportedObject(object: THREE.Object3D): THREE.Object3D {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh || !mesh.isMesh) {
      return
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
  return object
}

export function buildWallPresetPreviewDynamicMesh(
  preset: WallPresetData,
  options: { rectSizeMeters?: number } = {},
): WallDynamicMesh {
  const rectSize = typeof options.rectSizeMeters === 'number' && Number.isFinite(options.rectSizeMeters)
    ? Math.max(0.1, options.rectSizeMeters)
    : 3
  const half = rectSize * 0.5
  const built = buildWallDynamicMeshFromWorldSegments(
    [
      { start: { x: -half, y: 0, z: -half }, end: { x: half, y: 0, z: -half } },
      { start: { x: half, y: 0, z: -half }, end: { x: half, y: 0, z: half } },
      { start: { x: half, y: 0, z: half }, end: { x: -half, y: 0, z: half } },
      { start: { x: -half, y: 0, z: half }, end: { x: -half, y: 0, z: -half } },
    ],
    {
      height: preset.wallProps.height,
      width: preset.wallProps.width,
      thickness: preset.wallProps.thickness,
    },
  )

  if (!built) {
    throw new Error('无法构建墙体预览几何')
  }

  return {
    ...built.definition,
    bodyMaterialConfigId: preset.wallProps.bodyMaterialConfigId ?? preset.materialOrder?.[0] ?? null,
  }
}

export async function buildWallPresetPreviewObject(options: {
  preset: WallPresetData
  loadAssetMesh: (assetId: string) => Promise<THREE.Object3D | null>
}): Promise<THREE.Object3D | null> {
  const definition = buildWallPresetPreviewDynamicMesh(options.preset, { rectSizeMeters: 10 })
  const loadedAssetObjects = new Map<string, THREE.Object3D>()
  const assetIds = collectWallPresetAssetIds(options.preset)


  for (const assetId of assetIds) {
    const loaded = await options.loadAssetMesh(assetId)

    if (!loaded) {
      continue
    }
    prepareWallPreviewImportedObject(loaded)
    loadedAssetObjects.set(assetId, loaded)

  }

  const renderAssets = buildWallRenderAssetsFromPreset(options.preset, loadedAssetObjects)
  const renderOptions = buildWallRenderOptionsFromPreset(options.preset, definition)


  const wallObject = createWallRenderGroup(definition, renderAssets, renderOptions)
  wallObject.name = options.preset.name || 'Wall Preset Preview'



  return wallObject
}

export async function renderWallPresetThumbnailDataUrl(options: {
  preset: WallPresetData
  loadAssetMesh: (assetId: string) => Promise<THREE.Object3D | null>
  sharedMaterials?: readonly SceneMaterial[]
  resolveTexture?: (ref: SceneMaterialTextureRef) => Promise<THREE.Texture | null>
  width: number
  height: number
}): Promise<string | null> {

  const wallObject = await buildWallPresetPreviewObject({
    preset: options.preset,
    loadAssetMesh: options.loadAssetMesh,
  })
  if (!wallObject) {
    return null
  }

  if (options.sharedMaterials && options.resolveTexture) {
    const materialOverrideOptions: MaterialTextureAssignmentOptions = {
      resolveTexture: options.resolveTexture,
    }
    applyMaterialOverrides(
      wallObject,
      buildWallNodeMaterialsFromPreset(options.preset, options.sharedMaterials),
      materialOverrideOptions,
    )
  }

  const dataUrl = renderObjectThumbnailDataUrl({
    object: wallObject,
    width: options.width,
    height: options.height,
  })

  disposeThumbnailObject(wallObject, {
    preserveMeshUserDataFlag: WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY,
  })
  return dataUrl
}
