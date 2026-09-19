import type { SceneNode } from '@schema/core'
import { isLightweightImportNode } from '@schema/core'

/**
 * Key that matches an imported lightweight child node with the asset node it
 * was created from.
 */
export function importChildObjectPathKey(path: number[] | null | undefined): string {
  if (!Array.isArray(path) || !path.length) {
    return ''
  }
  return path
    .map((segment) => (Number.isInteger(segment) && segment >= 0 ? segment : -1))
    .join('.')
}

/**
 * Indexes the lightweight child nodes of a document by `objectPath`, which is
 * the only stable link between an exported child and its asset node.
 */
export function collectImportedChildOverrides(
  nodes: SceneNode[] | null | undefined,
): Map<string, SceneNode> {
  const overrides = new Map<string, SceneNode>()
  const visit = (list: SceneNode[] | null | undefined): void => {
    if (!Array.isArray(list) || !list.length) {
      return
    }
    list.forEach((node) => {
      if (!node || !isLightweightImportNode(node)) {
        return
      }
      const key = importChildObjectPathKey(node.importMetadata?.objectPath)
      if (key && !overrides.has(key)) {
        overrides.set(key, node)
      }
      visit(node.children)
    })
  }
  visit(nodes)
  return overrides
}

/**
 * Copies the override surface of an exported child node onto the equivalent
 * node rebuilt from the asset.
 *
 * Lightweight nodes only ever carry material, transform and visibility
 * overrides (plus the id other document data may reference), so those fields
 * are enough to restore the exact edit state the package shipped with.
 */
export function applyImportedChildOverride(target: SceneNode, source: SceneNode): void {
  target.id = source.id
  if (typeof source.name === 'string' && source.name.trim()) {
    target.name = source.name
  }
  if (source.position) {
    target.position = source.position
  }
  if (source.rotation) {
    target.rotation = source.rotation
  }
  if (source.scale) {
    target.scale = source.scale
  }
  if (typeof source.visible === 'boolean') {
    target.visible = source.visible
  }
  if (Array.isArray(source.materials) && source.materials.length) {
    target.materials = source.materials
  }
  if (source.locked !== undefined) {
    target.locked = source.locked
  }
  if (source.selectedHighlight !== undefined) {
    target.selectedHighlight = source.selectedHighlight
  }
  if (source.userData) {
    target.userData = source.userData
  }
  if (source.editorFlags) {
    target.editorFlags = source.editorFlags
  }
}

/**
 * Merges the exported overrides of a pruned expanded import tree onto the child
 * nodes rebuilt from the asset, and returns how many nodes were restored.
 *
 * A return value of 0 means the exported children do not describe this asset
 * tree at all (their paths drifted), in which case the caller must keep the
 * document untouched instead of replacing it with rebuilt nodes.
 */
export function mergeImportedChildOverrides(
  root: SceneNode,
  rebuilt: SceneNode[],
  overrides: ReadonlyMap<string, SceneNode>,
): number {
  if (!rebuilt.length || !overrides.size) {
    return 0
  }
  // Children that are not derived from the asset (nodes the user parented under
  // the expanded root) are not part of the rebuilt tree and must be kept.
  const extras = (Array.isArray(root.children) ? root.children : []).filter(
    (node) => node && !isLightweightImportNode(node),
  )
  const matchedKeys = new Set<string>()
  let mergedCount = 0
  const merge = (nodes: SceneNode[]): void => {
    nodes.forEach((node) => {
      const key = importChildObjectPathKey(node.importMetadata?.objectPath)
      const exported = key ? overrides.get(key) ?? null : null
      if (exported) {
        matchedKeys.add(key)
        applyImportedChildOverride(node, exported)
        mergedCount += 1
      }
      if (Array.isArray(node.children) && node.children.length) {
        merge(node.children)
      }
    })
  }
  merge(rebuilt)
  if (!mergedCount) {
    return 0
  }

  // Children whose asset node drifted away cannot be patched in place anymore;
  // keep them in the tree so their overrides are not silently dropped.
  const drifted: SceneNode[] = []
  overrides.forEach((node, key) => {
    if (!matchedKeys.has(key)) {
      drifted.push(node)
    }
  })
  root.children = [...rebuilt, ...extras, ...drifted]
  return mergedCount
}
