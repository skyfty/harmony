import { watch, type WatchStopHandle } from 'vue'
import { Box3, Euler, Matrix4, Quaternion, Vector3, Object3D } from 'three'
import type {
  AssetIndexEntry,
  BehaviorComponentProps,
  BehaviorEventType,
  SceneBehavior,
  SceneNode,
  SceneNodeComponentState,
  Vector3Like,
} from '@harmony/schema'
import { BEHAVIOR_COMPONENT_TYPE } from '@schema/components'
import { behaviorMapToList, cloneBehaviorList } from '@schema/behaviors/definitions'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { NodePrefabData } from '@/types/node-prefab'
import type { DuplicateContext } from '@/types/duplicate-context'
import { useAssetCacheStore, type AssetCacheEntry } from './assetCacheStore'
import { determineAssetCategoryId } from './assetCatalog'
import { extractExtension } from '@/utils/blob'
import {
  buildBehaviorPrefabFilename,
  createBehaviorPrefabData,
  deserializeBehaviorPrefab,
  instantiateBehaviorPrefab,
  serializeBehaviorPrefab,
  type BehaviorPrefabData,
} from '@/utils/behaviorPrefab'

export type PrefabStoreLike = {
  nodes: SceneNode[]
  camera: unknown
  assetIndex: Record<string, AssetIndexEntry>
  packageAssetMap: Record<string, string>
  prefabAssetDownloadProgress: Record<
    string,
    { active: boolean; progress: number; error: string | null; assetIds: string[] }
  >

  projectTree: ProjectDirectory[]
  packageDirectoryCache: Record<string, ProjectDirectory[]>

  selectedNodeId: string | null

  getAsset: (id: string) => ProjectAsset | null
  findAssetInCatalog: (assetId: string) => ProjectAsset | null

  registerAsset: (asset: ProjectAsset, options: any) => ProjectAsset
  registerAssets: (assets: ProjectAsset[], options: any) => ProjectAsset[]

  setActiveDirectory: (categoryId: string) => void
  selectAsset: (assetId: string) => void

  copyPackageAssetsToAssets: (providerId: string, assets: ProjectAsset[]) => ProjectAsset[]

  queueSceneNodePatch: (nodeId: string, fields: any[]) => void
  captureNodeStructureHistorySnapshot: (ops: any[]) => void

  addPlaceholderNode: (asset: ProjectAsset, transform: any, options: { parentId?: string | null }) => SceneNode
  removeSceneNodes: (ids: string[]) => void
  setSelection: (ids: string[], options?: any) => void

  ensureSceneAssetsReady: (options: any) => Promise<void>
  withHistorySuppressed: <T>(fn: () => T | Promise<T>) => Promise<T>
  setNodeWorldPositionPositionOnly: (nodeId: string, worldPosition: Vector3) => void
  syncComponentSubtree: (node: SceneNode) => void

  addNodeComponent: <T extends string>(nodeId: string, type: T) => any
  updateNodeComponentProps: (nodeId: string, componentId: string, patch: any) => boolean
}

export type PrefabActionsDeps = {
  PREFAB_SOURCE_METADATA_KEY: string
  NODE_PREFAB_FORMAT_VERSION: number
  NODE_PREFAB_PREVIEW_COLOR: string
  BEHAVIOR_PREFAB_PREVIEW_COLOR: string

  SKY_NODE_ID: string
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
  createVector: (x: number, y: number, z: number) => any
  composeNodeMatrix: (node: SceneNode) => Matrix4
  computeWorldMatrixForNode: (nodes: SceneNode[], id: string) => Matrix4 | null

  resolveSpawnPosition: (options: any) => Vector3
  toPlainVector: (value: Vector3) => Vector3Like

  insertNodeMutable: (nodes: SceneNode[], parentId: string, node: SceneNode, mode: 'inside' | 'before' | 'after') => boolean
  findNodeLocationInTree: (nodes: SceneNode[], nodeId: string) => any

  getRuntimeObject: (nodeId: string) => Object3D | null

  // Prefab serialization helpers (owned by sceneStore)
  isPlainRecord: (value: unknown) => value is Record<string, unknown>
  clonePlainRecord: (source?: Record<string, unknown> | null) => Record<string, unknown> | undefined

  // Asset index helpers (owned by sceneStore)
  isAssetIndex: (value: unknown) => value is Record<string, AssetIndexEntry>
  isPackageAssetMap: (value: unknown) => value is Record<string, string>
  cloneAssetIndex: (source: Record<string, AssetIndexEntry>) => Record<string, AssetIndexEntry>
  clonePackageAssetMap: (source: Record<string, string>) => Record<string, string>
  buildAssetIndexSubsetForPrefab: (
    source: Record<string, AssetIndexEntry>,
    assetIds: Iterable<string>,
  ) => Record<string, AssetIndexEntry> | undefined
  buildPackageAssetMapSubsetForPrefab: (source: Record<string, string>, assetIds: Iterable<string>) => Record<string, string> | undefined
  mergeAssetIndexEntries: (
    current: Record<string, AssetIndexEntry>,
    additions?: Record<string, AssetIndexEntry>,
    filter?: Set<string>,
  ) => { next: Record<string, AssetIndexEntry>; changed: boolean }
  mergePackageAssetMapEntries: (
    current: Record<string, string>,
    additions?: Record<string, string>,
    filter?: Set<string>,
  ) => { next: Record<string, string>; changed: boolean }

  // Scene duplication helpers (owned by sceneStore)
  duplicateNodeTree: (root: SceneNode, context: DuplicateContext) => SceneNode

  // Component manager
  syncNode: (node: SceneNode) => void

  // Snapshot
  commitSceneSnapshot: (store: any, options?: any) => void

  // Prefab asset dependency collector
  collectPrefabAssetReferences: (root: SceneNode | null | undefined) => string[]
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
  const identity = new Matrix4()
  const rootWorld = deps.computeWorldMatrixForNode(sceneNodes, root.id) ?? identity
  const rootDet = rootWorld.determinant()
  const rootInverse = Number.isFinite(rootDet) && Math.abs(rootDet) > 1e-12 ? rootWorld.clone().invert() : identity

  const rewrite = (node: SceneNode, parentRelativeWorld: Matrix4, parentSceneWorld: Matrix4) => {
    const sceneWorld =
      deps.computeWorldMatrixForNode(sceneNodes, node.id) ??
      new Matrix4().multiplyMatrices(parentSceneWorld, deps.composeNodeMatrix(node))
    const relativeWorld = new Matrix4().multiplyMatrices(rootInverse, sceneWorld)
    const parentInverse = parentRelativeWorld.clone().invert()
    const localMatrix = new Matrix4().multiplyMatrices(parentInverse, relativeWorld)

    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    localMatrix.decompose(position, quaternion, scale)

    const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
    const nextPosition = sanitizeFiniteVector3Like({ x: position.x, y: position.y, z: position.z }, { x: 0, y: 0, z: 0 })
    const nextRotation = sanitizeFiniteVector3Like({ x: euler.x, y: euler.y, z: euler.z }, { x: 0, y: 0, z: 0 })
    const nextScale = sanitizeFiniteVector3Like({ x: scale.x, y: scale.y, z: scale.z }, { x: 1, y: 1, z: 1 })

    node.position = deps.createVector(nextPosition.x, nextPosition.y, nextPosition.z)
    node.rotation = deps.createVector(nextRotation.x, nextRotation.y, nextRotation.z)
    node.scale = deps.createVector(nextScale.x, nextScale.y, nextScale.z)

    if (node.children?.length) {
      node.children.forEach((child) => rewrite(child, relativeWorld, sceneWorld))
    }
  }

  rewrite(root, identity, identity)
  return root
}

function ensurePrefabGroupRoot(deps: PrefabActionsDeps, node: SceneNode): SceneNode {
  if (node.nodeType === 'Group') {
    const cloned = deps.cloneNode(node)
    ;(cloned as any).groupExpanded = false
    return cloned
  }
  const wrapper: SceneNode = {
    id: deps.generateUuid(),
    name: node.name?.trim().length ? `${node.name} Group` : 'Group Root',
    nodeType: 'Group',
    position: deps.createVector(0, 0, 0),
    rotation: deps.createVector(0, 0, 0),
    scale: deps.createVector(1, 1, 1),
    visible: node.visible ?? true,
    locked: false,
    groupExpanded: false,
    children: [deps.cloneNode(node)],
  }
  return wrapper
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
  const formatVersion = Number.isFinite(candidate.formatVersion) ? Number(candidate.formatVersion) : deps.NODE_PREFAB_FORMAT_VERSION
  if (formatVersion !== deps.NODE_PREFAB_FORMAT_VERSION) {
    throw new Error(`不支持的节点预制件版本: ${candidate.formatVersion}`)
  }
  if (!candidate.root || typeof candidate.root !== 'object') {
    throw new Error('节点预制件缺少有效的节点数据')
  }
  const normalizedName = normalizePrefabName(typeof candidate.name === 'string' ? candidate.name : '') || 'Unnamed Prefab'
  const root = prepareNodePrefabRoot(deps, candidate.root as SceneNode, { regenerateIds: false })
  const assetIndex = candidate.assetIndex && deps.isAssetIndex(candidate.assetIndex)
    ? deps.cloneAssetIndex(candidate.assetIndex as Record<string, AssetIndexEntry>)
    : undefined
  const packageAssetMap = candidate.packageAssetMap && deps.isPackageAssetMap(candidate.packageAssetMap)
    ? deps.clonePackageAssetMap(candidate.packageAssetMap as Record<string, string>)
    : undefined
  const prefab: NodePrefabData = {
    formatVersion: deps.NODE_PREFAB_FORMAT_VERSION,
    name: normalizedName,
    root,
  }
  if (assetIndex && Object.keys(assetIndex).length) {
    prefab.assetIndex = assetIndex
  }
  if (packageAssetMap && Object.keys(packageAssetMap).length) {
    prefab.packageAssetMap = packageAssetMap
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
    assetIndex: Record<string, AssetIndexEntry>
    packageAssetMap: Record<string, string>
    sceneNodes: SceneNode[]
  },
): SerializedPrefabPayload {
  const prefabRoot = ensurePrefabGroupRoot(deps, node)
  const prefabData = createNodePrefabData(deps, prefabRoot, context.name ?? node.name ?? '')
  bakePrefabSubtreeTransforms(deps, prefabData.root, context.sceneNodes)
  const dependencyAssetIds = deps.collectPrefabAssetReferences(prefabData.root)
  if (dependencyAssetIds.length) {
    const assetIndexSubset = deps.buildAssetIndexSubsetForPrefab(context.assetIndex, dependencyAssetIds)
    if (assetIndexSubset) {
      prefabData.assetIndex = assetIndexSubset
    } else {
      delete (prefabData as any).assetIndex
    }
    const packageAssetMapSubset = deps.buildPackageAssetMapSubsetForPrefab(context.packageAssetMap, dependencyAssetIds)
    if (packageAssetMapSubset) {
      prefabData.packageAssetMap = packageAssetMapSubset
    } else {
      delete (prefabData as any).packageAssetMap
    }
  } else {
    delete (prefabData as any).assetIndex
    delete (prefabData as any).packageAssetMap
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
        assetIndex: Record<string, AssetIndexEntry>
        packageAssetMap: Record<string, string>
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
          extension: extractExtension(fileName) ?? existing.extension ?? null,
        }
        const categoryId = determineAssetCategoryId(updated)
        const sourceMeta = store.assetIndex[targetAssetId]?.source
        return store.registerAsset(updated, {
          categoryId,
          source: sourceMeta,
          commitOptions: { updateNodes: false },
        })
      }

      const projectAsset: ProjectAsset = {
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
      const categoryId = determineAssetCategoryId(projectAsset)
      const registered = store.registerAsset(projectAsset, {
        categoryId,
        source: { type: 'local' },
        commitOptions: { updateNodes: false },
      })
      if (options.select !== false) {
        store.setActiveDirectory(categoryId)
        store.selectAsset(registered.id)
      }
      return registered
    },

    async saveNodePrefab(
      store: PrefabStoreLike,
      nodeId: string,
      options: { assetId?: string; name?: string } = {},
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
        assetIndex: store.assetIndex,
        packageAssetMap: store.packageAssetMap,
        sceneNodes: store.nodes,
      })

      const registered = await this.registerPrefabAssetFromData(store, payload.prefab, payload.serialized, {
        assetId: options.assetId,
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
        entry = await assetCache.loadFromIndexedDb(assetId)
      }
      if ((!entry || !entry.blob) && asset.downloadUrl && /^https?:\/\//i.test(asset.downloadUrl)) {
        await assetCache.downloaProjectAsset(asset)
        entry = assetCache.getEntry(assetId)
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载节点预制件数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      return parseNodePrefab(deps, text)
    },

    async ensurePrefabDependencies(
      store: PrefabStoreLike,
      assetIds: string[],
      options: {
        providerId?: string | null
        prefabAssetIdForDownloadProgress?: string | null
        prefabAssetIndex?: Record<string, AssetIndexEntry> | null
        prefabPackageAssetMap?: Record<string, string> | null
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

      const assetCache = useAssetCacheStore()
      const missingIds = normalizedIds.filter((assetId) => !store.getAsset(assetId))

      if (providerId) {
        const providerDirectories = store.packageDirectoryCache[providerId]
        if (providerDirectories?.length) {
          const providerAssets: ProjectAsset[] = []
          normalizedIds.forEach((assetId) => {
            const providerAsset = deps.findAssetInTree(providerDirectories, assetId)
            if (!providerAsset) {
              return
            }
            const existing = store.getAsset(assetId)
            if (!existing || deps.isPrefabDependencyPlaceholderAsset(existing)) {
              providerAssets.push(providerAsset)
            }
          })
          if (providerAssets.length) {
            store.copyPackageAssetsToAssets(providerId, providerAssets)
          }
        } else if (missingIds.length) {
          console.warn(`Provider ${providerId} is not loaded; prefab dependencies may be unavailable.`)
        }
      }

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
              await assetCache.downloaProjectAsset(asset)
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
      const dependencyAssetIds = options.dependencyAssetIds ?? deps.collectPrefabAssetReferences(prefab.root)
      const dependencyFilter = dependencyAssetIds.length ? new Set(dependencyAssetIds) : undefined
      const providerId = options.providerId ?? null
      const prefabAssetIndex = prefab.assetIndex && deps.isAssetIndex(prefab.assetIndex) ? prefab.assetIndex : undefined
      const prefabPackageAssetMap = prefab.packageAssetMap && deps.isPackageAssetMap(prefab.packageAssetMap)
        ? prefab.packageAssetMap
        : undefined
      if (prefabAssetIndex || prefabPackageAssetMap) {
        const { next: mergedIndex, changed: assetIndexChanged } = deps.mergeAssetIndexEntries(
          store.assetIndex,
          prefabAssetIndex,
          dependencyFilter,
        )
        if (assetIndexChanged) {
          store.assetIndex = mergedIndex
        }
        const { next: mergedPackageMap, changed: packageMapChanged } = deps.mergePackageAssetMapEntries(
          store.packageAssetMap,
          prefabPackageAssetMap,
          dependencyFilter,
        )
        if (packageMapChanged) {
          store.packageAssetMap = mergedPackageMap
        }
      }

      if (dependencyAssetIds.length) {
        await this.ensurePrefabDependencies(store, dependencyAssetIds, {
          providerId,
          prefabAssetIdForDownloadProgress: options.prefabAssetIdForDownloadProgress ?? null,
          prefabAssetIndex: prefabAssetIndex ?? null,
          prefabPackageAssetMap: prefabPackageAssetMap ?? null,
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

      const prefab = await this.loadNodePrefab(store, assetId)
      const sourceMeta = store.assetIndex[assetId]?.source ?? null
      const dependencyProviderId = sourceMeta && sourceMeta.type === 'package' ? (sourceMeta as any).providerId ?? null : null
      const duplicate = await this.instantiatePrefabData(store, prefab, {
        sourceAssetId: assetId,
        position: position ?? null,
        providerId: dependencyProviderId,
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
      if (parentId === deps.SKY_NODE_ID || parentId === deps.ENVIRONMENT_NODE_ID) {
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
          nextNodes = [...store.nodes, duplicate]
        }
      } else {
        nextNodes = [...store.nodes, duplicate]
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
      deps.commitSceneSnapshot(store)
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
      if (parentId === deps.SKY_NODE_ID || parentId === deps.ENVIRONMENT_NODE_ID) {
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
        categoryId: determineAssetCategoryId(projectAsset),
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
        entry = await assetCache.loadFromIndexedDb(assetId)
      }
      if ((!entry || !entry.blob) && asset.downloadUrl && /^https?:\/\//i.test(asset.downloadUrl)) {
        await assetCache.downloaProjectAsset(asset)
        entry = assetCache.getEntry(assetId)
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
