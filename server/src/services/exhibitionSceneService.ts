import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { Types } from 'mongoose'
import { appConfig } from '@/config/env'
import { SceneModel } from '@/models/Scene'
import type { SceneDocument } from '@/types/models'
import { resolveSceneFilePath } from '@/services/sceneService'

const SCENE_INSTANCE_PREFIX = 'scene-instances'

type SceneNodeComponentState<TProps = Record<string, unknown>> = {
  props?: TProps
  [key: string]: unknown
}

type SceneNode = {
  components?: Record<string, SceneNodeComponentState>
  children?: SceneNode[]
  [key: string]: unknown
}

type LanternSlideDefinition = {
  imageAssetId?: string | null
  [key: string]: unknown
}

type LanternBehaviorParams = {
  slides?: LanternSlideDefinition[]
  [key: string]: unknown
}

type SceneBehavior = {
  action?: string
  script?: {
    type?: string
    params?: unknown
  } | null
  [key: string]: unknown
}

type SceneResourceSummaryEntry = {
  assetId: string
  downloadUrl?: string | null
  [key: string]: unknown
}

type SceneJsonExportDocument = {
  id?: string
  name?: string
  createdAt?: string
  updatedAt?: string
  nodes?: SceneNode[]
  packageAssetMap?: Record<string, string>
  assetIndex?: Record<string, Record<string, unknown>>
  resourceSummary?: {
    assets?: SceneResourceSummaryEntry[]
  } | null
  [key: string]: unknown
}

export type ExhibitionWorkMedia = {
  fileUrl?: string | null
  thumbnailUrl?: string | null
  mediaType?: string | null
}

type SceneDocLike = SceneDocument & { _id: Types.ObjectId }

type ScenePlaceholder = {
  assetId: string
  assetIds: Set<string>
  slides: LanternSlideDefinition[]
}

export async function generateExhibitionSceneInstance(options: {
  exhibitionId: string
  works: ExhibitionWorkMedia[]
  previousSceneUrl?: string | null
}): Promise<string | null> {
  try {
    const template = await pickRandomSceneTemplate()
    if (!template) {
      return options.previousSceneUrl ?? null
    }
    const document = await loadSceneDocument(template)
    if (!document) {
      return options.previousSceneUrl ?? null
    }
    const imageUrls = collectWorkImageUrls(options.works)
    if (imageUrls.length) {
      const placeholders = collectScenePlaceholders(document)
      if (placeholders.length) {
        applyImagesToPlaceholders(document, placeholders, imageUrls)
      }
    }
    updateSceneMetadata(document, options.exhibitionId)
    const stored = await storeSceneInstanceDocument(document, options.exhibitionId)
    if (!stored) {
      return options.previousSceneUrl ?? null
    }
    const previousKey = deriveInstanceFileKey(options.previousSceneUrl)
    if (previousKey && previousKey !== stored.fileKey) {
      await removeInstanceFile(previousKey)
    }
    return stored.fileUrl
  } catch (error) {
    console.error('[exhibitionSceneService] Failed to generate exhibition scene instance', error)
    return options.previousSceneUrl ?? null
  }
}

export async function deleteSceneInstanceByUrl(url: string | null | undefined): Promise<void> {
  try {
    const fileKey = deriveInstanceFileKey(url)
    if (!fileKey) {
      return
    }
    await removeInstanceFile(fileKey)
  } catch (error) {
    console.error('[exhibitionSceneService] Failed to delete scene instance', error)
  }
}

async function pickRandomSceneTemplate(): Promise<SceneDocLike | null> {
  const total = await SceneModel.countDocuments().exec()
  if (!total) {
    return null
  }
  const offset = Math.floor(Math.random() * total)
  const scene = await SceneModel.findOne().skip(offset).lean().exec()
  return (scene as SceneDocLike | null) ?? null
}

async function loadSceneDocument(scene: SceneDocLike): Promise<SceneJsonExportDocument | null> {
  try {
    const absolute = resolveSceneFilePath(scene.fileKey)
    const exists = await fs.pathExists(absolute)
    if (!exists) {
      return null
    }
    const raw = await fs.readFile(absolute, 'utf8')
    const parsed = JSON.parse(raw) as SceneJsonExportDocument
    return parsed
  } catch (error) {
    console.error('[exhibitionSceneService] Failed to load scene document', error)
    return null
  }
}

function collectScenePlaceholders(document: SceneJsonExportDocument): ScenePlaceholder[] {
  const result: ScenePlaceholder[] = []
  const roots = Array.isArray(document.nodes) ? (document.nodes as SceneNode[]) : []
  const stack: Array<{ node: SceneNode; siblings: SceneNode[] }> = roots.map((node) => ({ node, siblings: roots }))
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    const display = getComponent<{ assetId?: string }>(current.node, 'displayBoard')
    const assetId = parseAssetId(display?.props?.assetId)
    if (assetId) {
      const placeholder: ScenePlaceholder = {
        assetId,
        assetIds: new Set([assetId]),
        slides: [],
      }
      collectLanternData(current.node, placeholder)
      current.siblings.forEach((sibling) => {
        if (sibling !== current.node) {
          collectLanternData(sibling, placeholder)
        }
      })
      result.push(placeholder)
    }
    const children = Array.isArray(current.node.children) ? (current.node.children as SceneNode[]) : []
    children.forEach((child) => {
      stack.push({ node: child, siblings: children })
    })
  }
  return result
}

function collectLanternData(node: SceneNode, placeholder: ScenePlaceholder): void {
  const guideboard = getComponent(node, 'guideboard')
  if (!guideboard) {
    return
  }
  const behavior = getComponent<{ behaviors?: SceneBehavior[] }>(node, 'behavior')
  const behaviors: SceneBehavior[] = Array.isArray(behavior?.props?.behaviors)
    ? (behavior?.props?.behaviors as SceneBehavior[])
    : []
  behaviors.forEach((entry: SceneBehavior) => {
    if (!entry || entry.action !== 'click') {
      return
    }
    if (!entry.script || entry.script.type !== 'lantern') {
      return
    }
    const params = entry.script.params as LanternBehaviorParams | undefined
    if (!params || !Array.isArray(params.slides)) {
      return
    }
    params.slides.forEach((slide: LanternSlideDefinition) => {
      if (!slide || typeof slide !== 'object') {
        return
      }
      placeholder.slides.push(slide)
      const slideAssetId = parseAssetId(slide.imageAssetId)
      if (slideAssetId) {
        placeholder.assetIds.add(slideAssetId)
      }
    })
  })
}

function applyImagesToPlaceholders(
  document: SceneJsonExportDocument,
  placeholders: ScenePlaceholder[],
  imageUrls: string[],
): void {
  const limit = Math.min(placeholders.length, imageUrls.length)
  for (let index = 0; index < limit; index += 1) {
    const placeholder = placeholders[index]
    const imageUrl = imageUrls[index]
    placeholder.assetIds.forEach((assetId) => {
      updateAssetReferences(document, assetId, imageUrl)
    })
    placeholder.slides.forEach((slide: LanternSlideDefinition) => {
      if (!parseAssetId(slide.imageAssetId)) {
        slide.imageAssetId = placeholder.assetId
      }
    })
  }
}

function updateAssetReferences(document: SceneJsonExportDocument, assetId: string, imageUrl: string): void {
  if (!assetId || !imageUrl) {
    return
  }
  if (!document.packageAssetMap || typeof document.packageAssetMap !== 'object') {
    document.packageAssetMap = {}
  }
  document.packageAssetMap[assetId] = imageUrl
  if (document.assetIndex && document.assetIndex[assetId]) {
    const entry = document.assetIndex[assetId] as Record<string, unknown>
    entry['downloadUrl'] = imageUrl
    entry['url'] = imageUrl
  }
  const summary = document.resourceSummary
  if (summary && Array.isArray(summary.assets)) {
    summary.assets.forEach((item: SceneResourceSummaryEntry) => {
      if (item && item.assetId === assetId) {
        item.downloadUrl = imageUrl
      }
    })
  }
}

function updateSceneMetadata(document: SceneJsonExportDocument, exhibitionId: string): void {
  const now = new Date().toISOString()
  document.id = `exhibition-${sanitizeForKey(exhibitionId)}-${nanoid(6)}`
  document.createdAt = now
  document.updatedAt = now
}

async function storeSceneInstanceDocument(
  document: SceneJsonExportDocument,
  exhibitionId: string,
): Promise<{ fileKey: string; fileUrl: string } | null> {
  const fileKey = buildSceneInstanceFileKey(exhibitionId)
  const absolute = resolveInstanceFilePath(fileKey)
  await fs.ensureDir(path.dirname(absolute))
  await fs.writeJson(absolute, document, { spaces: 2 })
  return {
    fileKey,
    fileUrl: buildPublicUrl(fileKey),
  }
}

async function removeInstanceFile(fileKey: string): Promise<void> {
  if (!fileKey.startsWith(`${SCENE_INSTANCE_PREFIX}/`)) {
    return
  }
  const absolute = resolveInstanceFilePath(fileKey)
  const exists = await fs.pathExists(absolute)
  if (!exists) {
    return
  }
  await fs.remove(absolute).catch(() => undefined)
}

function collectWorkImageUrls(works: ExhibitionWorkMedia[]): string[] {
  const urls: string[] = []
  works.forEach((work) => {
    if (!work) {
      return
    }
    const fileUrl = typeof work.fileUrl === 'string' ? work.fileUrl.trim() : ''
    const thumbnailUrl = typeof work.thumbnailUrl === 'string' ? work.thumbnailUrl.trim() : ''
    const mediaType = typeof work.mediaType === 'string' ? work.mediaType.trim() : ''
    if (mediaType === 'image' && fileUrl) {
      urls.push(fileUrl)
      return
    }
    if (thumbnailUrl) {
      urls.push(thumbnailUrl)
      return
    }
    if (fileUrl) {
      urls.push(fileUrl)
    }
  })
  return urls
}

function getComponent<T = Record<string, unknown>>(
  node: SceneNode,
  type: string,
): SceneNodeComponentState<T> | null {
  const map = node.components as Record<string, SceneNodeComponentState<T>> | undefined
  if (!map) {
    return null
  }
  const component = map[type]
  if (!component || typeof component !== 'object') {
    return null
  }
  return component
}

function parseAssetId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function buildSceneInstanceFileKey(exhibitionId: string): string {
  const sanitized = sanitizeForKey(exhibitionId)
  return `${SCENE_INSTANCE_PREFIX}/${sanitized}-${Date.now()}-${nanoid(8)}.json`
}

function sanitizeForKey(input: string): string {
  const base = input.replace(/[^a-zA-Z0-9-_]+/g, '').slice(0, 32)
  return base.length ? base : 'exhibition'
}

function buildPublicUrl(fileKey: string): string {
  const base = appConfig.assetPublicUrl.replace(/\/$/u, '')
  return `${base}/${fileKey}`
}

function resolveInstanceFilePath(fileKey: string): string {
  const normalized = fileKey.replace(/\\+/g, '/').replace(/^\/+/, '')
  const root = path.resolve(appConfig.assetStoragePath)
  const absolute = path.resolve(root, normalized)
  if (!absolute.startsWith(root)) {
    throw new Error('Invalid scene instance file key')
  }
  return absolute
}

function deriveInstanceFileKey(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }
  const normalized = url.trim()
  if (!normalized.length) {
    return null
  }
  const base = appConfig.assetPublicUrl.replace(/\/+$/u, '')
  if (!normalized.startsWith(base)) {
    return null
  }
  const suffix = normalized.slice(base.length).replace(/^\/+/, '')
  if (!suffix.startsWith(`${SCENE_INSTANCE_PREFIX}/`)) {
    return null
  }
  return suffix
}
