import * as THREE from 'three'
import type {
  SceneMaterialTextureRef,
  SceneNode,
  SceneNodeComponentState,
  SceneNodeMaterial,
} from '@schema'
import { ROAD_COMPONENT_TYPE, ROAD_DEFAULT_WIDTH, ROAD_MIN_WIDTH, clampRoadProps, type RoadComponentProps } from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from './assetCacheStore'
import { extractExtension } from '@/utils/blob'
import { ASSET_THUMBNAIL_HEIGHT, ASSET_THUMBNAIL_WIDTH } from '@/utils/assetThumbnail'
import {
  ROAD_PRESET_FORMAT_VERSION,
  buildRoadComponentPatchFromPreset,
  buildRoadPresetFilename,
  isRoadPresetFilename,
  type RoadPresetData,
  type RoadPresetMaterialPatch,
  type StrictRoadPresetRoadProps,
} from '@/utils/roadPreset'
import { buildAssetDependencySubset, isSceneAssetRegistry } from '@/utils/assetDependencySubset'
import { buildRoadNodeMaterialsFromPreset } from '@/utils/roadPresetNodeMaterials'
import { renderRoadPresetThumbnailDataUrl } from '@/utils/roadPresetThumbnail'
import {
  normalizeAssetIdWithRegistry,
  normalizeAssetIdsWithRegistry,
  normalizeMaterialLikeTextureAssetIds,
} from '@/utils/assetRegistryIdNormalization'

export type RoadPresetStoreLike = {
  nodes: SceneNode[]
  selectedNodeId: string | null
  assetCatalog: Record<string, ProjectAsset[]> | null
  assetRegistry: Record<string, any>
  materials: Array<{ id: string; name: string; type: string } & Record<string, unknown>>

  getAsset: (id: string) => ProjectAsset | null
  registerAsset: (asset: ProjectAsset, options: any) => ProjectAsset
  setActiveDirectory: (categoryId: string) => void
  selectAsset: (assetId: string) => void
  resolveConfigAssetSaveDirectoryId: () => string

  updateNodeDynamicMesh: (nodeId: string, dynamicMesh: any) => void
  updateNodeComponentProps: (nodeId: string, componentId: string, patch: any) => boolean
  setNodeMaterials: (nodeId: string, materials: SceneNodeMaterial[]) => boolean
  ensurePrefabDependencies: (assetIds: string[], options: any) => Promise<void>
  addNodeComponent: <TType extends string = string>(
    nodeId: string,
    componentType: TType,
  ) => { node: SceneNode; component: SceneNodeComponentState<any> } | null
}

export type RoadPresetActionsDeps = {
  ROAD_PRESET_PREVIEW_COLOR: string

  generateUuid: () => string
  normalizePrefabName: (value: string | null | undefined) => string

  findNodeById: (nodes: SceneNode[], id: string) => SceneNode | null
  nodeSupportsMaterials: (node: SceneNode | null | undefined) => boolean

  extractMaterialProps: (material: SceneNodeMaterial | null | undefined) => any
}

function isRoadPresetAsset(asset: ProjectAsset | null | undefined): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  const extension = typeof asset.extension === 'string' ? asset.extension.trim().toLowerCase() : ''
  if (extension === 'road') {
    return true
  }
  return isRoadPresetFilename(asset.description ?? asset.name ?? asset.downloadUrl ?? asset.id ?? null)
}

function normalizeOptionalAssetId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : null
}

function resolveRoadPresetMaterialPatchId(key: string, patch: Record<string, unknown>): string {
  const normalizedPatchId = normalizeOptionalAssetId(patch.id)
  if (normalizedPatchId) {
    return normalizedPatchId
  }
  return typeof key === 'string' ? key.trim() : ''
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

export function collectRoadPresetDependencyAssetIds(
  preset: RoadPresetData | null | undefined,
): string[] {
  if (!preset) {
    return []
  }

  return normalizeAssetIdsWithRegistry(
    [
      ...Object.values(preset.materialPatches ?? {}).flatMap((patch) => {
        const normalizedPatchProps = normalizeMaterialLikeTextureAssetIds(
          ((patch as any)?.props ?? null) as Record<string, unknown> | null,
          (preset.assetRegistry ?? null) as Record<string, unknown> | null,
        )
        const patchTextureAssetIds = collectTextureAssetIdsFromMaterialLike(normalizedPatchProps)
        return patchTextureAssetIds
      }),
      ...Object.keys((preset.assetRegistry ?? {}) as Record<string, unknown>),
      typeof preset.roadProps?.bodyAssetId === 'string' ? preset.roadProps.bodyAssetId : '',
    ],
    (preset.assetRegistry ?? null) as Record<string, unknown> | null,
  )
}

function parseRoadPresetRoadProps(value: unknown): StrictRoadPresetRoadProps {
  if (!value || typeof value !== 'object') {
    throw new Error('道路预设 roadProps 格式无效')
  }
  const raw = value as Record<string, unknown>
  const widthSafe = clampRoadProps({
    vertices: [],
    segments: [],
    width: ROAD_DEFAULT_WIDTH,
    junctionSmoothing: raw.junctionSmoothing as any,
    snapToTerrain: Boolean(raw.snapToTerrain),
    laneLines: Boolean(raw.laneLines),
    shoulders: Boolean(raw.shoulders),
    bodyAssetId: normalizeOptionalAssetId(raw.bodyAssetId),
    samplingDensityFactor: raw.samplingDensityFactor as any,
    smoothingStrengthFactor: raw.smoothingStrengthFactor as any,
    minClearance: raw.minClearance as any,
    laneLineWidth: raw.laneLineWidth as any,
    shoulderWidth: raw.shoulderWidth as any,
  })

  return {
    junctionSmoothing: widthSafe.junctionSmoothing,
    snapToTerrain: widthSafe.snapToTerrain,
    laneLines: widthSafe.laneLines,
    shoulders: widthSafe.shoulders,
    bodyAssetId: widthSafe.bodyAssetId ?? null,
    samplingDensityFactor: widthSafe.samplingDensityFactor ?? 1.0,
    smoothingStrengthFactor: widthSafe.smoothingStrengthFactor ?? 1.0,
    minClearance: widthSafe.minClearance ?? 0.01,
    laneLineWidth: widthSafe.laneLineWidth,
    shoulderWidth: widthSafe.shoulderWidth,
  }
}

export function parseRoadPresetData(text: string): RoadPresetData {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('道路预设数据损坏：无法解析 JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('道路预设格式无效')
  }

  const record = parsed as Record<string, unknown>
  if (record.kind !== 'road-preset') {
    throw new Error('道路预设格式不受支持')
  }
  if (record.formatVersion !== ROAD_PRESET_FORMAT_VERSION) {
    throw new Error(`道路预设版本不匹配 (expected ${ROAD_PRESET_FORMAT_VERSION})`)
  }

  const name = typeof record.name === 'string' && record.name.trim().length ? record.name.trim() : ''
  if (!name) {
    throw new Error('道路预设缺少名称')
  }

  const widthRaw = typeof record.width === 'number' ? record.width : Number(record.width)
  const width = Number.isFinite(widthRaw) ? Math.max(ROAD_MIN_WIDTH, widthRaw) : ROAD_DEFAULT_WIDTH

  const roadProps = parseRoadPresetRoadProps(record.roadProps)

  const materialOrderRaw = record.materialOrder
  if (!Array.isArray(materialOrderRaw)) {
    throw new Error('道路预设缺少或无效字段: materialOrder')
  }
  const materialOrder = materialOrderRaw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)

  const materialPatchesRaw = record.materialPatches
  if (!materialPatchesRaw || typeof materialPatchesRaw !== 'object') {
    throw new Error('道路预设缺少或无效字段: materialPatches')
  }

  const materialPatches: Record<string, RoadPresetMaterialPatch> = {}
  for (const [key, value] of Object.entries(materialPatchesRaw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      const id = typeof key === 'string' ? key.trim() : ''
      throw new Error(`道路预设 materialPatches[${id}] 格式无效`)
    }
    const patch = value as Record<string, unknown>
    const id = resolveRoadPresetMaterialPatchId(key, patch)
    if (!id) {
      continue
    }
    if (materialPatches[id]) {
      throw new Error(`道路预设 materialPatches[${id}] 重复`)
    }
    const next: RoadPresetMaterialPatch = {
      id,
    }
    if (typeof patch.name === 'string' && patch.name.trim().length) {
      next.name = patch.name.trim()
    }
    if (typeof patch.type === 'string' && patch.type.trim().length) {
      next.type = patch.type.trim()
    }
    if (patch.props !== undefined) {
      if (!patch.props || typeof patch.props !== 'object' || Array.isArray(patch.props)) {
        throw new Error(`道路预设 materialPatches[${id}] 字段 props 格式无效`)
      }
      next.props = patch.props as Record<string, unknown>
    }
    materialPatches[id] = next
  }

  for (const id of materialOrder) {
    if (!materialPatches[id]) {
      throw new Error(`道路预设缺少 materialPatches[${id}]`)
    }
  }

  return {
    kind: 'road-preset',
    formatVersion: ROAD_PRESET_FORMAT_VERSION,
    name,
    width,
    roadProps,
    materialOrder,
    materialPatches,
    assetRegistry: record.assetRegistry,
  }
}

export function createRoadPresetActions(deps: RoadPresetActionsDeps) {
  async function generateRoadPresetThumbnailDataUrl(
    store: RoadPresetStoreLike,
    presetData: RoadPresetData,
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

    return await renderRoadPresetThumbnailDataUrl({
      preset: presetData,
      resolveTexture,
      width: ASSET_THUMBNAIL_WIDTH,
      height: ASSET_THUMBNAIL_HEIGHT,
    })
  }

  return {
    findRoadPresetAssetByFilename(store: RoadPresetStoreLike, filename: string): ProjectAsset | null {
      const normalized = typeof filename === 'string' ? filename.trim().toLowerCase() : ''
      if (!normalized || !isRoadPresetFilename(normalized)) {
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
          if (description && description === normalized && isRoadPresetFilename(description)) {
            return asset
          }
        }
      }
      return null
    },

    async saveRoadPreset(
      store: RoadPresetStoreLike,
      payload: { name: string; nodeId?: string | null; assetId?: string | null; select?: boolean },
    ): Promise<ProjectAsset> {
      const nodeId = (payload.nodeId ?? store.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择道路节点')
      }
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('道路节点不存在或已被移除')
      }

      const component = node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
      if (!component) {
        throw new Error('道路节点缺少 Road 组件')
      }

      const name = typeof payload.name === 'string' ? payload.name : ''
      const sanitizedName = deps.normalizePrefabName(name) || 'Road Preset'

      const clamped = clampRoadProps(component.props)
      const roadProps: StrictRoadPresetRoadProps = {
        junctionSmoothing: clamped.junctionSmoothing,
        snapToTerrain: clamped.snapToTerrain,
        laneLines: clamped.laneLines,
        shoulders: clamped.shoulders,
        bodyAssetId: clamped.bodyAssetId ?? null,
        samplingDensityFactor: clamped.samplingDensityFactor ?? 1.0,
        smoothingStrengthFactor: clamped.smoothingStrengthFactor ?? 1.0,
        minClearance: clamped.minClearance ?? 0.01,
        laneLineWidth: clamped.laneLineWidth,
        shoulderWidth: clamped.shoulderWidth,
      }

      const meshWidth = node.dynamicMesh?.type === 'Road' ? node.dynamicMesh.width : undefined
      const width = Number.isFinite(meshWidth) ? Math.max(ROAD_MIN_WIDTH, Number(meshWidth)) : (clamped.width ?? ROAD_DEFAULT_WIDTH)

      const nodeMaterials = Array.isArray((node as any).materials) ? ((node as any).materials as SceneNodeMaterial[]) : []
      const materialOrder = nodeMaterials
        .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
        .filter((value) => value.length > 0)

      const materialPatches: Record<string, RoadPresetMaterialPatch> = {}
      for (const entry of nodeMaterials) {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
        if (!id) {
          continue
        }

        materialPatches[id] = {
          id,
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

      const dependencyAssetIds = Array.from(
        new Set(
          [
            roadProps.bodyAssetId ?? '',
            ...nodeMaterials.flatMap((material) => collectTextureAssetIdsFromMaterialLike(material)),
          ]
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0),
        ),
      )

      const presetData: RoadPresetData = {
        kind: 'road-preset',
        formatVersion: ROAD_PRESET_FORMAT_VERSION,
        name: sanitizedName,
        width,
        roadProps,
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
      const fileName = buildRoadPresetFilename(sanitizedName)
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
        thumbnailDataUrl = await generateRoadPresetThumbnailDataUrl(store, presetData)
      } catch (thumbnailError) {
        console.warn('Failed to generate road preset thumbnail', thumbnailError)
      }

      if (payload.assetId) {
        const existing = store.getAsset(assetId)
        if (!existing) {
          throw new Error('道路预设资源不存在')
        }
        if (existing.type !== 'prefab') {
          throw new Error('指定资源并非道路预设')
        }
        const updated: ProjectAsset = {
          ...existing,
          name: sanitizedName,
          description: fileName,
          previewColor: deps.ROAD_PRESET_PREVIEW_COLOR,
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
        previewColor: deps.ROAD_PRESET_PREVIEW_COLOR,
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

    async loadRoadPreset(store: RoadPresetStoreLike, assetId: string): Promise<RoadPresetData> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('道路预设资源不存在')
      }
      if (!isRoadPresetAsset(asset)) {
        throw new Error('指定资源并非 .road 道路预设')
      }

      const assetCache = useAssetCacheStore()
      let entry: any = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { asset })
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载道路预设数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      const preset = parseRoadPresetData(text)

      if (preset.assetRegistry !== undefined && preset.assetRegistry !== null && !isSceneAssetRegistry(preset.assetRegistry)) {
        throw new Error('道路预设 assetRegistry 格式无效')
      }
      return preset
    },

    async applyRoadPresetToNode(
      store: RoadPresetStoreLike,
      nodeId: string,
      assetId: string,
      presetData?: RoadPresetData | null,
    ): Promise<RoadComponentProps> {
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('道路节点不存在或已被移除')
      }

      const preset = presetData ?? (await this.loadRoadPreset(store, assetId))

      const dependencyAssetIds = collectRoadPresetDependencyAssetIds(preset)
      const presetAssetRegistry = isSceneAssetRegistry(preset.assetRegistry)
        ? preset.assetRegistry
        : undefined

      if (dependencyAssetIds.length) {
        await store.ensurePrefabDependencies(dependencyAssetIds, {
          prefabAssetIdForDownloadProgress: assetId,
          prefabAssetRegistry: presetAssetRegistry ?? null,
        })
      }

      let refreshed = deps.findNodeById(store.nodes, nodeId)
      if (!refreshed?.components?.[ROAD_COMPONENT_TYPE]) {
        const result = store.addNodeComponent<typeof ROAD_COMPONENT_TYPE>(nodeId, ROAD_COMPONENT_TYPE)
        refreshed = result?.node ?? deps.findNodeById(store.nodes, nodeId)
      }

      const roadComponent = refreshed?.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
      if (!roadComponent) {
        throw new Error('Road 组件不可用')
      }

      const current = clampRoadProps(roadComponent.props)
      const normalizedRoadProps = {
        ...preset.roadProps,
        bodyAssetId: normalizeAssetIdWithRegistry(preset.roadProps.bodyAssetId, presetAssetRegistry),
      }
      const patch = buildRoadComponentPatchFromPreset(normalizedRoadProps)
      const merged = clampRoadProps({
        ...current,
        ...patch,
      })
      store.updateNodeComponentProps(nodeId, roadComponent.id, patch)

      if (refreshed?.dynamicMesh?.type === 'Road') {
        const width = Number.isFinite(preset.width) ? Math.max(ROAD_MIN_WIDTH, preset.width) : refreshed.dynamicMesh.width
        store.updateNodeDynamicMesh(nodeId, {
          ...refreshed.dynamicMesh,
          width,
        })
      }

      const target = deps.findNodeById(store.nodes, nodeId)
      if (target && deps.nodeSupportsMaterials(target)) {
        const normalizedPresetForMaterials: RoadPresetData = {
          ...preset,
          roadProps: normalizedRoadProps,
          materialPatches: Object.fromEntries(
            Object.entries(preset.materialPatches ?? {}).map(([slotId, patch]) => [
              slotId,
              {
                ...patch,
                props: patch?.props
                  ? normalizeMaterialLikeTextureAssetIds(patch.props as any, presetAssetRegistry ?? null)
                  : patch?.props,
              },
            ]),
          ),
        }
        const nextFromPreset = buildRoadNodeMaterialsFromPreset(normalizedPresetForMaterials)
        if (nextFromPreset.length) {
          const presetIds = new Set(nextFromPreset.map((entry) => entry.id))
          const existing = Array.isArray(target.materials) ? (target.materials as SceneNodeMaterial[]) : []
          const tail = existing.filter((entry) => !presetIds.has(entry.id))
          store.setNodeMaterials(nodeId, [...nextFromPreset, ...tail])
        }
      }

      return merged
    },

    async applyRoadPresetToSelectedRoad(store: RoadPresetStoreLike, assetId: string): Promise<void> {
      const nodeId = (store.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择道路节点')
      }
      await this.applyRoadPresetToNode(store, nodeId, assetId)
    },

    parseRoadPresetData,
  }
}
