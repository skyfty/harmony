import * as THREE from 'three'
import type { SceneMaterialTextureRef, SceneNode, SceneNodeComponentState, SceneNodeMaterial } from '@schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from './assetCacheStore'
import { extractExtension } from '@/utils/blob'
import { ASSET_THUMBNAIL_HEIGHT, ASSET_THUMBNAIL_WIDTH } from '@/utils/assetThumbnail'
import {
  LANDFORM_COMPONENT_TYPE,
  clampLandformComponentProps,
  type LandformComponentProps,
} from '@schema/components'
import {
  LANDFORM_PRESET_FORMAT_VERSION,
  buildLandformPresetFilename,
  isLandformPresetFilename,
  type LandformPresetData,
  type LandformPresetMaterialPatch,
  type StrictLandformPresetProps,
} from '@/utils/landformPreset'
import { buildAssetDependencySubset, isSceneAssetRegistry } from '@/utils/assetDependencySubset'
import { renderLandformPresetThumbnailDataUrl } from '@/utils/landformPresetThumbnail'

export type LandformPresetStoreLike = {
  nodes: SceneNode[]
  selectedNodeId: string | null
  assetCatalog: Record<string, ProjectAsset[]> | null
  assetRegistry: Record<string, any>
  materials: Array<{ id: string; name: string; type: string } & Record<string, any>>

  getAsset: (id: string) => ProjectAsset | null
  registerAsset: (asset: ProjectAsset, options: any) => ProjectAsset
  selectAsset: (assetId: string) => void
  resolveConfigAssetSaveDirectoryId: () => string

  updateNodeDynamicMesh: (nodeId: string, dynamicMesh: any) => void
  updateNodeComponentProps: (nodeId: string, componentId: string, patch: any) => boolean
  setNodeMaterials: (nodeId: string, materials: SceneNodeMaterial[]) => boolean
  ensurePrefabDependencies: (assetIds: string[], options: any) => Promise<void>
}

export type LandformPresetActionsDeps = {
  LANDFORM_PRESET_PREVIEW_COLOR: string
  generateUuid: () => string
  normalizePrefabName: (value: string | null | undefined) => string
  findNodeById: (nodes: SceneNode[], id: string) => SceneNode | null
  nodeSupportsMaterials: (node: SceneNode | null | undefined) => boolean
  extractMaterialProps: (material: SceneNodeMaterial | null | undefined) => any
  materialUpdateToProps: (update: any) => any
  mergeMaterialProps: (base: any, overrides?: any) => any
  createNodeMaterial: (materialId: string | null, props: any, options: { id?: string; name?: string; type?: any }) => SceneNodeMaterial
  DEFAULT_SCENE_MATERIAL_TYPE: string
}

function normalizeOptionalAssetId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : null
}

function collectTextureAssetIdsFromMaterialLike(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  const textures = (value as { textures?: Record<string, unknown> }).textures
  if (!textures || typeof textures !== 'object') {
    return []
  }
  const out = new Set<string>()
  Object.values(textures).forEach((entry) => {
    const assetId = typeof (entry as { assetId?: unknown } | null | undefined)?.assetId === 'string'
      ? ((entry as { assetId?: string }).assetId ?? '').trim()
      : ''
    if (assetId) {
      out.add(assetId)
    }
  })
  return Array.from(out)
}

export function collectLandformPresetDependencyAssetIds(
  preset: LandformPresetData | null | undefined,
  sharedMaterials: ReadonlyArray<{ id: string } & Record<string, unknown>> = [],
): string[] {
  if (!preset) {
    return []
  }

  const patchTextureAssetIds = collectTextureAssetIdsFromMaterialLike(preset.materialPatch?.props)
  const sharedMaterialId = typeof preset.materialPatch?.materialId === 'string' ? preset.materialPatch.materialId.trim() : ''
  const sharedMaterial = sharedMaterialId ? sharedMaterials.find((entry) => entry.id === sharedMaterialId) : null
  const sharedTextureAssetIds = collectTextureAssetIdsFromMaterialLike(sharedMaterial)

  return Array.from(
    new Set(
      [
        ...patchTextureAssetIds,
        ...sharedTextureAssetIds,
        ...Object.keys((preset.assetRegistry ?? {}) as Record<string, unknown>),
      ]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0),
    ),
  )
}

function assertStrictLandformPresetProps(value: unknown): StrictLandformPresetProps {
  if (!value || typeof value !== 'object') {
    throw new Error('地貌预设 landformProps 格式无效')
  }

  const record = value as Record<string, unknown>
  const uvScaleRaw = record.uvScale
  if (!uvScaleRaw || typeof uvScaleRaw !== 'object') {
    throw new Error('地貌预设缺少或无效字段: uvScale')
  }

  const props = clampLandformComponentProps({
    enableFeather: typeof record.enableFeather === 'boolean' ? record.enableFeather : true,
    feather: record.feather as number | undefined,
    uvScale: uvScaleRaw as any,
  })

  return {
    enableFeather: props.enableFeather,
    feather: props.feather,
    uvScale: { x: props.uvScale.x, y: props.uvScale.y },
  }
}

export function parseLandformPresetData(text: string): LandformPresetData {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('地貌预设数据损坏：无法解析 JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('地貌预设格式无效')
  }

  const record = parsed as Record<string, unknown>
  if (record.kind !== 'landform-preset') {
    throw new Error('地貌预设格式不受支持')
  }
  const formatVersion = Number(record.formatVersion)
  if (formatVersion !== 1 && formatVersion !== LANDFORM_PRESET_FORMAT_VERSION) {
    throw new Error(`地貌预设版本不匹配 (expected 1 or ${LANDFORM_PRESET_FORMAT_VERSION})`)
  }

  const name = typeof record.name === 'string' && record.name.trim().length ? record.name.trim() : ''
  if (!name) {
    throw new Error('地貌预设缺少名称')
  }

  const materialSlotId = typeof record.materialSlotId === 'string' ? record.materialSlotId.trim() : ''
  if (!materialSlotId) {
    throw new Error('地貌预设缺少材质槽信息')
  }

  const patchRaw = record.materialPatch
  if (!patchRaw || typeof patchRaw !== 'object') {
    throw new Error('地貌预设缺少材质 patch')
  }

  const patchRecord = patchRaw as Record<string, unknown>
  const materialId = patchRecord.materialId === null ? null : normalizeOptionalAssetId(patchRecord.materialId)
  if (patchRecord.materialId !== null && materialId === null) {
    throw new Error('地貌预设材质 patch 缺少 materialId')
  }

  const materialPatch: LandformPresetMaterialPatch = {
    id: materialSlotId,
    materialId,
  }
  if (typeof patchRecord.name === 'string' && patchRecord.name.trim().length) {
    materialPatch.name = patchRecord.name.trim()
  }
  if (typeof patchRecord.type === 'string' && patchRecord.type.trim().length) {
    materialPatch.type = patchRecord.type.trim()
  }
  if (patchRecord.props !== undefined) {
    if (!patchRecord.props || typeof patchRecord.props !== 'object' || Array.isArray(patchRecord.props)) {
      throw new Error('地貌预设材质 props 格式无效')
    }
    materialPatch.props = patchRecord.props as Record<string, unknown>
  }

  return {
    kind: 'landform-preset',
    formatVersion,
    name,
    landformProps: assertStrictLandformPresetProps(record.landformProps),
    materialSlotId,
    materialPatch,
    assetRegistry: record.assetRegistry,
  }
}

export function createLandformPresetActions(deps: LandformPresetActionsDeps) {
  async function generateLandformPresetThumbnailDataUrl(
    store: LandformPresetStoreLike,
    presetData: LandformPresetData,
  ): Promise<string | null> {
    const assetCache = useAssetCacheStore()

    const ensureAssetFile = async (assetId: string): Promise<File | null> => {
      const normalizedId = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalizedId.length) {
        return null
      }

      const asset = store.getAsset(normalizedId)
      return await assetCache.ensureAssetFile(normalizedId, { asset })
    }

    const resolveTexture = async (ref: SceneMaterialTextureRef) => {
      const assetId = typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''
      if (!assetId) {
        return null
      }
      const file = await ensureAssetFile(assetId)
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
      } catch {
        return null
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    }

    return await renderLandformPresetThumbnailDataUrl({
      preset: presetData,
      sharedMaterials: store.materials as any,
      resolveTexture,
      width: ASSET_THUMBNAIL_WIDTH,
      height: ASSET_THUMBNAIL_HEIGHT,
    })
  }

  return {
    findLandformPresetAssetByFilename(store: LandformPresetStoreLike, filename: string): ProjectAsset | null {
      const normalized = typeof filename === 'string' ? filename.trim().toLowerCase() : ''
      if (!normalized || !isLandformPresetFilename(normalized)) {
        return null
      }
      const categories = Object.values(store.assetCatalog ?? {})
      for (const list of categories) {
        if (!Array.isArray(list)) {
          continue
        }
        for (const asset of list) {
          if (!asset || asset.type !== 'prefab') {
            continue
          }
          const description = typeof asset.description === 'string' ? asset.description.trim().toLowerCase() : ''
          if (description && description === normalized && isLandformPresetFilename(description)) {
            return asset
          }
        }
      }
      return null
    },

    async saveLandformPreset(
      store: LandformPresetStoreLike,
      payload: { name: string; nodeId?: string | null; assetId?: string | null; select?: boolean },
    ): Promise<ProjectAsset> {
      const nodeId = (payload.nodeId ?? store.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择地貌节点')
      }
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('地貌节点不存在或已被移除')
      }

      const component = node.components?.[LANDFORM_COMPONENT_TYPE] as SceneNodeComponentState<LandformComponentProps> | undefined
      if (!component) {
        throw new Error('地貌节点缺少 Landform 组件')
      }

      const name = typeof payload.name === 'string' ? payload.name : ''
      const sanitizedName = deps.normalizePrefabName(name) || 'Landform Preset'
      const landformProps = clampLandformComponentProps(component.props)

      const nodeMaterials = Array.isArray(node.materials) ? (node.materials as SceneNodeMaterial[]) : []
      if (!nodeMaterials.length) {
        throw new Error('地貌节点缺少材质槽位')
      }

      const surfaceSlot = nodeMaterials.find((entry) => (entry?.name ?? '').trim().toLowerCase() === 'surface') ?? nodeMaterials[0]
      if (!surfaceSlot) {
        throw new Error('地貌节点缺少 Surface 材质槽')
      }
      const materialSlotId = typeof surfaceSlot?.id === 'string' ? surfaceSlot.id.trim() : ''
      if (!materialSlotId) {
        throw new Error('地貌节点材质槽位 id 无效')
      }

      const surfaceMaterialId = typeof (surfaceSlot as any).materialId === 'string' ? (surfaceSlot as any).materialId.trim() : ''
      const materialPatch: LandformPresetMaterialPatch = surfaceMaterialId
        ? {
            id: materialSlotId,
            materialId: surfaceMaterialId,
          }
        : {
            id: materialSlotId,
            materialId: null,
            name: typeof surfaceSlot.name === 'string' && surfaceSlot.name.trim().length ? surfaceSlot.name.trim() : undefined,
            type: typeof surfaceSlot.type === 'string' && surfaceSlot.type.trim().length ? surfaceSlot.type.trim() : undefined,
            props: deps.extractMaterialProps(surfaceSlot) as Record<string, unknown>,
          }

      const dependencyAssetIds = Array.from(
        new Set(
          nodeMaterials
            .flatMap((material) => {
              const localTextureAssetIds = collectTextureAssetIdsFromMaterialLike(material)
              const sharedMaterialId = typeof (material as any)?.materialId === 'string' ? (material as any).materialId.trim() : ''
              if (!sharedMaterialId) {
                return localTextureAssetIds
              }
              const sharedMaterial = store.materials.find((entry) => entry.id === sharedMaterialId)
              const sharedTextureAssetIds = collectTextureAssetIdsFromMaterialLike(sharedMaterial)
              return [...localTextureAssetIds, ...sharedTextureAssetIds]
            })
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0),
        ),
      )

      const presetData: LandformPresetData = {
        kind: 'landform-preset',
        formatVersion: LANDFORM_PRESET_FORMAT_VERSION,
        name: sanitizedName,
        landformProps: {
          enableFeather: landformProps.enableFeather,
          feather: landformProps.feather,
          uvScale: { x: landformProps.uvScale.x, y: landformProps.uvScale.y },
        },
        materialSlotId,
        materialPatch,
      }

      if (dependencyAssetIds.length) {
        const dependencySubset = buildAssetDependencySubset({
          assetIds: dependencyAssetIds,
          assetRegistry: store.assetRegistry,
        })
        if (dependencySubset.assetRegistry) {
          presetData.assetRegistry = dependencySubset.assetRegistry
        }
      }

      const serialized = JSON.stringify(presetData, null, 2)
      const fileName = buildLandformPresetFilename(sanitizedName)
      const assetId = typeof payload.assetId === 'string' && payload.assetId.trim().length ? payload.assetId.trim() : deps.generateUuid()

      const blob = new Blob([serialized], { type: 'application/json' })
      const assetCache = useAssetCacheStore()
      await assetCache.storeAssetBlob(assetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      let thumbnailDataUrl: string | null = null
      try {
        thumbnailDataUrl = await generateLandformPresetThumbnailDataUrl(store, presetData)
      } catch (thumbnailError) {
        console.warn('Failed to generate landform preset thumbnail', thumbnailError)
      }

      if (payload.assetId) {
        const existing = store.getAsset(assetId)
        if (!existing) {
          throw new Error('地貌预设资源不存在')
        }
        if (existing.type !== 'prefab') {
          throw new Error('指定资源并非地貌预设')
        }
        const updated: ProjectAsset = {
          ...existing,
          name: sanitizedName,
          description: fileName,
          previewColor: deps.LANDFORM_PRESET_PREVIEW_COLOR,
          thumbnail: thumbnailDataUrl ?? existing.thumbnail ?? null,
        }
        const categoryId = store.resolveConfigAssetSaveDirectoryId()
        const sourceMeta = existing.source
        return store.registerAsset(updated, {
          categoryId,
          source: sourceMeta,
          commitOptions: { updateNodes: false },
        })
      }

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: sanitizedName,
        type: 'prefab',
        downloadUrl: assetId,
        previewColor: deps.LANDFORM_PRESET_PREVIEW_COLOR,
        thumbnail: thumbnailDataUrl,
        description: fileName,
        gleaned: true,
        extension: extractExtension(fileName) ?? null,
      }
      const categoryId = store.resolveConfigAssetSaveDirectoryId()
      const registered = store.registerAsset(projectAsset, {
        categoryId,
        source: { type: 'local' },
        commitOptions: { updateNodes: false },
      })

        if (payload.select === true) {
        store.selectAsset(registered.id)
      }

      return registered
    },

    async loadLandformPreset(store: LandformPresetStoreLike, assetId: string): Promise<LandformPresetData> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('地貌预设资源不存在')
      }
      if (asset.type !== 'prefab') {
        throw new Error('指定资源并非地貌预设')
      }
      if (!isLandformPresetFilename(asset.description ?? null)) {
        throw new Error('指定资源并非 .landform 地貌预设')
      }

      const assetCache = useAssetCacheStore()
      let entry: any = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { asset })
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载地貌预设数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      const preset = parseLandformPresetData(text)

      if (preset.assetRegistry !== undefined && preset.assetRegistry !== null && !isSceneAssetRegistry(preset.assetRegistry)) {
        throw new Error('地貌预设 assetRegistry 格式无效')
      }
      return preset
    },

    async applyLandformPresetToNode(
      store: LandformPresetStoreLike,
      nodeId: string,
      assetId: string,
      presetData?: LandformPresetData | null,
    ): Promise<LandformComponentProps> {
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('地貌节点不存在或已被移除')
      }

      const component = node.components?.[LANDFORM_COMPONENT_TYPE] as SceneNodeComponentState<LandformComponentProps> | undefined
      if (!component) {
        throw new Error('只能将地貌预设应用到 Landform 节点')
      }

      const preset = presetData ?? (await this.loadLandformPreset(store, assetId))
      const dependencyAssetIds = collectLandformPresetDependencyAssetIds(preset, store.materials)
      const presetAssetRegistry = isSceneAssetRegistry(preset.assetRegistry) ? preset.assetRegistry : undefined

      if (dependencyAssetIds.length) {
        await store.ensurePrefabDependencies(dependencyAssetIds, {
          prefabAssetIdForDownloadProgress: assetId,
          prefabAssetRegistry: presetAssetRegistry ?? null,
        })
      }

      const refreshed = deps.findNodeById(store.nodes, nodeId)
      const landformComponent = refreshed?.components?.[LANDFORM_COMPONENT_TYPE] as SceneNodeComponentState<LandformComponentProps> | undefined
      if (!landformComponent) {
        throw new Error('Landform 组件不可用')
      }

      store.updateNodeComponentProps(nodeId, landformComponent.id, preset.landformProps as unknown as Partial<Record<string, unknown>>)

      const target = deps.findNodeById(store.nodes, nodeId)
      if (target && deps.nodeSupportsMaterials(target)) {
        const existing = Array.isArray(target.materials) ? (target.materials as SceneNodeMaterial[]) : []
        const existingSlot = existing.find((entry) => entry.id === preset.materialSlotId)
          ?? existing.find((entry) => (entry?.name ?? '').trim().toLowerCase() === 'surface')
          ?? existing[0]
        if (!existingSlot) {
          throw new Error('地貌节点缺少 Surface 材质槽')
        }

        const patch = preset.materialPatch
        const sharedMaterialId = patch.materialId === null ? null : normalizeOptionalAssetId(patch.materialId)
        const patchName = typeof patch.name === 'string' && patch.name.trim().length ? patch.name.trim() : (existingSlot.name || 'Surface')

        let updated = existingSlot
        if (sharedMaterialId) {
          const shared = store.materials.find((entry) => entry.id === sharedMaterialId) ?? null
          if (!shared) {
            throw new Error(`地貌预设引用的共享材质不存在: ${sharedMaterialId}`)
          }
          updated = deps.createNodeMaterial(shared.id, shared, {
            id: existingSlot.id,
            name: patchName,
            type: (shared as any).type,
          })
        } else {
          const baseProps = deps.extractMaterialProps(existingSlot)
          const overrides = patch.props ? deps.materialUpdateToProps(patch.props as any) : {}
          const mergedProps = patch.props ? deps.mergeMaterialProps(baseProps as any, overrides) : baseProps
          updated = deps.createNodeMaterial(null, mergedProps, {
            id: existingSlot.id,
            name: patchName,
            type: typeof patch.type === 'string' && patch.type.trim().length
              ? (patch.type as any)
              : (existingSlot as any).type ?? deps.DEFAULT_SCENE_MATERIAL_TYPE,
          })
        }

        const nextMaterials = existing.map((entry) => (entry.id === existingSlot.id ? updated : entry))
        store.setNodeMaterials(nodeId, nextMaterials)

        const refreshedAfterMaterials = deps.findNodeById(store.nodes, nodeId)
        const mesh = refreshedAfterMaterials?.dynamicMesh?.type === 'Landform' ? (refreshedAfterMaterials.dynamicMesh as any) : null
        if (mesh) {
          store.updateNodeDynamicMesh(nodeId, {
            ...mesh,
            materialConfigId: updated.id,
          })
        }
      }

      return preset.landformProps as unknown as LandformComponentProps
    },

    async applyLandformPresetToSelectedLandform(store: LandformPresetStoreLike, assetId: string): Promise<void> {
      const nodeId = (store.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择地貌节点')
      }
      await this.applyLandformPresetToNode(store, nodeId, assetId)
    },

    parseLandformPresetData,
    assertStrictLandformPresetProps,
  }
}