import { Matrix4, Vector3, Quaternion, Euler } from 'three'
import type { SceneNode, NodePrefabData, AssetIndexEntry } from '@harmony/schema'

import { generateUuid } from '@/utils/uuid'
import type { Vector3Like } from '@/types/transform-update-payload'

function normalizePrefabName(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function createVector(x: number, y: number, z: number): Vector3Like {
  return { x, y, z }
}

function sanitizePrefabUserData(userData?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!userData || typeof userData !== 'object') return null
  try {
    const cloned = JSON.parse(JSON.stringify(userData)) as Record<string, unknown>
    if (PREFAB_SOURCE_METADATA_KEY in cloned) {
      delete cloned[PREFAB_SOURCE_METADATA_KEY]
    }
    return Object.keys(cloned).length ? cloned : null
  } catch {
    return null
  }
}

const PREFAB_SOURCE_METADATA_KEY = '__prefabAssetId'

function stripPrefabTransientFields(node: SceneNode): SceneNode {
  const sanitized: SceneNode = { ...node }
  delete (sanitized as any).parentId
  delete (sanitized as any).downloadProgress
  delete (sanitized as any).downloadStatus
  delete (sanitized as any).downloadError
  delete (sanitized as any).isPlaceholder
  sanitized.visible = sanitized.visible ?? true
  if ('locked' in sanitized) delete (sanitized as any).locked
  const cleanedUserData = sanitizePrefabUserData(sanitized.userData as Record<string, unknown> | null)
  if (cleanedUserData) sanitized.userData = cleanedUserData
  else if ('userData' in sanitized) delete (sanitized as any).userData
  if (sanitized.children?.length) sanitized.children = sanitized.children.map(stripPrefabTransientFields)
  else if (sanitized.children) delete (sanitized as any).children
  return sanitized
}

function remapPrefabNodeIds(node: SceneNode, regenerate: boolean): SceneNode {
  const resolvedId = regenerate || typeof node.id !== 'string' || !node.id.trim().length ? generateUuid() : node.id
  const children = node.children?.map((child) => remapPrefabNodeIds(child, regenerate))
  const sanitized: SceneNode = { ...node, id: resolvedId }
  if (children && children.length) sanitized.children = children
  else if (children) delete (sanitized as any).children
  return sanitized
}

function prepareNodePrefabRoot(source: SceneNode, options: { regenerateIds?: boolean } = {}): SceneNode {
  const cloned = JSON.parse(JSON.stringify(source)) as SceneNode
  const stripped = stripPrefabTransientFields(cloned)
  return remapPrefabNodeIds(stripped, options.regenerateIds ?? false)
}

function sanitizeFiniteVector3Like(value: Vector3Like | null | undefined, fallback: Vector3Like): Vector3Like {
  if (!value) return fallback
  const x = typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : fallback.x
  const y = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : fallback.y
  const z = typeof value.z === 'number' && Number.isFinite(value.z) ? value.z : fallback.z
  return { x, y, z }
}

function composeNodeMatrix(node: SceneNode): Matrix4 {
  const position = new Vector3(node.position.x, node.position.y, node.position.z)
  const rotation = new Euler(node.rotation.x, node.rotation.y, node.rotation.z, 'XYZ')
  const quaternion = new Quaternion().setFromEuler(rotation)
  const scale = new Vector3(node.scale.x, node.scale.y, node.scale.z)
  return new Matrix4().compose(position, quaternion, scale)
}

function createNodePrefabData(node: SceneNode, name: string): NodePrefabData {
  const normalizedName = normalizePrefabName(name) || 'Unnamed Prefab'
  const root = prepareNodePrefabRoot(node)
  return { formatVersion: NODE_PREFAB_FORMAT_VERSION, name: normalizedName, root }
}

function parseNodePrefab(raw: string): NodePrefabData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid node prefab data: ${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid node prefab payload')
  }
  const candidate = parsed as Partial<NodePrefabData> & { root?: SceneNode | null }
  const formatVersion = Number.isFinite(candidate.formatVersion) ? Number(candidate.formatVersion) : NODE_PREFAB_FORMAT_VERSION
  if (formatVersion !== NODE_PREFAB_FORMAT_VERSION) {
    throw new Error(`Unsupported prefab version: ${candidate.formatVersion}`)
  }
  if (!candidate.root || typeof candidate.root !== 'object') {
    throw new Error('Prefab missing root node')
  }
  const normalizedName = normalizePrefabName(typeof candidate.name === 'string' ? candidate.name : '') || 'Unnamed Prefab'
  const root = prepareNodePrefabRoot(candidate.root as SceneNode, { regenerateIds: false })
  const prefab: NodePrefabData = { formatVersion: NODE_PREFAB_FORMAT_VERSION, name: normalizedName, root }
  if (candidate.assetIndex && typeof candidate.assetIndex === 'object') {
    prefab.assetIndex = candidate.assetIndex as Record<string, AssetIndexEntry>
  }
  if (candidate.packageAssetMap && typeof candidate.packageAssetMap === 'object') {
    prefab.packageAssetMap = candidate.packageAssetMap as Record<string, string>
  }
  return prefab
}

function deserializeSceneNode(raw: string): SceneNode | null {
  if (typeof raw !== 'string') return null
  const normalized = raw.trim()
  if (!normalized.length) return null

  try {
    const prefab = parseNodePrefab(normalized)
    return prefab.root
  } catch (_prefabError) {
    // fallthrough to plain node
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch (error) {
    console.warn('Failed to parse scene node clipboard payload', error)
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  try {
    const root = prepareNodePrefabRoot(parsed as SceneNode, { regenerateIds: false })
    return root
  } catch (error) {
    console.warn('Failed to normalize scene node clipboard payload', error)
    return null
  }
}

function bakePrefabSubtreeTransforms(root: SceneNode, sceneNodes: SceneNode[]): SceneNode {
  const identity = new Matrix4()
  const rootWorld = computeWorldMatrixForNode(sceneNodes, root.id) ?? identity
  const rootDet = rootWorld.determinant()
  const rootInverse = Number.isFinite(rootDet) && Math.abs(rootDet) > 1e-12 ? rootWorld.clone().invert() : identity

  const rewrite = (node: SceneNode, parentRelativeWorld: Matrix4, parentSceneWorld: Matrix4) => {
    const sceneWorld = computeWorldMatrixForNode(sceneNodes, node.id) ?? new Matrix4().multiplyMatrices(parentSceneWorld, composeNodeMatrix(node))
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
    node.position = createVector(nextPosition.x, nextPosition.y, nextPosition.z)
    node.rotation = createVector(nextRotation.x, nextRotation.y, nextRotation.z)
    node.scale = createVector(nextScale.x, nextScale.y, nextScale.z)
    if (node.children?.length) node.children.forEach((child) => rewrite(child, relativeWorld, sceneWorld))
  }

  rewrite(root, identity, identity)
  return root
}

function ensurePrefabGroupRoot(node: SceneNode): SceneNode {
  if (node.nodeType === 'Group') {
    const cloned = JSON.parse(JSON.stringify(node)) as SceneNode
    cloned.groupExpanded = false
    return cloned
  }
  const wrapper: SceneNode = {
    id: generateUuid(),
    name: node.name?.trim().length ? `${node.name} Group` : 'Group Root',
    nodeType: 'Group',
    position: createVector(0, 0, 0),
    rotation: createVector(0, 0, 0),
    scale: createVector(1, 1, 1),
    visible: node.visible ?? true,
    locked: false,
    groupExpanded: false,
    children: [JSON.parse(JSON.stringify(node)) as SceneNode],
  }
  return wrapper
}

function createNodePrefabData(node: SceneNode, name: string): NodePrefabData {
  const normalizedName = normalizePrefabName(name) || 'Unnamed Prefab'
  const root = prepareNodePrefabRoot(node)
  return { formatVersion: NODE_PREFAB_FORMAT_VERSION, name: normalizedName, root }
}

const NODE_PREFAB_FORMAT_VERSION = 1

function serializeNodePrefab(payload: NodePrefabData): string {
  return JSON.stringify(payload, null, 2)
}

function computeWorldMatrixForNode(nodes: SceneNode[], targetId: string): Matrix4 | null {
  const identity = new Matrix4()
  const traverse = (list: SceneNode[], parentMatrix: Matrix4): Matrix4 | null => {
    for (const node of list) {
      const localMatrix = composeNodeMatrix(node)
      const worldMatrix = new Matrix4().multiplyMatrices(parentMatrix, localMatrix)
      if (node.id === targetId) return worldMatrix
      if (node.children) {
        const found = traverse(node.children, worldMatrix)
        if (found) return found
      }
    }
    return null
  }
  return traverse(nodes, identity)
}

type ClipboardEntry = { sourceId: string; root: SceneNode; serialized: string }

export function collectClipboardPayload(nodes: SceneNode[], ids: string[], getRuntimeObject?: (id: string) => any): { entries: ClipboardEntry[]; runtimeSnapshots: Map<string, any> } {
  const runtimeSnapshots = new Map<string, any>()
  if (!ids.length) return { entries: [], runtimeSnapshots }
  const uniqueIds = Array.from(new Set(ids))
  const parentMap = new Map<string, string | null>()
  const buildParentMap = (list: SceneNode[], parent: string | null) => {
    list.forEach((n) => {
      parentMap.set(n.id, parent)
      if (n.children) buildParentMap(n.children, n.id)
    })
  }
  buildParentMap(nodes, null)
  const filterTopLevelNodeIds = (idsList: string[]) => idsList.filter((id) => {
    let parent = parentMap.get(id) ?? null
    while (parent) {
      if (idsList.includes(parent)) return false
      parent = parentMap.get(parent) ?? null
    }
    return true
  })
  const topLevelIds = filterTopLevelNodeIds(uniqueIds)
  const entries: ClipboardEntry[] = []
  topLevelIds.forEach((id) => {
    if (!id) return
    const found = findNodeById(nodes, id)
    if (found) {
      const rootNode = prepareNodePrefabRoot(found)
      bakePrefabSubtreeTransforms(rootNode, nodes)
      const serialized = JSON.stringify(rootNode, null, 2)
      entries.push({ sourceId: id, root: rootNode, serialized })
      if (getRuntimeObject) {
        const runtime = getRuntimeObject(found.id)
        if (runtime) {
          try { runtimeSnapshots.set(found.id, runtime.clone(true)) } catch (e) { /* ignore */ }
        }
      }
    }
  })
  return { entries, runtimeSnapshots }
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

export function buildSerializedPrefabPayload(
  node: SceneNode,
  context: {
    name?: string
    assetIndex?: Record<string, AssetIndexEntry>
    packageAssetMap?: Record<string, string>
    sceneNodes: SceneNode[]
    collectPrefabAssetReferences?: (root: SceneNode | null | undefined) => string[]
    buildAssetIndexSubsetForPrefab?: (source: Record<string, AssetIndexEntry>, assetIds: Iterable<string>) => Record<string, AssetIndexEntry> | undefined
    buildPackageAssetMapSubsetForPrefab?: (source: Record<string, string>, assetIds: Iterable<string>) => Record<string, string> | undefined
  },
): { prefab: NodePrefabData; serialized: string; dependencyAssetIds: string[] } {
  const prefabRoot = ensurePrefabGroupRoot(node)
  const prefabData: NodePrefabData = { formatVersion: NODE_PREFAB_FORMAT_VERSION, name: normalizePrefabName(context.name ?? node.name ?? ''), root: prepareNodePrefabRoot(prefabRoot) }
  bakePrefabSubtreeTransforms(prefabData.root, context.sceneNodes)
  const dependencyCollector = context.collectPrefabAssetReferences
  const dependencyAssetIds = dependencyCollector ? dependencyCollector(prefabData.root) : []
  if (dependencyAssetIds.length) {
    const assetIndexSubset = context.buildAssetIndexSubsetForPrefab && context.assetIndex ? context.buildAssetIndexSubsetForPrefab(context.assetIndex, dependencyAssetIds) : undefined
    if (assetIndexSubset) prefabData.assetIndex = assetIndexSubset
    const packageAssetMapSubset = context.buildPackageAssetMapSubsetForPrefab && context.packageAssetMap ? context.buildPackageAssetMapSubsetForPrefab(context.packageAssetMap, dependencyAssetIds) : undefined
    if (packageAssetMapSubset) prefabData.packageAssetMap = packageAssetMapSubset
  }
  const serialized = serializeNodePrefab(prefabData)
  return { prefab: prefabData, serialized, dependencyAssetIds }
}

export {
  composeNodeMatrix,
  createNodePrefabData,
  parseNodePrefab,
  deserializeSceneNode,
}

export default {
  collectClipboardPayload,
  buildSerializedPrefabPayload,
  prepareNodePrefabRoot,
  ensurePrefabGroupRoot,
  serializeNodePrefab,
  stripPrefabTransientFields,
}
