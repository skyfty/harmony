import type { SceneNode, SceneNodeComponentState } from '@harmony/schema'
import { LOD_COMPONENT_TYPE, clampLodComponentProps, type LodComponentProps } from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore, type AssetCacheEntry } from './assetCacheStore'
import { determineAssetCategoryId } from './assetCatalog'
import { extractExtension } from '@/utils/blob'
import {
  buildLodPresetFilename,
  deserializeLodPreset,
  serializeLodPreset,
  type LodPresetAssetReference,
  type LodPresetData,
} from '@/utils/lodPreset'
import { generateUuid } from '@/utils/uuid'
import { SERVER_ASSET_PREVIEW_COLORS } from '@/api/serverAssetTypes'

export type LodPresetStoreLike = {
  nodes: SceneNode[]

  getAsset: (id: string) => ProjectAsset | null
  registerAsset: (asset: ProjectAsset, options: any) => ProjectAsset
  setActiveDirectory: (categoryId: string) => void
  selectAsset: (assetId: string) => void

  addNodeComponent: <T extends string>(nodeId: string, type: T) => any
  updateNodeComponentProps: (nodeId: string, componentId: string, patch: any) => boolean
}

export type LodPresetActionsDeps = {
  LOD_PRESET_PREVIEW_COLOR: string

  findNodeById: (nodes: SceneNode[], id: string) => SceneNode | null
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
      const referencedModelIds = Array.from(
        new Set(
          props.levels
            .map((level) => (typeof level?.modelAssetId === 'string' ? level.modelAssetId.trim() : ''))
            .filter((id) => Boolean(id)),
        ),
      )

      const assetRefs = referencedModelIds
        .map<LodPresetAssetReference | null>((assetId) => {
          const asset = store.getAsset(assetId)
          if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
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

      const serialized = serializeLodPreset({ name, props, assetRefs })
      const assetId = generateUuid()
      const fileName = buildLodPresetFilename(name)
      const blob = new Blob([serialized], { type: 'application/json' })
      await assetCache.storeAssetBlob(assetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: name?.trim().length ? name.trim() : 'LOD Preset',
        type: 'prefab',
        downloadUrl: assetId,
        previewColor: deps.LOD_PRESET_PREVIEW_COLOR,
        thumbnail: null,
        description: fileName,
        gleaned: true,
        extension: extractExtension(fileName) ?? null,
      }

      const categoryId = determineAssetCategoryId(projectAsset)
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
      if (asset.type !== 'prefab') {
        throw new Error('指定资源并非 LOD 预设')
      }

      const assetCache = useAssetCacheStore()
      let entry: AssetCacheEntry | null = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.loadFromIndexedDb(assetId)
      }
      if ((!entry || !entry.blob) && asset.downloadUrl && /^https?:\/\//i.test(asset.downloadUrl)) {
        await assetCache.downloaProjectAsset(asset)
        entry = assetCache.getEntry(assetId)
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载 LOD 预设数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      const preset = deserializeLodPreset(text)

      const refs = Array.isArray(preset.assetRefs) ? preset.assetRefs : []
      if (refs.length) {
        // Best-effort: ensure referenced model assets exist in this project, and trigger download if possible.
        refs.forEach((ref) => {
          if (!ref?.assetId || store.getAsset(ref.assetId)) {
            return
          }
          if (ref.type !== 'model' && ref.type !== 'mesh') {
            return
          }

          const remoteUrl = typeof ref.downloadUrl === 'string' && /^https?:\/\//i.test(ref.downloadUrl)
            ? ref.downloadUrl
            : ''

          const projectAsset: ProjectAsset = {
            id: ref.assetId,
            name:
              typeof ref.name === 'string' && ref.name.trim().length
                ? ref.name.trim()
                : `LOD Ref ${ref.assetId}`,
            type: ref.type,
            downloadUrl: remoteUrl,
            previewColor: SERVER_ASSET_PREVIEW_COLORS[ref.type],
            thumbnail: ref.thumbnail ?? null,
            description: ref.description ?? (ref.filename ?? undefined),
            gleaned: true,
            extension: extractExtension(ref.filename ?? ref.description ?? remoteUrl) ?? null,
          }

          store.registerAsset(projectAsset, {
            categoryId: determineAssetCategoryId(projectAsset),
            source: { type: 'url' },
            commitOptions: { updateNodes: false },
          })
        })

        refs.forEach((ref) => {
          if (!ref?.assetId) {
            return
          }
          const remoteUrl = typeof ref.downloadUrl === 'string' && /^https?:\/\//i.test(ref.downloadUrl)
            ? ref.downloadUrl
            : ''
          if (!remoteUrl) {
            return
          }
          if (assetCache.hasCache(ref.assetId) || assetCache.isDownloading(ref.assetId)) {
            return
          }
          const refAsset = store.getAsset(ref.assetId)
          if (!refAsset) {
            return
          }
          void assetCache.downloaProjectAsset(refAsset).catch((error) => {
            console.warn('[LodPresetActions] Failed to download referenced LOD model asset', ref.assetId, error)
          })
        })
      }

      return preset
    },

    async applyLodPresetToNode(store: LodPresetStoreLike, nodeId: string, assetId: string): Promise<LodPresetData> {
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('节点不存在或已被移除')
      }

      const preset = await this.loadLodPreset(store, assetId)

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
        preset.props as unknown as Partial<Record<string, unknown>>,
      )
      return preset
    },
  }
}
