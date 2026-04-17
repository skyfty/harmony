import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState, SceneNodeMaterial } from '@schema'
import { FLOOR_COMPONENT_TYPE, clampFloorComponentProps, type FloorComponentProps } from '@schema/components'
import type { SceneMaterialTextureRef } from '@schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from './assetCacheStore'
import { extractExtension } from '@/utils/blob'
import { ASSET_THUMBNAIL_HEIGHT, ASSET_THUMBNAIL_WIDTH } from '@/utils/assetThumbnail'
import { renderFloorPresetThumbnailDataUrl } from '@/utils/floorPresetThumbnail'
import {
  FLOOR_PRESET_FORMAT_VERSION,
  buildFloorPresetFilename,
  isFloorPresetFilename,
  type FloorPresetData,
  type FloorPresetMaterialPatch,
  type StrictFloorPresetFloorProps,
  type StrictFloorPresetMaterialConfig,
} from '@/utils/floorPreset'
import { buildAssetDependencySubset, isSceneAssetRegistry } from '@/utils/assetDependencySubset'
import { normalizeAssetIdsWithRegistry, normalizeMaterialLikeTextureAssetIds } from '@/utils/assetRegistryIdNormalization'

export type FloorPresetStoreLike = {
  nodes: SceneNode[]
  selectedNodeId: string | null
  assetCatalog: Record<string, ProjectAsset[]> | null
  assetRegistry: Record<string, any>
  materials: Array<{ id: string; name: string; type: string } & Record<string, any>>

  getAsset: (id: string) => ProjectAsset | null
  registerAsset: (asset: ProjectAsset, options: any) => ProjectAsset
  setActiveDirectory: (categoryId: string) => void
  selectAsset: (assetId: string) => void
  resolveConfigAssetSaveDirectoryId: () => string

  updateNodeDynamicMesh: (nodeId: string, dynamicMesh: any) => void
  updateNodeComponentProps: (nodeId: string, componentId: string, patch: any) => boolean
  setNodeMaterials: (nodeId: string, materials: SceneNodeMaterial[]) => boolean
  ensurePrefabDependencies: (assetIds: string[], options: any) => Promise<void>
}

export type FloorPresetActionsDeps = {
  FLOOR_PRESET_PREVIEW_COLOR: string

  generateUuid: () => string
  normalizePrefabName: (value: string | null | undefined) => string

  // Node helpers
  findNodeById: (nodes: SceneNode[], id: string) => SceneNode | null
  nodeSupportsMaterials: (node: SceneNode | null | undefined) => boolean

  // Material helpers
  extractMaterialProps: (material: SceneNodeMaterial | null | undefined) => any
  materialUpdateToProps: (update: any) => any
  mergeMaterialProps: (base: any, overrides?: any) => any
  createMaterialProps: (overrides?: any) => any
  createNodeMaterial: (materialId: string | null, props: any, options: { id?: string; name?: string; type?: any }) => SceneNodeMaterial
  DEFAULT_SCENE_MATERIAL_TYPE: string
}

function isFloorPresetAsset(asset: ProjectAsset | null | undefined): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  const extension = typeof asset.extension === 'string' ? asset.extension.trim().toLowerCase() : ''
  if (extension === 'floor') {
    return true
  }
  return isFloorPresetFilename(asset.description ?? asset.name ?? asset.downloadUrl ?? asset.id ?? null)
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

export function collectFloorPresetDependencyAssetIds(
  preset: FloorPresetData | null | undefined,
  sharedMaterials: ReadonlyArray<{ id: string } & Record<string, unknown>> = [],
): string[] {
  if (!preset) {
    return []
  }

  return normalizeAssetIdsWithRegistry(
    [
      ...Object.values(preset.materialPatches ?? {}).flatMap((patch) => {
        const normalizedPatchProps = normalizeMaterialLikeTextureAssetIds((patch as any)?.props, preset.assetRegistry)
        const patchTextureAssetIds = collectTextureAssetIdsFromMaterialLike(normalizedPatchProps)
        const sharedMaterialId = typeof patch?.materialId === 'string' ? patch.materialId.trim() : ''
        if (!sharedMaterialId) {
          return patchTextureAssetIds
        }
        const sharedMaterial = sharedMaterials.find((entry) => entry.id === sharedMaterialId)
        const sharedTextureAssetIds = collectTextureAssetIdsFromMaterialLike(sharedMaterial)
        return [...patchTextureAssetIds, ...sharedTextureAssetIds]
      }),
      ...Object.keys((preset.assetRegistry ?? {}) as Record<string, unknown>),
    ],
    preset.assetRegistry,
  )
}

function assertStrictFloorPresetFloorProps(value: unknown): StrictFloorPresetFloorProps {
  if (!value || typeof value !== 'object') {
    throw new Error('地板预设 floorProps 格式无效')
  }

  const record = value as Record<string, unknown>
  const requiredNumber = (key: string): number => {
    const raw = record[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`地板预设 floorProps 缺少或无效字段: ${key}`)
    }
    return raw
  }

  const sideUvScaleRaw = record.sideUvScale
  if (!sideUvScaleRaw || typeof sideUvScaleRaw !== 'object') {
    throw new Error('地板预设 floorProps 缺少或无效字段: sideUvScale')
  }

  const sideUvScaleRecord = sideUvScaleRaw as Record<string, unknown>
  const sideX = typeof sideUvScaleRecord.x === 'number' && Number.isFinite(sideUvScaleRecord.x) ? sideUvScaleRecord.x : Number.NaN
  const sideY = typeof sideUvScaleRecord.y === 'number' && Number.isFinite(sideUvScaleRecord.y) ? sideUvScaleRecord.y : Number.NaN
  if (!Number.isFinite(sideX) || !Number.isFinite(sideY)) {
    throw new Error('地板预设 floorProps.sideUvScale 格式无效')
  }

  return clampFloorComponentProps({
    smooth: requiredNumber('smooth'),
    thickness: requiredNumber('thickness'),
    sideUvScale: { x: sideX, y: sideY },
  })
}

function assertStrictFloorPresetMaterialConfig(value: unknown, materialOrder: string[]): StrictFloorPresetMaterialConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('地板预设 materialConfig 格式无效')
  }

  const record = value as Record<string, unknown>
  const normalizeId = (raw: unknown): string => {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!id) {
      throw new Error('地板预设 materialConfig 缺少或无效字段')
    }
    return id
  }

  const topBottomMaterialConfigId = normalizeId(record.topBottomMaterialConfigId)
  const sideMaterialConfigId = normalizeId(record.sideMaterialConfigId)

  const orderSet = new Set(materialOrder)
  if (!orderSet.has(topBottomMaterialConfigId)) {
    throw new Error(`地板预设 materialConfig.topBottomMaterialConfigId 不在材质槽列表中: ${topBottomMaterialConfigId}`)
  }
  if (!orderSet.has(sideMaterialConfigId)) {
    throw new Error(`地板预设 materialConfig.sideMaterialConfigId 不在材质槽列表中: ${sideMaterialConfigId}`)
  }

  return { topBottomMaterialConfigId, sideMaterialConfigId }
}

export function parseFloorPresetData(text: string): FloorPresetData {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('地板预设数据损坏：无法解析 JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('地板预设格式无效')
  }

  const record = parsed as Record<string, unknown>
  if (record.kind !== 'floor-preset') {
    throw new Error('地板预设格式不受支持')
  }
  if (record.formatVersion !== FLOOR_PRESET_FORMAT_VERSION) {
    throw new Error(`地板预设版本不匹配 (expected ${FLOOR_PRESET_FORMAT_VERSION})`)
  }

  const name = typeof record.name === 'string' && record.name.trim().length ? record.name.trim() : ''
  if (!name) {
    throw new Error('地板预设缺少名称')
  }

  const floorProps = assertStrictFloorPresetFloorProps(record.floorProps)

  const materialOrderRaw = record.materialOrder
  if (!Array.isArray(materialOrderRaw)) {
    throw new Error('地板预设缺少或无效字段: materialOrder')
  }
  const materialOrder = materialOrderRaw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)

  const materialPatchesRaw = record.materialPatches
  if (!materialPatchesRaw || typeof materialPatchesRaw !== 'object') {
    throw new Error('地板预设缺少或无效字段: materialPatches')
  }
  const materialPatches: Record<string, FloorPresetMaterialPatch> = {}
  for (const [key, value] of Object.entries(materialPatchesRaw as Record<string, unknown>)) {
    const id = typeof key === 'string' ? key.trim() : ''
    if (!id) {
      continue
    }
    if (!value || typeof value !== 'object') {
      throw new Error(`地板预设 materialPatches[${id}] 格式无效`)
    }
    const patch = value as Record<string, unknown>
    const materialId = patch.materialId === null ? null : normalizeOptionalAssetId(patch.materialId)
    if (patch.materialId !== null && materialId === null) {
      throw new Error(`地板预设 materialPatches[${id}] 缺少或无效字段: materialId`)
    }
    const next: FloorPresetMaterialPatch = {
      id,
      materialId,
    }
    if (typeof patch.name === 'string' && patch.name.trim().length) {
      next.name = patch.name.trim()
    }
    if (typeof patch.type === 'string' && patch.type.trim().length) {
      next.type = patch.type.trim()
    }
    if (patch.props !== undefined) {
      if (!patch.props || typeof patch.props !== 'object' || Array.isArray(patch.props)) {
        throw new Error(`地板预设 materialPatches[${id}] 字段 props 格式无效`)
      }
      next.props = patch.props as Record<string, unknown>
    }
    materialPatches[id] = next
  }

  for (const id of materialOrder) {
    if (!materialPatches[id]) {
      throw new Error(`地板预设缺少 materialPatches[${id}]`)
    }
  }

  const materialConfig = assertStrictFloorPresetMaterialConfig(record.materialConfig, materialOrder)

  return {
    kind: 'floor-preset',
    formatVersion: FLOOR_PRESET_FORMAT_VERSION,
    name,
    floorProps,
    materialConfig,
    materialOrder,
    materialPatches,
    assetRegistry: record.assetRegistry,
  }
}

async function generateFloorPresetThumbnailDataUrl(
  store: FloorPresetStoreLike,
  presetData: FloorPresetData,
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

  return await renderFloorPresetThumbnailDataUrl({
    preset: presetData,
    sharedMaterials: store.materials as any,
    resolveTexture,
    width: ASSET_THUMBNAIL_WIDTH,
    height: ASSET_THUMBNAIL_HEIGHT,
  })
}

export function createFloorPresetActions(deps: FloorPresetActionsDeps) {
  return {
    findFloorPresetAssetByFilename(store: FloorPresetStoreLike, filename: string): ProjectAsset | null {
      const normalized = typeof filename === 'string' ? filename.trim().toLowerCase() : ''
      if (!normalized || !isFloorPresetFilename(normalized)) {
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
          if (description && description === normalized && isFloorPresetFilename(description)) {
            return asset
          }
        }
      }
      return null
    },

    async saveFloorPreset(
      store: FloorPresetStoreLike,
      payload: { name: string; nodeId?: string | null; assetId?: string | null; select?: boolean },
    ): Promise<ProjectAsset> {
      const nodeId = (payload.nodeId ?? store.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择地板节点')
      }
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('地板节点不存在或已被移除')
      }

      const component = node.components?.[FLOOR_COMPONENT_TYPE] as SceneNodeComponentState<FloorComponentProps> | undefined
      if (!component) {
        throw new Error('地板节点缺少 Floor 组件')
      }

      const name = typeof payload.name === 'string' ? payload.name : ''
      const sanitizedName = deps.normalizePrefabName(name) || 'Floor Preset'

      const floorProps = clampFloorComponentProps(component.props)

      const nodeMaterials = Array.isArray((node as any).materials) ? ((node as any).materials as SceneNodeMaterial[]) : []
      if (nodeMaterials.length < 2) {
        throw new Error('地板节点材质槽位不足（需要 2 个）')
      }

      const materialOrder = nodeMaterials
        .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
        .filter((value) => value.length > 0)
      if (!materialOrder.length) {
        throw new Error('地板节点材质槽位 id 无效')
      }

      const materialPatches: Record<string, FloorPresetMaterialPatch> = {}
      for (const entry of nodeMaterials) {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
        if (!id) {
          continue
        }

        // Shared material assignment: persist only the shared material id.
        if (typeof (entry as any).materialId === 'string' && (entry as any).materialId.trim().length) {
          materialPatches[id] = {
            id,
            materialId: (entry as any).materialId.trim(),
          }
          continue
        }

        materialPatches[id] = {
          id,
          materialId: null,
          name:
            typeof (entry as any).name === 'string' && (entry as any).name.trim().length
              ? (entry as any).name.trim()
              : undefined,
          type:
            typeof (entry as any).type === 'string' && (entry as any).type.trim().length
              ? (entry as any).type.trim()
              : undefined,
          props: deps.extractMaterialProps(entry) as unknown as Record<string, unknown>,
        }
      }

      for (const id of materialOrder) {
        if (!materialPatches[id]) {
          throw new Error(`地板节点材质槽位缺少 patch: ${id}`)
        }
      }

      const orderSet = new Set(materialOrder)
      const mesh = node.dynamicMesh?.type === 'Floor' ? (node.dynamicMesh as any) : null
      const normalizeSlotId = (value: unknown) => (typeof value === 'string' && value.trim().length ? value.trim() : null)

      const topFallback = materialOrder[0]!
      const sideFallback = materialOrder[1] ?? topFallback

      const topIdRaw = normalizeSlotId(mesh?.topBottomMaterialConfigId) ?? topFallback
      const sideIdRaw = normalizeSlotId(mesh?.sideMaterialConfigId) ?? sideFallback

      const topBottomMaterialConfigId = orderSet.has(topIdRaw) ? topIdRaw : topFallback
      const sideMaterialConfigId = orderSet.has(sideIdRaw) ? sideIdRaw : sideFallback

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

      const presetData: FloorPresetData = {
        kind: 'floor-preset',
        formatVersion: FLOOR_PRESET_FORMAT_VERSION,
        name: sanitizedName,
        floorProps,
        materialConfig: {
          topBottomMaterialConfigId,
          sideMaterialConfigId,
        },
        materialOrder,
        materialPatches,
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
      const fileName = buildFloorPresetFilename(sanitizedName)
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
        thumbnailDataUrl = await generateFloorPresetThumbnailDataUrl(store, presetData)
      } catch (thumbnailError) {
        console.warn('Failed to generate floor preset thumbnail', thumbnailError)
      }

      if (payload.assetId) {
        const existing = store.getAsset(assetId)
        if (!existing) {
          throw new Error('地板预设资源不存在')
        }
        if (existing.type !== 'prefab') {
          throw new Error('指定资源并非地板预设')
        }
        const updated: ProjectAsset = {
          ...existing,
          name: sanitizedName,
          description: fileName,
          previewColor: deps.FLOOR_PRESET_PREVIEW_COLOR,
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
        previewColor: deps.FLOOR_PRESET_PREVIEW_COLOR,
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

    async loadFloorPreset(store: FloorPresetStoreLike, assetId: string): Promise<FloorPresetData> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('地板预设资源不存在')
      }
      if (!isFloorPresetAsset(asset)) {
        throw new Error('指定资源并非 .floor 地板预设')
      }

      const assetCache = useAssetCacheStore()
      let entry: any = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { asset })
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载地板预设数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      const preset = parseFloorPresetData(text)

      if (preset.assetRegistry !== undefined && preset.assetRegistry !== null && !isSceneAssetRegistry(preset.assetRegistry)) {
        throw new Error('地板预设 assetRegistry 格式无效')
      }
      return preset
    },

    async applyFloorPresetToNode(
      store: FloorPresetStoreLike,
      nodeId: string,
      assetId: string,
      presetData?: FloorPresetData | null,
    ): Promise<FloorComponentProps> {
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('地板节点不存在或已被移除')
      }

      const component = node.components?.[FLOOR_COMPONENT_TYPE] as SceneNodeComponentState<FloorComponentProps> | undefined
      if (!component) {
        throw new Error('只能将地板预设应用到 Floor 节点')
      }

      const preset = presetData ?? (await this.loadFloorPreset(store, assetId))

      const dependencyAssetIds = collectFloorPresetDependencyAssetIds(preset, store.materials)

      const presetAssetRegistry = isSceneAssetRegistry(preset.assetRegistry)
        ? preset.assetRegistry
        : undefined

      if (dependencyAssetIds.length) {
        await store.ensurePrefabDependencies(dependencyAssetIds, {
          prefabAssetIdForDownloadProgress: assetId,
          prefabAssetRegistry: presetAssetRegistry ?? null,
        })
      }

      // Refresh after potential dependency updates.
      const refreshed = deps.findNodeById(store.nodes, nodeId)
      const floorComponent = refreshed?.components?.[FLOOR_COMPONENT_TYPE] as SceneNodeComponentState<FloorComponentProps> | undefined
      if (!floorComponent) {
        throw new Error('Floor 组件不可用')
      }

      store.updateNodeComponentProps(nodeId, floorComponent.id, preset.floorProps as unknown as Partial<Record<string, unknown>>)

      // Apply node material patches (merge into existing TopBottom/Side materials by name; do not duplicate).
      // This ensures dropping a .floor preset updates the current floor appearance without clobbering unrelated materials.
      const target = deps.findNodeById(store.nodes, nodeId)
      if (target && deps.nodeSupportsMaterials(target)) {
        const TOP_BOTTOM_NAME = 'TopBottom'
        const SIDE_NAME = 'Side'
        const normalizeName = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '')

        const existing = Array.isArray(target.materials) ? (target.materials as SceneNodeMaterial[]) : []

        const ensureSlot = (
          desiredName: string,
          fallbackIndex: number,
          options: { avoidId?: string | null } = {},
        ): SceneNodeMaterial => {
          const desired = normalizeName(desiredName)
          const avoidId = typeof options.avoidId === 'string' && options.avoidId.trim().length ? options.avoidId.trim() : null

          const byName = existing.find((entry) => normalizeName((entry as any).name) === desired && (!avoidId || entry.id !== avoidId))
          if (byName) {
            return byName
          }

          const byIndex = existing[fallbackIndex]
          if (byIndex && (!avoidId || byIndex.id !== avoidId)) {
            return byIndex
          }

          const created = deps.createNodeMaterial(null, deps.createMaterialProps(), {
            id: deps.generateUuid(),
            name: desiredName,
            type: deps.DEFAULT_SCENE_MATERIAL_TYPE,
          })
          existing.push(created)
          return created
        }

        const applyPatchToSlot = (
          slot: SceneNodeMaterial,
          desiredName: string,
          patch: FloorPresetMaterialPatch,
        ): SceneNodeMaterial => {
          const sharedMaterialId = patch.materialId === null ? null : normalizeOptionalAssetId(patch.materialId)
          const patchName = typeof patch.name === 'string' && patch.name.trim().length ? patch.name.trim() : desiredName

          if (sharedMaterialId) {
            const shared = store.materials.find((entry) => entry.id === sharedMaterialId) ?? null
            if (!shared) {
              throw new Error(`地板预设引用的共享材质不存在: ${sharedMaterialId}`)
            }
            if (patch.props && Object.keys(patch.props).length) {
              throw new Error(`地板预设试图修改共享材质 props: ${slot.id}`)
            }
            return deps.createNodeMaterial(shared.id, shared, {
              id: slot.id,
              name: patchName,
              type: (shared as any).type,
            })
          }

          const baseProps = deps.extractMaterialProps(slot)
          const normalizedPatchProps = patch.props
            ? normalizeMaterialLikeTextureAssetIds(patch.props as any, presetAssetRegistry ?? null)
            : null
          const overrides = normalizedPatchProps ? deps.materialUpdateToProps(normalizedPatchProps as any) : {}
          const mergedProps = patch.props ? deps.mergeMaterialProps(baseProps as any, overrides) : baseProps

          return deps.createNodeMaterial(null, mergedProps, {
            id: slot.id,
            name: patchName,
            type:
              typeof patch.type === 'string' && patch.type.trim().length
                ? (patch.type as any)
                : (slot as any).type ?? deps.DEFAULT_SCENE_MATERIAL_TYPE,
          })
        }

        const presetTopSlotId = preset.materialConfig.topBottomMaterialConfigId
        const presetSideSlotId = preset.materialConfig.sideMaterialConfigId
        const topPatch = preset.materialPatches?.[presetTopSlotId]
        const sidePatch = preset.materialPatches?.[presetSideSlotId]
        if (!topPatch || !sidePatch) {
          throw new Error('地板预设缺少 TopBottom/Side 材质槽 patch')
        }

        const topSlot = ensureSlot(TOP_BOTTOM_NAME, 0)
        const sideSlot = ensureSlot(SIDE_NAME, 1, { avoidId: topSlot.id })

        const updatedTop = applyPatchToSlot(topSlot, TOP_BOTTOM_NAME, topPatch)
        const updatedSide = applyPatchToSlot(sideSlot, SIDE_NAME, sidePatch)

        // Replace in-place (by id), keep unrelated materials, and drop duplicate TopBottom/Side entries.
        const replacements = new Map<string, SceneNodeMaterial>([
          [updatedTop.id, updatedTop],
          [updatedSide.id, updatedSide],
        ])
        const nextMaterials = existing
          .map((entry) => replacements.get(entry.id) ?? entry)
          .filter((entry) => {
            const name = normalizeName((entry as any).name)
            if (name === normalizeName(TOP_BOTTOM_NAME) && entry.id !== updatedTop.id) {
              return false
            }
            if (name === normalizeName(SIDE_NAME) && entry.id !== updatedSide.id) {
              return false
            }
            return true
          })

        if (nextMaterials.length) {
          store.setNodeMaterials(nodeId, nextMaterials)
        }

        // Force override floor material config ids to the updated slots.
        const refreshedAfterMaterials = deps.findNodeById(store.nodes, nodeId)
        const mesh = refreshedAfterMaterials?.dynamicMesh?.type === 'Floor' ? (refreshedAfterMaterials.dynamicMesh as any) : null
        if (!mesh) {
          throw new Error('地板节点缺少 Floor 动态网格')
        }

        store.updateNodeDynamicMesh(nodeId, {
          ...mesh,
          topBottomMaterialConfigId: updatedTop.id,
          sideMaterialConfigId: updatedSide.id,
        })
      }

      return preset.floorProps as unknown as FloorComponentProps
    },

    async applyFloorPresetToSelectedFloor(store: FloorPresetStoreLike, assetId: string): Promise<void> {
      const nodeId = (store.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择地板节点')
      }
      await this.applyFloorPresetToNode(store, nodeId, assetId)
    },

    // Expose validator for sceneStore if needed.
    parseFloorPresetData,
    assertStrictFloorPresetFloorProps,
  }
}
