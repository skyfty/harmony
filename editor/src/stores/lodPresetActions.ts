import type { SceneNode, SceneNodeComponentState } from '@schema'
import {
  LOD_COMPONENT_TYPE,
  clampLodComponentProps,
  getLodLevelAssetId,
  type LodComponentProps,
} from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore, type AssetCacheEntry } from './assetCacheStore'
import { extractExtension } from '@/utils/blob'
import {
  buildLodPresetFilename,
  deserializeLodPreset,
  resolveFirstLodModelAssetId,
  serializeLodPreset,
  type LodPresetAssetReference,
  type LodPresetData,
} from '@/utils/lodPreset'
import { generateLodPresetThumbnailDataUrl } from '@/utils/lodPreview'
import { generateUuid } from '@/utils/uuid'
import { buildAssetDependencySubset, isSceneAssetRegistry } from '@/utils/assetDependencySubset'
import { normalizeAssetIdWithRegistry, normalizeAssetIdsWithRegistry } from '@/utils/assetRegistryIdNormalization'

export type LodPresetStoreLike = {
  nodes: SceneNode[]
  assetRegistry: Record<string, any>

  getAsset: (id: string) => ProjectAsset | null
  registerAsset: (asset: ProjectAsset, options: any) => ProjectAsset
  setActiveDirectory: (categoryId: string) => void
  selectAsset: (assetId: string) => void
  resolveConfigAssetSaveDirectoryId: () => string
  ensurePrefabDependencies: (assetIds: string[], options: any) => Promise<void>

  addNodeComponent: <T extends string>(nodeId: string, type: T) => any
  updateNodeComponentProps: (nodeId: string, componentId: string, patch: any) => boolean
}

export type LodPresetActionsDeps = {
  LOD_PRESET_PREVIEW_COLOR: string

  findNodeById: (nodes: SceneNode[], id: string) => SceneNode | null
}

export type PreparedLodAsset = {
  requestedAsset: ProjectAsset
  modelAsset: ProjectAsset
  preset: LodPresetData
}

function collectLodPresetDependencyAssetIds(preset: LodPresetData | null | undefined): string[] {
  if (!preset) {
    return []
  }
  return normalizeAssetIdsWithRegistry(
    [
      ...preset.props.levels.map((level) => getLodLevelAssetId(level) ?? ''),
    ],
    preset.assetRegistry,
  )
}

function normalizeLodPresetPropsAssetIds(
  preset: LodPresetData,
): LodComponentProps {
  return {
    ...preset.props,
    levels: preset.props.levels.map((level) => ({
      ...level,
      modelAssetId: normalizeAssetIdWithRegistry(level.modelAssetId, preset.assetRegistry),
      billboardAssetId: normalizeAssetIdWithRegistry(level.billboardAssetId, preset.assetRegistry),
    })),
  }
}

function syncResolvedLodDependencyMetadata(store: LodPresetStoreLike, preset: LodPresetData): void {
  const metadataByAssetId = new Map<string, Partial<ProjectAsset>>()

  ;(preset.assetRefs ?? []).forEach((assetRef) => {
    const assetId = normalizeAssetIdWithRegistry(assetRef.assetId, preset.assetRegistry)
    if (!assetId) {
      return
    }
    metadataByAssetId.set(assetId, {
      ...(metadataByAssetId.get(assetId) ?? {}),
      ...(typeof assetRef.name === 'string' && assetRef.name.trim().length ? { name: assetRef.name.trim() } : null),
      ...(typeof assetRef.thumbnail === 'string' && assetRef.thumbnail.trim().length ? { thumbnail: assetRef.thumbnail.trim() } : null),
      ...(typeof assetRef.description === 'string' && assetRef.description.trim().length ? { description: assetRef.description.trim() } : null),
      ...(typeof assetRef.downloadUrl === 'string' && assetRef.downloadUrl.trim().length ? { downloadUrl: assetRef.downloadUrl.trim() } : null),
    })
  })

  Object.entries(preset.assetRegistry ?? {}).forEach(([assetId, entry]) => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    const record = entry as Record<string, unknown>
    const sourceType = typeof record.sourceType === 'string' ? record.sourceType.trim() : ''
    const targetAssetId = sourceType === 'server' && typeof record.serverAssetId === 'string' && record.serverAssetId.trim().length
      ? record.serverAssetId.trim()
      : assetId.trim()
    if (!targetAssetId) {
      return
    }
    metadataByAssetId.set(targetAssetId, {
      ...(metadataByAssetId.get(targetAssetId) ?? {}),
      ...(typeof record.name === 'string' && record.name.trim().length ? { name: record.name.trim() } : null),
    })
  })

  metadataByAssetId.forEach((metadata, assetId) => {
    const existingAsset = store.getAsset(assetId)
    if (!existingAsset) {
      return
    }

    const nextAsset: ProjectAsset = { ...existingAsset }
    let changed = false

    if (typeof metadata.name === 'string' && metadata.name.trim().length) {
      const normalizedName = metadata.name.trim()
      const existingName = typeof existingAsset.name === 'string' ? existingAsset.name.trim() : ''
      const existingLooksHashed = existingName.startsWith('sha256-') || existingName === existingAsset.id
      if (!existingName || existingLooksHashed || existingAsset.bundleRole === 'dependency') {
        nextAsset.name = normalizedName
        changed = changed || nextAsset.name !== existingAsset.name
      }
    }

    if (typeof metadata.thumbnail === 'string' && metadata.thumbnail.trim().length) {
      const normalizedThumbnail = metadata.thumbnail.trim()
      if (!existingAsset.thumbnail || !existingAsset.thumbnail.trim().length) {
        nextAsset.thumbnail = normalizedThumbnail
        changed = true
      }
    }

    if (typeof metadata.description === 'string' && metadata.description.trim().length) {
      const normalizedDescription = metadata.description.trim()
      const existingDescription = typeof existingAsset.description === 'string' ? existingAsset.description.trim() : ''
      if (!existingDescription || existingDescription === existingAsset.name) {
        nextAsset.description = normalizedDescription
        changed = changed || nextAsset.description !== existingAsset.description
      }
    }

    if (!changed) {
      return
    }

    store.registerAsset(nextAsset, {
      categoryId: existingAsset.categoryId,
      source: existingAsset.source,
      commitOptions: { updateNodes: false },
      autoSave: false,
    })
  })
}

export function createLodPresetActions(deps: LodPresetActionsDeps) {
  return {
    async saveLodPreset(
      store: LodPresetStoreLike,
      payload: { name: string; props: LodComponentProps; select?: boolean },
    ): Promise<ProjectAsset> {
      const name = typeof payload.name === 'string' ? payload.name : ''
      const props = clampLodComponentProps(payload.props)
      const assetCache = useAssetCacheStore()
      const referencedAssetIds = Array.from(
        new Set(
          props.levels
            .map((level) => getLodLevelAssetId(level) ?? '')
            .filter((id) => Boolean(id)),
        ),
      )

      const assetRefs = referencedAssetIds
        .map<LodPresetAssetReference | null>((assetId) => {
          const asset = store.getAsset(assetId)
          if (!asset || (asset.type !== 'model' && asset.type !== 'mesh' && asset.type !== 'image' && asset.type !== 'texture')) {
            return null
          }
          const entry = assetCache.getEntry(assetId)
          const candidates = [entry?.downloadUrl, asset.downloadUrl, asset.description]
          const downloadUrl = candidates.find(
            (candidate) => typeof candidate === 'string' && /^https?:\/\//i.test(candidate),
          )
          const ref: LodPresetAssetReference = {
            assetId,
            type: asset.type,
            name: asset.name,
            downloadUrl: downloadUrl ?? null,
            description: asset.description ?? null,
            filename: entry?.filename ?? null,
            thumbnail: asset.thumbnail ?? null,
          }
          return ref
        })
        .filter((ref): ref is LodPresetAssetReference => ref !== null)

      const dependencySubset = referencedAssetIds.length
        ? buildAssetDependencySubset({ assetIds: referencedAssetIds, assetRegistry: store.assetRegistry })
        : null
      const serialized = serializeLodPreset({
        name,
        props,
        assetRefs,
        assetRegistry: dependencySubset?.assetRegistry ?? null,
      })
      const assetId = generateUuid()
      const fileName = buildLodPresetFilename(name)
      const blob = new Blob([serialized], { type: 'application/json' })
      await assetCache.storeAssetBlob(assetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      const thumbnailDataUrl = await generateLodPresetThumbnailDataUrl(store, assetCache, { props })

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: name?.trim().length ? name.trim() : 'LOD Preset',
        type: 'lod',
        downloadUrl: assetId,
        previewColor: deps.LOD_PRESET_PREVIEW_COLOR,
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

      if (payload.select !== false) {
        store.setActiveDirectory(categoryId)
        store.selectAsset(registered.id)
      }

      return registered
    },

    async loadLodPreset(store: LodPresetStoreLike, assetId: string): Promise<LodPresetData> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('LOD 预设资源不存在')
      }
      if (asset.type !== 'lod') {
        throw new Error('指定资源并非 LOD 预设')
      }

      const assetCache = useAssetCacheStore()
      let entry: AssetCacheEntry | null = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { asset })
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载 LOD 预设数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      const preset = deserializeLodPreset(text)

      if (preset.assetRegistry !== undefined && preset.assetRegistry !== null && !isSceneAssetRegistry(preset.assetRegistry)) {
        throw new Error('LOD 预设 assetRegistry 格式无效')
      }

      return preset
    },

    async prepareLodAsset(store: LodPresetStoreLike, assetOrId: ProjectAsset | string): Promise<PreparedLodAsset> {
      const requestedAsset = typeof assetOrId === 'string'
        ? store.getAsset(assetOrId)
        : assetOrId
      if (!requestedAsset) {
        throw new Error('LOD 预设资源不存在')
      }
      if (requestedAsset.type !== 'lod') {
        throw new Error('指定资源并非 LOD 预设')
      }

      const preset = await this.loadLodPreset(store, requestedAsset.id)
      const dependencyAssetIds = collectLodPresetDependencyAssetIds(preset)
      const presetAssetRegistry = isSceneAssetRegistry(preset.assetRegistry) ? preset.assetRegistry : undefined
      if (dependencyAssetIds.length) {
        await store.ensurePrefabDependencies(dependencyAssetIds, {
          prefabAssetIdForDownloadProgress: requestedAsset.id,
          prefabAssetRegistry: presetAssetRegistry ?? null,
        })
        syncResolvedLodDependencyMetadata(store, preset)
      }

      const normalizedProps = normalizeLodPresetPropsAssetIds(preset)
      const modelAssetId = resolveFirstLodModelAssetId(normalizedProps)
      if (!modelAssetId) {
        throw new Error('LOD 预设未配置可用模型')
      }

      const modelAsset = store.getAsset(modelAssetId)
      if (!modelAsset) {
        throw new Error('Referenced LOD model asset is not available in this project')
      }
      if (modelAsset.type !== 'model' && modelAsset.type !== 'mesh') {
        throw new Error('Referenced LOD asset is not a model or mesh asset')
      }

      const assetCache = useAssetCacheStore()
      const entry = await assetCache.ensureAssetEntry(modelAsset.id, { asset: modelAsset })
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        throw new Error(entry?.error ?? 'Referenced LOD model asset is not ready yet')
      }

      return {
        requestedAsset,
        modelAsset,
        preset,
      }
    },

    async applyLodPresetToNode(store: LodPresetStoreLike, nodeId: string, assetId: string): Promise<LodPresetData> {
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('节点不存在或已被移除')
      }

      const preset = await this.loadLodPreset(store, assetId)
      const dependencyAssetIds = collectLodPresetDependencyAssetIds(preset)
      const presetAssetRegistry = isSceneAssetRegistry(preset.assetRegistry) ? preset.assetRegistry : undefined

      if (dependencyAssetIds.length) {
        await store.ensurePrefabDependencies(dependencyAssetIds, {
          prefabAssetIdForDownloadProgress: assetId,
          prefabAssetRegistry: presetAssetRegistry ?? null,
        })
        syncResolvedLodDependencyMetadata(store, preset)
      }

      if (!node.components?.[LOD_COMPONENT_TYPE]) {
        const result = store.addNodeComponent<typeof LOD_COMPONENT_TYPE>(nodeId, LOD_COMPONENT_TYPE)
        if (!result) {
          throw new Error('无法为节点添加 LOD 组件')
        }
      }

      const refreshedNode = deps.findNodeById(store.nodes, nodeId)
      const lodComponent = refreshedNode?.components?.[LOD_COMPONENT_TYPE] as
        | SceneNodeComponentState<LodComponentProps>
        | undefined
      if (!lodComponent) {
        throw new Error('LOD 组件不可用')
      }

      store.updateNodeComponentProps(
        nodeId,
        lodComponent.id,
        normalizeLodPresetPropsAssetIds(preset) as unknown as Partial<Record<string, unknown>>,
      )
      return preset
    },
  }
}
