import { Matrix4, Vector3, Quaternion, Euler } from 'three'
import { generateUuid } from '@/utils/uuid'
import { useClipboardStore } from './clipboardStore'
import * as clipboardHelpers from './clipboardHelpers'
import { GROUND_NODE_ID, SKY_NODE_ID, ENVIRONMENT_NODE_ID } from '@harmony/schema'
import type { SceneNode, NodePrefabData, AssetIndexEntry } from '@harmony/schema'

function createVector(x: number, y: number, z: number) {
  return { x, y, z }
}

function buildParentMap(nodes: SceneNode[]) {
  const parentMap = new Map<string, string | null>()
  const build = (list: SceneNode[], parent: string | null) => {
    list.forEach((n) => {
      parentMap.set(n.id, parent)
      if (n.children) build(n.children, n.id)
    })
  }
  build(nodes, null)
  return parentMap
}

function filterTopLevelNodeIds(ids: string[], parentMap: Map<string, string | null>) {
  return ids.filter((id) => {
    let parent = parentMap.get(id) ?? null
    while (parent) {
      if (ids.includes(parent)) return false
      parent = parentMap.get(parent) ?? null
    }
    return true
  })
}

export function copyNodesAction(store: any, nodeIds: string[]) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) return false

  const uniqueIds = Array.from(new Set(nodeIds)).filter((id) => typeof id === 'string' && id.trim().length > 0)
  if (!uniqueIds.length) return false

  const existingIds = uniqueIds.filter((id) => !!clipboardHelpers.findNodeById(store.nodes, id) && !store.isNodeSelectionLocked(id))
  if (!existingIds.length) return false

  const parentMap = buildParentMap(store.nodes)
  const topLevelIds = filterTopLevelNodeIds(existingIds, parentMap)
    .filter((id) => id !== GROUND_NODE_ID && id !== SKY_NODE_ID && id !== ENVIRONMENT_NODE_ID)
    .filter((id) => {
      const node = clipboardHelpers.findNodeById(store.nodes, id)
      if (!node) return false
      if (node.canPrefab === false) return false
      return true
    })

  if (!topLevelIds.length) return false

  const { entries, runtimeSnapshots } = clipboardHelpers.collectClipboardPayload(store.nodes, topLevelIds, (id: string) => store.runtimeObjects?.get(id))

  const buildClipboardPrefab = (): { serialized: string; cut: boolean } | null => {
    if (topLevelIds.length === 1) {
      const node = clipboardHelpers.findNodeById(store.nodes, topLevelIds[0]!)
      if (!node) return null
      if (node.nodeType === 'Group') {
        const payload = clipboardHelpers.buildSerializedPrefabPayload(node, {
          name: node.name ?? '',
          assetIndex: store.assetIndex,
          packageAssetMap: store.packageAssetMap,
          sceneNodes: store.nodes,
          collectPrefabAssetReferences: store.collectPrefabAssetReferences,
          buildAssetIndexSubsetForPrefab: store.buildAssetIndexSubsetForPrefab,
          buildPackageAssetMapSubsetForPrefab: store.buildPackageAssetMapSubsetForPrefab,
        })
        const serialized = JSON.stringify({ ...payload.prefab, clipboard: { mode: 'copy', multiRoot: false } }, null, 2)
        return { serialized, cut: false }
      }
    }

    const firstWorld = clipboardHelpers.computeWorldMatrixForNode(store.nodes, topLevelIds[0]!)
    const pivotTranslation = new Matrix4().identity()
    if (firstWorld) {
      const pivotPos = new Vector3()
      const pivotQuat = new Quaternion()
      const pivotScale = new Vector3()
      firstWorld.decompose(pivotPos, pivotQuat, pivotScale)
      pivotTranslation.makeTranslation(pivotPos.x, pivotPos.y, pivotPos.z)
    }
    const pivotInverse = pivotTranslation.clone().invert()

    const wrapperId = generateUuid()
    const rootChildIds: string[] = []
    const children: SceneNode[] = []

    topLevelIds.forEach((id) => {
      const source = clipboardHelpers.findNodeById(store.nodes, id)
      if (!source) return
      const sourceWorld = clipboardHelpers.computeWorldMatrixForNode(store.nodes, id)
      const cloned = clipboardHelpers.prepareNodePrefabRoot(source, { regenerateIds: false })

      if (sourceWorld) {
        const localMatrix = new Matrix4().multiplyMatrices(pivotInverse, sourceWorld)
        const position = new Vector3()
        const quaternion = new Quaternion()
        const scale = new Vector3()
        localMatrix.decompose(position, quaternion, scale)
        const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
        cloned.position = createVector(position.x, position.y, position.z)
        cloned.rotation = createVector(euler.x, euler.y, euler.z)
        cloned.scale = createVector(scale.x, scale.y, scale.z)
      }

      rootChildIds.push(cloned.id)
      children.push(cloned)
    })

    if (!children.length) return null

    const wrapper: SceneNode = {
      id: wrapperId,
      name: 'Clipboard',
      nodeType: 'Group',
      position: createVector(0, 0, 0),
      rotation: createVector(0, 0, 0),
      scale: createVector(1, 1, 1),
      visible: true,
      locked: false,
      groupExpanded: false,
      children,
    }

    const payload = clipboardHelpers.buildSerializedPrefabPayload(wrapper, {
      name: 'Clipboard',
      assetIndex: store.assetIndex,
      packageAssetMap: store.packageAssetMap,
      sceneNodes: store.nodes,
      collectPrefabAssetReferences: store.collectPrefabAssetReferences,
      buildAssetIndexSubsetForPrefab: store.buildAssetIndexSubsetForPrefab,
      buildPackageAssetMapSubsetForPrefab: store.buildPackageAssetMapSubsetForPrefab,
    })

    const serialized = JSON.stringify({ ...payload.prefab, clipboard: { mode: 'copy', multiRoot: true, rootChildIds } }, null, 2)
    return { serialized, cut: false }
  }

  const prefabPayload = buildClipboardPrefab()
  if (!prefabPayload) return false

  const clipboardStore = useClipboardStore()
  clipboardStore.setClipboard({ entries, runtimeSnapshots, cut: false })
  void clipboardStore.writeSystem(prefabPayload.serialized)
  return true
}

export function cutNodesAction(store: any, nodeIds: string[]) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) return false

  const uniqueIds = Array.from(new Set(nodeIds)).filter((id) => typeof id === 'string' && id.trim().length > 0)
  if (!uniqueIds.length) return false

  const existingIds = uniqueIds.filter((id) => !!clipboardHelpers.findNodeById(store.nodes, id) && !store.isNodeSelectionLocked(id))
  if (!existingIds.length) return false

  const parentMap = buildParentMap(store.nodes)
  const topLevelIds = filterTopLevelNodeIds(existingIds, parentMap)
    .filter((id) => id !== GROUND_NODE_ID && id !== SKY_NODE_ID && id !== ENVIRONMENT_NODE_ID)
    .filter((id) => {
      const node = clipboardHelpers.findNodeById(store.nodes, id)
      if (!node) return false
      if (node.canPrefab === false) return false
      return true
    })

  if (!topLevelIds.length) return false

  const { entries, runtimeSnapshots } = clipboardHelpers.collectClipboardPayload(store.nodes, topLevelIds, (id: string) => store.runtimeObjects?.get(id))

  const buildClipboardPrefab = (): string | null => {
    if (topLevelIds.length === 1) {
      const node = clipboardHelpers.findNodeById(store.nodes, topLevelIds[0]!)
      if (!node) return null
      if (node.nodeType === 'Group') {
        const payload = clipboardHelpers.buildSerializedPrefabPayload(node, {
          name: node.name ?? '',
          assetIndex: store.assetIndex,
          packageAssetMap: store.packageAssetMap,
          sceneNodes: store.nodes,
          collectPrefabAssetReferences: store.collectPrefabAssetReferences,
          buildAssetIndexSubsetForPrefab: store.buildAssetIndexSubsetForPrefab,
          buildPackageAssetMapSubsetForPrefab: store.buildPackageAssetMapSubsetForPrefab,
        })
        return JSON.stringify({ ...payload.prefab, clipboard: { mode: 'cut', multiRoot: false } }, null, 2)
      }
    }

    const firstWorld = clipboardHelpers.computeWorldMatrixForNode(store.nodes, topLevelIds[0]!)
    const pivotTranslation = new Matrix4().identity()
    if (firstWorld) {
      const pivotPos = new Vector3()
      const pivotQuat = new Quaternion()
      const pivotScale = new Vector3()
      firstWorld.decompose(pivotPos, pivotQuat, pivotScale)
      pivotTranslation.makeTranslation(pivotPos.x, pivotPos.y, pivotPos.z)
    }
    const pivotInverse = pivotTranslation.clone().invert()

    const wrapperId = generateUuid()
    const rootChildIds: string[] = []
    const children: SceneNode[] = []

    topLevelIds.forEach((id) => {
      const source = clipboardHelpers.findNodeById(store.nodes, id)
      if (!source) return
      const sourceWorld = clipboardHelpers.computeWorldMatrixForNode(store.nodes, id)
      const cloned = clipboardHelpers.prepareNodePrefabRoot(source, { regenerateIds: false })

      if (sourceWorld) {
        const localMatrix = new Matrix4().multiplyMatrices(pivotInverse, sourceWorld)
        const position = new Vector3()
        const quaternion = new Quaternion()
        const scale = new Vector3()
        localMatrix.decompose(position, quaternion, scale)
        const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
        cloned.position = createVector(position.x, position.y, position.z)
        cloned.rotation = createVector(euler.x, euler.y, euler.z)
        cloned.scale = createVector(scale.x, scale.y, scale.z)
      }

      rootChildIds.push(cloned.id)
      children.push(cloned)
    })

    if (!children.length) return null

    const wrapper: SceneNode = {
      id: wrapperId,
      name: 'Clipboard',
      nodeType: 'Group',
      position: createVector(0, 0, 0),
      rotation: createVector(0, 0, 0),
      scale: createVector(1, 1, 1),
      visible: true,
      locked: false,
      groupExpanded: false,
      children,
    }

    const payload = clipboardHelpers.buildSerializedPrefabPayload(wrapper, {
      name: 'Clipboard',
      assetIndex: store.assetIndex,
      packageAssetMap: store.packageAssetMap,
      sceneNodes: store.nodes,
      collectPrefabAssetReferences: store.collectPrefabAssetReferences,
      buildAssetIndexSubsetForPrefab: store.buildAssetIndexSubsetForPrefab,
      buildPackageAssetMapSubsetForPrefab: store.buildPackageAssetMapSubsetForPrefab,
    })

    return JSON.stringify({ ...payload.prefab, clipboard: { mode: 'cut', multiRoot: true, rootChildIds } }, null, 2)
  }

  const serialized = buildClipboardPrefab()
  if (!serialized) return false

  const clipboardStore = useClipboardStore()
  clipboardStore.setClipboard({ entries, runtimeSnapshots, cut: true })
  void clipboardStore.writeSystem(serialized)

  // Cut semantics: remove from scene immediately
  store.removeSceneNodes(topLevelIds)
  return true
}

export async function pasteClipboardAction(store: any, targetId?: string | null): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.readText !== 'function') return false

  let serialized: string
  try {
    serialized = await navigator.clipboard.readText()
  } catch (error) {
    console.warn('Failed to read clipboard', error)
    return false
  }

  const normalized = serialized?.trim()
  if (!normalized) return false

  let clipboardMeta: { mode?: string; multiRoot?: boolean; rootChildIds?: unknown } | null = null
  try {
    const parsed = JSON.parse(normalized) as unknown
    if (parsed && typeof parsed === 'object' && 'clipboard' in (parsed as any)) {
      const candidate = (parsed as any).clipboard
      if (candidate && typeof candidate === 'object') clipboardMeta = candidate as { mode?: string; multiRoot?: boolean; rootChildIds?: unknown }
    }
  } catch {
    // ignore
  }

  let prefab: NodePrefabData | null = null
  try {
    prefab = clipboardHelpers.parseNodePrefab(normalized)
  } catch (_error) {
    const node = clipboardHelpers.deserializeSceneNode(normalized)
    if (!node) return false
    const root = clipboardHelpers.ensurePrefabGroupRoot(node)
    prefab = clipboardHelpers.createNodePrefabData(root, node.name ?? 'Clipboard')
  }

  if (!prefab) return false

  let parentId = typeof targetId === 'string' ? targetId.trim() : ''
  if (!parentId.length) parentId = ''
  let resolvedParentId: string | null = parentId.length ? parentId : null
  if (resolvedParentId === SKY_NODE_ID || resolvedParentId === ENVIRONMENT_NODE_ID) resolvedParentId = null
  if (resolvedParentId) {
    const parentNode = clipboardHelpers.findNodeById(store.nodes, resolvedParentId)
    if (!parentNode || parentNode.nodeType !== 'Group' || !store.allowsChildNodes(parentNode)) resolvedParentId = null
  }

  const clipboardStore = useClipboardStore()
  const runtimeSnapshots = clipboardStore.clipboard?.runtimeSnapshots ?? new Map<string, any>()
  const duplicate = await store.instantiatePrefabData(prefab, { runtimeSnapshots, position: null })

  const multiRoot = Boolean(clipboardMeta?.multiRoot)

  const syncSubtree = (node: SceneNode) => {
    store.componentManager.syncNode(node)
    if (node.children?.length) node.children.forEach(syncSubtree)
  }

  const applyWorldToParentLocal = (node: SceneNode, worldMatrix: Matrix4, targetParentId: string | null) => {
    let parentInverse = new Matrix4().identity()
    if (targetParentId) {
      const parentWorld = clipboardHelpers.computeWorldMatrixForNode(store.nodes, targetParentId)
      if (!parentWorld) targetParentId = null
      else parentInverse = parentWorld.clone().invert()
    }
    const localMatrix = targetParentId ? new Matrix4().multiplyMatrices(parentInverse, worldMatrix) : worldMatrix.clone()
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    localMatrix.decompose(position, quaternion, scale)
    const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
    node.position = createVector(position.x, position.y, position.z)
    node.rotation = createVector(euler.x, euler.y, euler.z)
    node.scale = createVector(scale.x, scale.y, scale.z)
    syncSubtree(node)
  }

  const rootsToInsert: SceneNode[] = []
  if (multiRoot && duplicate.nodeType === 'Group' && duplicate.children?.length) {
    const wrapperWorld = clipboardHelpers.composeNodeMatrix(duplicate)
    duplicate.children.forEach((child) => {
      const childWorld = new Matrix4().multiplyMatrices(wrapperWorld, clipboardHelpers.composeNodeMatrix(child))
      applyWorldToParentLocal(child, childWorld, resolvedParentId)
      rootsToInsert.push(child)
    })
  } else {
    const rootWorld = clipboardHelpers.composeNodeMatrix(duplicate)
    applyWorldToParentLocal(duplicate, rootWorld, resolvedParentId)
    rootsToInsert.push(duplicate)
  }

  if (!rootsToInsert.length) return false

  const undoOps: any[] = []
  let workingTree = [...store.nodes]
  rootsToInsert.forEach((node) => {
    if (resolvedParentId) {
      const inserted = store.insertNodeMutable(workingTree, resolvedParentId, node, 'inside')
      if (!inserted) workingTree.push(node)
    } else {
      workingTree.push(node)
    }
    const location = store.findNodeLocationInTree(workingTree, node.id)
    if (location) undoOps.push({ type: 'remove', location, nodeId: node.id })
  })

  if (undoOps.length) store.captureNodeStructureHistorySnapshot(undoOps)

  store.nodes = workingTree

  if (resolvedParentId) store.recenterGroupAncestry(resolvedParentId, { captureHistory: false })

  await store.ensureSceneAssetsReady({ nodes: rootsToInsert, showOverlay: false, refreshViewport: true })

  rootsToInsert.forEach((node) => store.queueSceneNodePatch(node.id, ['transform']))

  const insertedIds = rootsToInsert.map((node) => node.id)
  store.setSelection(insertedIds, { primaryId: insertedIds[0] ?? null })
  store.commitSceneSnapshot && store.commitSceneSnapshot(store)
  return true
}
