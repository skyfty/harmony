import { watch, type WatchStopHandle } from 'vue'
import { Box3, Euler, Matrix4, Quaternion, Vector3, Object3D } from 'three'
import type {
  SceneAssetRegistryEntry,
  BehaviorComponentProps,
  BehaviorEventType,
  SceneBehavior,
  SceneNode,
  SceneNodeComponentState,
  Vector3Like,
} from '@schema'
import type { AssetSourceMetadata } from '@schema'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type { SceneHistoryNodeLocation } from '@/types/scene-history-entry'
import type { SceneState } from '@/types/scene-state'
import { BEHAVIOR_COMPONENT_TYPE } from '@schema/components'
import { behaviorMapToList, cloneBehaviorList } from '@schema/behaviors/definitions'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { NodePrefabData } from '@/types/node-prefab'
import type { DuplicateContext } from '@/types/duplicate-context'
import { useAssetCacheStore, type AssetCacheEntry } from './assetCacheStore'
import { determineAssetCategoryId } from './assetCatalog'
import { extractExtension } from '@/utils/blob'
import { fetchResourceAsset } from '@/api/resourceAssets'
import { mapServerAssetToProjectAsset } from '@/api/serverAssetTypes'
import {
  buildBehaviorPrefabFilename,
  createBehaviorPrefabData,
  deserializeBehaviorPrefab,
  instantiateBehaviorPrefab,
  serializeBehaviorPrefab,
  type BehaviorPrefabData,
} from '@/utils/behaviorPrefab'
import { buildAssetDependencySubset, sanitizeSceneAssetRegistry } from '@/utils/assetDependencySubset'
import { createServerAssetSource, isServerBackedProviderId } from '@/utils/serverAssetSource'
import {
  type ExplicitSceneAssetReference,
  visitExplicitComponentAssetReferences,
  visitExplicitTerrainScatterAssetReferences,
} from '../utils/sceneExplicitAssetReferences'

export type PrefabStoreLike = {
  nodes: SceneNode[]
  camera: SceneCameraState | null | undefined
  assetRegistry: Record<string, SceneAssetRegistryEntry>
  prefabAssetDownloadProgress: Record<
    string,
    { active: boolean; progress: number; error: string | null; assetIds: string[] }
  >

  projectTree: ProjectDirectory[]
  packageDirectoryCache: Record<string, ProjectDirectory[]>

  selectedNodeId: string | null

  getAsset: (id: string) => ProjectAsset | null
  findAssetInCatalog: (assetId: string) => ProjectAsset | null

  registerAsset: (
    asset: ProjectAsset,
    options?: { categoryId?: string; source?: AssetSourceMetadata; internal?: boolean; commitOptions?: { updateNodes?: boolean } },
  ) => ProjectAsset
  registerAssets: (
    assets: ProjectAsset[],
    options?: {
      categoryId?: string | ((asset: ProjectAsset) => string)
      source?: AssetSourceMetadata | ((asset: ProjectAsset) => AssetSourceMetadata | undefined)
      internal?: boolean | ((asset: ProjectAsset) => boolean)
      commitOptions?: { updateNodes?: boolean }
    },
  ) => ProjectAsset[]

  setActiveDirectory: (categoryId: string) => void
  selectAsset: (assetId: string) => void
  resolveConfigAssetSaveDirectoryId: () => string

  copyPackageAssetsToAssets: (
    providerId: string,
    assets: ProjectAsset[],
    options?: { packagePathSegments?: string[]; packagePathByAssetId?: Record<string, string[]> },
  ) => ProjectAsset[]
  getPackageAssetPathSegments: (providerId: string, assetId: string) => string[]

  queueSceneNodePatch: (nodeId: string, fields: string[]) => void
  captureNodeStructureHistorySnapshot: (ops: unknown[]) => void

  addPlaceholderNode: (
    asset: ProjectAsset,
    transform: { position?: Vector3Like; rotation?: Vector3Like; scale?: Vector3Like },
    options: { parentId?: string | null },
  ) => SceneNode
  removeSceneNodes: (ids: string[]) => void
  setSelection: (ids: string[], options?: Record<string, unknown> | undefined) => void

  ensureSceneAssetsReady: (options?: Record<string, unknown>) => Promise<void>
  withHistorySuppressed: <T>(fn: () => T | Promise<T>) => Promise<T>
  setNodeWorldPositionPositionOnly: (nodeId: string, worldPosition: Vector3) => void
  syncComponentSubtree: (node: SceneNode) => void

  addNodeComponent: <T extends string>(nodeId: string, type: T) => unknown
  updateNodeComponentProps: (nodeId: string, componentId: string, patch: Record<string, unknown>) => boolean
}

type PreparePrefabAssetOptions = {
  providerId?: string | null
  prefabAssetIdForDownloadProgress?: string | null
}

const pendingPrefabPreparationTasks = new Map<string, Promise<NodePrefabData>>()

export type PrefabActionsDeps = {
  PREFAB_SOURCE_METADATA_KEY: string
  NODE_PREFAB_FORMAT_VERSION: number
  NODE_PREFAB_PREVIEW_COLOR: string
  BEHAVIOR_PREFAB_PREVIEW_COLOR: string

  ENVIRONMENT_NODE_ID: string

  PREFAB_PLACEMENT_EPSILON: number
  DEFAULT_SPAWN_RADIUS: number
  LOCAL_EMBEDDED_ASSET_PREFIX: string

  // Generic helpers (owned by sceneStore)
  generateUuid: () => string

  findNodeById: (nodes: SceneNode[], id: string) => SceneNode | null
  allowsChildNodes: (node: SceneNode | null | undefined) => boolean
  buildParentMap: (nodes: SceneNode[]) => Map<string, string | null>

  findAssetInTree: (tree: ProjectDirectory[], assetId: string) => ProjectAsset | null

  isGroundNode: (node: SceneNode) => boolean

  isPrefabDependencyPlaceholderAsset: (asset: ProjectAsset) => boolean

  cloneNode: (node: SceneNode) => SceneNode
  createVector: (x: number, y: number, z: number) => Vector3
  composeNodeMatrix: (node: SceneNode) => Matrix4
  computeWorldMatrixForNode: (nodes: SceneNode[], id: string) => Matrix4 | null

  resolveSpawnPosition: (options: {
    baseY: number
    radius: number
    localCenter?: Vector3
    camera: SceneCameraState | null | undefined
    nodes: SceneNode[]
    snapToGrid?: boolean
  }) => Vector3

  toPlainVector: (value: Vector3) => Vector3Like

  insertNodeMutable: (nodes: SceneNode[], parentId: string, node: SceneNode, mode: 'inside' | 'before' | 'after') => boolean
  findNodeLocationInTree: (nodes: SceneNode[], nodeId: string) => SceneHistoryNodeLocation | null

  getRuntimeObject: (nodeId: string) => Object3D | null

  // Prefab serialization helpers (owned by sceneStore)
  isPlainRecord: (value: unknown) => value is Record<string, unknown>
  clonePlainRecord: (source?: Record<string, unknown> | null) => Record<string, unknown> | undefined

  // Scene duplication helpers (owned by sceneStore)
  duplicateNodeTree: (root: SceneNode, context: DuplicateContext) => SceneNode

  // Component manager
  syncNode: (node: SceneNode) => void

  // Snapshot
  commitSceneSnapshot: (store: SceneState, options?: Record<string, unknown>) => void

}

// --- Prefab asset reference collection (self-contained copy used by prefab module) ---
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeEnvironmentAssetReferences<T>(value: T): T {
  if (!isPlainObject(value)) {
    return value
  }

  const clone: Record<string, unknown> = { ...(value as any) }

  const stripHdriAsset = (raw: unknown): void => {
    if (!isPlainObject(raw)) {
      return
    }
    const section: Record<string, unknown> = { ...raw }
    const mode = typeof section.mode === 'string' ? section.mode.toLowerCase() : ''
    if (mode !== 'hdri') {
      delete section.hdriAssetId
    }
    if (mode !== 'skycube') {
      delete section.positiveXAssetId
      delete section.negativeXAssetId
      delete section.positiveYAssetId
      delete section.negativeYAssetId
      delete section.positiveZAssetId
      delete section.negativeZAssetId
    }
    clone.background = section
  }

  stripHdriAsset(clone.background)

  return clone as T
}

const ASSET_REFERENCE_SKIP_KEYS = new Set<string>(['prefabSource'])

function isAssetReferenceKey(key: string | null | undefined): boolean {
  if (!key) return false
  const normalized = key.trim().toLowerCase()
  if (!normalized) return false
  return normalized.includes('assetid')
}

function normalizePrefabAssetIdCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let candidate = value.trim()
  if (!candidate) return null
  const assetProtocol = 'asset://'
  if (candidate.startsWith(assetProtocol)) candidate = candidate.slice(assetProtocol.length)
  if (!candidate) return null
  if (candidate.startsWith('local:')) return null
  if (/^(?:https?:|data:|blob:)/i.test(candidate)) return null
  if (candidate.length > 256) return null
  return candidate
}

function collectAssetIdCandidate(bucket: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetIdCandidate(bucket, entry))
    return
  }
  const normalized = normalizePrefabAssetIdCandidate(value)
  if (normalized) bucket.add(normalized)
}

function collectAssetIdsFromUnknown(value: unknown, bucket: Set<string>) {
  if (!value) return
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetIdsFromUnknown(entry, bucket))
    return
  }
  if (!isPlainObject(value)) return
  Object.entries(value).forEach(([key, entry]) => {
    if (ASSET_REFERENCE_SKIP_KEYS.has(key)) return
    if (isAssetReferenceKey(key)) {
      collectAssetIdCandidate(bucket, entry)
    } else {
      collectAssetIdsFromUnknown(entry, bucket)
    }
  })
}

function collectTerrainScatterAssetDependencies(snapshot: any, bucket: Set<string>) {
  if (!snapshot || !Array.isArray(snapshot.layers) || !snapshot.layers.length) return
  snapshot.layers.forEach((layer: any) => {
    collectAssetIdCandidate(bucket, layer.assetId)
    collectAssetIdCandidate(bucket, layer.profileId)
    if (Array.isArray(layer.instances)) {
      layer.instances.forEach((instance: any) => {
        collectAssetIdCandidate(bucket, instance.assetId)
        collectAssetIdCandidate(bucket, instance.profileId)
      })
    }
  })
  visitExplicitTerrainScatterAssetReferences(snapshot, ({ assetId }: ExplicitSceneAssetReference) => {
    collectAssetIdCandidate(bucket, assetId)
  })
}

function collectNodeAssetDependenciesLocal(node: SceneNode | null | undefined, bucket: Set<string>) {
  if (!node) return
  collectAssetIdCandidate(bucket, (node as any).sourceAssetId)
  collectAssetIdCandidate(bucket, (node as any).importMetadata?.assetId)

  const rawLayout = (node as any).instanceLayout as unknown
  if (rawLayout) {
    try {
      // Attempt best-effort instance layout handling using schema utilities when available
      // (these imports are available in callers like prefabPreviewBuilder)
      // Fallback: ignore if utilities are not present at runtime.
      // @ts-ignore
      const { clampSceneNodeInstanceLayout, resolveInstanceLayoutTemplateAssetId } = require('@schema/instanceLayout')
      const layout = clampSceneNodeInstanceLayout(rawLayout)
      if (layout?.mode === 'grid') {
        const templateAssetId = resolveInstanceLayoutTemplateAssetId(layout, (node as any).sourceAssetId)
        collectAssetIdCandidate(bucket, templateAssetId)
      }
    } catch (e) {
      // ignore
    }
  }

  if (Array.isArray((node as any).materials) && (node as any).materials.length) {
    ;((node as any).materials as any[]).forEach((material) => collectAssetIdsFromUnknown(material, bucket))
  }
  if ((node as any).components) {
    Object.entries((node as any).components as Record<string, { props?: Record<string, unknown> | null | undefined }>).forEach(
      ([componentType, component]) => {
        if (!component?.props) return
        collectAssetIdsFromUnknown(component.props, bucket)
        visitExplicitComponentAssetReferences(componentType, component.props, ({ assetId }: ExplicitSceneAssetReference) => {
          collectAssetIdCandidate(bucket, assetId)
        })
      },
    )
  }
  if ((node as any).userData) {
    if ((node as any).nodeType === 'Environment' && isPlainObject((node as any).userData)) {
      const sanitizedUserData = { ...((node as any).userData as Record<string, unknown>) }
      if ('environment' in sanitizedUserData) sanitizedUserData.environment = sanitizeEnvironmentAssetReferences(sanitizedUserData.environment)
      collectAssetIdsFromUnknown(sanitizedUserData, bucket)
    } else {
      collectAssetIdsFromUnknown((node as any).userData, bucket)
    }
  }
  if ((node as any).dynamicMesh?.type === 'Ground') {
    const definition = (node as any).dynamicMesh as any
    collectTerrainScatterAssetDependencies(definition.terrainScatter, bucket)
    collectAssetIdCandidate(bucket, definition?.terrainPaintBakedTextureAssetId)
  }
  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => collectNodeAssetDependenciesLocal(child, bucket))
  }
}

export function collectPrefabAssetReferences(root: SceneNode | null | undefined): string[] {
  if (!root) return []
  const bucket = new Set<string>()
  collectNodeAssetDependenciesLocal(root, bucket)
  return Array.from(bucket)
}

export function normalizePrefabName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export function buildNodePrefabFilename(name: string): string {
  const normalized = normalizePrefabName(name) || 'Unnamed Prefab'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'UnnamedPrefab'
  return `${base}.prefab`
}

function sanitizePrefabUserData(
  deps: PrefabActionsDeps,
  userData?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!userData || !deps.isPlainRecord(userData)) {
    return null
  }
  const cloned = deps.clonePlainRecord(userData)
  if (!cloned) {
    return null
  }
  if (deps.PREFAB_SOURCE_METADATA_KEY in cloned) {
    delete cloned[deps.PREFAB_SOURCE_METADATA_KEY]
  }
  return Object.keys(cloned).length ? cloned : null
}

function stripPrefabTransientFields(deps: PrefabActionsDeps, node: SceneNode): SceneNode {
  const sanitized: SceneNode = { ...node }
  delete (sanitized as { parentId?: string | null }).parentId
  delete (sanitized as { downloadProgress?: number }).downloadProgress
  delete (sanitized as { downloadStatus?: SceneNode['downloadStatus'] }).downloadStatus
  delete (sanitized as { downloadError?: string | null }).downloadError
  delete (sanitized as { isPlaceholder?: boolean }).isPlaceholder
  sanitized.visible = sanitized.visible ?? true
  if ('locked' in sanitized) {
    delete (sanitized as any).locked
  }
  const cleanedUserData = sanitizePrefabUserData(deps, sanitized.userData as Record<string, unknown> | null)
  if (cleanedUserData) {
    sanitized.userData = cleanedUserData
  } else if ('userData' in sanitized) {
    delete (sanitized as any).userData
  }
  if (sanitized.children?.length) {
    sanitized.children = sanitized.children.map((child) => stripPrefabTransientFields(deps, child))
  } else if (sanitized.children) {
    delete (sanitized as any).children
  }
  return sanitized
}

function attachPrefabMetadata(deps: PrefabActionsDeps, node: SceneNode, assetId: string) {
  if (!assetId) {
    return
  }
  const current = deps.clonePlainRecord(node.userData as Record<string, unknown> | null)
  const next: Record<string, unknown> = current ? { ...current } : {}
  next[deps.PREFAB_SOURCE_METADATA_KEY] = assetId
  node.userData = next
}

function remapPrefabNodeIds(deps: PrefabActionsDeps, node: SceneNode, regenerate: boolean): SceneNode {
  const resolvedId = regenerate || typeof node.id !== 'string' || !node.id.trim().length ? deps.generateUuid() : node.id
  const children = node.children?.map((child) => remapPrefabNodeIds(deps, child, regenerate))
  const sanitized: SceneNode = {
    ...node,
    id: resolvedId,
  }
  if (children && children.length) {
    sanitized.children = children
  } else if (children) {
    delete (sanitized as any).children
  }
  return sanitized
}

export function prepareNodePrefabRoot(
  deps: PrefabActionsDeps,
  source: SceneNode,
  options: { regenerateIds?: boolean } = {},
): SceneNode {
  const cloned = deps.cloneNode(source)
  const stripped = stripPrefabTransientFields(deps, cloned)
  return remapPrefabNodeIds(deps, stripped, options.regenerateIds ?? false)
}

function sanitizeFiniteVector3Like(value: Vector3Like | null | undefined, fallback: Vector3Like): Vector3Like {
  if (!value) {
    return fallback
  }
  const x = typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : fallback.x
  const y = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : fallback.y
  const z = typeof value.z === 'number' && Number.isFinite(value.z) ? value.z : fallback.z
  return { x, y, z }
}

export function bakePrefabSubtreeTransforms(deps: PrefabActionsDeps, root: SceneNode, sceneNodes: SceneNode[]): SceneNode {
  void sceneNodes

  const sanitizeSubtree = (node: SceneNode) => {
    node.position = deps.createVector(
      sanitizeFiniteVector3Like(node.position, { x: 0, y: 0, z: 0 }).x,
      sanitizeFiniteVector3Like(node.position, { x: 0, y: 0, z: 0 }).y,
      sanitizeFiniteVector3Like(node.position, { x: 0, y: 0, z: 0 }).z,
    )
    node.rotation = deps.createVector(
      sanitizeFiniteVector3Like(node.rotation, { x: 0, y: 0, z: 0 }).x,
      sanitizeFiniteVector3Like(node.rotation, { x: 0, y: 0, z: 0 }).y,
      sanitizeFiniteVector3Like(node.rotation, { x: 0, y: 0, z: 0 }).z,
    )
    node.scale = deps.createVector(
      sanitizeFiniteVector3Like(node.scale, { x: 1, y: 1, z: 1 }).x,
      sanitizeFiniteVector3Like(node.scale, { x: 1, y: 1, z: 1 }).y,
      sanitizeFiniteVector3Like(node.scale, { x: 1, y: 1, z: 1 }).z,
    )

    if (node.children?.length) {
      node.children.forEach((child) => sanitizeSubtree(child))
    }
  }

  sanitizeSubtree(root)
  root.position = deps.createVector(0, 0, 0)
  return root
}

function ensurePrefabRoot(deps: PrefabActionsDeps, node: SceneNode): SceneNode {
  const cloned = deps.cloneNode(node)
  if (cloned.nodeType === 'Group') {
    ;(cloned as any).groupExpanded = false
  }
  return cloned
}

function createNodePrefabData(deps: PrefabActionsDeps, node: SceneNode, name: string): NodePrefabData {
  const normalizedName = normalizePrefabName(name) || 'Unnamed Prefab'
  const root = prepareNodePrefabRoot(deps, node, { regenerateIds: false })
  return {
    formatVersion: deps.NODE_PREFAB_FORMAT_VERSION,
    name: normalizedName,
    root,
  }
}

function serializeNodePrefab(payload: NodePrefabData): string {
  return JSON.stringify(payload, null, 2)
}

export function parseNodePrefab(deps: PrefabActionsDeps, raw: string): NodePrefabData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`节点预制件数据无效: ${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('节点预制件数据格式错误')
  }
  const candidate = parsed as Partial<NodePrefabData> & { root?: SceneNode | null }
  if (!candidate.root || typeof candidate.root !== 'object') {
    throw new Error('节点预制件缺少有效的节点数据')
  }
  const normalizedName = normalizePrefabName(typeof candidate.name === 'string' ? candidate.name : '') || 'Unnamed Prefab'
  const root = prepareNodePrefabRoot(deps, candidate.root as SceneNode, { regenerateIds: false })
  const assetRegistry = sanitizeSceneAssetRegistry(candidate.assetRegistry)
  const prefab: NodePrefabData = {
    formatVersion: deps.NODE_PREFAB_FORMAT_VERSION,
    name: normalizedName,
    root,
  }
  if (assetRegistry && Object.keys(assetRegistry).length) {
    prefab.assetRegistry = assetRegistry
  }
  return prefab
}

function instantiateNodePrefab(
  deps: PrefabActionsDeps,
  prefab: NodePrefabData,
  context: {
    assetCache: ReturnType<typeof useAssetCacheStore>
    runtimeSnapshots?: Map<string, Object3D>
    regenerateBehaviorIds?: boolean
  },
): SceneNode {
  const duplicateContext: DuplicateContext = {
    assetCache: context.assetCache,
    runtimeSnapshots: context.runtimeSnapshots ?? new Map<string, Object3D>(),
    idMap: new Map<string, string>(),
    regenerateBehaviorIds: context.regenerateBehaviorIds ?? true,
  }
  return deps.duplicateNodeTree(prefab.root, duplicateContext)
}

type SerializedPrefabPayload = {
  prefab: NodePrefabData
  serialized: string
  dependencyAssetIds: string[]
}

export function buildSerializedPrefabPayload(
  deps: PrefabActionsDeps,
  node: SceneNode,
  context: {
    name?: string
    assetRegistry: Record<string, SceneAssetRegistryEntry>
    sceneNodes: SceneNode[]
  },
): SerializedPrefabPayload {
  const prefabRoot = ensurePrefabRoot(deps, node)
  const prefabData = createNodePrefabData(deps, prefabRoot, context.name ?? node.name ?? '')
  bakePrefabSubtreeTransforms(deps, prefabData.root, context.sceneNodes)
  const dependencyAssetIds = collectPrefabAssetReferences(prefabData.root)
  if (dependencyAssetIds.length) {
    const dependencySubset = buildAssetDependencySubset({
      assetIds: dependencyAssetIds,
      assetRegistry: context.assetRegistry,
    })
    if (dependencySubset.assetRegistry) {
      prefabData.assetRegistry = dependencySubset.assetRegistry
    } else {
      delete (prefabData as any).assetRegistry
    }
  } else {
    delete (prefabData as any).assetRegistry
  }
  const serialized = serializeNodePrefab(prefabData)
  return {
    prefab: prefabData,
    serialized,
    dependencyAssetIds,
  }
}

export function createNodePrefabHelpers(deps: PrefabActionsDeps) {
  return {
    prepareNodePrefabRoot: (source: SceneNode, options: { regenerateIds?: boolean } = {}) =>
      prepareNodePrefabRoot(deps, source, options),
    bakePrefabSubtreeTransforms: (root: SceneNode, sceneNodes: SceneNode[]) => bakePrefabSubtreeTransforms(deps, root, sceneNodes),
    parseNodePrefab: (raw: string) => parseNodePrefab(deps, raw),
    buildSerializedPrefabPayload: (
      node: SceneNode,
      context: {
        name?: string
        assetRegistry: Record<string, SceneAssetRegistryEntry>
        sceneNodes: SceneNode[]
      },
    ) => buildSerializedPrefabPayload(deps, node, context),
  }
}

function extractBehaviorList(component: SceneNodeComponentState<BehaviorComponentProps> | undefined): SceneBehavior[] {
  if (!component) {
    return []
  }
  const props = component.props as BehaviorComponentProps | undefined
  const behaviors = props?.behaviors
  if (Array.isArray(behaviors)) {
    return cloneBehaviorList(behaviors)
  }
  return cloneBehaviorList(behaviorMapToList(behaviors))
}

const prefabPlaceholderWatchers = new Map<string, WatchStopHandle>()

export function stopPrefabPlaceholderWatcher(nodeId: string) {
  const stop = prefabPlaceholderWatchers.get(nodeId)
  if (stop) {
    stop()
    prefabPlaceholderWatchers.delete(nodeId)
  }
}

export function createPrefabActions(deps: PrefabActionsDeps) {
  return {
    async registerPrefabAssetFromData(
      store: PrefabStoreLike,
      prefabData: NodePrefabData,
      serialized: string,
      options: { assetId?: string | null; select?: boolean } = {},
    ): Promise<ProjectAsset> {
      const targetAssetId = options.assetId ?? deps.generateUuid()
      const fileName = buildNodePrefabFilename(prefabData.name)
      const blob = new Blob([serialized], { type: 'application/json' })
      const assetCache = useAssetCacheStore()
      await assetCache.storeAssetBlob(targetAssetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      const thumbnailAsset: ProjectAsset = options.assetId
        ? {
            ...(store.getAsset(targetAssetId) ?? {
              id: targetAssetId,
              name: prefabData.name,
              type: 'prefab',
              downloadUrl: targetAssetId,
              previewColor: deps.NODE_PREFAB_PREVIEW_COLOR,
              thumbnail: null,
              description: fileName,
              gleaned: true,
              extension: extractExtension(fileName) ?? null,
            }),
            name: prefabData.name,
            type: 'prefab',
            downloadUrl: targetAssetId,
            previewColor: deps.NODE_PREFAB_PREVIEW_COLOR,
            description: fileName,
            extension: extractExtension(fileName) ?? null,
          }
        : {
            id: targetAssetId,
            name: prefabData.name,
            type: 'prefab',
            downloadUrl: targetAssetId,
            previewColor: deps.NODE_PREFAB_PREVIEW_COLOR,
            thumbnail: null,
            description: fileName,
            gleaned: true,
            extension: extractExtension(fileName) ?? null,
          }

      let thumbnailDataUrl: string | null = null
      try {
        const { renderPrefabThumbnailDataUrl } = await import('@/utils/prefabPreviewBuilder')
        const file = new File([blob], fileName, { type: 'application/json' })
        thumbnailDataUrl = await renderPrefabThumbnailDataUrl({
          asset: thumbnailAsset,
          assetId: targetAssetId,
          file,
          assetCacheStore: assetCache,
        })
      } catch (thumbnailError) {
        console.warn('Failed to generate prefab thumbnail', thumbnailError)
      }

      if (options.assetId) {
        const existing = store.getAsset(targetAssetId)
        if (!existing) {
          throw new Error('节点预制件资源不存在')
        }
        if (existing.type !== 'prefab') {
          throw new Error('指定资源并非节点预制件')
        }
        const updated: ProjectAsset = {
          ...existing,
          name: prefabData.name,
          description: fileName,
          previewColor: deps.NODE_PREFAB_PREVIEW_COLOR,
          thumbnail: thumbnailDataUrl ?? existing.thumbnail ?? null,
          extension: extractExtension(fileName) ?? existing.extension ?? null,
        }
        const categoryId = store.resolveConfigAssetSaveDirectoryId()
        return store.registerAsset(updated, {
          categoryId,
          commitOptions: { updateNodes: false },
        })
      }

      const projectAsset: ProjectAsset = {
        id: targetAssetId,
        name: prefabData.name,
        type: 'prefab',
        downloadUrl: targetAssetId,
        previewColor: deps.NODE_PREFAB_PREVIEW_COLOR,
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
        if (options.select === true) {
        store.selectAsset(registered.id)
      }
      return registered
    },

    async saveNodePrefab(
      store: PrefabStoreLike,
      nodeId: string,
        options: { assetId?: string; name?: string; select?: boolean } = {},
    ): Promise<ProjectAsset> {
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('节点不存在或已被移除')
      }
      if ((node as any).canPrefab === false) {
        throw new Error('该节点不允许保存为预制件')
      }
      if (deps.isGroundNode(node)) {
        throw new Error('地面节点无法保存为预制件')
      }

      const payload = buildSerializedPrefabPayload(deps, node, {
        name: options.name ?? node.name ?? '',
        assetRegistry: store.assetRegistry,
        sceneNodes: store.nodes,
      })

      const registered = await this.registerPrefabAssetFromData(store, payload.prefab, payload.serialized, {
        assetId: options.assetId,
        select: options.select,
      })

      attachPrefabMetadata(deps, node, registered.id)
      store.queueSceneNodePatch(nodeId, ['userData'])
      return registered
    },

    async importPrefabAssetFromClipboard(store: PrefabStoreLike, serialized: string): Promise<ProjectAsset | null> {
      if (typeof serialized !== 'string' || !serialized.trim().length) {
        return null
      }
      try {
        const prefabData = parseNodePrefab(deps, serialized)
        return await this.registerPrefabAssetFromData(store, prefabData, serialized)
      } catch (error) {
        console.warn('Invalid prefab clipboard payload', error)
        return null
      }
    },

    async loadNodePrefab(store: PrefabStoreLike, assetId: string): Promise<NodePrefabData> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('节点预制件资源不存在')
      }
      if (asset.type !== 'prefab') {
        throw new Error('指定资源并非节点预制件')
      }

      const assetCache = useAssetCacheStore()
      let entry: AssetCacheEntry | null = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { asset })
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载节点预制件数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      return parseNodePrefab(deps, text)
    },

    async preparePrefabAsset(
      store: PrefabStoreLike,
      assetId: string,
      options: PreparePrefabAssetOptions = {},
    ): Promise<NodePrefabData> {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalizedAssetId) {
        throw new Error('节点预制件资源不存在')
      }

      const existingTask = pendingPrefabPreparationTasks.get(normalizedAssetId)
      if (existingTask) {
        return existingTask
      }

      const task = (async () => {
        const asset = store.getAsset(normalizedAssetId)
        if (!asset) {
          throw new Error('节点预制件资源不存在')
        }
        if (asset.type !== 'prefab') {
          throw new Error('指定资源并非节点预制件')
        }

        const prefab = await this.loadNodePrefab(store, normalizedAssetId)
        const dependencyAssetIds = Array.from(
          new Set(
            [
              ...collectPrefabAssetReferences(prefab.root),
              ...Object.keys(prefab.assetRegistry ?? {}),
            ]
              .map((value) => (typeof value === 'string' ? value.trim() : ''))
              .filter((value) => value.length > 0),
          ),
        )

        if (dependencyAssetIds.length) {
          await this.ensurePrefabDependencies(store, dependencyAssetIds, {
            providerId: options.providerId ?? null,
            prefabAssetIdForDownloadProgress: options.prefabAssetIdForDownloadProgress ?? normalizedAssetId,
            prefabAssetRegistry: prefab.assetRegistry ?? null,
          })
        }

        return prefab
      })().finally(() => {
        pendingPrefabPreparationTasks.delete(normalizedAssetId)
      })

      pendingPrefabPreparationTasks.set(normalizedAssetId, task)
      return task
    },

    async ensurePrefabDependencies(
      store: PrefabStoreLike,
      assetIds: string[],
      options: {
        providerId?: string | null
        prefabAssetIdForDownloadProgress?: string | null
        prefabAssetRegistry?: Record<string, SceneAssetRegistryEntry> | null
      } = {},
    ) {
      const providerId = options.providerId ?? null
      const prefabProgressKey =
        typeof options.prefabAssetIdForDownloadProgress === 'string' ? options.prefabAssetIdForDownloadProgress.trim() : ''
      const shouldReportPrefabProgress = prefabProgressKey.length > 0
      const normalizedIds = Array.from(
        new Set(
          assetIds
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0 && !value.startsWith(deps.LOCAL_EMBEDDED_ASSET_PREFIX)),
        ),
      )

      if (!normalizedIds.length) {
        return
      }

      const prefabAssetRegistry = options.prefabAssetRegistry && typeof options.prefabAssetRegistry === 'object'
        ? options.prefabAssetRegistry
        : null

      const parseProviderKey = (key: string): { providerId: string; originalAssetId: string } | null => {
        const normalized = typeof key === 'string' ? key.trim() : ''
        const separator = normalized.indexOf('::')
        if (separator <= 0 || separator >= normalized.length - 2) {
          return null
        }
        const providerId = normalized.slice(0, separator).trim()
        const originalAssetId = normalized.slice(separator + 2).trim()
        if (!providerId || !originalAssetId) {
          return null
        }
        if (providerId === 'local' || providerId === 'url') {
          return null
        }
        return { providerId, originalAssetId }
      }

      const resolveRegistryEntry = (assetId: string): SceneAssetRegistryEntry | null => {
        if (!prefabAssetRegistry) {
          return null
        }
        const entry = prefabAssetRegistry[assetId]
        if (!entry || typeof entry !== 'object') {
          return null
        }
        if (entry.sourceType !== 'server' && entry.sourceType !== 'package' && entry.sourceType !== 'url') {
          return null
        }
        return entry
      }

      const resolveRegistryEntryByServerAssetId = (assetId: string): SceneAssetRegistryEntry | null => {
        if (!prefabAssetRegistry) {
          return null
        }
        for (const entry of Object.values(prefabAssetRegistry)) {
          if (!entry || typeof entry !== 'object' || entry.sourceType !== 'server') {
            continue
          }
          const serverAssetId = typeof entry.serverAssetId === 'string' ? entry.serverAssetId.trim() : ''
          if (serverAssetId && serverAssetId === assetId) {
            return entry
          }
        }
        return null
      }

      const resolveProviderFromRegistry = (assetId: string): { providerId: string; originalAssetId: string } | null => {
        const entry = resolveRegistryEntry(assetId) ?? resolveRegistryEntryByServerAssetId(assetId)
        if (!entry || entry.sourceType !== 'package') {
          return null
        }
        const zipPath = typeof entry.zipPath === 'string' ? entry.zipPath.trim() : ''
        if (!zipPath) {
          return null
        }
        return parseProviderKey(zipPath)
      }

      const resolveProviderHint = (assetId: string): { providerId: string; originalAssetId: string } | null => {
        const registryResolved = resolveProviderFromRegistry(assetId)
        if (registryResolved) {
          return registryResolved
        }
        return null
      }

      const resolveRemoteLookupAssetId = (assetId: string): string | null => {
        const registryEntry = resolveRegistryEntry(assetId) ?? resolveRegistryEntryByServerAssetId(assetId)
        if (registryEntry?.sourceType === 'server') {
          const serverAssetId = typeof registryEntry.serverAssetId === 'string' ? registryEntry.serverAssetId.trim() : ''
          return serverAssetId || assetId
        }
        if (registryEntry?.sourceType === 'url') {
          return null
        }
        if (registryEntry?.sourceType === 'package') {
          const parsed = resolveProviderFromRegistry(assetId)
          if (parsed?.originalAssetId) {
            return parsed.originalAssetId
          }
        }
        return assetId
      }

      const resolveDependencySourceMeta = (assetId: string): AssetSourceMetadata | undefined => {
        const providerHint = resolveProviderHint(assetId)
        if (providerHint) {
          if (isServerBackedProviderId(providerHint.providerId)) {
            return createServerAssetSource(providerHint.originalAssetId)
          }
          const packagePathSegments = store.getPackageAssetPathSegments(providerHint.providerId, providerHint.originalAssetId)
          return {
            type: 'package',
            providerId: providerHint.providerId,
            originalAssetId: providerHint.originalAssetId,
            packagePathSegments,
          }
        }
        const registryEntry = resolveRegistryEntry(assetId) ?? resolveRegistryEntryByServerAssetId(assetId)
        if (registryEntry?.sourceType === 'server') {
          const serverAssetId = typeof registryEntry.serverAssetId === 'string' ? registryEntry.serverAssetId.trim() : ''
          return createServerAssetSource(serverAssetId || assetId)
        }
        if (registryEntry?.sourceType === 'url') {
          return { type: 'url' }
        }
        return undefined
      }

      const copyFromProvider = (targetProviderId: string, candidateAssetIds: string[]): void => {
        if (!targetProviderId || !candidateAssetIds.length) {
          return
        }
        const providerDirectories = store.packageDirectoryCache[targetProviderId]
        if (!providerDirectories?.length) {
          return
        }
        const providerAssets: ProjectAsset[] = []
        candidateAssetIds.forEach((assetId) => {
          const hint = resolveProviderHint(assetId)
          const lookupAssetId = hint?.providerId === targetProviderId ? hint.originalAssetId : assetId
          const providerAsset = deps.findAssetInTree(providerDirectories, lookupAssetId)
          if (!providerAsset) {
            return
          }
          const existing = store.getAsset(assetId)
          if (!existing || deps.isPrefabDependencyPlaceholderAsset(existing)) {
            providerAssets.push({ ...providerAsset, id: assetId })
          }
        })
        if (!providerAssets.length) {
          return
        }
        const packagePathByAssetId: Record<string, string[]> = {}
        providerAssets.forEach((providerAsset) => {
          const hint = resolveProviderHint(providerAsset.id)
          const lookupAssetId = hint?.providerId === targetProviderId ? hint.originalAssetId : providerAsset.id
          const path = store.getPackageAssetPathSegments(targetProviderId, lookupAssetId)
          if (path.length) {
            packagePathByAssetId[providerAsset.id] = path
          }
        })
        store.copyPackageAssetsToAssets(targetProviderId, providerAssets, { packagePathByAssetId })
      }

      const assetCache = useAssetCacheStore()
      const missingIds = normalizedIds.filter((assetId) => !store.getAsset(assetId))

      if (providerId) {
        const providerDirectories = store.packageDirectoryCache[providerId]
        if (providerDirectories?.length) {
          copyFromProvider(providerId, normalizedIds)
        } else if (missingIds.length) {
          console.warn(`Provider ${providerId} is not loaded; prefab dependencies may be unavailable.`)
        }
      }

      const unresolvedAfterPrimaryProvider = normalizedIds.filter((assetId) => !store.findAssetInCatalog(assetId))
      const unresolvedByProvider = new Map<string, Set<string>>()
      unresolvedAfterPrimaryProvider.forEach((assetId) => {
        const hint = resolveProviderHint(assetId)
        if (!hint?.providerId || hint.providerId === providerId) {
          return
        }
        if (!unresolvedByProvider.has(hint.providerId)) {
          unresolvedByProvider.set(hint.providerId, new Set<string>())
        }
        unresolvedByProvider.get(hint.providerId)!.add(assetId)
      })
      unresolvedByProvider.forEach((ids, hintedProviderId) => {
        const candidateIds = Array.from(ids)
        if (!candidateIds.length) {
          return
        }
        copyFromProvider(hintedProviderId, candidateIds)
      })

      const unresolvedIds = normalizedIds.filter((assetId) => !store.findAssetInCatalog(assetId))
      if (unresolvedIds.length) {
        const placeholderAssets: ProjectAsset[] = []
        unresolvedIds.forEach((assetId) => {
          const placeholder = deps.findAssetInTree(store.projectTree, assetId)
          if (placeholder) {
            placeholderAssets.push(placeholder)
          }
        })

        if (placeholderAssets.length) {
          store.registerAssets(placeholderAssets, {
            categoryId: (asset: ProjectAsset) => determineAssetCategoryId(asset),
            commitOptions: { updateNodes: false },
          })
        }

        const stillUnresolvedIds = unresolvedIds.filter((assetId) => !store.findAssetInCatalog(assetId))
        if (stillUnresolvedIds.length) {
          const fetchedRemoteAssets: Array<{ asset: ProjectAsset; source: AssetSourceMetadata; targetAssetId: string }> = []
          await Promise.all(
            stillUnresolvedIds.map(async (assetId) => {
              try {
                const remoteLookupAssetId = resolveRemoteLookupAssetId(assetId)
                if (!remoteLookupAssetId) {
                  return
                }
                const serverAsset = await fetchResourceAsset(remoteLookupAssetId)
                const mappedAsset = mapServerAssetToProjectAsset(serverAsset)
                const projectAsset = mappedAsset.id === assetId ? mappedAsset : { ...mappedAsset, id: assetId }
                fetchedRemoteAssets.push({
                  asset: projectAsset,
                  source: resolveDependencySourceMeta(assetId) ?? createServerAssetSource(remoteLookupAssetId),
                  targetAssetId: assetId,
                })
              } catch {
                // Ignore missing/unauthorized assets; export flow will surface unresolved ids if still needed.
              }
            }),
          )

          if (fetchedRemoteAssets.length) {
            const sourceByAssetId = new Map<string, AssetSourceMetadata>()
            fetchedRemoteAssets.forEach((entry) => {
              sourceByAssetId.set(entry.targetAssetId, entry.source)
            })
            store.registerAssets(
              fetchedRemoteAssets.map((entry) => entry.asset),
              {
                categoryId: (asset: ProjectAsset) => determineAssetCategoryId(asset),
                source: (asset: ProjectAsset) => sourceByAssetId.get(asset.id),
                commitOptions: { updateNodes: false },
              },
            )

          }
        }
      }

      const resolvedAssets: ProjectAsset[] = []
      normalizedIds.forEach((assetId) => {
        const asset = store.getAsset(assetId)
        if (asset) {
          resolvedAssets.push(asset)
        }
      })

      if (!resolvedAssets.length) {
        return
      }

      const trackedAssetIds = normalizedIds
      const prefabProgressWatcher = { stop: null as WatchStopHandle | null }

      const clampPercent = (value: unknown): number => {
        const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0
        return Math.max(0, Math.min(100, Math.round(numeric)))
      }

      const computePrefabAggregateProgress = (): { active: boolean; progress: number; error: string | null } => {
        if (!trackedAssetIds.length) {
          return { active: false, progress: 100, error: null }
        }
        let sum = 0
        let missing = 0
        let downloading = 0
        let errorCount = 0
        let firstError: string | null = null

        for (const id of trackedAssetIds) {
          const entry = assetCache.getEntry(id)
          const cached = assetCache.hasCache(id) || entry?.status === 'cached'
          if (cached) {
            sum += 100
            continue
          }
          if (entry?.status === 'downloading') {
            downloading += 1
            sum += clampPercent(entry.progress)
            continue
          }
          if (entry?.status === 'error') {
            errorCount += 1
            if (!firstError) {
              firstError = entry.error ?? '资源下载失败'
            }
            sum += 0
            continue
          }
          missing += 1
          sum += 0
        }

        const progress = Math.round(sum / trackedAssetIds.length)
        const active = downloading > 0 || missing > 0
        const error = errorCount > 0 ? (errorCount === 1 ? firstError : `${errorCount} assets failed`) : null
        return { active, progress, error }
      }

      let prefabProgressTimer: ReturnType<typeof setTimeout> | null = null
      const PREFAB_PROGRESS_VISIBILITY_DELAY_MS = 120

      if (shouldReportPrefabProgress) {
        prefabProgressTimer = setTimeout(() => {
          const initial = computePrefabAggregateProgress()
          if (!initial.active && !initial.error) {
            return
          }

          store.prefabAssetDownloadProgress[prefabProgressKey] = {
            active: initial.active,
            progress: initial.progress,
            error: initial.error,
            assetIds: trackedAssetIds,
          }

          prefabProgressWatcher.stop = watch(
            () =>
              trackedAssetIds.map((id) => {
                const entry = assetCache.getEntry(id)
                return [entry?.status ?? 'idle', entry?.progress ?? 0, entry?.error ?? null] as const
              }),
            () => {
              const next = computePrefabAggregateProgress()
              const previous = store.prefabAssetDownloadProgress[prefabProgressKey]
              if (!previous) {
                return
              }
              store.prefabAssetDownloadProgress[prefabProgressKey] = {
                ...previous,
                active: next.active,
                progress: next.progress,
                error: next.error,
              }
            },
            { immediate: true },
          )
        }, PREFAB_PROGRESS_VISIBILITY_DELAY_MS)
      }

      const errors: Array<{ assetId: string; message: string }> = []

      try {
        await Promise.all(
          resolvedAssets.map(async (asset) => {
            if (assetCache.hasCache(asset.id)) {
              assetCache.touch(asset.id)
              return
            }
            try {
              await assetCache.downloadProjectAsset(asset)
            } catch (error) {
              const message = (error as Error).message ?? '资源下载失败'
              errors.push({ assetId: asset.id, message })
              console.warn(`Failed to preload prefab dependency ${asset.id}`, error)
            }
          }),
        )
      } finally {
        if (prefabProgressTimer) {
          clearTimeout(prefabProgressTimer)
          prefabProgressTimer = null
        }
        prefabProgressWatcher.stop?.()
        prefabProgressWatcher.stop = null
        if (shouldReportPrefabProgress) {
          const latest = store.prefabAssetDownloadProgress[prefabProgressKey]
          const next = computePrefabAggregateProgress()
          if (errors.length > 0) {
            store.prefabAssetDownloadProgress[prefabProgressKey] = {
              ...(latest ?? { assetIds: trackedAssetIds }),
              active: false,
              progress: next.progress,
              error: errors.length === 1 ? errors[0]?.message ?? next.error : `${errors.length} assets failed`,
              assetIds: trackedAssetIds,
            }
          } else if (latest) {
            delete store.prefabAssetDownloadProgress[prefabProgressKey]
          }
        }
      }
    },

    async instantiatePrefabData(
      store: PrefabStoreLike,
      prefab: NodePrefabData,
      options: {
        sourceAssetId?: string | null
        dependencyAssetIds?: string[]
        runtimeSnapshots?: Map<string, Object3D>
        position?: Vector3 | null
        providerId?: string | null
        prefabAssetIdForDownloadProgress?: string | null
      } = {},
    ): Promise<SceneNode> {
      const dependencyAssetIds = options.dependencyAssetIds ?? collectPrefabAssetReferences(prefab.root)
      const normalizedDependencyAssetIds = Array.from(
        new Set([
          ...dependencyAssetIds,
          ...Object.keys(prefab.assetRegistry ?? {}),
        ].map((value) => (typeof value === 'string' ? value.trim() : '')).filter((value) => value.length > 0)),
      )
      const providerId = options.providerId ?? null
      const prefabAssetRegistry = prefab.assetRegistry && Object.keys(prefab.assetRegistry).length
        ? prefab.assetRegistry
        : undefined

      if (normalizedDependencyAssetIds.length) {
        await this.ensurePrefabDependencies(store, normalizedDependencyAssetIds, {
          providerId,
          prefabAssetIdForDownloadProgress: options.prefabAssetIdForDownloadProgress ?? null,
          prefabAssetRegistry: prefabAssetRegistry ?? null,
        })
      }

      const assetCache = useAssetCacheStore()
      const runtimeSnapshots = options.runtimeSnapshots ?? new Map<string, Object3D>()
      const duplicate = instantiateNodePrefab(deps, prefab, {
        assetCache,
        runtimeSnapshots,
        regenerateBehaviorIds: true,
      })

      const requestedPosition = options.position
      const spawnPosition =
        requestedPosition === undefined
          ? deps.resolveSpawnPosition({
              baseY: 0,
              radius: deps.DEFAULT_SPAWN_RADIUS,
              localCenter: new Vector3(0, 0, 0),
              camera: store.camera,
              nodes: store.nodes,
              snapToGrid: true,
            })
          : requestedPosition === null
            ? null
            : requestedPosition.clone()
      if (spawnPosition) {
        duplicate.position = deps.toPlainVector(spawnPosition)
      }
      duplicate.rotation = duplicate.rotation ?? ({ x: 0, y: 0, z: 0 } as Vector3Like)
      duplicate.scale = duplicate.scale ?? ({ x: 1, y: 1, z: 1 } as Vector3Like)
      if (duplicate.nodeType === 'Group') {
        ;(duplicate as any).groupExpanded = false
      }
      if (options.sourceAssetId) {
        attachPrefabMetadata(deps, duplicate, options.sourceAssetId)
      } else if (duplicate.userData && deps.isPlainRecord(duplicate.userData)) {
        const sanitized = deps.clonePlainRecord(duplicate.userData as Record<string, unknown>)
        if (sanitized && deps.PREFAB_SOURCE_METADATA_KEY in sanitized) {
          delete sanitized[deps.PREFAB_SOURCE_METADATA_KEY]
          duplicate.userData = Object.keys(sanitized).length ? sanitized : undefined
        }
      }
      deps.syncNode(duplicate)
      return duplicate
    },

    async instantiateNodePrefabAsset(
      store: PrefabStoreLike,
      assetId: string,
      position?: Vector3,
      options: { parentId?: string | null; rotation?: Vector3 | null } = {},
    ): Promise<SceneNode> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('节点预制件资源不存在')
      }
      if (asset.type !== 'prefab') {
        throw new Error('指定资源并非节点预制件')
      }

      const prefab = await this.preparePrefabAsset(store, assetId, {
        prefabAssetIdForDownloadProgress: assetId,
      })
      const duplicate = await this.instantiatePrefabData(store, prefab, {
        sourceAssetId: assetId,
        position: position ?? null,
        prefabAssetIdForDownloadProgress: assetId,
      })

      if (options.rotation) {
        const existing = duplicate.rotation ?? ({ x: 0, y: 0, z: 0 } as Vector3Like)
        duplicate.rotation = {
          x: (existing.x ?? 0) + options.rotation.x,
          y: (existing.y ?? 0) + options.rotation.y,
          z: (existing.z ?? 0) + options.rotation.z,
        } as Vector3Like
      }

      let parentId = options.parentId ?? null
      if (parentId === deps.ENVIRONMENT_NODE_ID) {
        parentId = null
      }
      if (parentId) {
        const parentNode = deps.findNodeById(store.nodes, parentId)
        if (!deps.allowsChildNodes(parentNode)) {
          parentId = null
        }
      }
      if (parentId) {
        const parentMatrix = deps.computeWorldMatrixForNode(store.nodes, parentId)
        if (parentMatrix) {
          const worldMatrix = deps.composeNodeMatrix(duplicate)
          const parentInverse = parentMatrix.clone().invert()
          const localMatrix = new Matrix4().multiplyMatrices(parentInverse, worldMatrix)
          const localPosition = new Vector3()
          const localQuaternion = new Quaternion()
          const localScale = new Vector3()
          localMatrix.decompose(localPosition, localQuaternion, localScale)
          const localEuler = new Euler().setFromQuaternion(localQuaternion, 'XYZ')
          duplicate.position = deps.createVector(localPosition.x, localPosition.y, localPosition.z)
          duplicate.rotation = deps.createVector(localEuler.x, localEuler.y, localEuler.z)
          duplicate.scale = deps.createVector(localScale.x, localScale.y, localScale.z)
          deps.syncNode(duplicate)
        } else {
          parentId = null
        }
      }

      let nextNodes: SceneNode[]
      if (parentId) {
        const workingTree = [...store.nodes]
        const inserted = deps.insertNodeMutable(workingTree, parentId, duplicate, 'inside')
        if (inserted) {
          nextNodes = workingTree
        } else {
          nextNodes = [duplicate,...store.nodes]
        }
      } else {
        nextNodes = [duplicate,...store.nodes]
      }
      store.nodes = nextNodes

      const insertionLocation = deps.findNodeLocationInTree(store.nodes, duplicate.id)
      if (insertionLocation) {
        store.captureNodeStructureHistorySnapshot([
          {
            type: 'remove',
            location: insertionLocation,
            nodeId: duplicate.id,
          },
        ])
      }

      await store.ensureSceneAssetsReady({
        nodes: [duplicate],
        showOverlay: false,
        prefabAssetIdForDownloadProgress: assetId,
        refreshViewport: true,
      })

      await store.withHistorySuppressed(() => {
        const runtimeRoot = deps.getRuntimeObject(duplicate.id)
        if (!runtimeRoot) {
          return
        }
        runtimeRoot.updateMatrixWorld(true)
        const bounds = new Box3().setFromObject(runtimeRoot)
        if (bounds.isEmpty()) {
          return
        }
        const currentWorldMatrix = deps.computeWorldMatrixForNode(store.nodes, duplicate.id)
        if (!currentWorldMatrix) {
          return
        }
        const currentWorldPosition = new Vector3()
        currentWorldMatrix.decompose(currentWorldPosition, new Quaternion(), new Vector3())
        store.setNodeWorldPositionPositionOnly(duplicate.id, currentWorldPosition)
      })

      store.syncComponentSubtree(duplicate)

      store.queueSceneNodePatch(duplicate.id, ['transform'])
      if (duplicate.nodeType === 'Group') {
        ;(duplicate as any).groupExpanded = false
      }
      store.setSelection([duplicate.id], { primaryId: duplicate.id })
      deps.commitSceneSnapshot(store as unknown as SceneState)
      return duplicate
    },

    observePrefabDownloadForNode(store: PrefabStoreLike, nodeId: string, prefabAssetId: string) {
      stopPrefabPlaceholderWatcher(nodeId)
      const prefabKey = typeof prefabAssetId === 'string' ? prefabAssetId.trim() : ''
      if (!prefabKey) {
        return
      }

      const stop = watch(
        () => {
          const entry = store.prefabAssetDownloadProgress?.[prefabKey] ?? null
          if (!entry) {
            return null
          }
          return {
            active: entry.active,
            progress: entry.progress ?? 0,
            error: entry.error ?? null,
          }
        },
        (snapshot) => {
          const target = deps.findNodeById(store.nodes, nodeId)
          if (!target) {
            stopPrefabPlaceholderWatcher(nodeId)
            return
          }

          if (!snapshot) {
            if ((target as any).downloadProgress !== 100) {
              ;(target as any).downloadProgress = 100
              store.queueSceneNodePatch(nodeId, ['download'])
            }
            return
          }

          let changed = false
          if ((target as any).downloadProgress !== snapshot.progress) {
            ;(target as any).downloadProgress = snapshot.progress
            changed = true
          }
          if ((target as any).downloadError !== snapshot.error) {
            ;(target as any).downloadError = snapshot.error
            changed = true
          }
          const nextStatus = snapshot.error ? 'error' : snapshot.active ? 'downloading' : 'ready'
          if ((target as any).downloadStatus !== nextStatus) {
            ;(target as any).downloadStatus = nextStatus
            changed = true
          }
          if (changed) {
            store.queueSceneNodePatch(nodeId, ['download'])
          }
        },
        { immediate: true },
      )

      prefabPlaceholderWatchers.set(nodeId, stop)
    },

    async spawnPrefabWithPlaceholder(
      store: PrefabStoreLike,
      assetId: string,
      position: Vector3 | null,
      options: { parentId?: string | null; placeAtParentOrigin?: boolean; rotation?: Vector3 | null } = {},
    ): Promise<SceneNode> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('节点预制件资源不存在')
      }
      if (asset.type !== 'prefab') {
        throw new Error('指定资源并非节点预制件')
      }

      const parentMap = deps.buildParentMap(store.nodes)
      let parentId = options.parentId ?? null
      if (parentId === deps.ENVIRONMENT_NODE_ID) {
        parentId = null
      }
      while (parentId) {
        const parentNode = deps.findNodeById(store.nodes, parentId)
        if (deps.allowsChildNodes(parentNode)) {
          break
        }
        parentId = parentMap.get(parentId) ?? null
      }

      let spawnPosition = position ? position.clone() : null
      if (!spawnPosition && parentId && options.placeAtParentOrigin) {
        const parentMatrix = deps.computeWorldMatrixForNode(store.nodes, parentId)
        if (parentMatrix) {
          const parentWorldPosition = new Vector3()
          parentMatrix.decompose(parentWorldPosition, new Quaternion(), new Vector3())
          spawnPosition = parentWorldPosition
        }
      }

      if (!spawnPosition) {
        spawnPosition = deps.resolveSpawnPosition({
          baseY: 0,
          radius: deps.DEFAULT_SPAWN_RADIUS,
          localCenter: new Vector3(0, 0, 0),
          camera: store.camera,
          nodes: store.nodes,
          snapToGrid: true,
        })
      }

      const placeholder = store.addPlaceholderNode(
        asset,
        {
          position: deps.toPlainVector(spawnPosition),
          rotation: options.rotation ? deps.toPlainVector(options.rotation) : ({ x: 0, y: 0, z: 0 } as Vector3Like),
          scale: { x: 1, y: 1, z: 1 } as Vector3Like,
        },
        { parentId },
      )

      const placeholderLocation = deps.findNodeLocationInTree(store.nodes, placeholder.id)
      if (placeholderLocation) {
        store.captureNodeStructureHistorySnapshot([{ type: 'remove', location: placeholderLocation, nodeId: placeholder.id }])
      }

      this.observePrefabDownloadForNode(store, placeholder.id, assetId)

      void (async () => {
        try {
          const instantiated = await this.instantiateNodePrefabAsset(store, assetId, spawnPosition ?? undefined, {
            parentId,
            rotation: options.rotation ?? null,
          })
          stopPrefabPlaceholderWatcher(placeholder.id)
          store.removeSceneNodes([placeholder.id])
          store.setSelection([instantiated.id], { primaryId: instantiated.id })
        } catch (error) {
          const target = deps.findNodeById(store.nodes, placeholder.id)
          if (target) {
            ;(target as any).downloadStatus = 'error'
            ;(target as any).downloadError = (error as Error).message ?? '资源下载失败'
            store.queueSceneNodePatch(placeholder.id, ['download'])
          }
        }
      })()

      return placeholder
    },

    async saveBehaviorPrefab(
      store: PrefabStoreLike,
      payload: { name: string; action: BehaviorEventType; sequence: SceneBehavior[] },
    ): Promise<ProjectAsset> {
      const sanitized = createBehaviorPrefabData(payload)
      const serialized = serializeBehaviorPrefab(sanitized)
      const assetId = deps.generateUuid()
      const fileName = buildBehaviorPrefabFilename(sanitized.name)
      const blob = new Blob([serialized], { type: 'application/json' })
      const assetCache = useAssetCacheStore()
      await assetCache.storeAssetBlob(assetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: sanitized.name,
        type: 'behavior',
        downloadUrl: assetId,
        previewColor: deps.BEHAVIOR_PREFAB_PREVIEW_COLOR,
        thumbnail: null,
        description: fileName,
        gleaned: true,
        extension: extractExtension(fileName) ?? null,
      }

      return store.registerAsset(projectAsset, {
        categoryId: store.resolveConfigAssetSaveDirectoryId(),
        source: { type: 'local' },
        commitOptions: { updateNodes: false },
      })
    },

    async loadBehaviorPrefab(store: PrefabStoreLike, assetId: string): Promise<BehaviorPrefabData> {
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('行为预制件资源不存在')
      }
      if (asset.type !== 'behavior') {
        throw new Error('指定资源并非行为预制件')
      }

      const assetCache = useAssetCacheStore()
      let entry: AssetCacheEntry | null = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { asset })
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载行为预制件数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      return deserializeBehaviorPrefab(text)
    },

    async applyBehaviorPrefabToNode(
      store: PrefabStoreLike,
      nodeId: string,
      assetId: string,
    ): Promise<{ sequenceId: string; sequence: SceneBehavior[]; action: BehaviorEventType; name: string } | null> {
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        return null
      }

      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('行为预制件资源不存在')
      }
      if (asset.type !== 'behavior') {
        throw new Error('指定资源并非行为预制件')
      }

      const prefab = await this.loadBehaviorPrefab(store, assetId)
      const instantiated = instantiateBehaviorPrefab(prefab, { nodeId })

      if (!node.components?.[BEHAVIOR_COMPONENT_TYPE]) {
        const result = store.addNodeComponent<typeof BEHAVIOR_COMPONENT_TYPE>(nodeId, BEHAVIOR_COMPONENT_TYPE)
        if (!result) {
          throw new Error('无法为节点添加行为组件')
        }
      }

      const refreshedNode = deps.findNodeById(store.nodes, nodeId)
      const behaviorComponent = refreshedNode?.components?.[BEHAVIOR_COMPONENT_TYPE] as
        | SceneNodeComponentState<BehaviorComponentProps>
        | undefined
      if (!behaviorComponent) {
        throw new Error('行为组件不可用')
      }

      const currentList = extractBehaviorList(behaviorComponent)
      const newSequence = cloneBehaviorList(instantiated.sequence)
      const nextList: SceneBehavior[] = []
      let inserted = false

      currentList.forEach((step) => {
        if (!inserted && step.action === instantiated.action) {
          nextList.push(...newSequence)
          inserted = true
        }
        if (step.action !== instantiated.action) {
          nextList.push(step)
        }
      })

      if (!inserted) {
        nextList.push(...newSequence)
      }

      const updated = store.updateNodeComponentProps(nodeId, behaviorComponent.id, {
        behaviors: cloneBehaviorList(nextList),
      })

      if (!updated) {
        return null
      }

      return instantiated
    },
  }
}
