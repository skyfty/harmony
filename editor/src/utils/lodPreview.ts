import type { LodComponentProps } from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import type { LodPresetData } from '@/utils/lodPreset'
import { deserializeLodPreset, resolveFirstLodModelAssetId } from '@/utils/lodPreset'
import { renderModelFileThumbnailDataUrl } from '@/utils/localAssetImport'

export type LodPreviewStoreLike = {
  getAsset: (id: string) => ProjectAsset | null
}

export type LodPreviewAssetCacheLike = {
  ensureAssetFile: (assetId: string, options?: { asset?: ProjectAsset | null }) => Promise<File | null>
}

export type ResolvedLodPreviewModel = {
  assetId: string
  asset: ProjectAsset
  file: File
}

const LOD_PREVIEW_LOG_PREFIX = '[LOD-TREE]'

function logLodPreviewInfo(message: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.info(LOD_PREVIEW_LOG_PREFIX, message, payload)
    return
  }
  console.info(LOD_PREVIEW_LOG_PREFIX, message)
}

export async function ensureProjectAssetFile(
  assetCache: LodPreviewAssetCacheLike,
  asset: ProjectAsset,
): Promise<File> {
  const file = await assetCache.ensureAssetFile(asset.id, { asset })
  if (file) {
    return file
  }

  throw new Error('资源文件未缓存')
}

export async function readLodPresetDataFromAsset(
  asset: ProjectAsset,
  assetCache: LodPreviewAssetCacheLike,
): Promise<LodPresetData> {
  if (asset.type !== 'lod') {
    throw new Error('指定资源并非 LOD 预设')
  }

  const file = await ensureProjectAssetFile(assetCache, asset)
  const text = await file.text()
  const preset = deserializeLodPreset(text)
  logLodPreviewInfo('readLodPresetDataFromAsset parsed preset', {
    assetId: asset.id,
    assetName: asset.name,
    presetId: preset.id,
    presetName: preset.name,
    levelAssetIds: preset.props.levels.map((level, index) => ({
      index,
      kind: level.kind ?? 'model',
      modelAssetId: level.modelAssetId ?? null,
      billboardAssetId: level.billboardAssetId ?? null,
    })),
    assetRegistryKeys: Object.keys(preset.assetRegistry ?? {}),
  })
  return preset
}

export async function resolveLodPreviewModelFile(
  store: LodPreviewStoreLike,
  assetCache: LodPreviewAssetCacheLike,
  source: ProjectAsset | LodComponentProps | LodPresetData | { props: LodComponentProps },
): Promise<ResolvedLodPreviewModel> {
  const preset = isProjectAsset(source)
    ? await readLodPresetDataFromAsset(source, assetCache)
    : source

  const modelAssetId = resolveFirstLodModelAssetId(preset)
  if (!modelAssetId) {
    logLodPreviewInfo('resolveLodPreviewModelFile missing model asset id', {
      sourceType: isProjectAsset(source) ? 'project-asset' : 'preset-like',
    })
    throw new Error('LOD 预设未配置可用模型')
  }

  const modelAsset = store.getAsset(modelAssetId)
  if (!modelAsset) {
    logLodPreviewInfo('resolveLodPreviewModelFile missing model asset', {
      modelAssetId,
      sourceType: isProjectAsset(source) ? 'project-asset' : 'preset-like',
      assetRegistryKeys: 'assetRegistry' in preset && preset.assetRegistry ? Object.keys(preset.assetRegistry) : [],
    })
    throw new Error('LOD 引用模型未导入')
  }

  const file = await ensureProjectAssetFile(assetCache, modelAsset)
  logLodPreviewInfo('resolveLodPreviewModelFile resolved model', {
    modelAssetId,
    modelAssetName: modelAsset.name,
    modelAssetType: modelAsset.type,
    sourceType: isProjectAsset(source) ? 'project-asset' : 'preset-like',
  })
  return {
    assetId: modelAssetId,
    asset: modelAsset,
    file,
  }
}

export async function generateLodPresetThumbnailDataUrl(
  store: LodPreviewStoreLike,
  assetCache: LodPreviewAssetCacheLike,
  source: ProjectAsset | LodComponentProps | LodPresetData | { props: LodComponentProps },
): Promise<string | null> {
  try {
    const resolved = await resolveLodPreviewModelFile(store, assetCache, source)
    const thumbnail = await renderModelFileThumbnailDataUrl(resolved.asset, resolved.file)
    logLodPreviewInfo('generateLodPresetThumbnailDataUrl rendered thumbnail', {
      assetId: resolved.assetId,
      assetName: resolved.asset.name,
      hasThumbnail: typeof thumbnail === 'string' && thumbnail.length > 0,
    })
    return thumbnail
  } catch (error) {
    console.warn('[LodPreview] Failed to generate LOD thumbnail', error)
    return null
  }
}

function isProjectAsset(value: unknown): value is ProjectAsset {
  return Boolean(value && typeof value === 'object' && 'type' in value && 'id' in value)
}