import type { AssetIndexEntry, SceneJsonExportDocument, SceneNode } from '@harmony/schema'
import { normalizeSkyboxSettings } from '@/stores/skyboxPresets'

const NODE_PREFAB_FORMAT_VERSION = 1

type PrefabFilePayload = {
  formatVersion?: unknown
  name?: unknown
  root?: unknown
  assetIndex?: unknown
  packageAssetMap?: unknown
}

function generatePreviewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `prefab-preview-${crypto.randomUUID()}`
  }
  return `prefab-preview-${Date.now()}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVector3Like(value: unknown): value is { x: number; y: number; z: number } {
  if (!isPlainObject(value)) {
    return false
  }
  const { x, y, z } = value as Record<string, unknown>
  return [x, y, z].every((component) => typeof component === 'number' && Number.isFinite(component))
}

function isSceneNodeLike(value: unknown): value is SceneNode {
  if (!isPlainObject(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || !candidate.id.trim().length) {
    return false
  }
  if (typeof candidate.name !== 'string') {
    return false
  }
  if (typeof candidate.nodeType !== 'string' || !candidate.nodeType.trim().length) {
    return false
  }
  if (!isVector3Like(candidate.position) || !isVector3Like(candidate.rotation) || !isVector3Like(candidate.scale)) {
    return false
  }
  return true
}

function cloneDeep<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeAssetIndex(value: unknown): Record<string, AssetIndexEntry> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const result: Record<string, AssetIndexEntry> = {}
  Object.entries(value).forEach(([assetId, entry]) => {
    if (!isPlainObject(entry)) {
      return
    }
    const clonedEntry = cloneDeep(entry) as Partial<AssetIndexEntry> & Record<string, unknown>
    const categoryId = typeof clonedEntry.categoryId === 'string' ? clonedEntry.categoryId.trim() : ''
    if (!categoryId) {
      return
    }
    const normalized: AssetIndexEntry = { categoryId }
    if (clonedEntry.source && typeof clonedEntry.source === 'object') {
      normalized.source = clonedEntry.source as AssetIndexEntry['source']
    }
    result[assetId] = normalized
  })
  return Object.keys(result).length ? result : undefined
}

function sanitizePackageAssetMap(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const result: Record<string, string> = {}
  Object.entries(value).forEach(([assetId, mapped]) => {
    if (typeof mapped === 'string' && mapped.trim().length) {
      result[assetId] = mapped.trim()
    }
  })
  return Object.keys(result).length ? result : undefined
}

export function normalizePrefabSceneDocument(raw: unknown): SceneJsonExportDocument {
  if (!isPlainObject(raw)) {
    throw new Error('Prefab 资源文件格式不正确')
  }
  const payload = raw as PrefabFilePayload
  if ('formatVersion' in payload && payload.formatVersion !== undefined) {
    const version = Number(payload.formatVersion)
    if (!Number.isFinite(version)) {
      throw new Error('Prefab 版本号无效')
    }
    if (version !== NODE_PREFAB_FORMAT_VERSION) {
      throw new Error(`暂不支持的 Prefab 版本: ${version}`)
    }
  }
  const rootCandidate = payload.root
  if (!isPlainObject(rootCandidate)) {
    throw new Error('Prefab 数据缺少有效的根节点')
  }

  const now = new Date().toISOString()
  const id = generatePreviewId()
  const name = typeof payload.name === 'string' && payload.name.trim().length ? payload.name.trim() : 'Prefab Preview'

  const skybox = normalizeSkyboxSettings()
  const clonedRoot = cloneDeep(rootCandidate)
  if (!isSceneNodeLike(clonedRoot)) {
    throw new Error('Prefab 根节点数据无效')
  }
  const nodes: SceneNode[] = [clonedRoot]
  const assetIndex = sanitizeAssetIndex(payload.assetIndex)
  const packageAssetMap = sanitizePackageAssetMap(payload.packageAssetMap)

  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    skybox,
    nodes,
    materials: [],
    assetIndex,
    packageAssetMap,
  }
}

export async function parsePrefabFile(file: File): Promise<SceneJsonExportDocument> {
  const text = await file.text()
  const parsed = JSON.parse(text) as unknown
  return normalizePrefabSceneDocument(parsed)
}
