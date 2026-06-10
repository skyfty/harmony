import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from './assetCacheStore'
import type { AssetCacheEntry } from './assetCacheStore'
import { extractExtension } from '@/utils/blob'
import {
  buildDicePresetFilename,
  deserializeDicePreset,
  resolveFirstDiceAssetId,
  serializeDicePreset,
  type DicePresetAssetReference,
  type DicePresetData,
} from '@/utils/dicePreset'
import { generateDicePresetThumbnailDataUrl } from '@/utils/dicePreview'
import { generateUuid } from '@/utils/uuid'
import { buildAssetDependencySubset, isSceneAssetRegistry } from '@/utils/assetDependencySubset'
import { normalizeAssetIdWithRegistry, normalizeAssetIdsWithRegistry } from '@/utils/assetRegistryIdNormalization'

export type DicePresetStoreLike = {
  assetRegistry: Record<string, any>

  getAsset: (id: string) => ProjectAsset | null
  registerAsset: (asset: ProjectAsset, options: any) => ProjectAsset
  setActiveDirectory: (categoryId: string) => void
  selectAsset: (assetId: string) => void
  resolveConfigAssetSaveDirectoryId: () => string
  ensurePrefabDependencies: (assetIds: string[], options: any) => Promise<void>
  prepareLodAsset: (asset: ProjectAsset) => Promise<any>
}

export type PreparedDiceAsset = {
  requestedAsset: ProjectAsset
  previewAsset: ProjectAsset
  preset: DicePresetData
}

function collectDicePresetDependencyAssetIds(preset: DicePresetData | null | undefined): string[] {
  if (!preset) {
    return []
  }
  return normalizeAssetIdsWithRegistry(
    (preset.assetRefs ?? []).map((ref) => ref.assetId),
    preset.assetRegistry,
  )
}

function normalizeDicePresetAssetRefs(preset: DicePresetData): DicePresetAssetReference[] {
  return (preset.assetRefs ?? []).map((ref) => ({
    ...ref,
    assetId: normalizeAssetIdWithRegistry(ref.assetId, preset.assetRegistry) ?? ref.assetId,
  }))
}

function randomize<T>(values: T[]): T[] {
  const out = values.slice()
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[out[index], out[swapIndex]] = [out[swapIndex]!, out[index]!]
  }
  return out
}

export function createDicePresetActions() {
  return {
    async saveDicePreset(
      store: DicePresetStoreLike,
      payload: { name: string; assetIds: string[]; select?: boolean; assetId?: string | null },
    ): Promise<ProjectAsset> {
      const name = typeof payload.name === 'string' ? payload.name : ''
      const assetIds = Array.from(new Set((payload.assetIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)))
      if (!assetIds.length) {
        throw new Error('Dice 预设至少需要一个引用资产')
      }

      const assetCache = useAssetCacheStore()
      const assetRefs = assetIds
        .map<DicePresetAssetReference | null>((assetId) => {
          const asset = store.getAsset(assetId)
          if (!asset || (asset.type !== 'model' && asset.type !== 'mesh' && asset.type !== 'lod')) {
            return null
          }
          const entry = assetCache.getEntry(assetId)
          const candidates = [entry?.downloadUrl, asset.downloadUrl, asset.description]
          const downloadUrl = candidates.find(
            (candidate) => typeof candidate === 'string' && /^https?:\/\//i.test(candidate),
          )
          return {
            assetId,
            type: asset.type,
            name: asset.name,
            downloadUrl: downloadUrl ?? null,
            description: asset.description ?? null,
            filename: entry?.filename ?? null,
            thumbnail: asset.thumbnail ?? null,
          }
        })
        .filter((ref): ref is DicePresetAssetReference => ref !== null)

      if (!assetRefs.length) {
        throw new Error('Dice 预设未包含可用的模型资产')
      }

      const dependencySubset = buildAssetDependencySubset({
        assetIds: assetRefs.map((ref) => ref.assetId),
        assetRegistry: store.assetRegistry,
      })
      const serialized = serializeDicePreset({
        name,
        assetRefs,
        assetRegistry: dependencySubset.assetRegistry ?? null,
      })
      const assetId = typeof payload.assetId === 'string' && payload.assetId.trim().length ? payload.assetId.trim() : generateUuid()
      const fileName = buildDicePresetFilename(name)
      const blob = new Blob([serialized], { type: 'application/json' })
      await assetCache.storeAssetBlob(assetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      const thumbnailDataUrl = await generateDicePresetThumbnailDataUrl(store, assetCache, { assetRefs })

      const categoryId = store.resolveConfigAssetSaveDirectoryId()
      if (payload.assetId) {
        const existing = store.getAsset(assetId)
        if (!existing) {
          throw new Error('Dice 预设资源不存在')
        }
        if (existing.type !== 'dice') {
          throw new Error('指定资源并非 Dice 预设')
        }
        const updated: ProjectAsset = {
          ...existing,
          name: name?.trim().length ? name.trim() : 'Dice Preset',
          downloadUrl: assetId,
          previewColor: '#7C8DB5',
          thumbnail: thumbnailDataUrl ?? existing.thumbnail ?? null,
          description: fileName,
          gleaned: true,
          extension: extractExtension(fileName) ?? null,
        }
        const registered = store.registerAsset(updated, {
          categoryId: existing.categoryId ?? categoryId,
          source: existing.source ?? { type: 'local' },
          commitOptions: { updateNodes: false },
        })

        if (payload.select !== false) {
          store.setActiveDirectory(categoryId)
          store.selectAsset(registered.id)
        }

        return registered
      }

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: name?.trim().length ? name.trim() : 'Dice Preset',
        type: 'dice',
        downloadUrl: assetId,
        previewColor: '#7C8DB5',
        thumbnail: thumbnailDataUrl,
        description: fileName,
        gleaned: true,
        extension: extractExtension(fileName) ?? null,
      }

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

    async loadDicePreset(store: DicePresetStoreLike, assetId: string): Promise<DicePresetData> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('Dice 预设资源不存在')
      }
      if (asset.type !== 'dice') {
        throw new Error('指定资源并非 Dice 预设')
      }

      const assetCache = useAssetCacheStore()
      let entry: AssetCacheEntry | null = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { asset })
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载 Dice 预设数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      const preset = deserializeDicePreset(text)
      if (preset.assetRegistry !== undefined && preset.assetRegistry !== null && !isSceneAssetRegistry(preset.assetRegistry)) {
        throw new Error('Dice 预设 assetRegistry 格式无效')
      }
      return preset
    },

    async prepareDiceAsset(store: DicePresetStoreLike, assetOrId: ProjectAsset | string): Promise<PreparedDiceAsset> {
      const requestedAsset = typeof assetOrId === 'string'
        ? store.getAsset(assetOrId)
        : assetOrId
      if (!requestedAsset) {
        throw new Error('Dice 预设资源不存在')
      }
      if (requestedAsset.type !== 'dice') {
        throw new Error('指定资源并非 Dice 预设')
      }

      const preset = await this.loadDicePreset(store, requestedAsset.id)
      const dependencyAssetIds = collectDicePresetDependencyAssetIds(preset)
      const presetAssetRegistry = isSceneAssetRegistry(preset.assetRegistry) ? preset.assetRegistry : undefined
      if (dependencyAssetIds.length) {
        await store.ensurePrefabDependencies(dependencyAssetIds, {
          prefabAssetIdForDownloadProgress: requestedAsset.id,
          prefabAssetRegistry: presetAssetRegistry ?? null,
        })
      }

      const normalizedRefs = normalizeDicePresetAssetRefs(preset)
      const previewRef = normalizedRefs.find((ref) => ref.type === 'model' || ref.type === 'mesh' || ref.type === 'lod')
      if (!previewRef) {
        throw new Error('Dice 预设未配置可用资产')
      }

      const previewAsset = store.getAsset(previewRef.assetId)
      if (!previewAsset) {
        throw new Error('Dice 预设引用资产不存在')
      }
      if (previewAsset.type !== 'model' && previewAsset.type !== 'mesh' && previewAsset.type !== 'lod') {
        throw new Error('Dice 预设引用资产不是模型资产')
      }

      const assetCache = useAssetCacheStore()
      if (previewAsset.type === 'lod') {
        const prepared = await store.prepareLodAsset(previewAsset)
        return {
          requestedAsset,
          previewAsset: prepared.modelAsset,
          preset,
        }
      }

      const entry = await assetCache.ensureAssetEntry(previewAsset.id, { asset: previewAsset })
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        throw new Error(entry?.error ?? 'Referenced Dice model asset is not ready yet')
      }

      return {
        requestedAsset,
        previewAsset,
        preset,
      }
    },

    async resolveRandomDicePlacementAsset(store: DicePresetStoreLike, assetOrId: ProjectAsset | string): Promise<PreparedDiceAsset> {
      const requestedAsset = typeof assetOrId === 'string'
        ? store.getAsset(assetOrId)
        : assetOrId
      if (!requestedAsset) {
        throw new Error('Dice 预设资源不存在')
      }
      if (requestedAsset.type !== 'dice') {
        throw new Error('指定资源并非 Dice 预设')
      }

      const preset = await this.loadDicePreset(store, requestedAsset.id)
      const dependencyAssetIds = collectDicePresetDependencyAssetIds(preset)
      const presetAssetRegistry = isSceneAssetRegistry(preset.assetRegistry) ? preset.assetRegistry : undefined
      if (dependencyAssetIds.length) {
        await store.ensurePrefabDependencies(dependencyAssetIds, {
          prefabAssetIdForDownloadProgress: requestedAsset.id,
          prefabAssetRegistry: presetAssetRegistry ?? null,
        })
      }

      const candidates = randomize(
        normalizeDicePresetAssetRefs(preset)
          .map((ref) => store.getAsset(ref.assetId))
          .filter((asset): asset is ProjectAsset => !!asset && (asset.type === 'model' || asset.type === 'mesh' || asset.type === 'lod')),
      )

      let lastError: unknown = null
      for (const candidate of candidates) {
        try {
          if (candidate.type === 'lod') {
            const prepared = await store.prepareLodAsset(candidate)
            return {
              requestedAsset: candidate,
              previewAsset: prepared.modelAsset,
              preset,
            }
          }
          return {
            requestedAsset: candidate,
            previewAsset: candidate,
            preset,
          }
        } catch (error) {
          lastError = error
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Dice 预设未包含可用的模型资产')
    },
  }
}

export function resolveFirstDiceModelAssetId(preset: DicePresetData | null | undefined): string | null {
  return resolveFirstDiceAssetId(preset)
}
