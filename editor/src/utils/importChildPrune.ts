import type { SceneNode } from '@schema/core'
import { isIdentityNodeTransform, isLightweightImportNode } from '@schema/core'

/**
 * Keys that hold node id references somewhere in a scene document
 * (`targetNodeId`, `ownerNodeIds`, `followNodeId`, ...).
 */
const NODE_ID_KEY_PATTERN = /node_?ids?$/i

function pushNodeIdCandidate(value: unknown, bucket: Set<string>): void {
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (normalized) {
      bucket.add(normalized)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => pushNodeIdCandidate(entry, bucket))
    return
  }
  if (value && typeof value === 'object') {
    // Node-id keyed maps (`{ [nodeId]: ... }`) reference their keys.
    Object.keys(value as Record<string, unknown>).forEach((key) => {
      const normalized = key.trim()
      if (normalized) {
        bucket.add(normalized)
      }
    })
  }
}

/**
 * Collects every node id referenced from somewhere other than the node tree
 * itself (behaviors, camera targets, physics bindings, punch points, ...).
 *
 * A node's own `id` key is skipped: otherwise every node would look referenced.
 * The walk is intentionally generic so new reference-bearing fields keep
 * working without a central registry.
 */
export function collectReferencedNodeIds(root: unknown): Set<string> {
  const bucket = new Set<string>()
  const visit = (value: unknown, level: number): void => {
    if (!value || typeof value !== 'object' || level > 32) {
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, level + 1))
      return
    }
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      if (key !== 'id' && NODE_ID_KEY_PATTERN.test(key)) {
        pushNodeIdCandidate(entry, bucket)
      }
      visit(entry, level + 1)
    })
  }
  visit(root, 0)
  return bucket
}

export type ImportChildPruneResult = {
  nodes: SceneNode[]
  removedCount: number
}

function hasEnabledComponent(node: SceneNode): boolean {
  const components = node.components
  if (!components) {
    return false
  }
  return Object.keys(components).some((key) => Boolean(components[key]))
}

function hasUserDataEntries(node: SceneNode): boolean {
  const userData = (node as { userData?: Record<string, unknown> | null }).userData
  return Boolean(userData && typeof userData === 'object' && Object.keys(userData).length > 0)
}

/**
 * A lightweight import node only needs to survive an export when it actually
 * deviates from the asset: transform delta, visibility, material override. Any
 * other payload (components, light / camera props, userData) is kept as well so
 * nothing unrelated can silently disappear.
 */
function hasImportChildOverride(node: SceneNode): boolean {
  if (!isIdentityNodeTransform(node)) {
    return true
  }
  if (typeof node.visible === 'boolean') {
    return true
  }
  if (Array.isArray(node.materials) && node.materials.length > 0) {
    return true
  }
  if (hasEnabledComponent(node)) {
    return true
  }
  if (node.light || node.camera || node.dynamicMesh) {
    return true
  }
  if (node.editorFlags && Object.keys(node.editorFlags).length) {
    return true
  }
  return hasUserDataEntries(node)
}

function hasLightweightImportDescendant(nodes: SceneNode[] | null | undefined): boolean {
  if (!Array.isArray(nodes) || !nodes.length) {
    return false
  }
  return nodes.some((node) => {
    if (!node) {
      return false
    }
    if (isLightweightImportNode(node)) {
      return true
    }
    return hasLightweightImportDescendant(node.children)
  })
}

/**
 * Drops the lightweight import child nodes that carry no override at all.
 *
 * Exports only need the children that deviate from the asset: the runtime
 * renders the whole model once and patches those nodes onto it, so untouched
 * nodes are pure payload (and pure runtime objects). Untouched nodes that are
 * still referenced by other document data, and the ancestor chain leading to a
 * kept node, stay in the tree.
 */
export function pruneUntouchedImportChildNodes(
  nodes: SceneNode[] | null | undefined,
  referencedNodeIds: ReadonlySet<string>,
): ImportChildPruneResult {
  let removedCount = 0

  const pruneList = (list: SceneNode[] | null | undefined): SceneNode[] => {
    if (!Array.isArray(list) || !list.length) {
      return []
    }
    const kept: SceneNode[] = []
    for (const node of list) {
      if (!node) {
        continue
      }
      const children = pruneList(node.children ?? null)
      if (children.length) {
        node.children = children
      } else if ('children' in node) {
        delete (node as { children?: SceneNode[] }).children
      }

      const droppable = isLightweightImportNode(node)
        && !hasImportChildOverride(node)
        && !children.length
        && !referencedNodeIds.has(node.id)
      if (droppable) {
        removedCount += 1
        continue
      }
      if (node.importChildrenExpanded === true && !hasLightweightImportDescendant(node.children)) {
        // Nothing is left to patch onto the whole-model clone: render the asset
        // as a regular imported model node again.
        delete (node as { importChildrenExpanded?: boolean }).importChildrenExpanded
      }
      kept.push(node)
    }
    return kept
  }

  const pruned = pruneList(nodes)
  return { nodes: pruned, removedCount }
}
