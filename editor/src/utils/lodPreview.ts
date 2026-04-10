import type { LodComponentProps } from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import type { LodPresetData } from '@/utils/lodPreset'
import { deserializeLodPreset, resolveFirstLodModelAssetId } from '@/utils/lodPreset'
import { renderModelFileThumbnailDataUrl } from '@/utils/localAssetImport'

export type LodPreviewStoreLike = {
  getAsset: (id: string) => ProjectAsset | null
}

export type LodPreviewAssetCacheLike = {
  createFileFromCache: (assetId: string) => File | null
  loadFromIndexedDb: (assetId: string) => Promise<unknown>
  downloaProjectAsset: (asset: ProjectAsset) => Promise<unknown>
}

export type ResolvedLodPreviewModel = {
  assetId: string
  asset: ProjectAsset
  file: File
}

export async function ensureProjectAssetFile(
  assetCache: LodPreviewAssetCacheLike,
  asset: ProjectAsset,
): Promise<File> {
  let file = assetCache.createFileFromCache(asset.id)
  if (file) {
    return file
  }

  await assetCache.loadFromIndexedDb(asset.id)
  file = assetCache.createFileFromCache(asset.id)
  if (file) {
    return file
  }

  await assetCache.downloaProjectAsset(asset)
  file = assetCache.createFileFromCache(asset.id)
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
  return deserializeLodPreset(text)
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
    throw new Error('LOD 预设未配置可用模型')
  }

  const modelAsset = store.getAsset(modelAssetId)
  if (!modelAsset) {
    throw new Error('LOD 引用模型未导入')
  }

  const file = await ensureProjectAssetFile(assetCache, modelAsset)
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
    return await renderModelFileThumbnailDataUrl(resolved.asset, resolved.file)
  } catch (error) {
    console.warn('[LodPreview] Failed to generate LOD thumbnail', error)
    return null
  }
}

function isProjectAsset(value: unknown): value is ProjectAsset {
  return Boolean(value && typeof value === 'object' && 'type' in value && 'id' in value)
}