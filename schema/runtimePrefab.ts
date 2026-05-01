import type { SceneAssetRegistryEntry, SceneJsonExportDocument, SceneNode } from './index'

export interface NodePrefabData {
  formatVersion: number
  name: string
  root: SceneNode
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
}

export interface RuntimePrefabCloneResult {
  root: SceneNode
  idMap: Map<string, string>
}

let runtimePrefabIdCounter = 0

function createRuntimePrefabId(prefix: string): string {
  runtimePrefabIdCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${runtimePrefabIdCounter.toString(36)}`
}

function deepCloneNode<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePrefabName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return 'Runtime Prefab'
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : 'Runtime Prefab'
}

function remapNodeReferenceValue(key: string, value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    if (key === 'nodeId' || key.endsWith('NodeId')) {
      return idMap.get(value) ?? value
    }
    return value
  }
  if (Array.isArray(value)) {
    if (key === 'nodeIds' || key.endsWith('NodeIds')) {
      return value.map((entry) => (typeof entry === 'string' ? (idMap.get(entry) ?? entry) : entry))
    }
    return value.map((entry) => remapNodeReferences(entry, idMap))
  }
  return remapNodeReferences(value, idMap)
}

function remapNodeReferences(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => remapNodeReferences(entry, idMap))
  }
  if (!isRecord(value)) {
    return value
  }
  const next: Record<string, unknown> = {}
  Object.entries(value).forEach(([key, entry]) => {
    next[key] = remapNodeReferenceValue(key, entry, idMap)
  })
  return next
}

function remapRuntimeNodeIds(node: SceneNode, idMap: Map<string, string>): void {
  const nextNodeId = createRuntimePrefabId('runtime_node')
  idMap.set(node.id, nextNodeId)
  node.id = nextNodeId

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => remapRuntimeNodeIds(child, idMap))
  }
}

function remapRuntimeNodeComponents(node: SceneNode, idMap: Map<string, string>): void {
  if (node.components && typeof node.components === 'object') {
    Object.entries(node.components).forEach(([componentType, componentState]) => {
      if (!componentState || typeof componentState !== 'object') {
        return
      }
      const typedState = componentState as Record<string, unknown>
      if (typeof typedState.id === 'string') {
        typedState.id = createRuntimePrefabId(`runtime_component_${componentType}`)
      }
      if (typedState.props && typeof typedState.props === 'object') {
        typedState.props = remapNodeReferences(typedState.props, idMap)
      }
      if (typedState.metadata && typeof typedState.metadata === 'object') {
        typedState.metadata = remapNodeReferences(typedState.metadata, idMap)
      }
    })
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => remapRuntimeNodeComponents(child, idMap))
  }
}

function applyRuntimeReferenceRemap(node: SceneNode, idMap: Map<string, string>): void {
  if (node.components && typeof node.components === 'object') {
    Object.values(node.components).forEach((componentState) => {
      if (!componentState || typeof componentState !== 'object') {
        return
      }
      const typedState = componentState as Record<string, unknown>
      if (typedState.props && typeof typedState.props === 'object') {
        typedState.props = remapNodeReferences(typedState.props, idMap)
      }
      if (typedState.metadata && typeof typedState.metadata === 'object') {
        typedState.metadata = remapNodeReferences(typedState.metadata, idMap)
      }
    })
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => applyRuntimeReferenceRemap(child, idMap))
  }
}

export function parseRuntimePrefabData(raw: string): NodePrefabData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid runtime prefab JSON: ${(error as Error).message}`)
  }
  if (!isRecord(parsed)) {
    throw new Error('Invalid runtime prefab payload')
  }
  const candidate = parsed as Partial<NodePrefabData>
  if (!candidate.root || typeof candidate.root !== 'object') {
    throw new Error('Runtime prefab is missing a root node')
  }
  return {
    formatVersion: typeof candidate.formatVersion === 'number' ? candidate.formatVersion : 1,
    name: normalizePrefabName(candidate.name),
    root: deepCloneNode(candidate.root),
    assetRegistry: isRecord(candidate.assetRegistry)
      ? (deepCloneNode(candidate.assetRegistry) as Record<string, SceneAssetRegistryEntry>)
      : undefined,
  }
}

export function cloneRuntimePrefabNode(prefab: NodePrefabData): RuntimePrefabCloneResult {
  const root = deepCloneNode(prefab.root)
  const idMap = new Map<string, string>()
  remapRuntimeNodeIds(root, idMap)
  remapRuntimeNodeComponents(root, idMap)
  applyRuntimeReferenceRemap(root, idMap)
  return { root, idMap }
}

export function createRuntimePrefabDocument(
  prefab: NodePrefabData,
  root: SceneNode,
): SceneJsonExportDocument {
  const timestamp = new Date().toISOString()
  return {
    id: createRuntimePrefabId('runtime_prefab_document'),
    name: normalizePrefabName(prefab.name),
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [root],
    assetRegistry: prefab.assetRegistry ? deepCloneNode(prefab.assetRegistry) : undefined,
  }
}
