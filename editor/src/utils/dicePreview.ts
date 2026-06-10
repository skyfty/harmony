import type { ProjectAsset } from '@/types/project-asset'
import type { DicePresetData } from '@/utils/dicePreset'
import { deserializeDicePreset } from '@/utils/dicePreset'
import { resolveLodPreviewModelFile } from '@/utils/lodPreview'
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

    const previewAssets = await collectDiceThumbnailAssets(store, assetCache, preset)
    if (!previewAssets.length) {
      throw new Error('Dice 预设未配置可用资产')
    }

    const previewImages = await Promise.all(
      previewAssets.map(async (asset) => ({
        asset,
        dataUrl: await renderDicePreviewAssetDataUrl(store, assetCache, asset),
      })),
    )

    const usableImages = previewImages.filter((entry): entry is { asset: ProjectAsset; dataUrl: string } => Boolean(entry.dataUrl))
    if (!usableImages.length) {
      throw new Error('Dice 预设引用资产不是模型资产')
    }

    if (usableImages.length === 1) {
      return usableImages[0]!.dataUrl
    }

    return await renderDiceThumbnailCollage(usableImages.slice(0, 3))
  } catch (error) {
    console.warn('[DicePreview] Failed to generate Dice thumbnail', error)
    return null
  }
}

async function collectDiceThumbnailAssets(
  store: DicePreviewStoreLike,
  assetCache: DicePreviewAssetCacheLike,
  preset: DicePresetData | { assetRefs?: DicePresetData['assetRefs'] } | null | undefined,
): Promise<ProjectAsset[]> {
  const refs = preset?.assetRefs ?? []
  const assets: ProjectAsset[] = []
  const seen = new Set<string>()

  for (const ref of refs) {
    const assetId = typeof ref.assetId === 'string' ? ref.assetId.trim() : ''
    if (!assetId || seen.has(assetId)) {
      continue
    }

    const asset = store.getAsset(assetId)
    if (!asset || (asset.type !== 'model' && asset.type !== 'mesh' && asset.type !== 'lod')) {
      continue
    }

    seen.add(assetId)
    assets.push(asset)
    if (assets.length >= 3) {
      break
    }
  }

  // Warm the referenced assets so thumbnail generation can run immediately after save.
  await Promise.all(
    assets.map(async (asset) => {
      try {
        if (asset.type === 'lod') {
          await resolveLodPreviewModelFile(store, assetCache, asset)
          return
        }
        await ensureProjectAssetFile(assetCache, asset)
      } catch (_error) {
        // Ignore individual failures; the collage will use whatever can be rendered.
      }
    }),
  )

  return assets
}

async function renderDicePreviewAssetDataUrl(
  store: DicePreviewStoreLike,
  assetCache: DicePreviewAssetCacheLike,
  asset: ProjectAsset,
): Promise<string | null> {
  try {
    if (asset.type === 'lod') {
      const resolved = await resolveLodPreviewModelFile(store, assetCache, asset)
      return await renderModelFileThumbnailDataUrl(resolved.asset, resolved.file)
    }

    const file = await ensureProjectAssetFile(assetCache, asset)
    return await renderModelFileThumbnailDataUrl(asset, file)
  } catch (error) {
    console.warn('[DicePreview] Failed to render preview asset thumbnail', asset.id, error)
    return null
  }
}

async function renderDiceThumbnailCollage(entries: Array<{ asset: ProjectAsset; dataUrl: string }>): Promise<string | null> {
  if (typeof document === 'undefined') {
    return null
  }

  const width = 512
  const height = 512
  const padding = 18
  const gap = 10
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  const background = context.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, '#1d2430')
  background.addColorStop(1, '#11161d')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)

  const panelRects = entries.length >= 3
    ? [
        { x: padding, y: padding, w: Math.round((width - padding * 2 - gap) * 0.56), h: height - padding * 2 },
        { x: width - padding - Math.round((width - padding * 2 - gap) * 0.40), y: padding, w: Math.round((width - padding * 2 - gap) * 0.40), h: Math.round((height - padding * 2 - gap) * 0.5) },
        { x: width - padding - Math.round((width - padding * 2 - gap) * 0.40), y: padding + Math.round((height - padding * 2 - gap) * 0.5) + gap, w: Math.round((width - padding * 2 - gap) * 0.40), h: Math.round((height - padding * 2 - gap) * 0.5) },
      ]
    : entries.length === 2
      ? [
          { x: padding, y: padding, w: Math.floor((width - padding * 2 - gap) / 2), h: height - padding * 2 },
          { x: padding + Math.floor((width - padding * 2 - gap) / 2) + gap, y: padding, w: Math.floor((width - padding * 2 - gap) / 2), h: height - padding * 2 },
        ]
      : [
          { x: padding, y: padding, w: width - padding * 2, h: height - padding * 2 },
        ]

  await Promise.all(entries.map(async (entry, index) => {
    const image = await loadImageElement(entry.dataUrl)
    const panel = panelRects[Math.min(index, panelRects.length - 1)]
    if (!panel) {
      return
    }
    drawImageCover(context, image, panel.x, panel.y, panel.w, panel.h)
    drawRoundedRect(context, panel.x, panel.y, panel.w, panel.h, 24)
    context.save()
    context.clip()
    context.fillStyle = 'rgba(0, 0, 0, 0.12)'
    context.fillRect(panel.x, panel.y, panel.w, panel.h)
    context.restore()

    const badgeSize = 30
    const badgeX = panel.x + 12
    const badgeY = panel.y + 12
    context.save()
    context.fillStyle = 'rgba(7, 12, 18, 0.72)'
    context.beginPath()
    context.arc(badgeX + badgeSize / 2, badgeY + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = 'rgba(255, 255, 255, 0.92)'
    context.font = '700 14px "Inter", "Segoe UI", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(String(index + 1), badgeX + badgeSize / 2, badgeY + badgeSize / 2 + 0.5)
    context.restore()
  }))

  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl
}

async function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load thumbnail image'))
    image.src = dataUrl
  })
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const imageRatio = image.width / image.height
  const targetRatio = width / height
  let drawWidth = width
  let drawHeight = height
  let offsetX = x
  let offsetY = y

  if (imageRatio > targetRatio) {
    drawHeight = height
    drawWidth = Math.round(height * imageRatio)
    offsetX = x - Math.round((drawWidth - width) / 2)
  } else {
    drawWidth = width
    drawHeight = Math.round(width / imageRatio)
    offsetY = y - Math.round((drawHeight - height) / 2)
  }

  context.save()
  drawRoundedRect(context, x, y, width, height, 24)
  context.clip()
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
  context.restore()
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function isProjectAsset(value: unknown): value is ProjectAsset {
  return Boolean(value && typeof value === 'object' && 'type' in value && 'id' in value)
}
