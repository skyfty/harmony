import type { SceneNode } from '@schema/core'
import { componentManager } from '@schema/components'
import type {
  HarmonyAssetSearchQuery,
  HarmonyAssetSearchResult,
  HarmonyAssetSummary,
  HarmonyComponentSnapshot,
  HarmonyNodeSummary,
  HarmonySceneQuery,
  HarmonySceneQueryResult,
} from '@schema/editorAgentProtocol'
import type { useSceneStore } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'

type SceneStore = ReturnType<typeof useSceneStore>

type IndexedNode = {
  node: SceneNode
  parentId: string | null
  depth: number
}

function collectNodes(nodes: SceneNode[], parentId: string | null = null, depth = 0): IndexedNode[] {
  const entries: IndexedNode[] = []
  for (const node of nodes) {
    entries.push({ node, parentId, depth })
    if (node.children?.length) {
      entries.push(...collectNodes(node.children, node.id, depth + 1))
    }
  }
  return entries
}

function toComponentSnapshot(component: NonNullable<SceneNode['components']>[string]): HarmonyComponentSnapshot | null {
  if (!component) {
    return null
  }
  const profile = componentManager.getAgentProfile(component.type)
  return {
    id: component.id,
    type: component.type,
    label: profile?.label ?? component.type,
    enabled: component.enabled !== false,
    editMode: profile?.editMode ?? 'readonly',
    domain: profile?.domain ?? null,
    props: component.props && typeof component.props === 'object'
      ? component.props as Record<string, unknown>
      : {},
    ...(component.metadata ? { metadata: component.metadata } : {}),
  }
}

function toNodeSummary(
  entry: IndexedNode,
  includeComponents: boolean,
  includeMaterials: boolean,
): HarmonyNodeSummary {
  const { node, parentId } = entry
  const componentSnapshots = includeComponents
    ? Object.values(node.components ?? {})
      .map((component) => component ? toComponentSnapshot(component) : null)
      .filter((component): component is HarmonyComponentSnapshot => Boolean(component))
    : undefined
  const materials = includeMaterials
    ? (node.materials ?? []).map((material) => ({
      id: material.id,
      name: material.name ?? null,
      type: material.type ?? null,
      color: material.color ?? null,
      sourceMaterialAssetId: material.sourceMaterialAssetId ?? null,
      textureAssetIds: Object.values(material.textures ?? {})
        .filter(Boolean)
        .map((texture) => texture?.assetId ?? null)
        .filter((assetId): assetId is string => Boolean(assetId)),
    }))
    : undefined

  return {
    id: node.id,
    parentId,
    name: node.name ?? '',
    nodeType: node.nodeType ?? 'Mesh',
    position: { ...node.position },
    rotation: { ...node.rotation },
    scale: { ...node.scale },
    visible: node.visible !== false,
    locked: node.locked === true,
    childCount: node.children?.length ?? 0,
    componentTypes: Object.values(node.components ?? {})
      .filter(Boolean)
      .map((component) => component?.type ?? '')
      .filter(Boolean),
    ...(node.sourceAssetId ? { sourceAssetId: node.sourceAssetId } : {}),
    ...(componentSnapshots ? { components: componentSnapshots } : {}),
    ...(materials ? { materials } : {}),
  }
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0
  }
  const parsed = Number.parseInt(cursor, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function queryScene(store: SceneStore, query: HarmonySceneQuery = {}): HarmonySceneQueryResult {
  const allEntries = collectNodes(store.nodes)
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50)))
  const offset = parseCursor(query.cursor)
  const text = query.text?.trim().toLowerCase() ?? ''
  const maxDepth = typeof query.depth === 'number' && Number.isFinite(query.depth)
    ? Math.max(0, Math.floor(query.depth))
    : Number.POSITIVE_INFINITY

  const matched = allEntries.filter(({ node, parentId, depth }) => {
    if (depth > maxDepth) return false
    if (query.nodeId && node.id !== query.nodeId) return false
    if (Object.prototype.hasOwnProperty.call(query, 'parentId') && parentId !== (query.parentId ?? null)) return false
    if (query.nodeType && (node.nodeType ?? 'Mesh') !== query.nodeType) return false
    if (query.assetId && node.sourceAssetId !== query.assetId) return false
    if (query.componentType && !node.components?.[query.componentType]) return false
    if (text) {
      const componentTypes = Object.values(node.components ?? {}).map((component) => component?.type ?? '')
      const haystack = [node.name, node.id, node.nodeType, ...componentTypes].join(' ').toLowerCase()
      if (!haystack.includes(text)) return false
    }
    return true
  })

  const page = matched.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    sceneId: store.currentSceneId,
    sceneName: store.currentSceneMeta?.name ?? null,
    sceneRevision: store.sceneRevision,
    totalMatched: matched.length,
    nodes: page.map((entry) => toNodeSummary(
      entry,
      query.includeComponents === true,
      query.includeMaterials === true,
    )),
    nextCursor: nextOffset < matched.length ? String(nextOffset) : null,
  }
}

function flattenAssets(store: SceneStore): ProjectAsset[] {
  const records = new Map<string, ProjectAsset>()
  Object.values(store.assetCatalog ?? {}).forEach((assets) => {
    if (!Array.isArray(assets)) {
      return
    }
    assets.forEach((asset) => {
      if (asset?.id) {
        records.set(asset.id, asset)
      }
    })
  })
  return Array.from(records.values())
}

function toAssetSummary(asset: ProjectAsset): HarmonyAssetSummary {
  return {
    id: asset.id,
    name: asset.name ?? asset.id,
    type: asset.type ?? 'unknown',
    extension: asset.extension ?? null,
    category: asset.categoryId ?? null,
    thumbnail: asset.thumbnail ?? null,
    downloadUrl: asset.downloadUrl ?? null,
    source: asset.source?.type ?? null,
  }
}

export function searchCatalog(store: SceneStore, query: HarmonyAssetSearchQuery = {}): HarmonyAssetSearchResult {
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50)))
  const offset = parseCursor(query.cursor)
  const text = query.text?.trim().toLowerCase() ?? ''
  const assets = flattenAssets(store)
    .filter((asset) => !query.type || asset.type === query.type)
    .filter((asset) => {
      if (!text) return true
      return [asset.id, asset.name, asset.description, asset.type]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase()
        .includes(text)
    })
  const page = assets.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    assets: page.map(toAssetSummary),
    nextCursor: nextOffset < assets.length ? String(nextOffset) : null,
  }
}
