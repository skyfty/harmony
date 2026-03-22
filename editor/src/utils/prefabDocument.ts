import type { SceneJsonExportDocument, SceneNode } from '@schema'
import { normalizeSkyboxSettings } from '@/stores/skyboxPresets'
import {
  buildAssetDependencySubset,
  sanitizeSceneAssetRegistry,
} from '@/utils/assetDependencySubset'

type PrefabFilePayload = {
  name?: unknown
  root?: unknown
  assetRegistry?: unknown
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

export function normalizePrefabSceneDocument(raw: unknown): SceneJsonExportDocument {
  if (!isPlainObject(raw)) {
    throw new Error('Prefab 资源文件格式不正确')
  }
  const payload = raw as PrefabFilePayload
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
  const inputAssetRegistry = sanitizeSceneAssetRegistry(payload.assetRegistry)
  const dependencyAssetIds = new Set<string>(Object.keys(inputAssetRegistry ?? {}))
  const dependencySubset = buildAssetDependencySubset({
    assetIds: dependencyAssetIds,
    assetRegistry: inputAssetRegistry,
  })

  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    skybox,
    nodes,
    materials: [],
    assetRegistry: dependencySubset.assetRegistry,
  }
}

export async function parsePrefabFile(file: File): Promise<SceneJsonExportDocument> {
  const text = await file.text()
  const parsed = JSON.parse(text) as unknown
  return normalizePrefabSceneDocument(parsed)
}
