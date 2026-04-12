import { ENVIRONMENT_NODE_ID, type GroundDynamicMesh, type SceneNode } from '@schema'
import { clampSceneNodeInstanceLayout, resolveInstanceLayoutTemplateAssetId } from '@schema/instanceLayout'
import type { TerrainScatterStoreSnapshot } from '@schema/terrain-scatter'
import type { NodePrefabData } from '@/types/node-prefab'
import type { ProjectAsset } from '@/types/project-asset'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { SceneMaterial } from '@/types/material'
import type { PlanningSceneData } from '@/types/planning-scene-data'
import {
  collectConfigAssetDependencyIds,
  isConfigAssetExtension,
  normalizeAssetReferenceCandidate,
} from '@/utils/assetDependencySubset'
import { extractExtension } from '@/utils/blob'
import { isPlanningImageConversionNode } from '@/utils/planningToScene'
import {
  type ExplicitSceneAssetReference,
  visitExplicitComponentAssetReferences,
  visitExplicitTerrainScatterAssetReferences,
} from '../utils/sceneExplicitAssetReferences'
import { useGroundScatterStore } from './groundScatterStore'
import { useGroundPaintStore } from './groundPaintStore'
import { collectPrefabAssetReferences } from './prefabActions'

const PREFAB_SOURCE_METADATA_KEY = '__prefabAssetId'
const ASSET_REFERENCE_SKIP_KEYS = new Set<string>([PREFAB_SOURCE_METADATA_KEY])
const ASSET_REFERENCE_EXACT_KEYS = new Set<string>([
  'assetid',
  'assetids',
  'sourceassetid',
  'providerassetid',
  'imageassetid',
  'descriptionassetid',
  'textureassetid',
  'hdriassetid',
  'skycubezipassetid',
  'positivexassetid',
  'negativexassetid',
  'positiveyassetid',
  'negativeyassetid',
  'positivezassetid',
  'negativezassetid',
])

type GroundPaintRuntimeState = {
  nodeId: string
  groundSurfaceChunks: GroundDynamicMesh['groundSurfaceChunks'] | null | undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getAssetFromCatalog(catalog: Record<string, ProjectAsset[]>, assetId: string): ProjectAsset | null {
  const normalized = assetId.trim()
  if (!normalized) {
    return null
  }
  for (const assets of Object.values(catalog)) {
    const found = assets.find((asset) => asset.id === normalized)
    if (found) {
      return found
    }
  }
  return null
}

function findGroundNode(nodes: SceneNode[] | null | undefined): SceneNode | null {
  if (!Array.isArray(nodes) || !nodes.length) {
    return null
  }
  const stack = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    if (current.dynamicMesh?.type === 'Ground') {
      return current
    }
    if (Array.isArray(current.children) && current.children.length) {
      stack.push(...current.children)
    }
  }
  return null
}

function sanitizeEnvironmentAssetReferences<T>(value: T): T {
  if (!isPlainObject(value)) {
    return value
  }

  const clone: Record<string, unknown> = { ...value }

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

function isAssetReferenceKey(key: string | null | undefined): boolean {
  if (!key) {
    return false
  }
  const normalized = key.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  if (ASSET_REFERENCE_EXACT_KEYS.has(normalized)) {
    return true
  }
  return normalized.endsWith('assetid') || normalized.endsWith('assetids')
}

function normalizeAssetIdCandidate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  let candidate = normalizeAssetReferenceCandidate(trimmed) ?? trimmed
  if (!candidate) {
    return null
  }
  if (/^(?:https?:|data:|blob:)/i.test(candidate)) {
    return null
  }
  if (candidate.length > 256) {
    return null
  }
  return candidate
}

function resolveAssetExtension(asset: ProjectAsset | null | undefined): string {
  return (
    (typeof asset?.extension === 'string' ? asset.extension.trim().toLowerCase() : '')
    || (extractExtension(asset?.description ?? null) ?? '').trim().toLowerCase()
  )
}

function resolveTraversableConfigAssetKind(asset: ProjectAsset | null): 'prefab' | 'config' | null {
  if (!asset) {
    return null
  }
  const extension = resolveAssetExtension(asset)
  if (asset.type === 'lod' || extension === 'lod') {
    return 'config'
  }
  if (extension === 'prefab' || (asset.type === 'prefab' && !extension)) {
    return 'prefab'
  }
  if (isConfigAssetExtension(extension)) {
    return extension === 'prefab' ? 'prefab' : 'config'
  }
  return null
}

function collectPrefabDependencyAssetIds(prefabData: NodePrefabData): Set<string> {
  const dependencyAssetIds = new Set<string>()
  collectPrefabAssetReferences(prefabData.root).forEach((assetId) => {
    const normalized = typeof assetId === 'string' ? assetId.trim() : ''
    if (normalized) {
      dependencyAssetIds.add(normalized)
    }
  })
  Object.keys(prefabData.assetRegistry ?? {}).forEach((assetId) => {
    const normalized = assetId.trim()
    if (normalized) {
      dependencyAssetIds.add(normalized)
    }
  })
  return dependencyAssetIds
}

function queueDependencyAssetId(
  dependencyAssetIds: Set<string>,
  pendingAssetIds: string[],
  queuedAssetIds: Set<string>,
  catalog: Record<string, ProjectAsset[]>,
  rawAssetId: string,
): void {
  const normalized = normalizeAssetIdCandidate(rawAssetId)
  if (!normalized) {
    return
  }
  dependencyAssetIds.add(normalized)
  const dependencyAsset = getAssetFromCatalog(catalog, normalized)
  if (!dependencyAsset || !resolveTraversableConfigAssetKind(dependencyAsset) || queuedAssetIds.has(normalized)) {
    return
  }
  queuedAssetIds.add(normalized)
  pendingAssetIds.push(normalized)
}

export async function collectTransitiveConfigDependencyAssetIds(
  rootAssetIds: Iterable<string>,
  catalog: Record<string, ProjectAsset[]>,
  options: {
    loadPrefab: (assetId: string) => Promise<NodePrefabData>
    loadConfigAssetText: (assetId: string, asset: ProjectAsset) => Promise<string | null>
  },
): Promise<Set<string>> {
  const dependencyAssetIds = new Set<string>()
  const queuedAssetIds = new Set<string>()
  const visitedAssetIds = new Set<string>()
  const pendingAssetIds: string[] = []

  Array.from(rootAssetIds).forEach((assetId) => {
    const normalized = normalizeAssetIdCandidate(assetId)
    if (!normalized || queuedAssetIds.has(normalized)) {
      return
    }
    queuedAssetIds.add(normalized)
    pendingAssetIds.push(normalized)
  })

  while (pendingAssetIds.length) {
    const assetId = pendingAssetIds.shift()
    if (!assetId || visitedAssetIds.has(assetId)) {
      continue
    }
    visitedAssetIds.add(assetId)

    const asset = getAssetFromCatalog(catalog, assetId)
    const traversalKind = resolveTraversableConfigAssetKind(asset)
    if (!asset || !traversalKind) {
      continue
    }

    try {
      if (traversalKind === 'prefab') {
        const prefabData = await options.loadPrefab(assetId)
        collectPrefabDependencyAssetIds(prefabData).forEach((dependencyAssetId) => {
          queueDependencyAssetId(dependencyAssetIds, pendingAssetIds, queuedAssetIds, catalog, dependencyAssetId)
        })
        continue
      }

      const fileText = await options.loadConfigAssetText(assetId, asset)
      if (!fileText) {
        continue
      }
      const parsed = JSON.parse(fileText) as unknown
      collectConfigAssetDependencyIds(parsed).forEach((dependencyAssetId) => {
        queueDependencyAssetId(dependencyAssetIds, pendingAssetIds, queuedAssetIds, catalog, dependencyAssetId)
      })
    } catch (error) {
      console.warn('Failed to collect config asset dependencies during cleanup/export', assetId, error)
    }
  }

  return dependencyAssetIds
}

function collectAssetIdCandidate(bucket: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetIdCandidate(bucket, entry))
    return
  }
  const normalized = normalizeAssetIdCandidate(value)
  if (normalized) {
    bucket.add(normalized)
  }
}

function collectAssetIdsFromUnknown(value: unknown, bucket: Set<string>) {
  if (!value) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetIdsFromUnknown(entry, bucket))
    return
  }
  if (!isPlainObject(value)) {
    return
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (ASSET_REFERENCE_SKIP_KEYS.has(key)) {
      return
    }
    if (isAssetReferenceKey(key)) {
      collectAssetIdCandidate(bucket, entry)
    } else {
      collectAssetIdsFromUnknown(entry, bucket)
    }
  })
}

function collectPlanningAssetDependencies(
  planningData: PlanningSceneData | null | undefined,
  bucket: Set<string>,
) {
  if (!planningData) {
    return
  }
  collectAssetIdsFromUnknown(planningData, bucket)
}

function collectTerrainScatterAssetDependencies(
  snapshot: TerrainScatterStoreSnapshot | null | undefined,
  bucket: Set<string>,
) {
  if (!snapshot || !Array.isArray(snapshot.layers) || !snapshot.layers.length) {
    return
  }
  snapshot.layers.forEach((layer) => {
    collectAssetIdCandidate(bucket, layer.assetId)
    collectAssetIdCandidate(bucket, layer.profileId)
    if (Array.isArray(layer.instances)) {
      layer.instances.forEach((instance) => {
        collectAssetIdCandidate(bucket, instance.assetId)
        collectAssetIdCandidate(bucket, instance.profileId)
      })
    }
  })
  visitExplicitTerrainScatterAssetReferences(snapshot, ({ assetId }: ExplicitSceneAssetReference) => {
    collectAssetIdCandidate(bucket, assetId)
  })
}

function collectTerrainPaintAssetDependencies(
  groundSurfaceChunks: GroundDynamicMesh['groundSurfaceChunks'] | null | undefined,
  bakedTextureAssetId: string | null | undefined,
  bucket: Set<string>,
) {
  collectAssetIdCandidate(bucket, bakedTextureAssetId)
  Object.values(groundSurfaceChunks ?? {}).forEach((chunkRef) => {
    const textureAssetId = typeof chunkRef?.textureAssetId === 'string' ? chunkRef.textureAssetId.trim() : ''
    if (textureAssetId) {
      bucket.add(textureAssetId)
    }
  })
}

function collectGroundScatterAssetDependencies(scene: StoredSceneDocument, bucket: Set<string>) {
  const groundNode = findGroundNode(scene.nodes ?? [])
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return
  }
  const definition = groundNode.dynamicMesh as GroundDynamicMesh & {
    terrainScatter?: TerrainScatterStoreSnapshot | null
  }
  const runtimeState = useGroundScatterStore().getSceneGroundScatter(scene.id)
  if (runtimeState?.nodeId === groundNode.id) {
    collectTerrainScatterAssetDependencies(runtimeState.terrainScatter, bucket)
    return
  }
  collectTerrainScatterAssetDependencies(definition.terrainScatter, bucket)
}

function collectGroundPaintAssetDependencies(scene: StoredSceneDocument, bucket: Set<string>) {
  const groundNode = findGroundNode(scene.nodes ?? [])
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return
  }
  const runtimeState = useGroundPaintStore().getSceneGroundPaint(scene.id) as GroundPaintRuntimeState | null
  if (runtimeState?.nodeId === groundNode.id) {
    collectTerrainPaintAssetDependencies(
      runtimeState.groundSurfaceChunks,
      (groundNode.dynamicMesh as any)?.terrainPaintBakedTextureAssetId,
      bucket,
    )
    return
  }
  collectTerrainPaintAssetDependencies(
    (groundNode.dynamicMesh as any)?.groundSurfaceChunks,
    (groundNode.dynamicMesh as any)?.terrainPaintBakedTextureAssetId,
    bucket,
  )
}

function collectNodeAssetDependencies(node: SceneNode | null | undefined, bucket: Set<string>) {
  if (!node) {
    return
  }
  collectAssetIdCandidate(bucket, node.sourceAssetId)
  collectAssetIdCandidate(bucket, node.importMetadata?.assetId)

  const rawLayout = (node as any).instanceLayout as unknown
  if (rawLayout) {
    const layout = clampSceneNodeInstanceLayout(rawLayout)
    if (layout?.mode === 'grid') {
      const templateAssetId = resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId)
      collectAssetIdCandidate(bucket, templateAssetId)
    }
  }
  if (node.materials?.length) {
    node.materials.forEach((material) => {
      collectAssetIdsFromUnknown(material, bucket)
    })
  }
  if (node.components) {
    Object.entries(node.components).forEach(([componentType, component]) => {
      if (!component?.props) {
        return
      }
      collectAssetIdsFromUnknown(component.props, bucket)
      visitExplicitComponentAssetReferences(componentType, component.props as Record<string, unknown>, ({ assetId }: ExplicitSceneAssetReference) => {
        collectAssetIdCandidate(bucket, assetId)
      })
    })
  }
  if (node.userData) {
    if (node.id === ENVIRONMENT_NODE_ID && isPlainObject(node.userData)) {
      const sanitizedUserData = { ...(node.userData as Record<string, unknown>) }
      if ('environment' in sanitizedUserData) {
        sanitizedUserData.environment = sanitizeEnvironmentAssetReferences(sanitizedUserData.environment)
      }
      collectAssetIdsFromUnknown(sanitizedUserData, bucket)
    } else {
      collectAssetIdsFromUnknown(node.userData, bucket)
    }
  }
  if (node.dynamicMesh) {
    collectAssetIdsFromUnknown(node.dynamicMesh as unknown, bucket)
  }
  if (node.dynamicMesh?.type === 'Ground') {
    const definition = node.dynamicMesh as GroundDynamicMesh & {
      terrainScatter?: TerrainScatterStoreSnapshot | null
    }
    collectTerrainScatterAssetDependencies(definition.terrainScatter, bucket)
  }
}

export function collectDirectSceneAssetReferenceIds(scene: StoredSceneDocument): Set<string> {
  const bucket = new Set<string>()
  const materialIds = new Set<string>()

  const traverseNodes = (nodes: SceneNode[] | null | undefined): void => {
    if (!Array.isArray(nodes) || !nodes.length) {
      return
    }
    nodes.forEach((node) => {
      if (!node) {
        return
      }
      if (isPlanningImageConversionNode(node)) {
        return
      }
      collectNodeAssetDependencies(node, bucket)
      if (Array.isArray(node.materials) && node.materials.length) {
        node.materials.forEach((material) => {
          const baseId = typeof material?.materialId === 'string' ? material.materialId.trim() : ''
          if (baseId) {
            materialIds.add(baseId)
          }
        })
      }
      if (Array.isArray(node.children) && node.children.length) {
        traverseNodes(node.children as SceneNode[])
      }
    })
  }

  traverseNodes(scene.nodes ?? [])
  collectGroundScatterAssetDependencies(scene, bucket)
  collectGroundPaintAssetDependencies(scene, bucket)

  const materialById = new Map<string, SceneMaterial>()
  if (Array.isArray(scene.materials) && scene.materials.length) {
    scene.materials.forEach((material) => {
      const materialId = typeof material?.id === 'string' ? material.id.trim() : ''
      if (materialId) {
        materialById.set(materialId, material)
      }
    })
  }

  materialIds.forEach((materialId) => {
    const material = materialById.get(materialId)
    if (material) {
      collectAssetIdsFromUnknown(material, bucket)
    }
  })

  collectAssetIdsFromUnknown(sanitizeEnvironmentAssetReferences(scene.environment), bucket)
  collectAssetIdsFromUnknown(scene.groundSettings, bucket)
  collectPlanningAssetDependencies(scene.planningData, bucket)

  return bucket
}

export function collectSceneAssetReferences(scene: StoredSceneDocument): Set<string> {
  const bucket = collectDirectSceneAssetReferenceIds(scene)

  const catalog = scene.assetCatalog ?? {}
  const removable: string[] = []
  bucket.forEach((assetId) => {
    const asset = getAssetFromCatalog(catalog, assetId)
    if (asset?.type === 'prefab') {
      removable.push(assetId)
    }
  })
  removable.forEach((assetId) => bucket.delete(assetId))

  return bucket
}

function collectInternalAssetIdsFromCatalog(catalog: Record<string, ProjectAsset[]>): Set<string> {
  const internalAssetIds = new Set<string>()
  Object.values(catalog).forEach((assets) => {
    assets.forEach((asset) => {
      if (asset?.internal && asset.id) {
        internalAssetIds.add(asset.id)
      }
    })
  })
  return internalAssetIds
}

export function collectRetainedAssetIdsForSceneCleanup(
  scene: StoredSceneDocument,
  catalog: Record<string, ProjectAsset[]>,
): Set<string> {
  const retainedAssetIds = new Set<string>(collectSceneAssetReferences(scene))
  collectInternalAssetIdsFromCatalog(catalog).forEach((assetId) => retainedAssetIds.add(assetId))
  return retainedAssetIds
}

export function pruneAssetCatalogByRetainedIds(
  catalog: Record<string, ProjectAsset[]>,
  retainedAssetIds: Set<string>,
): {
  nextCatalog: Record<string, ProjectAsset[]>
  removedAssetIds: string[]
  catalogChanged: boolean
} {
  const removedAssetIds: string[] = []
  const nextCatalog: Record<string, ProjectAsset[]> = {}
  let catalogChanged = false

  Object.entries(catalog).forEach(([categoryId, list]) => {
    const filtered = list.filter((asset) => {
      const keep = retainedAssetIds.has(asset.id)
      if (!keep) {
        removedAssetIds.push(asset.id)
      }
      return keep
    })
    if (filtered.length !== list.length) {
      catalogChanged = true
    }
    nextCatalog[categoryId] = filtered
  })

  return {
    nextCatalog,
    removedAssetIds,
    catalogChanged,
  }
}

export function collectPrefabAssetIdsFromSceneReferences(
  scene: StoredSceneDocument,
  catalog: Record<string, ProjectAsset[]>,
): Set<string> {
  const prefabAssetIds = new Set<string>()

  const registerIfPrefab = (value: unknown) => {
    const assetId = normalizeAssetIdCandidate(value)
    if (!assetId) {
      return
    }
    const asset = getAssetFromCatalog(catalog, assetId)
    if (asset?.type === 'prefab') {
      prefabAssetIds.add(assetId)
    }
  }

  const traverseNodes = (nodes: SceneNode[] | null | undefined): void => {
    if (!Array.isArray(nodes) || !nodes.length) {
      return
    }
    nodes.forEach((node) => {
      if (!node) {
        return
      }
      registerIfPrefab(node.sourceAssetId)
      registerIfPrefab(node.importMetadata?.assetId)
      if (isPlainObject(node.userData)) {
        registerIfPrefab((node.userData as Record<string, unknown>)[PREFAB_SOURCE_METADATA_KEY])
      }
      if (Array.isArray(node.children) && node.children.length) {
        traverseNodes(node.children)
      }
    })
  }

  traverseNodes(scene.nodes ?? [])
  return prefabAssetIds
}

export async function collectPrefabTransitiveDependencyAssetIds(
  prefabAssetIds: Iterable<string>,
  catalog: Record<string, ProjectAsset[]>,
  loadPrefab: (assetId: string) => Promise<NodePrefabData>,
): Promise<Set<string>> {
  return collectTransitiveConfigDependencyAssetIds(prefabAssetIds, catalog, {
    loadPrefab,
    loadConfigAssetText: async () => null,
  })
}
