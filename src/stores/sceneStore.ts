import { watch, type WatchStopHandle } from 'vue'
import { defineStore } from 'pinia'
import { type Object3D } from 'three'
import type { LightNodeProperties, LightNodeType, SceneNode, Vector3Like } from '@/types/scene'
import type { ClipboardEntry } from '@/types/clipboard-entry'
import type { DetachResult } from '@/types/detach-result'
import type { DuplicateContext } from '@/types/duplicate-context'
import type { EditorTool } from '@/types/editor-tool'
import type { EnsureSceneAssetsOptions } from '@/types/ensure-scene-assets-options'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
import type { PanelVisibilityState } from '@/types/panel-visibility-state'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { AssetIndexEntry, AssetSourceMetadata } from '@/types/asset-index-entry'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type { SceneHistoryEntry } from '@/types/scene-history-entry'
import type { SceneState } from '@/types/scene-state'
import type { SceneSummary } from '@/types/scene-summary'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import { useAssetCacheStore } from './assetCacheStore'
import { useUiStore } from './uiStore'
import { loadObjectFromFile } from '@/plugins/assetImport'

import groundModelUrl from '@/preset/models/ground.glb?url'
import {
  cloneAssetList,
  cloneProjectTree,
  createEmptyAssetCatalog,
  createProjectTreeFromCache,
  defaultDirectoryId,
  determineAssetCategoryId,
  ASSETS_ROOT_DIRECTORY_ID,
  PACKAGES_ROOT_DIRECTORY_ID,
} from './assetCatalog'

export { ASSETS_ROOT_DIRECTORY_ID, buildPackageDirectoryId, extractProviderIdFromPackageDirectoryId } from './assetCatalog'

export type EditorPanel = 'hierarchy' | 'inspector' | 'project'

export type HierarchyDropPosition = 'before' | 'after' | 'inside'

const HISTORY_LIMIT = 50

const DEFAULT_GROUND_SIZE = 100

function createVector(x: number, y: number, z: number): Vector3Like {
  return { x, y, z }
}

type LightNodeExtras = Partial<Omit<LightNodeProperties, 'type' | 'color' | 'intensity' | 'target'>>

const groundAsset: ProjectAsset = {
  id: 'preset:models/ground.glb',
  name: 'Ground Plane',
  type: 'model',
  downloadUrl: groundModelUrl,
  previewColor: '#8d6e63',
  thumbnail: null,
  description: 'Preset/Models/Ground',
  gleaned: false,
}

const groundAssetCategoryId = determineAssetCategoryId(groundAsset)
const groundAssetSource: AssetSourceMetadata = {
  type: 'package',
  providerId: 'preset',
  originalAssetId: groundAsset.id,
}

const initialAssetCatalog = createEmptyAssetCatalog()
initialAssetCatalog[groundAssetCategoryId] = [groundAsset]

const initialAssetIndex: Record<string, AssetIndexEntry> = {
  [groundAsset.id]: {
    categoryId: groundAssetCategoryId,
    source: groundAssetSource,
  },
}

function createLightNode(options: {
  name: string
  type: LightNodeType
  color: string
  intensity: number
  position: Vector3Like
  rotation?: Vector3Like
  target?: Vector3Like
  extras?: LightNodeExtras
}): SceneNode {
  const light: LightNodeProperties = {
    type: options.type,
    color: options.color,
    intensity: options.intensity,
    ...(options.extras ?? {}),
  }

  if (options.target) {
    light.target = createVector(options.target.x, options.target.y, options.target.z)
  }

  return {
    id: crypto.randomUUID(),
    name: options.name,
    nodeType: 'light',
    light,
    position: createVector(options.position.x, options.position.y, options.position.z),
    rotation: options.rotation
      ? createVector(options.rotation.x, options.rotation.y, options.rotation.z)
      : createVector(0, 0, 0),
    scale: createVector(1, 1, 1),
    visible: true,
  }
}

function getLightPreset(type: LightNodeType) {
  switch (type) {
    case 'directional':
      return {
        name: 'Directional Light',
        color: '#ffffff',
        intensity: 1.2,
        position: createVector(20, 40, 20),
        target: createVector(0, 0, 0),
        extras: { castShadow: true } as LightNodeExtras,
      }
    case 'point':
      return {
        name: 'Point Light',
        color: '#ffffff',
        intensity: 1,
        position: createVector(0, 8, 0),
        extras: { distance: 60, decay: 2, castShadow: false } as LightNodeExtras,
      }
    case 'spot':
      return {
        name: 'Spot Light',
        color: '#ffffff',
        intensity: 1,
        position: createVector(12, 18, 12),
        target: createVector(0, 0, 0),
        extras: { angle: Math.PI / 5, penumbra: 0.35, distance: 80, decay: 2, castShadow: true } as LightNodeExtras,
      }
    case 'ambient':
    default:
      return {
        name: 'Ambient Light',
        color: '#ffffff',
        intensity: 0.35,
        position: createVector(0, 25, 0),
        extras: {} as LightNodeExtras,
      }
  }
}

const initialNodes: SceneNode[] = [
  {
    id: crypto.randomUUID(),
    name: 'Ground',
    nodeType: 'mesh',
    material: {
      color: '#707070',
      wireframe: false,
      opacity: 1,
    },
    position: createVector(0, 0, 0),
    rotation: createVector(0, 0, 0),
    scale: createVector(DEFAULT_GROUND_SIZE, 1, DEFAULT_GROUND_SIZE),
    visible: true,
    locked: true,
    sourceAssetId: groundAsset.id,
  },
  createLightNode({
    name: 'Directional Light',
    type: 'directional',
    color: '#ffffff',
    intensity: 1.2,
    position: createVector(30, 40, 20),
    target: createVector(0, 0, 0),
    extras: {
      castShadow: true,
    },
  }),
]

const placeholderDownloadWatchers = new Map<string, WatchStopHandle>()

function stopPlaceholderWatcher(nodeId: string) {
  const stop = placeholderDownloadWatchers.get(nodeId)
  if (stop) {
    stop()
    placeholderDownloadWatchers.delete(nodeId)
  }
}

const defaultCameraState: SceneCameraState = {
  position: createVector(30, 20, 30),
  target: createVector(0, 5, 0),
  fov: 60,
}

const defaultPanelVisibility: PanelVisibilityState = {
  hierarchy: true,
  inspector: true,
  project: true,
}

const initialSceneDocument = createSceneDocument('Sample Scene', {
  nodes: initialNodes,
  selectedNodeId: initialNodes[0]?.id ?? null,
  resourceProviderId: 'builtin',
  assetCatalog: initialAssetCatalog,
  assetIndex: initialAssetIndex,
})

const runtimeObjectRegistry = new Map<string, Object3D>()

function registerRuntimeObject(id: string, object: Object3D) {
  runtimeObjectRegistry.set(id, object)
}

function unregisterRuntimeObject(id: string) {
  runtimeObjectRegistry.delete(id)
}

export function getRuntimeObject(id: string): Object3D | null {
  return runtimeObjectRegistry.get(id) ?? null
}

function tagObjectWithNodeId(object: Object3D, nodeId: string) {
  object.userData = {
    ...(object.userData ?? {}),
    nodeId,
  }
  object.traverse((child) => {
    child.userData = {
      ...(child.userData ?? {}),
      nodeId,
    }
  })
}

function collectNodesByAssetId(nodes: SceneNode[]): Map<string, SceneNode[]> {
  const map = new Map<string, SceneNode[]>()

  const traverse = (list: SceneNode[]) => {
    list.forEach((node) => {
      if (node.sourceAssetId) {
        if (!map.has(node.sourceAssetId)) {
          map.set(node.sourceAssetId, [])
        }
        map.get(node.sourceAssetId)!.push(node)
      }
      if (node.children?.length) {
        traverse(node.children)
      }
    })
  }

  traverse(nodes)
  return map
}

function buildParentMap(
  nodes: SceneNode[],
  parentId: string | null = null,
  map: Map<string, string | null> = new Map(),
): Map<string, string | null> {
  nodes.forEach((node) => {
    map.set(node.id, parentId)
    if (node.children?.length) {
      buildParentMap(node.children, node.id, map)
    }
  })
  return map
}

function filterTopLevelNodeIds(ids: string[], parentMap: Map<string, string | null>): string[] {
  const idSet = new Set(ids)
  return ids.filter((id) => {
    let parent = parentMap.get(id) ?? null
    while (parent) {
      if (idSet.has(parent)) {
        return false
      }
      parent = parentMap.get(parent) ?? null
    }
    return true
  })
}

function collectRuntimeSnapshots(node: SceneNode, bucket: Map<string, Object3D>) {
  const runtime = getRuntimeObject(node.id)
  if (runtime) {
    bucket.set(node.id, runtime.clone(true))
  }
  node.children?.forEach((child) => collectRuntimeSnapshots(child, bucket))
}

function collectClipboardPayload(nodes: SceneNode[], ids: string[]): { entries: ClipboardEntry[]; runtimeSnapshots: Map<string, Object3D> } {
  const runtimeSnapshots = new Map<string, Object3D>()
  if (!ids.length) {
    return { entries: [], runtimeSnapshots }
  }
  const uniqueIds = Array.from(new Set(ids))
  const parentMap = buildParentMap(nodes)
  const topLevelIds = filterTopLevelNodeIds(uniqueIds, parentMap)
  const entries: ClipboardEntry[] = []
  topLevelIds.forEach((id) => {
    const found = findNodeById(nodes, id)
    if (found) {
      entries.push({ sourceId: id, node: cloneNode(found) })
      collectRuntimeSnapshots(found, runtimeSnapshots)
    }
  })
  return { entries, runtimeSnapshots }
}

function duplicateNodeTree(original: SceneNode, context: DuplicateContext): SceneNode {
  const duplicated = cloneNode(original)
  duplicated.id = crypto.randomUUID()

  if (original.children?.length) {
    duplicated.children = original.children.map((child) => duplicateNodeTree(child, context))
  } else {
    delete duplicated.children
  }

  if (duplicated.sourceAssetId) {
    context.assetCache.registerUsage(duplicated.sourceAssetId)
  }

  const runtimeObject = getRuntimeObject(original.id) ?? context.runtimeSnapshots.get(original.id) ?? null
  if (runtimeObject) {
    const clonedObject = runtimeObject.clone(true)
    tagObjectWithNodeId(clonedObject, duplicated.id)
    registerRuntimeObject(duplicated.id, clonedObject)
  }

  return duplicated
}

function cloneVector(vector: Vector3Like): Vector3Like {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function computeAssetSpawnTransform(asset: ProjectAsset, position?: Vector3Like) {
  const spawnPosition = position ? cloneVector(position) : { x: 0, y: 0, z: 0 }
  const rotation: Vector3Like = { x: 0, y: 0, z: 0 }
  const scale: Vector3Like = { x: 1, y: 1, z: 1 }

  if (!position && asset.type !== 'model') {
    spawnPosition.y = 1
  }

  if (asset.type === 'model') {
    const baseHeight = Math.max(scale.y, 0)
    const offset = baseHeight / 2
    spawnPosition.y = (position?.y ?? spawnPosition.y) + offset
  }

  return {
    position: spawnPosition,
    rotation,
    scale,
  }
}

function cloneCameraState(camera: SceneCameraState): SceneCameraState {
  return {
    position: cloneVector(camera.position),
    target: cloneVector(camera.target),
    fov: camera.fov,
  }
}

function visitNode(nodes: SceneNode[], id: string, mutate: (node: SceneNode) => void): boolean {
  for (const node of nodes) {
    if (node.id === id) {
      mutate(node)
      return true
    }
    if (node.children && visitNode(node.children, id, mutate)) {
      return true
    }
  }
  return false
}

function toHierarchyItem(node: SceneNode): HierarchyTreeItem {
  return {
    id: node.id,
    name: node.name,
    visible: node.visible ?? true,
    locked: node.locked ?? false,
    nodeType: node.nodeType,
    lightType: node.light?.type,
    children: node.children?.map(toHierarchyItem),
  }
}

function cloneNode(node: SceneNode): SceneNode {
  return {
    ...node,
    material: node.material
      ? {
          color: node.material.color,
          wireframe: node.material.wireframe,
          opacity: node.material.opacity,
        }
      : undefined,
    light: node.light
      ? {
          ...node.light,
          target: node.light.target ? cloneVector(node.light.target) : undefined,
        }
      : undefined,
    position: cloneVector(node.position),
    rotation: cloneVector(node.rotation),
    scale: cloneVector(node.scale),
    children: node.children ? node.children.map(cloneNode) : undefined,
  }
}

function cloneSceneNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.map(cloneNode)
}

function vectorsEqual(a: Vector3Like, b: Vector3Like): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

function cloneAssetCatalog(catalog: Record<string, ProjectAsset[]>): Record<string, ProjectAsset[]> {
  const clone: Record<string, ProjectAsset[]> = {}
  Object.entries(catalog).forEach(([categoryId, list]) => {
    clone[categoryId] = cloneAssetList(list ?? [])
  })
  return clone
}

function cloneAssetIndex(index: Record<string, AssetIndexEntry>): Record<string, AssetIndexEntry> {
  const clone: Record<string, AssetIndexEntry> = {}
  Object.entries(index).forEach(([assetId, entry]) => {
    clone[assetId] = {
      categoryId: entry.categoryId,
      source: entry.source ? { ...entry.source } : undefined,
    }
  })
  return clone
}

function clonePackageAssetMap(map: Record<string, string>): Record<string, string> {
  return { ...map }
}

function applySceneAssetState(store: SceneState, scene: StoredSceneDocument) {
  store.assetCatalog = cloneAssetCatalog(scene.assetCatalog)
  store.assetIndex = cloneAssetIndex(scene.assetIndex)
  store.packageAssetMap = clonePackageAssetMap(scene.packageAssetMap)
  const nextTree = createProjectTreeFromCache(store.assetCatalog, store.packageDirectoryCache)
  store.projectTree = nextTree
  if (store.activeDirectoryId && !findDirectory(nextTree, store.activeDirectoryId)) {
    store.activeDirectoryId = defaultDirectoryId
  }
  if (store.selectedAssetId && !findAssetInTree(nextTree, store.selectedAssetId)) {
    store.selectedAssetId = null
  }
}

function collectSceneRuntimeSnapshots(nodes: SceneNode[]): Map<string, Object3D> {
  const runtimeSnapshots = new Map<string, Object3D>()
  nodes.forEach((node) => collectRuntimeSnapshots(node, runtimeSnapshots))
  return runtimeSnapshots
}

function createHistorySnapshot(store: SceneState): SceneHistoryEntry {
  return {
    nodes: cloneSceneNodes(store.nodes),
    selectedNodeIds: cloneSelection(store.selectedNodeIds),
    selectedNodeId: store.selectedNodeId,
    camera: cloneCameraState(store.camera),
    resourceProviderId: store.resourceProviderId,
    runtimeSnapshots: collectSceneRuntimeSnapshots(store.nodes),
  }
}

function collectNodeIds(node: SceneNode, buffer: string[]) {
  buffer.push(node.id)
  node.children?.forEach((child) => collectNodeIds(child, buffer))
}

function flattenNodeIds(nodes: SceneNode[]): string[] {
  const buffer: string[] = []
  nodes.forEach((node) => collectNodeIds(node, buffer))
  return buffer
}

function normalizeSelectionIds(nodes: SceneNode[], ids?: string[] | null): string[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    return []
  }
  const validIds = new Set(flattenNodeIds(nodes))
  const seen = new Set<string>()
  const normalized: string[] = []
  ids.forEach((id) => {
    if (!validIds.has(id) || seen.has(id)) {
      return
    }
    normalized.push(id)
    seen.add(id)
  })
  return normalized
}

function cloneSelection(ids: string[] | undefined | null): string[] {
  if (!Array.isArray(ids) || !ids.length) {
    return []
  }
  return [...ids]
}

function areSelectionsEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

type ScenePersistedState = Partial<SceneState>

function ensureActiveTool(state: ScenePersistedState): ScenePersistedState {
  return {
    ...state,
    activeTool: (state.activeTool as EditorTool | undefined) ?? 'select',
  }
}

function ensureCameraAndPanelState(state: ScenePersistedState): ScenePersistedState {
  const cameraState = state.camera as Partial<SceneCameraState> | undefined
  const panelState = state.panelVisibility as Partial<PanelVisibilityState> | undefined

  return {
    ...state,
    camera: {
      position: cloneVector(cameraState?.position ?? defaultCameraState.position),
      target: cloneVector(cameraState?.target ?? defaultCameraState.target),
      fov: cameraState?.fov ?? defaultCameraState.fov,
    },
    panelVisibility: {
      hierarchy: panelState?.hierarchy ?? defaultPanelVisibility.hierarchy,
      inspector: panelState?.inspector ?? defaultPanelVisibility.inspector,
      project: panelState?.project ?? defaultPanelVisibility.project,
    },
  }
}

function removeLegacyExternalNodes(state: ScenePersistedState): ScenePersistedState {
  const rawNodes = state.nodes as SceneNode[] | undefined
  return {
    ...state,
    nodes: Array.isArray(rawNodes)
      ? rawNodes.filter((node) => (node as SceneNode).nodeType !== 'mesh')
      : rawNodes,
  }
}

function ensureSceneCollection(state: ScenePersistedState): ScenePersistedState {
  const existingScenes = state.scenes as StoredSceneDocument[] | undefined
  if (Array.isArray(existingScenes) && existingScenes.length > 0) {
    return state
  }

  const rawNodes = (state.nodes as SceneNode[] | undefined) ?? []
  const selectedNodeId = (state.selectedNodeId as string | null | undefined) ?? null
  const cameraState = state.camera as Partial<SceneCameraState> | undefined
  const rawCatalog = (state.assetCatalog as Record<string, ProjectAsset[]> | undefined) ?? null
  const rawIndex = (state.assetIndex as Record<string, AssetIndexEntry> | undefined) ?? null
  const rawPackageMap = (state.packageAssetMap as Record<string, string> | undefined) ?? null

  const camera: SceneCameraState = {
    position: cloneVector(cameraState?.position ?? defaultCameraState.position),
    target: cloneVector(cameraState?.target ?? defaultCameraState.target),
    fov: cameraState?.fov ?? defaultCameraState.fov,
  }

  const recoveredScene = createSceneDocument('Recovered Scene', {
    nodes: rawNodes,
    selectedNodeId,
    camera,
    resourceProviderId: (state.resourceProviderId as string | undefined) ?? 'builtin',
    assetCatalog: rawCatalog ?? undefined,
    assetIndex: rawIndex ?? undefined,
    packageAssetMap: rawPackageMap ?? undefined,
  })

  return {
    ...state,
    scenes: [recoveredScene],
    currentSceneId: recoveredScene.id,
    nodes: cloneSceneNodes(recoveredScene.nodes),
    selectedNodeId: recoveredScene.selectedNodeId,
    selectedNodeIds: cloneSelection(recoveredScene.selectedNodeIds),
    camera: cloneCameraState(recoveredScene.camera),
    assetCatalog: cloneAssetCatalog(recoveredScene.assetCatalog),
    assetIndex: cloneAssetIndex(recoveredScene.assetIndex),
    packageAssetMap: clonePackageAssetMap(recoveredScene.packageAssetMap),
  }
}

function ensureResourceProvider(state: ScenePersistedState): ScenePersistedState {
  const scenes = state.scenes as StoredSceneDocument[] | undefined
  const updatedScenes = Array.isArray(scenes)
    ? scenes.map((scene) => ({
        ...scene,
        resourceProviderId: scene.resourceProviderId ?? 'builtin',
      }))
    : scenes

  return {
    ...state,
    scenes: updatedScenes,
    resourceProviderId: (state.resourceProviderId as string | undefined) ?? 'builtin',
  }
}

function ensureSceneTimestamps(state: ScenePersistedState): ScenePersistedState {
  const scenes = state.scenes as Partial<StoredSceneDocument>[] | undefined
  if (!Array.isArray(scenes)) {
    return state
  }

  const now = new Date().toISOString()
  const upgradedScenes = scenes.map((scene) => {
    const createdAt = scene.createdAt ?? now
    const updatedAt = scene.updatedAt ?? scene.createdAt ?? createdAt ?? now
    return {
      ...scene,
      createdAt,
      updatedAt,
    } as StoredSceneDocument
  })

  return {
    ...state,
    scenes: upgradedScenes,
  }
}

function normalizeSceneSelections(state: ScenePersistedState): ScenePersistedState {
  const scenes = state.scenes as Partial<StoredSceneDocument>[] | undefined
  const updatedScenes = Array.isArray(scenes)
    ? scenes.map((scene) => {
        const nodes = Array.isArray(scene.nodes) ? (scene.nodes as SceneNode[]) : []
        const existingSelection = Array.isArray(scene.selectedNodeIds) ? scene.selectedNodeIds : undefined
        const fallbackId = scene.selectedNodeId ?? null
        const normalizedSelection = normalizeSelectionIds(
          nodes,
          existingSelection ?? (fallbackId ? [fallbackId] : []),
        )
        return {
          ...scene,
          selectedNodeIds: normalizedSelection,
          selectedNodeId: normalizedSelection[normalizedSelection.length - 1] ?? (fallbackId ?? null),
        } as StoredSceneDocument
      })
    : scenes

  const nodes = Array.isArray(state.nodes) ? (state.nodes as SceneNode[]) : []
  const stateSelection = normalizeSelectionIds(nodes, state.selectedNodeIds as string[] | undefined)
  const fallbackId = (state.selectedNodeId as string | null | undefined) ?? null
  const normalizedStateSelection = stateSelection.length
    ? stateSelection
    : fallbackId
      ? [fallbackId]
      : []

  return {
    ...state,
    scenes: updatedScenes as StoredSceneDocument[] | undefined,
    selectedNodeIds: normalizedStateSelection,
    selectedNodeId: normalizedStateSelection[normalizedStateSelection.length - 1] ?? null,
  }
}

function ensureAssetCatalogState(state: ScenePersistedState): ScenePersistedState {
  const rawCatalog = (state as { assetCatalog?: unknown }).assetCatalog
  const rawIndex = (state as { assetIndex?: unknown }).assetIndex
  const rawPackageAssetMap = (state as { packageAssetMap?: unknown }).packageAssetMap

  const normalizedCatalogBase = createEmptyAssetCatalog()
  const normalizedCatalogEntries: Record<string, ProjectAsset[]> = { ...normalizedCatalogBase }
  if (rawCatalog && typeof rawCatalog === 'object') {
    const source = rawCatalog as Record<string, ProjectAsset[] | undefined>
    Object.keys(normalizedCatalogEntries).forEach((categoryId) => {
      const list = source[categoryId]
      normalizedCatalogEntries[categoryId] = Array.isArray(list) ? cloneAssetList(list) : []
    })
    Object.keys(source).forEach((categoryId) => {
      if (!(categoryId in normalizedCatalogEntries)) {
        const list = source[categoryId]
        if (Array.isArray(list)) {
          normalizedCatalogEntries[categoryId] = cloneAssetList(list)
        }
      }
    })
  }

  const normalizedIndex = rawIndex && typeof rawIndex === 'object'
    ? { ...(rawIndex as Record<string, AssetIndexEntry>) }
    : {}

  const normalizedPackageAssetMap = rawPackageAssetMap && typeof rawPackageAssetMap === 'object'
    ? { ...(rawPackageAssetMap as Record<string, string>) }
    : {}

  return {
    ...state,
    assetCatalog: normalizedCatalogEntries,
    assetIndex: normalizedIndex,
    packageAssetMap: normalizedPackageAssetMap,
  }
}

function ensurePackageDirectoryState(state: ScenePersistedState): ScenePersistedState {
  const rawCache = (state as { packageDirectoryCache?: unknown }).packageDirectoryCache
  const rawLoaded = (state as { packageDirectoryLoaded?: unknown }).packageDirectoryLoaded
  const normalizedCache: Record<string, ProjectDirectory[]> = rawCache && typeof rawCache === 'object'
    ? { ...(rawCache as Record<string, ProjectDirectory[]>) }
    : {}
  const normalizedLoaded: Record<string, boolean> = rawLoaded && typeof rawLoaded === 'object'
    ? { ...(rawLoaded as Record<string, boolean>) }
    : {}
  return {
    ...state,
    packageDirectoryCache: normalizedCache,
    packageDirectoryLoaded: normalizedLoaded,
  }
}

const sceneStoreMigrationSteps: Array<(state: ScenePersistedState) => ScenePersistedState> = [
  ensureActiveTool,
  ensureCameraAndPanelState,
  removeLegacyExternalNodes,
  ensureSceneCollection,
  ensureResourceProvider,
  ensureSceneTimestamps,
  normalizeSceneSelections,
  ensureAssetCatalogState,
  ensurePackageDirectoryState,
]

function migrateScenePersistedState(
  state: ScenePersistedState,
  _fromVersion: number,
  _toVersion: number,
): ScenePersistedState {
  if (!state || typeof state !== 'object') {
    return state
  }

  return sceneStoreMigrationSteps.reduce<ScenePersistedState>((current, step) => step(current), {
    ...state,
  })
}

function createSceneDocument(
  name: string,
  options: {
    id?: string
    nodes?: SceneNode[]
    selectedNodeId?: string | null
    selectedNodeIds?: string[]
    camera?: SceneCameraState
    thumbnail?: string | null
    resourceProviderId?: string
    createdAt?: string
    updatedAt?: string
    assetCatalog?: Record<string, ProjectAsset[]>
    assetIndex?: Record<string, AssetIndexEntry>
    packageAssetMap?: Record<string, string>
  } = {},
): StoredSceneDocument {
  const id = options.id ?? crypto.randomUUID()
  const nodes = options.nodes ? cloneSceneNodes(options.nodes) : []
  const camera = options.camera ? cloneCameraState(options.camera) : cloneCameraState(defaultCameraState)
  let selectedNodeId = options.selectedNodeId ?? (nodes[0]?.id ?? null)
  if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = nodes[0]?.id ?? null
  }
  const selectedNodeIds = normalizeSelectionIds(nodes, options.selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []))
  const now = new Date().toISOString()
  const createdAt = options.createdAt ?? now
  const updatedAt = options.updatedAt ?? createdAt
  const assetCatalog = options.assetCatalog ? cloneAssetCatalog(options.assetCatalog) : createEmptyAssetCatalog()
  const assetIndex = options.assetIndex ? cloneAssetIndex(options.assetIndex) : {}
  const packageAssetMap = options.packageAssetMap ? clonePackageAssetMap(options.packageAssetMap) : {}

  return {
    id,
    name,
    thumbnail: options.thumbnail ?? null,
    nodes,
    selectedNodeId,
    selectedNodeIds,
    camera,
    resourceProviderId: options.resourceProviderId ?? 'builtin',
    createdAt,
    updatedAt,
    assetCatalog,
    assetIndex,
    packageAssetMap,
  }
}

function commitSceneSnapshot(
  store: SceneState,
  options: { updateNodes?: boolean; updateCamera?: boolean } = {},
) {
  if (!store.currentSceneId) return
  const index = store.scenes.findIndex((scene) => scene.id === store.currentSceneId)
  if (index === -1) return

  const updateNodes = options.updateNodes ?? true
  const updateCamera = options.updateCamera ?? true
  const current = store.scenes[index]!
  const updatedAt = new Date().toISOString()

  const updatedScene: StoredSceneDocument = {
    ...current,
    nodes: updateNodes ? cloneSceneNodes(store.nodes) : current.nodes,
    selectedNodeId: store.selectedNodeId,
    selectedNodeIds: cloneSelection(store.selectedNodeIds),
    camera: updateCamera ? cloneCameraState(store.camera) : current.camera,
    resourceProviderId: store.resourceProviderId,
    updatedAt,
    assetCatalog: cloneAssetCatalog(store.assetCatalog),
    assetIndex: cloneAssetIndex(store.assetIndex),
    packageAssetMap: clonePackageAssetMap(store.packageAssetMap),
  }

  store.scenes = [
    ...store.scenes.slice(0, index),
    updatedScene,
    ...store.scenes.slice(index + 1),
  ]
}

function releaseRuntimeTree(node: SceneNode) {
  unregisterRuntimeObject(node.id)
  node.children?.forEach(releaseRuntimeTree)
}

function pruneNodes(nodes: SceneNode[], idSet: Set<string>, removed: string[]): SceneNode[] {
  const result: SceneNode[] = []
  for (const node of nodes) {
    if (idSet.has(node.id)) {
      removed.push(node.id)
      releaseRuntimeTree(node)
      continue
    }
    const cloned = cloneNode(node)
    if (cloned.children) {
      cloned.children = pruneNodes(cloned.children, idSet, removed)
      if (cloned.children.length === 0) {
        delete cloned.children
      }
    }
    result.push(cloned)
  }
  return result
}

function findDirectory(directories: ProjectDirectory[], id: string): ProjectDirectory | null {
  for (const dir of directories) {
    if (dir.id === id) return dir
    if (dir.children) {
      const found = findDirectory(dir.children, id)
      if (found) return found
    }
  }
  return null
}

function findDirectoryPathInTree(
  directories: ProjectDirectory[],
  targetId: string,
  trail: ProjectDirectory[] = [],
): ProjectDirectory[] | null {
  for (const directory of directories) {
    const nextTrail = [...trail, directory]
    if (directory.id === targetId) {
      return nextTrail
    }
    if (directory.children?.length) {
      const found = findDirectoryPathInTree(directory.children, targetId, nextTrail)
      if (found) {
        return found
      }
    }
  }
  return null
}

function collectDirectoryAssets(directory: ProjectDirectory | null, bucket: ProjectAsset[]) {
  if (!directory) {
    return
  }
  if (directory.assets?.length) {
    bucket.push(...directory.assets)
  }
  directory.children?.forEach((child) => collectDirectoryAssets(child, bucket))
}

function findAssetInTree(directories: ProjectDirectory[], assetId: string): ProjectAsset | null {
  for (const dir of directories) {
    if (dir.assets) {
      const asset = dir.assets.find((item) => item.id === assetId)
      if (asset) return asset
    }
    if (dir.children) {
      const found = findAssetInTree(dir.children, assetId)
      if (found) return found
    }
  }
  return null
}

function findNodeById(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const match = findNodeById(node.children, id)
      if (match) return match
    }
  }
  return null
}

function nodeContainsId(node: SceneNode, maybeChildId: string): boolean {
  if (!node.children) return false
  for (const child of node.children) {
    if (child.id === maybeChildId) return true
    if (nodeContainsId(child, maybeChildId)) return true
  }
  return false
}

function isDescendantNode(nodes: SceneNode[], ancestorId: string, childId: string): boolean {
  const ancestor = findNodeById(nodes, ancestorId)
  if (!ancestor) return false
  return nodeContainsId(ancestor, childId)
}

function detachNodeImmutable(nodes: SceneNode[], targetId: string): DetachResult {
  const nextTree: SceneNode[] = []
  let removed: SceneNode | null = null

  for (const node of nodes) {
    if (node.id === targetId) {
      removed = cloneNode(node)
      continue
    }

    const cloned = cloneNode(node)
    if (node.children) {
      const { tree: childTree, node: childRemoved } = detachNodeImmutable(node.children, targetId)
      if (childRemoved) {
        removed = childRemoved
      }
      if (childTree.length > 0) {
        cloned.children = childTree
      } else {
        delete cloned.children
      }
    }

    nextTree.push(cloned)
  }

  return { tree: nextTree, node: removed }
}

function insertNodeMutable(
  nodes: SceneNode[],
  targetId: string | null,
  node: SceneNode,
  position: HierarchyDropPosition,
): boolean {
  if (targetId === null) {
    if (position === 'before') {
      nodes.unshift(node)
    } else {
      nodes.push(node)
    }
    return true
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index]!
    if (current.id === targetId) {
      if (position === 'inside') {
        const children = current.children ? [...current.children, node] : [node]
        current.children = children
      } else if (position === 'before') {
        nodes.splice(index, 0, node)
      } else {
        nodes.splice(index + 1, 0, node)
      }
      return true
    }

    if (current.children) {
      const inserted = insertNodeMutable(current.children, targetId, node, position)
      if (inserted) {
        current.children = [...current.children]
        return true
      }
    }
  }

  return false
}


export const useSceneStore = defineStore('scene', {
  state: (): SceneState => {
    const assetCatalog = cloneAssetCatalog(initialSceneDocument.assetCatalog)
    const assetIndex = cloneAssetIndex(initialSceneDocument.assetIndex)
    const packageDirectoryCache: Record<string, ProjectDirectory[]> = {}
    return {
      scenes: [initialSceneDocument],
      currentSceneId: initialSceneDocument.id,
      nodes: cloneSceneNodes(initialSceneDocument.nodes),
      selectedNodeId: initialSceneDocument.selectedNodeId,
      selectedNodeIds: cloneSelection(initialSceneDocument.selectedNodeIds),
      activeTool: 'select',
  assetCatalog,
  assetIndex,
      packageAssetMap: {},
      packageDirectoryCache,
      packageDirectoryLoaded: {},
  projectTree: createProjectTreeFromCache(assetCatalog, packageDirectoryCache),
      activeDirectoryId: defaultDirectoryId,
      selectedAssetId: null,
      camera: cloneCameraState(initialSceneDocument.camera),
      panelVisibility: { ...defaultPanelVisibility },
      resourceProviderId: initialSceneDocument.resourceProviderId,
      cameraFocusNodeId: null,
      cameraFocusRequestId: 0,
      clipboard: null,
      draggingAssetObject: null,
      undoStack: [],
      redoStack: [],
      isRestoringHistory: false,
      activeTransformNodeId: null,
      transformSnapshotCaptured: false,
    }
  },
  getters: {
    currentScene(state): StoredSceneDocument | null {
      if (!state.scenes.length) {
        return null
      }
      if (state.currentSceneId) {
        const current = state.scenes.find((scene) => scene.id === state.currentSceneId)
        if (current) {
          return current
        }
      }
      return state.scenes[0] ?? null
    },
    selectedNode(state): SceneNode | null {
      if (!state.selectedNodeId) return null
      let result: SceneNode | null = null
      visitNode(state.nodes, state.selectedNodeId, (node) => {
        result = node
      })
      return result
    },
    hierarchyItems(state): HierarchyTreeItem[] {
      return state.nodes.map(toHierarchyItem)
    },
    sceneSummaries(state): SceneSummary[] {
      return [...state.scenes]
        .map((scene) => ({
          id: scene.id,
          name: scene.name,
          thumbnail: scene.thumbnail ?? null,
          createdAt: scene.createdAt,
          updatedAt: scene.updatedAt,
        }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    },
    currentDirectory(state): ProjectDirectory | null {
      if (!state.activeDirectoryId) return state.projectTree[0] ?? null
      return findDirectory(state.projectTree, state.activeDirectoryId)
    },
    currentAssets(state): ProjectAsset[] {
      const directory = state.activeDirectoryId
        ? findDirectory(state.projectTree, state.activeDirectoryId)
        : state.projectTree[0] ?? null
      if (!state.activeDirectoryId) {
        return directory?.assets ?? []
      }
      if (state.activeDirectoryId === PACKAGES_ROOT_DIRECTORY_ID) {
        return []
      }
      if (!directory) {
        return []
      }

      if (state.activeDirectoryId === ASSETS_ROOT_DIRECTORY_ID) {
        const collected: ProjectAsset[] = []
        collectDirectoryAssets(directory, collected)
        return collected
      }

      const path = findDirectoryPathInTree(state.projectTree, state.activeDirectoryId)
      const isUnderPackages = path ? path.some((entry) => entry.id === PACKAGES_ROOT_DIRECTORY_ID) : false
      if (isUnderPackages) {
        const collected: ProjectAsset[] = []
        collectDirectoryAssets(directory, collected)
        return collected
      }

      return directory.assets ?? []
    },
    canUndo(state): boolean {
      return state.undoStack.length > 0
    },
    canRedo(state): boolean {
      return state.redoStack.length > 0
    },
  },
  actions: {
    captureHistorySnapshot(options: { resetRedo?: boolean } = {}) {
      if (this.isRestoringHistory) {
        return
      }
      const snapshot = createHistorySnapshot(this)
      const nextUndoStack = [...this.undoStack, snapshot]
      this.undoStack = nextUndoStack.length > HISTORY_LIMIT
        ? nextUndoStack.slice(nextUndoStack.length - HISTORY_LIMIT)
        : nextUndoStack
      const resetRedo = options.resetRedo ?? true
      if (resetRedo && this.redoStack.length) {
        this.redoStack = []
      }
    },
    pushRedoSnapshot() {
      const snapshot = createHistorySnapshot(this)
      const nextRedoStack = [...this.redoStack, snapshot]
      this.redoStack = nextRedoStack.length > HISTORY_LIMIT
        ? nextRedoStack.slice(nextRedoStack.length - HISTORY_LIMIT)
        : nextRedoStack
    },
    async restoreFromHistory(snapshot: SceneHistoryEntry) {
      const assetCache = useAssetCacheStore()
      this.isRestoringHistory = true
      this.activeTransformNodeId = null
      this.transformSnapshotCaptured = false
      try {
        this.nodes.forEach((node) => releaseRuntimeTree(node))
        this.nodes = cloneSceneNodes(snapshot.nodes)
        this.selectedNodeIds = cloneSelection(snapshot.selectedNodeIds)
        this.selectedNodeId = snapshot.selectedNodeId
        this.camera = cloneCameraState(snapshot.camera)
        this.resourceProviderId = snapshot.resourceProviderId

        assetCache.recalculateUsage(this.nodes)

        snapshot.runtimeSnapshots.forEach((object, nodeId) => {
          const clonedObject = object.clone(true)
          tagObjectWithNodeId(clonedObject, nodeId)
          registerRuntimeObject(nodeId, clonedObject)
        })

        const nodeIds = flattenNodeIds(this.nodes)
        const missingRuntimeObjects = nodeIds.filter((id) => !runtimeObjectRegistry.has(id))
        if (missingRuntimeObjects.length) {
          await this.ensureSceneAssetsReady({ nodes: this.nodes, showOverlay: false, refreshViewport: false })
        }

        // trigger reactivity for consumers relying on node array reference
        this.nodes = [...this.nodes]
        commitSceneSnapshot(this)
      } finally {
        this.isRestoringHistory = false
      }
    },
    async undo() {
      if (!this.undoStack.length || this.isRestoringHistory) {
        return false
      }
      const snapshot = this.undoStack[this.undoStack.length - 1]!
      this.undoStack = this.undoStack.slice(0, -1)
      this.pushRedoSnapshot()
      await this.restoreFromHistory(snapshot)
      return true
    },
    async redo() {
      if (!this.redoStack.length || this.isRestoringHistory) {
        return false
      }
      const snapshot = this.redoStack[this.redoStack.length - 1]!
      this.redoStack = this.redoStack.slice(0, -1)
      this.captureHistorySnapshot({ resetRedo: false })
      await this.restoreFromHistory(snapshot)
      return true
    },
    beginTransformInteraction(nodeId: string | null) {
      if (!nodeId) {
        this.activeTransformNodeId = null
        this.transformSnapshotCaptured = false
        return
      }
      if (this.activeTransformNodeId !== nodeId) {
        this.activeTransformNodeId = nodeId
      }
      this.transformSnapshotCaptured = false
    },
    endTransformInteraction() {
      this.activeTransformNodeId = null
      this.transformSnapshotCaptured = false
    },
    setActiveTool(tool: EditorTool) {
      this.activeTool = tool
    },
    setSelection(ids: string[], options: { commit?: boolean } = {}) {
      const commitChange = options.commit ?? true
      const normalized = normalizeSelectionIds(this.nodes, ids)
      const nextPrimary = normalized[normalized.length - 1] ?? null
      const primaryChanged = this.selectedNodeId !== nextPrimary
      const selectionChanged = !areSelectionsEqual(normalized, this.selectedNodeIds)
      if (!primaryChanged && !selectionChanged) {
        return false
      }
      this.selectedNodeIds = normalized
      this.selectedNodeId = nextPrimary
      if (commitChange) {
        commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
      }
      return true
    },
    selectNode(id: string | null) {
      this.setSelection(id ? [id] : [], { commit: true })
    },
    selectAllNodes() {
      const allIds = flattenNodeIds(this.nodes)
      this.setSelection(allIds, { commit: true })
    },
    clearSelection() {
      this.setSelection([], { commit: true })
    },
    setDraggingAssetObject(assetObject: Object3D | null) {
      this.draggingAssetObject = assetObject
    },

    updateNodeTransform(payload: { id: string; position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }) {
      const target = findNodeById(this.nodes, payload.id)
      if (!target) {
        return
      }
      const positionChanged = !vectorsEqual(target.position, payload.position)
      const rotationChanged = !vectorsEqual(target.rotation, payload.rotation)
      const scaleChanged = !vectorsEqual(target.scale, payload.scale)
      if (!positionChanged && !rotationChanged && !scaleChanged) {
        return
      }
      if (this.activeTransformNodeId === payload.id) {
        if (!this.transformSnapshotCaptured) {
          this.captureHistorySnapshot()
          this.transformSnapshotCaptured = true
        }
      } else {
        this.captureHistorySnapshot()
      }
      visitNode(this.nodes, payload.id, (node) => {
        node.position = cloneVector(payload.position)
        node.rotation = cloneVector(payload.rotation)
        node.scale = cloneVector(payload.scale)
      })
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    updateNodeProperties(payload: TransformUpdatePayload) {
      const target = findNodeById(this.nodes, payload.id)
      if (!target) {
        return
      }
      let changed = false
      if (payload.position && !vectorsEqual(target.position, payload.position)) {
        changed = true
      }
      if (payload.rotation && !vectorsEqual(target.rotation, payload.rotation)) {
        changed = true
      }
      if (payload.scale && !vectorsEqual(target.scale, payload.scale)) {
        changed = true
      }
      if (!changed) {
        return
      }
      if (this.activeTransformNodeId === payload.id) {
        if (!this.transformSnapshotCaptured) {
          this.captureHistorySnapshot()
          this.transformSnapshotCaptured = true
        }
      } else {
        this.captureHistorySnapshot()
      }
      visitNode(this.nodes, payload.id, (node) => {
        if (payload.position) node.position = cloneVector(payload.position)
        if (payload.rotation) node.rotation = cloneVector(payload.rotation)
        if (payload.scale) node.scale = cloneVector(payload.scale)
      })
      // trigger reactivity for listeners relying on reference changes
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    renameNode(id: string, name: string) {
      const trimmed = name.trim()
      if (!trimmed) {
        return
      }
      const target = findNodeById(this.nodes, id)
      if (!target || target.name === trimmed) {
        return
      }
      this.captureHistorySnapshot()
      visitNode(this.nodes, id, (node) => {
        node.name = trimmed
      })
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    updateNodeMaterial(id: string, material: Partial<NonNullable<SceneNode['material']>>) {
      let updated = false
      visitNode(this.nodes, id, (node) => {
        if (!node.material) {
          if ((node.nodeType ?? 'mesh') !== 'mesh') {
            return
          }
          node.material = {
            color: material.color ?? '#ffffff',
            wireframe: material.wireframe ?? false,
            opacity: material.opacity ?? 1,
          }
          updated = true
          return
        }
        node.material = {
          color: material.color ?? node.material.color,
          wireframe: material.wireframe ?? node.material.wireframe,
          opacity: material.opacity ?? node.material.opacity,
        }
        updated = true
      })
      if (!updated) {
        return
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    updateLightProperties(id: string, properties: Partial<LightNodeProperties>) {
      const target = findNodeById(this.nodes, id)
      if (!target || !target.light) {
        return
      }
      this.captureHistorySnapshot()
      visitNode(this.nodes, id, (node) => {
        if (!node.light) {
          return
        }
        const next: LightNodeProperties = {
          ...node.light,
          ...properties,
        }
        if (properties.target) {
          next.target = cloneVector(properties.target)
        } else if (properties.target === null) {
          next.target = undefined
        }
        node.light = next
      })
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    isNodeVisible(id: string) {
      const node = findNodeById(this.nodes, id)
      return node?.visible ?? true
    },
    setNodeVisibility(id: string, visible: boolean) {
      let updated = false
      visitNode(this.nodes, id, (node) => {
        node.visible = visible
        updated = true
      })
      if (!updated) {
        return
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    toggleNodeVisibility(id: string) {
      const current = this.isNodeVisible(id)
      this.setNodeVisibility(id, !current)
    },
    setAllNodesVisibility(visible: boolean) {
      let updated = false
      const apply = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if ((node.visible ?? true) !== visible) {
            node.visible = visible
            updated = true
          }
          if (node.children?.length) {
            apply(node.children)
          }
        })
      }
      apply(this.nodes)
      if (!updated) {
        return
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    isNodeSelectionLocked(id: string) {
      const node = findNodeById(this.nodes, id)
      return node?.locked ?? false
    },
    setNodeSelectionLock(id: string, locked: boolean) {
      let updated = false
      visitNode(this.nodes, id, (node) => {
        const current = node.locked ?? false
        if (current !== locked) {
          node.locked = locked
          updated = true
        }
      })
      if (!updated) {
        return
      }
      if (locked && this.selectedNodeIds.includes(id)) {
        const nextSelection = this.selectedNodeIds.filter((selectedId) => selectedId !== id)
        this.setSelection(nextSelection, { commit: false })
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    toggleNodeSelectionLock(id: string) {
      const next = !this.isNodeSelectionLocked(id)
      this.setNodeSelectionLock(id, next)
    },
    setAllNodesSelectionLock(locked: boolean) {
      let updated = false
      const apply = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          const current = node.locked ?? false
          if (current !== locked) {
            node.locked = locked
            updated = true
          }
          if (node.children?.length) {
            apply(node.children)
          }
        })
      }
      apply(this.nodes)
      if (!updated) {
        return
      }
      if (locked && this.selectedNodeIds.length) {
        this.setSelection([], { commit: false })
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    setActiveDirectory(id: string) {
      this.activeDirectoryId = id
    },
    selectAsset(id: string | null) {
      this.selectedAssetId = id
    },
    async ensureSceneAssetsReady(options: EnsureSceneAssetsOptions = {}) {
      const targetNodes = Array.isArray(options.nodes) ? options.nodes : this.nodes
      if (!targetNodes.length) {
        if (options.showOverlay) {
          useUiStore().hideLoadingOverlay(true)
        }
        return
      }

      const assetNodeMap = collectNodesByAssetId(targetNodes)
      if (assetNodeMap.size === 0) {
        if (options.showOverlay) {
          useUiStore().hideLoadingOverlay(true)
        }
        return
      }

      const assetCache = useAssetCacheStore()
      const uiStore = useUiStore()
      const shouldShowOverlay = options.showOverlay ?? true
      const refreshViewport = options.refreshViewport ?? options.nodes === undefined
      const normalizeUrl = (value: string | null | undefined): string | null => {
        if (!value) {
          return null
        }
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
      }

      if (shouldShowOverlay) {
        uiStore.showLoadingOverlay({
          title: 'Loading Scene Assets',
          message: 'Preparing assets…',
          mode: 'determinate',
          progress: 0,
          closable: false,
          autoClose: false,
        })
      }

      const total = assetNodeMap.size
      let completed = 0
      const errors: Array<{ assetId: string; message: string }> = []

      for (const [assetId, nodesForAsset] of assetNodeMap.entries()) {
        const asset = this.getAsset(assetId)
        const assetLabel = normalizeUrl(asset?.name) ?? nodesForAsset[0]?.name ?? assetId
        const fallbackDownloadUrl = normalizeUrl(asset?.downloadUrl) ?? normalizeUrl(asset?.description)
    
        try {
          if (shouldShowOverlay) {
            uiStore.updateLoadingOverlay({
              message: `Loading asset: ${assetLabel}`,
            })
          }

          let entry = assetCache.getEntry(assetId)
          if (!normalizeUrl(entry.downloadUrl) && fallbackDownloadUrl) {
            entry.downloadUrl = fallbackDownloadUrl
          }
          if (entry.status !== 'cached') {
            await assetCache.loadFromIndexedDb(assetId)
            entry = assetCache.getEntry(assetId)
            if (!normalizeUrl(entry.downloadUrl) && fallbackDownloadUrl) {
              entry.downloadUrl = fallbackDownloadUrl
            }
          }
          const downloadUrl = normalizeUrl(entry?.downloadUrl) ?? fallbackDownloadUrl

          let stopDownloadWatcher: WatchStopHandle | null = null
          const completedBeforeAsset = completed
          const overlayTotal = total > 0 ? total : 1

          try {
            if (!assetCache.hasCache(assetId)) {
              if (!downloadUrl) {
                throw new Error('Missing asset download URL')
              }

              if (shouldShowOverlay) {
                stopDownloadWatcher = watch(
                  () => {
                    const current = assetCache.getEntry(assetId)
                    return [current.status, current.progress, current.filename] as const
                  },
                  ([status, progress, filename]) => {
                    if (status !== 'downloading') {
                      return
                    }
                    const normalizedProgress = Number.isFinite(progress)
                      ? Math.max(0, Math.round(progress))
                      : 0
                    const displayName = filename?.trim() || assetLabel
                    const aggregateProgress = Math.max(
                      0,
                      Math.min(100, Math.round(((completedBeforeAsset + normalizedProgress / 100) / overlayTotal) * 100)),
                    )
                    uiStore.updateLoadingOverlay({
                      message: `Downloading asset: ${displayName} (${normalizedProgress}%)`,
                      progress: aggregateProgress,
                      mode: 'determinate',
                    })
                    uiStore.updateLoadingProgress(aggregateProgress, { autoClose: false })
                  },
                  { immediate: true },
                )
              }

              await assetCache.downloadAsset(assetId, downloadUrl, assetLabel)
              if (shouldShowOverlay) {
                uiStore.updateLoadingOverlay({
                  message: `Loading asset: ${assetLabel}`,
                })
              }
            } else {
              assetCache.touch(assetId)
            }
          } finally {
            stopDownloadWatcher?.()
          }

          entry = assetCache.getEntry(assetId)

          const file = assetCache.createFileFromCache(assetId)
          if (!file) {
            throw new Error('Missing asset file in cache')
          }

          const baseObject = await loadObjectFromFile(file)

          nodesForAsset.forEach((node, index) => {
            const object = index === 0 ? baseObject : baseObject.clone(true)
            tagObjectWithNodeId(object, node.id)
            registerRuntimeObject(node.id, object)
          })
        } catch (error) {
          const message = (error as Error).message ?? 'Unknown error'
          errors.push({ assetId, message })
          console.warn(`Failed to load asset ${assetId}`, error)
          if (shouldShowOverlay) {
            uiStore.updateLoadingOverlay({
              message: `Failed to load asset ${assetLabel}: ${message}`,
              closable: true,
              autoClose: false,
            })
          }
        } finally {
          completed += 1
          if (shouldShowOverlay) {
            const percent = Math.round((completed / total) * 100)
            uiStore.updateLoadingProgress(percent, { autoClose: false })
          }
        }
      }

      if (shouldShowOverlay) {
        if (errors.length === 0) {
          uiStore.updateLoadingOverlay({
            message: 'Assets loaded successfully',
            autoClose: true,
            autoCloseDelay: 600,
          })
          uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 600 })
        } else {
          uiStore.updateLoadingOverlay({
            message: `${errors.length} assets failed to load. Please check the logs.`,
            closable: true,
            autoClose: false,
          })
          uiStore.updateLoadingProgress(100, { autoClose: false })
        }
      }

      if (errors.length === 0 && refreshViewport) {
        this.nodes = [...this.nodes]
      }
    },
    async addNodeFromAsset(asset: ProjectAsset, position?: Vector3Like): Promise<SceneNode | null> {
      const { position: spawnPosition, rotation, scale } = computeAssetSpawnTransform(asset, position)

      const assetCache = useAssetCacheStore()
      if (!assetCache.hasCache(asset.id)) {
        return null
      }
      const file = assetCache.createFileFromCache(asset.id)
      if (!file) {
        throw new Error('Missing asset data in cache')
      }

      const object = await loadObjectFromFile(file)
      const node = this.addSceneNode({
        object,
        name: asset.name,
        position: spawnPosition,
        rotation,
        scale,
        sourceAssetId: asset.id,
      })
      assetCache.registerUsage(asset.id)
      assetCache.touch(asset.id)
      return node
    },
    async spawnAssetAtPosition(assetId: string, position: Vector3Like): Promise<{ asset: ProjectAsset; node: SceneNode }> {
      const asset = findAssetInTree(this.projectTree, assetId)
      if (!asset) {
        throw new Error('Unable to find the requested asset')
      }

      const assetCache = useAssetCacheStore()

      if (assetCache.hasCache(asset.id)) {
        const node = await this.addNodeFromAsset(asset, position)
        if (!node) {
          throw new Error('Asset is not ready and cannot be added to the scene')
        }
        return { asset, node }
      }

      const transform = computeAssetSpawnTransform(asset, position)
      const placeholder = this.addPlaceholderNode(asset, transform)
      this.observeAssetDownloadForNode(placeholder.id, asset)
      assetCache.setError(asset.id, null)
      void assetCache.downloaProjectAsset(asset).catch((error) => {
        const target = findNodeById(this.nodes, placeholder.id)
        if (target) {
          target.downloadStatus = 'error'
          target.downloadError = (error as Error).message ?? '资源下载失败'
          this.nodes = [...this.nodes]
        }
      })

      return { asset, node: placeholder }
    },
    resetProjectTree() {
      this.packageDirectoryCache = {}
      this.packageDirectoryLoaded = {}
      this.projectTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      this.activeDirectoryId = defaultDirectoryId
      this.selectedAssetId = null
    },
    getPackageDirectories(providerId: string): ProjectDirectory[] | null {
      const cached = this.packageDirectoryCache[providerId]
      if (!cached) {
        return null
      }
      return cloneProjectTree(cached)
    },
    isPackageLoaded(providerId: string): boolean {
      return !!this.packageDirectoryLoaded[providerId]
    },
    setPackageDirectories(providerId: string, directories: ProjectDirectory[]) {
  this.packageDirectoryCache[providerId] = cloneProjectTree(directories)
      this.packageDirectoryLoaded[providerId] = true
  const nextTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      this.projectTree = nextTree
      if (!this.activeDirectoryId || !findDirectory(nextTree, this.activeDirectoryId)) {
        this.activeDirectoryId = defaultDirectoryId
      }
      this.selectedAssetId = null
    },
    getAsset(assetId: string): ProjectAsset | null {
      const meta = this.assetIndex[assetId]
      if (meta) {
        const catalogList = this.assetCatalog[meta.categoryId] ?? []
        const found = catalogList.find((item) => item.id === assetId)
        if (found) {
          return found
        }
      }
      return findAssetInTree(this.projectTree, assetId)
    },
    registerAsset(asset: ProjectAsset, options: { categoryId?: string; source?: AssetSourceMetadata } = {}) {
      const categoryId = options.categoryId ?? determineAssetCategoryId(asset)
      const existingEntry = this.assetIndex[asset.id]
      const nextCatalog: Record<string, ProjectAsset[]> = { ...this.assetCatalog }

      if (existingEntry) {
        const previousCategoryId = existingEntry.categoryId
        if (nextCatalog[previousCategoryId]) {
          nextCatalog[previousCategoryId] = nextCatalog[previousCategoryId]!.filter((item) => item.id !== asset.id)
        }
      }

      const registeredAsset: ProjectAsset = { ...asset }
      const currentList = nextCatalog[categoryId] ?? []
      nextCatalog[categoryId] = [...currentList.filter((item) => item.id !== registeredAsset.id), registeredAsset]

      this.assetCatalog = nextCatalog
      this.assetIndex = {
        ...this.assetIndex,
        [registeredAsset.id]: {
          categoryId,
          source: options.source,
        },
      }

      this.projectTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
      return registeredAsset
    },
    copyPackageAssetToAssets(providerId: string, asset: ProjectAsset): ProjectAsset {
      const mapKey = `${providerId}::${asset.id}`
      const existingId = this.packageAssetMap[mapKey]
      if (existingId) {
        const existingAsset = this.getAsset(existingId)
        if (existingAsset) {
          return existingAsset
        }
        const { [mapKey]: _removed, ...rest } = this.packageAssetMap
        this.packageAssetMap = rest
      }

      const assetClone: ProjectAsset = {
        ...asset,
        gleaned: true
      }
      const categoryId = determineAssetCategoryId(assetClone)
      const registered = this.registerAsset(assetClone, {
        categoryId,
        source: {
          type: 'package',
          providerId,
          originalAssetId: asset.id,
        },
      })

      this.packageAssetMap = {
        ...this.packageAssetMap,
        [mapKey]: registered.id,
      }

      return registered
    },
    deleteProjectAssets(assetIds: string[]): string[] {
      const uniqueIds = Array.from(
        new Set(
          assetIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
        ),
      )
      if (!uniqueIds.length) {
        return []
      }

      const catalogAssets = new Map<string, ProjectAsset>()
      Object.values(this.assetCatalog).forEach((list) => {
        list.forEach((asset) => {
          catalogAssets.set(asset.id, asset)
        })
      })

      const deletableIds = uniqueIds.filter((id) => catalogAssets.has(id))
      if (!deletableIds.length) {
        return []
      }

      const assetIdSet = new Set(deletableIds)
      const assetCache = useAssetCacheStore()

      const assetNodeMap = collectNodesByAssetId(this.nodes)
      const nodeIdsToRemove: string[] = []
      deletableIds.forEach((assetId) => {
        const nodes = assetNodeMap.get(assetId)
        if (nodes?.length) {
          nodes.forEach((node) => {
            nodeIdsToRemove.push(node.id)
          })
        }
      })
      if (nodeIdsToRemove.length) {
        this.removeSceneNodes(nodeIdsToRemove)
      }

      const now = new Date().toISOString()
      const updatedScenes = this.scenes.map((scene) => {
        if (scene.id === this.currentSceneId) {
          return scene
        }
        const sceneAssetNodeMap = collectNodesByAssetId(scene.nodes)
        const sceneNodeIds: string[] = []
        deletableIds.forEach((assetId) => {
          const nodes = sceneAssetNodeMap.get(assetId)
          if (nodes?.length) {
            nodes.forEach((node) => sceneNodeIds.push(node.id))
          }
        })
        if (!sceneNodeIds.length) {
          return scene
        }
        const removedNodeIds: string[] = []
        const prunedNodes = pruneNodes(scene.nodes, new Set(sceneNodeIds), removedNodeIds)
        const removedSet = new Set(removedNodeIds)

        let selectedNodeIds = Array.isArray(scene.selectedNodeIds)
          ? scene.selectedNodeIds.filter((id) => !removedSet.has(id))
          : []
        let selectedNodeId = scene.selectedNodeId
        if (selectedNodeId && removedSet.has(selectedNodeId)) {
          selectedNodeId = null
        }
        if (!selectedNodeId && prunedNodes.length > 0) {
          selectedNodeId = prunedNodes[0]!.id
        }
        if (!selectedNodeIds.length && selectedNodeId) {
          selectedNodeIds = [selectedNodeId]
        }
        selectedNodeIds = normalizeSelectionIds(prunedNodes, selectedNodeIds)
        if (selectedNodeId && !selectedNodeIds.includes(selectedNodeId)) {
          selectedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null
        }

        return {
          ...scene,
          nodes: prunedNodes,
          selectedNodeId,
          selectedNodeIds,
          updatedAt: now,
        }
      })
      this.scenes = updatedScenes

      const nextCatalog: Record<string, ProjectAsset[]> = {}
      Object.entries(this.assetCatalog).forEach(([categoryId, list]) => {
        nextCatalog[categoryId] = list
          .filter((asset) => !assetIdSet.has(asset.id))
          .map((asset) => ({ ...asset }))
      })
      this.assetCatalog = nextCatalog
      this.projectTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      if (this.activeDirectoryId && !findDirectory(this.projectTree, this.activeDirectoryId)) {
        this.activeDirectoryId = defaultDirectoryId
      }
      if (this.selectedAssetId && assetIdSet.has(this.selectedAssetId)) {
        this.selectedAssetId = null
      }

      const nextIndex = { ...this.assetIndex }
      deletableIds.forEach((assetId) => {
        delete nextIndex[assetId]
      })
      this.assetIndex = nextIndex

      const nextPackageMap: Record<string, string> = {}
      Object.entries(this.packageAssetMap).forEach(([key, value]) => {
        if (!assetIdSet.has(value)) {
          nextPackageMap[key] = value
        }
      })
      this.packageAssetMap = nextPackageMap

      deletableIds.forEach((assetId) => {
        assetCache.removeCache(assetId)
      })

      if (deletableIds.length) {
        commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
      }

      return deletableIds
    },
    setResourceProviderId(providerId: string) {
      if (this.resourceProviderId === providerId) {
        return
      }
      this.resourceProviderId = providerId
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
    },
    setCameraState(camera: SceneCameraState) {
      this.camera = cloneCameraState(camera)
      commitSceneSnapshot(this, { updateNodes: false })
    },
    resetCameraState() {
      this.camera = cloneCameraState(defaultCameraState)
      commitSceneSnapshot(this, { updateNodes: false })
    },
    setPanelVisibility(panel: EditorPanel, visible: boolean) {
      this.panelVisibility = {
        ...this.panelVisibility,
        [panel]: visible,
      }
    },
    togglePanelVisibility(panel: EditorPanel) {
      this.setPanelVisibility(panel, !this.panelVisibility[panel])
    },

    requestCameraFocus(nodeId: string | null) {
      if (!nodeId) {
        return
      }
      this.cameraFocusNodeId = nodeId
      this.cameraFocusRequestId += 1
    },

    clearCameraFocusRequest(nodeId?: string | null) {
      if (nodeId && this.cameraFocusNodeId && nodeId !== this.cameraFocusNodeId) {
        return
      }
      this.cameraFocusNodeId = null
    },

    isDescendant(ancestorId: string, maybeChildId: string) {
      if (!ancestorId || !maybeChildId) return false
      if (ancestorId === maybeChildId) return true
      return isDescendantNode(this.nodes, ancestorId, maybeChildId)
    },

    moveNode(payload: { nodeId: string; targetId: string | null; position: HierarchyDropPosition }) {
      const { nodeId, targetId, position } = payload
      if (!nodeId) return false
      if (targetId && nodeId === targetId) return false

      if (targetId && isDescendantNode(this.nodes, nodeId, targetId)) {
        return false
      }

      const { tree, node } = detachNodeImmutable(this.nodes, nodeId)
      if (!node) return false

      const inserted = insertNodeMutable(tree, targetId, node, position)
      if (!inserted) return false

      this.captureHistorySnapshot()
      this.nodes = tree
      commitSceneSnapshot(this)
      return true
    },

    addPlaceholderNode(asset: ProjectAsset, transform: { position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }) {
      this.captureHistorySnapshot()
      const id = crypto.randomUUID()
      const node: SceneNode = {
        id,
        name: asset.name,
        nodeType: 'mesh',
        material: { color: '#90a4ae', opacity: 0.6 },
        position: cloneVector(transform.position),
        rotation: cloneVector(transform.rotation),
        scale: cloneVector(transform.scale),
        visible: true,
        sourceAssetId: asset.id,
        isPlaceholder: true,
        downloadProgress: 0,
        downloadStatus: 'downloading',
        downloadError: null,
      }

      this.nodes = [...this.nodes, node]
      this.setSelection([id], { commit: false })
      commitSceneSnapshot(this)

      return node
    },

    observeAssetDownloadForNode(nodeId: string, asset: ProjectAsset) {
      const assetCache = useAssetCacheStore()
      stopPlaceholderWatcher(nodeId)

      const stop = watch(
        () => {
          const entry = assetCache.entries[asset.id]
          if (!entry) {
            return null
          }
          return {
            status: entry.status,
            progress: entry.progress ?? 0,
            error: entry.error ?? null,
          }
        },
        (snapshot) => {
          const target = findNodeById(this.nodes, nodeId)
          if (!target) {
            stopPlaceholderWatcher(nodeId)
            return
          }

          if (!snapshot) {
            return
          }

          let changed = false

          if (target.downloadProgress !== snapshot.progress) {
            target.downloadProgress = snapshot.progress
            changed = true
          }

          if (target.downloadError !== snapshot.error) {
            target.downloadError = snapshot.error
            changed = true
          }

          if (snapshot.status === 'cached') {
            target.downloadStatus = 'ready'
            target.downloadProgress = 100
            changed = true
            stopPlaceholderWatcher(nodeId)
            this.nodes = [...this.nodes]
            void this.finalizePlaceholderNode(nodeId, asset)
            return
          }

          if (snapshot.status === 'error') {
            target.downloadStatus = 'error'
            changed = true
            stopPlaceholderWatcher(nodeId)
            if (changed) {
              this.nodes = [...this.nodes]
            }
            return
          }

          const nextStatus = snapshot.status === 'downloading' ? 'downloading' : 'idle'
          if (target.downloadStatus !== nextStatus) {
            target.downloadStatus = nextStatus
            changed = true
          }

          if (changed) {
            this.nodes = [...this.nodes]
          }
        },
        { immediate: true },
      )

      placeholderDownloadWatchers.set(nodeId, stop)
    },

    async finalizePlaceholderNode(nodeId: string, asset: ProjectAsset) {
      const assetCache = useAssetCacheStore()
      const target = findNodeById(this.nodes, nodeId)
      if (!target) {
        return
      }

      try {
        const file = assetCache.createFileFromCache(asset.id)
        if (!file) {
          throw new Error('资源未缓存完成')
        }

        const object = await loadObjectFromFile(file)
        tagObjectWithNodeId(object, nodeId)
        registerRuntimeObject(nodeId, object)
        assetCache.registerUsage(asset.id)
        assetCache.touch(asset.id)

        target.isPlaceholder = false
  target.downloadStatus = undefined
  target.downloadProgress = undefined
        target.downloadError = null
        target.name = asset.name

        this.nodes = [...this.nodes]
        commitSceneSnapshot(this)
      } catch (error) {
        target.isPlaceholder = true
        target.downloadStatus = 'error'
        target.downloadError = (error as Error).message ?? '资源加载失败'
        this.nodes = [...this.nodes]
      }
    },

    addLightNode(type: LightNodeType, options: { position?: Vector3Like; name?: string } = {}) {
      const preset = getLightPreset(type)
      const node = createLightNode({
        name: options.name ?? preset.name,
        type,
        color: preset.color,
        intensity: preset.intensity,
        position: options.position ?? preset.position,
        target: preset.target,
        extras: preset.extras,
      })

      this.captureHistorySnapshot()
      this.nodes = [...this.nodes, node]
      this.setSelection([node.id], { commit: false })
      commitSceneSnapshot(this)
      return node
    },

    addSceneNode(payload: {
      object: Object3D
      name?: string
      position?: Vector3Like
      rotation?: Vector3Like
      scale?: Vector3Like
      sourceAssetId?: string
    }) {
      this.captureHistorySnapshot()
      const id = crypto.randomUUID()
      const node: SceneNode = {
        id,
        name: payload.name ?? payload.object.name ?? 'Imported Mesh',
        nodeType: 'mesh',
        material: { color: '#ffffff' },
        position: payload.position ?? { x: 0, y: 0, z: 0 },
        rotation: payload.rotation ?? { x: 0, y: 0, z: 0 },
        scale: payload.scale ?? { x: 1, y: 1, z: 1 },
        visible: true,
        sourceAssetId: payload.sourceAssetId,
      }

      registerRuntimeObject(id, payload.object)
      tagObjectWithNodeId(payload.object, id)
      this.nodes = [...this.nodes, node]
      this.setSelection([id], { commit: false })
      commitSceneSnapshot(this)

      return node
    },
    hasRuntimeObject(id: string) {
      return runtimeObjectRegistry.has(id)
    },
    releaseRuntimeObject(id: string) {
      unregisterRuntimeObject(id)
    },
    removeSceneNodes(ids: string[]) {
      if (!Array.isArray(ids) || ids.length === 0) {
        return
      }
      const existingIds = ids.filter((id) => !!findNodeById(this.nodes, id))
      if (!existingIds.length) {
        return
      }
      const idSet = new Set(existingIds)

      this.captureHistorySnapshot()

      const removed: string[] = []
      this.nodes = pruneNodes(this.nodes, idSet, removed)

  removed.forEach((id) => stopPlaceholderWatcher(id))

      const fallbackId = this.nodes[0]?.id ?? null
      const prevSelection = cloneSelection(this.selectedNodeIds)
      let nextSelection = prevSelection.filter((id) => !removed.includes(id))
      if (!nextSelection.length && fallbackId) {
        nextSelection = [fallbackId]
      }
      this.setSelection(nextSelection, { commit: false })
      const assetCache = useAssetCacheStore()
      assetCache.recalculateUsage(this.nodes)
      commitSceneSnapshot(this)
    },
    copyNodes(nodeIds: string[]) {
      const { entries, runtimeSnapshots } = collectClipboardPayload(this.nodes, nodeIds)
      if (!entries.length) {
        this.clipboard = null
        return false
      }
      this.clipboard = {
        entries,
        runtimeSnapshots,
        cut: false,
      }
      return true
    },
    cutNodes(nodeIds: string[]) {
      const success = this.copyNodes(nodeIds)
      if (!success || !this.clipboard) {
        return false
      }
      this.clipboard.cut = true
      const idsToRemove = this.clipboard.entries.map((entry) => entry.sourceId)
      if (idsToRemove.length) {
        this.removeSceneNodes(idsToRemove)
      }
      return true
    },
    pasteClipboard(targetId?: string | null) {
      if (!this.clipboard || !this.clipboard.entries.length) {
        return false
      }

      const assetCache = useAssetCacheStore()
      const context: DuplicateContext = {
        assetCache,
        runtimeSnapshots: this.clipboard.runtimeSnapshots,
      }
      const duplicates = this.clipboard.entries.map((entry) => duplicateNodeTree(entry.node, context))
      if (!duplicates.length) {
        return false
      }

      const working = cloneSceneNodes(this.nodes)

      let anchorId: string | null = null
      if (targetId && findNodeById(working, targetId)) {
        anchorId = targetId
      } else if (this.selectedNodeId && findNodeById(working, this.selectedNodeId)) {
        anchorId = this.selectedNodeId
      }

      duplicates.forEach((duplicate) => {
        const inserted = insertNodeMutable(working, anchorId, duplicate, anchorId ? 'after' : 'after')
        if (!inserted) {
          insertNodeMutable(working, null, duplicate, 'after')
        }
        anchorId = duplicate.id
      })

      this.captureHistorySnapshot()
      this.nodes = working
      const duplicateIds = duplicates.map((duplicate) => duplicate.id)
      if (duplicateIds.length) {
        this.setSelection(duplicateIds, { commit: false })
      }
      commitSceneSnapshot(this)
      assetCache.recalculateUsage(this.nodes)

      if (this.clipboard.cut) {
        this.clipboard = null
      }

      return true
    },
    clearClipboard() {
      this.clipboard = null
    },
    createScene(name = 'Untitled Scene', thumbnail?: string | null) {
      commitSceneSnapshot(this)
      const displayName = name.trim() || 'Untitled Scene'
      const scene = createSceneDocument(displayName, {
        thumbnail: thumbnail ?? null,
        resourceProviderId: this.resourceProviderId,
      })
      this.scenes = [...this.scenes, scene]
      this.currentSceneId = scene.id
      applySceneAssetState(this, scene)
      this.nodes = cloneSceneNodes(scene.nodes)
      this.setSelection(scene.selectedNodeIds ?? (scene.selectedNodeId ? [scene.selectedNodeId] : []), {
        commit: false,
      })
      this.camera = cloneCameraState(scene.camera)
      this.resourceProviderId = scene.resourceProviderId
      useAssetCacheStore().recalculateUsage(this.nodes)
      return scene.id
    },
    async selectScene(sceneId: string) {
      if (sceneId === this.currentSceneId) {
        await this.ensureSceneAssetsReady({ showOverlay: true })
        return true
      }
      commitSceneSnapshot(this)
      const scene = this.scenes.find((item) => item.id === sceneId)
      if (!scene) {
        return false
      }

      this.nodes.forEach((node) => releaseRuntimeTree(node))

      await this.ensureSceneAssetsReady({
        nodes: scene.nodes,
        showOverlay: true,
        refreshViewport: false,
      })

      this.currentSceneId = sceneId
      applySceneAssetState(this, scene)
      this.nodes = cloneSceneNodes(scene.nodes)
      this.setSelection(scene.selectedNodeIds ?? (scene.selectedNodeId ? [scene.selectedNodeId] : []), {
        commit: false,
      })
      this.camera = cloneCameraState(scene.camera)
      this.resourceProviderId = scene.resourceProviderId ?? 'builtin'
      useAssetCacheStore().recalculateUsage(this.nodes)
      return true
    },
    async deleteScene(sceneId: string) {
      commitSceneSnapshot(this)
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }

      const target = this.scenes[index]!
      target.nodes.forEach((node) => releaseRuntimeTree(node))

      const remaining = this.scenes.filter((scene) => scene.id !== sceneId)

      if (remaining.length === 0) {
        const fallback = createSceneDocument('Untitled Scene', { resourceProviderId: 'builtin' })
        this.scenes = [fallback]
        this.currentSceneId = fallback.id
        applySceneAssetState(this, fallback)
        this.nodes = cloneSceneNodes(fallback.nodes)
        this.setSelection(fallback.selectedNodeIds ?? (fallback.selectedNodeId ? [fallback.selectedNodeId] : []), {
          commit: false,
        })
        this.camera = cloneCameraState(fallback.camera)
        this.resourceProviderId = fallback.resourceProviderId
        useAssetCacheStore().recalculateUsage(this.nodes)
        return true
      }

      this.scenes = remaining

      if (this.currentSceneId === sceneId) {
        const next = remaining[0]!
        await this.ensureSceneAssetsReady({
          nodes: next.nodes,
          showOverlay: true,
          refreshViewport: false,
        })
        this.currentSceneId = next.id
        applySceneAssetState(this, next)
        this.nodes = cloneSceneNodes(next.nodes)
        this.setSelection(next.selectedNodeIds ?? (next.selectedNodeId ? [next.selectedNodeId] : []), {
          commit: false,
        })
        this.camera = cloneCameraState(next.camera)
        this.resourceProviderId = next.resourceProviderId ?? 'builtin'
        useAssetCacheStore().recalculateUsage(this.nodes)
      }

      return true
    },
    renameScene(sceneId: string, name: string) {
      const trimmed = name.trim()
      if (!trimmed) {
        return false
      }
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }
      const scene = this.scenes[index]!
      const updated: StoredSceneDocument = {
        ...scene,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      }
      this.scenes = [
        ...this.scenes.slice(0, index),
        updated,
        ...this.scenes.slice(index + 1),
      ]
      return true
    },
    updateSceneThumbnail(sceneId: string, thumbnail: string | null) {
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }
      const scene = this.scenes[index]!
      const updated: StoredSceneDocument = {
        ...scene,
        thumbnail,
        updatedAt: new Date().toISOString(),
      }
      this.scenes = [
        ...this.scenes.slice(0, index),
        updated,
        ...this.scenes.slice(index + 1),
      ]
      return true
    },
    async ensureCurrentSceneLoaded() {
      if (!this.scenes.length) {
        const fallback = createSceneDocument('Untitled Scene', { resourceProviderId: 'builtin' })
        this.scenes = [fallback]
        this.currentSceneId = fallback.id
        applySceneAssetState(this, fallback)
        this.nodes = cloneSceneNodes(fallback.nodes)
        this.setSelection(fallback.selectedNodeIds ?? (fallback.selectedNodeId ? [fallback.selectedNodeId] : []), {
          commit: false,
        })
        this.camera = cloneCameraState(fallback.camera)
        this.resourceProviderId = fallback.resourceProviderId
        return
      }

      let target = this.scenes.find((scene) => scene.id === this.currentSceneId) ?? null
      if (!target) {
        target = this.scenes[0]!
        this.currentSceneId = target.id
      }

      await this.ensureSceneAssetsReady({
        nodes: target.nodes,
        showOverlay: true,
        refreshViewport: false,
      })

      this.nodes = cloneSceneNodes(target.nodes)
      this.setSelection(target.selectedNodeIds ?? (target.selectedNodeId ? [target.selectedNodeId] : []), {
        commit: false,
      })
      this.camera = cloneCameraState(target.camera)
      this.resourceProviderId = target.resourceProviderId ?? 'builtin'
      applySceneAssetState(this, target)
      useAssetCacheStore().recalculateUsage(this.nodes)
    },
  },
  persist: {
    key: 'scene-store',
    storage: 'local',
    version: 0,
    pick: [
      'scenes',
      'currentSceneId',
      'nodes',
      'selectedNodeId',
      'selectedNodeIds',
      'activeTool',
      'activeDirectoryId',
      'selectedAssetId',
      'camera',
      'panelVisibility',
      'resourceProviderId',
      'assetCatalog',
      'assetIndex',
      'packageAssetMap',
    ],
    migrations: migrateScenePersistedState,
  },
})