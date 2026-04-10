import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { SceneMaterial, SceneMaterialTextureRef, WallDynamicMesh } from '@schema'
import { WALL_COMPONENT_TYPE } from '@schema/components'
import { applyMaterialOverrides, type MaterialTextureAssignmentOptions } from '@schema/material'
import { buildWallMesh } from '@schema/sceneGraph/dynamicMeshes/wall'
import { getCachedModelObject } from '@schema/modelObjectCache'
import {
  WALL_INSTANCED_BINDINGS_USERDATA_KEY,
  type WallInstancedBindingSpec,
} from '@schema/wallInstancing'
import { buildWallDynamicMeshFromWorldSegments } from '@/stores/wallUtils'
import { disposeThumbnailObject, renderObjectThumbnailDataUrl } from '@/utils/objectThumbnailRenderer'
import { buildWallNodeMaterialsFromPreset } from '@/utils/wallPresetNodeMaterials'
import type { WallPresetData } from '@/utils/wallPreset'

export const WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY = '__harmonyWallPresetPreviewSharedAsset'
const WALL_PRESET_PREVIEW_LOG_PREFIX = '[WallPresetPreview]'

function logWallPresetPreview(message: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.info(WALL_PRESET_PREVIEW_LOG_PREFIX, message, payload)
    return
  }
  console.info(WALL_PRESET_PREVIEW_LOG_PREFIX, message)
}

function normalizeWallInstancedBindingSpecs(object: THREE.Object3D | null | undefined): WallInstancedBindingSpec[] {
  const raw = (object?.userData as Record<string, unknown> | undefined)?.[WALL_INSTANCED_BINDINGS_USERDATA_KEY]
  return Array.isArray(raw)
    ? raw.filter((entry) => Boolean(entry && typeof entry === 'object')) as WallInstancedBindingSpec[]
    : []
}

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

function coercePreviewMatrix4(value: unknown): THREE.Matrix4 | null {
  if (value instanceof THREE.Matrix4) {
    return value
  }

  const elements = (value as { elements?: unknown } | null | undefined)?.elements
  if (!elements || typeof elements !== 'object' || !('length' in elements)) {
    return null
  }

  const raw = Array.from(elements as ArrayLike<unknown>)
  if (raw.length !== 16) {
    return null
  }

  const numeric = raw.map((entry) => Number(entry))
  if (numeric.some((entry) => !Number.isFinite(entry))) {
    return null
  }

  return new THREE.Matrix4().fromArray(numeric)
}


function resolveWallBindingSourceAssetId(binding: WallInstancedBindingSpec): string {
  const sourceAssetId = typeof binding.sourceAssetId === 'string' ? binding.sourceAssetId.trim() : ''
  if (sourceAssetId.length > 0) {
    return sourceAssetId
  }
  const assetId = typeof binding.assetId === 'string' ? binding.assetId.trim() : ''
  if (!assetId) {
    return ''
  }
  const variantSeparator = assetId.indexOf('#')
  return variantSeparator >= 0 ? assetId.slice(0, variantSeparator) : assetId
}

function cloneWallPreviewAssetObject(source: THREE.Object3D): THREE.Object3D {
  try {
    return cloneSkinned(source)
  } catch {
    return source.clone(true)
  }
}

function resolveWallBindingPreviewSource(binding: WallInstancedBindingSpec, loadedAssetObjects: Map<string, THREE.Object3D>): {
  object: THREE.Object3D | null
  sourceKind: 'loaded-binding' | 'loaded-source' | 'cached-binding' | 'cached-source' | 'missing'
  resolvedAssetId: string | null
} {
  const bindingAssetId = typeof binding.assetId === 'string' ? binding.assetId.trim() : ''
  const sourceAssetId = resolveWallBindingSourceAssetId(binding)

  const loadedBindingObject = bindingAssetId ? loadedAssetObjects.get(bindingAssetId) ?? null : null
  if (loadedBindingObject) {
    return { object: loadedBindingObject, sourceKind: 'loaded-binding', resolvedAssetId: bindingAssetId }
  }

  const loadedSourceObject = sourceAssetId ? loadedAssetObjects.get(sourceAssetId) ?? null : null
  if (loadedSourceObject) {
    return { object: loadedSourceObject, sourceKind: 'loaded-source', resolvedAssetId: sourceAssetId }
  }

  const cachedBindingObject = bindingAssetId ? getCachedModelObject(bindingAssetId)?.object ?? null : null
  if (cachedBindingObject) {
    return { object: cachedBindingObject, sourceKind: 'cached-binding', resolvedAssetId: bindingAssetId }
  }

  const cachedSourceObject = sourceAssetId ? getCachedModelObject(sourceAssetId)?.object ?? null : null
  if (cachedSourceObject) {
    return { object: cachedSourceObject, sourceKind: 'cached-source', resolvedAssetId: sourceAssetId }
  }

  return { object: null, sourceKind: 'missing', resolvedAssetId: null }
}

function materializeWallInstancedBindingsToPreviewMeshes(options: {
  wallObject: THREE.Object3D
  loadedAssetObjects: Map<string, THREE.Object3D>
}): { created: number; missingAssetIds: string[]; invalidMatrixCount: number; bindingAssetIds: string[] } {
  const bindings = normalizeWallInstancedBindingSpecs(options.wallObject)
  if (!bindings.length) {
    return { created: 0, missingAssetIds: [], invalidMatrixCount: 0, bindingAssetIds: [] }
  }

  const materializedGroup = new THREE.Group()
  materializedGroup.name = 'WallPresetInstancedPreviewMeshes'
  const missingAssetIds = new Set<string>()
  const bindingAssetIds = new Set<string>()
  let created = 0
  let invalidMatrixCount = 0

  bindings.forEach((binding) => {
    const sourceAssetId = resolveWallBindingSourceAssetId(binding)
    if (!sourceAssetId) {
      return
    }

    bindingAssetIds.add(sourceAssetId)

    const resolvedSource = resolveWallBindingPreviewSource(binding, options.loadedAssetObjects)
    const sourceObject = resolvedSource.object
    if (!sourceObject) {
      missingAssetIds.add(sourceAssetId)
      return
    }

    const localMatrices = Array.isArray(binding.localMatrices) ? binding.localMatrices : []
    localMatrices.forEach((matrixValue) => {
      const matrix = coercePreviewMatrix4(matrixValue)
      if (!matrix) {
        invalidMatrixCount += 1
        return
      }
      const cloned = cloneWallPreviewAssetObject(sourceObject)
      prepareWallPreviewImportedObject(cloned)
      cloned.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        mesh.userData = {
          ...(mesh.userData ?? {}),
          [WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY]: true,
        }
      })
      cloned.applyMatrix4(matrix)
      materializedGroup.add(cloned)
      created += 1
    })
  })

  if (created > 0) {
    options.wallObject.add(materializedGroup)
  }
  return {
    created,
    missingAssetIds: Array.from(missingAssetIds),
    invalidMatrixCount,
    bindingAssetIds: Array.from(bindingAssetIds),
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
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((mat) => {
        if (!mat) {
          return
        }
        mat.side = THREE.DoubleSide
        mat.needsUpdate = true
      })
    } else if (mesh.material) {
      mesh.material.side = THREE.DoubleSide
      mesh.material.needsUpdate = true
    }
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
  logWallPresetPreview('build start', {
    name: options.preset.name || 'Wall Preset Preview',
    bodyAssetId: options.preset.wallProps.bodyAssetId ?? null,
    headAssetId: options.preset.wallProps.headAssetId ?? null,
    footAssetId: options.preset.wallProps.footAssetId ?? null,
    bodyEndCapAssetId: options.preset.wallProps.bodyEndCapAssetId ?? null,
    headEndCapAssetId: options.preset.wallProps.headEndCapAssetId ?? null,
    footEndCapAssetId: options.preset.wallProps.footEndCapAssetId ?? null,
    cornerModelCount: Array.isArray(options.preset.wallProps.cornerModels) ? options.preset.wallProps.cornerModels.length : 0,
    wallRenderMode: options.preset.wallProps.wallRenderMode ?? 'stretch',
  })

  const node = {
    id: 'wall-preset-preview-node',
    name: options.preset.name || 'Wall Preset Preview',
    nodeType: 'Mesh',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    dynamicMesh: definition,
    components: {
      [WALL_COMPONENT_TYPE]: {
        enabled: true,
        props: options.preset.wallProps,
      },
    },
    materials: buildWallNodeMaterialsFromPreset(options.preset, []),
  } as any

  const tracedLoadAssetMesh = async (assetId: string): Promise<THREE.Object3D | null> => {
    const loaded = await options.loadAssetMesh(assetId)
    logWallPresetPreview('asset load result', {
      assetId,
      loaded: Boolean(loaded),
      hasRenderableMesh: hasRenderableMesh(loaded),
    })
    if (loaded) {
      loadedAssetObjects.set(assetId, loaded)
    }
    return loaded
  }

  const wallObject = await buildWallMesh(
    {
      loadAssetMesh: tracedLoadAssetMesh,
      resolveNodeMaterials: async () => [],
      pickMaterialAssignment: () => null,
      applyTransform: () => {},
      applyVisibility: () => {},
    },
    definition,
    node,
  )

  logWallPresetPreview('buildWallMesh result', {
    hasWallObject: Boolean(wallObject),
    hasRenderableMesh: hasRenderableMesh(wallObject),
    bindingCount: wallObject ? normalizeWallInstancedBindingSpecs(wallObject).length : 0,
    bindingAssetIds: wallObject
      ? normalizeWallInstancedBindingSpecs(wallObject).map((binding) => resolveWallBindingSourceAssetId(binding))
      : [],
    loadedAssetObjectCount: loadedAssetObjects.size,
  })

  if (wallObject) {
    const bindings = normalizeWallInstancedBindingSpecs(wallObject)
    if (bindings.length > 0) {
      const hadRenderableMeshBeforeMaterialize = hasRenderableMesh(wallObject)
      const materialized = materializeWallInstancedBindingsToPreviewMeshes({
        wallObject,
        loadedAssetObjects,
      })
      logWallPresetPreview('materialize instanced bindings result', {
        bindingCount: bindings.length,
        bindingAssetIds: materialized.bindingAssetIds,
        hadRenderableMeshBeforeMaterialize,
        created: materialized.created,
        invalidMatrixCount: materialized.invalidMatrixCount,
        missingAssetIds: materialized.missingAssetIds,
        hasRenderableMeshAfterMaterialize: hasRenderableMesh(wallObject),
      })

      if (!hasRenderableMesh(wallObject)) {
        const detailParts = [
          `bindings=${bindings.length}`,
          `created=${materialized.created}`,
          `invalidMatrices=${materialized.invalidMatrixCount}`,
        ]
        if (materialized.missingAssetIds.length > 0) {
          detailParts.push(`missingAssets=${materialized.missingAssetIds.join(',')}`)
        }
        throw new Error(`无法实体化墙体模型预览: ${detailParts.join(' ')}`)
      }
    }
  }

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
  logWallPresetPreview('thumbnail render start', {
    name: options.preset.name || 'Wall Preset Preview',
    width: options.width,
    height: options.height,
    sharedMaterialCount: Array.isArray(options.sharedMaterials) ? options.sharedMaterials.length : 0,
  })
  const wallObject = await buildWallPresetPreviewObject({
    preset: options.preset,
    loadAssetMesh: options.loadAssetMesh,
  })
  if (!wallObject) {
    logWallPresetPreview('thumbnail render skipped: wallObject missing')
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
  logWallPresetPreview('thumbnail render complete', {
    dataUrlLength: dataUrl.length,
    hasRenderableMesh: hasRenderableMesh(wallObject),
  })
  disposeThumbnailObject(wallObject, {
    preserveMeshUserDataFlag: WALL_PRESET_PREVIEW_SHARED_ASSET_USERDATA_KEY,
  })
  return dataUrl
}
