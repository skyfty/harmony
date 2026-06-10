import type { ProjectAsset } from '@/types/project-asset'
import type { DicePresetData } from '@/utils/dicePreset'
import { deserializeDicePreset, resolveFirstDiceAssetId } from '@/utils/dicePreset'
import { generateLodPresetThumbnailDataUrl } from '@/utils/lodPreview'
import { renderModelFileThumbnailDataUrl } from '@/utils/localAssetImport'

export type DicePreviewStoreLike = {
  getAsset: (id: string) => ProjectAsset | null
}

export type DicePreviewAssetCacheLike = {
  ensureAssetFile: (assetId: string, options?: { asset?: ProjectAsset | null }) => Promise<File | null>
}

export async function ensureProjectAssetFile(
  assetCache: DicePreviewAssetCacheLike,
  asset: ProjectAsset,
): Promise<File> {
  const file = await assetCache.ensureAssetFile(asset.id, { asset })
  if (file) {
    return file
  }
  throw new Error('资源文件未缓存')
}

export async function readDicePresetDataFromAsset(
  asset: ProjectAsset,
  assetCache: DicePreviewAssetCacheLike,
): Promise<DicePresetData> {
  if (asset.type !== 'dice') {
    throw new Error('指定资源并非 Dice 预设')
  }

  const file = await ensureProjectAssetFile(assetCache, asset)
  const text = await file.text()
  return deserializeDicePreset(text)
}

export async function generateDicePresetThumbnailDataUrl(
  store: DicePreviewStoreLike,
  assetCache: DicePreviewAssetCacheLike,
  source: ProjectAsset | DicePresetData | { assetRefs?: DicePresetData['assetRefs'] } = {},
): Promise<string | null> {
  try {
    const preset = isProjectAsset(source)
      ? await readDicePresetDataFromAsset(source, assetCache)
      : source

    const firstAssetId = resolveFirstDiceAssetId(preset)
    if (!firstAssetId) {
      throw new Error('Dice 预设未配置可用资产')
    }

    const asset = store.getAsset(firstAssetId)
    if (!asset) {
      throw new Error('Dice 引用资产未导入')
    }

    if (asset.type === 'lod') {
      return await generateLodPresetThumbnailDataUrl(store, assetCache, asset)
    }

    if (asset.type !== 'model' && asset.type !== 'mesh') {
      throw new Error('Dice 预设引用资产不是模型资产')
    }

    const file = await ensureProjectAssetFile(assetCache, asset)
    return await renderModelFileThumbnailDataUrl(asset, file)
  } catch (error) {
    console.warn('[DicePreview] Failed to generate Dice thumbnail', error)
    return null
  }
}

function isProjectAsset(value: unknown): value is ProjectAsset {
  return Boolean(value && typeof value === 'object' && 'type' in value && 'id' in value)
}
