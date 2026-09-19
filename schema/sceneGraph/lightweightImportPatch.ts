import * as THREE from 'three'
import type { SceneNodeMaterial } from '../core'
import { isLightweightImportNode } from '../core'
import type { SceneNodeWithExtras } from './types'

export type LightweightImportPatchHooks = {
  applyTransform: (object: THREE.Object3D, node: SceneNodeWithExtras) => void
  applyMaterial: (object: THREE.Object3D, material: SceneNodeMaterial) => Promise<void> | void
  applyMetadata: (object: THREE.Object3D, node: SceneNodeWithExtras) => void
  warn: (message: string) => void
}

export type LightweightImportPatchOptions = {
  assetId: string
  /**
   * Material surface inherited by the patched nodes: the imported model root's
   * whole-model override (or `null` when it has none). A node's own override
   * always wins over it.
   */
  inheritedMaterial: SceneNodeMaterial | null
  hooks: LightweightImportPatchHooks
}

export type LightweightImportPatchResult = {
  /** Scene node ids that were patched in place and must not be built again. */
  handledNodeIds: Set<string>
  /** Patched scene node ids mapped to the delta container that now owns them. */
  containerByNodeId: Map<string, THREE.Object3D>
  patchedNodeCount: number
}

export function objectPathKey(path: number[] | null | undefined): string {
  if (!Array.isArray(path) || !path.length) {
    return ''
  }
  let key = ''
  for (const segment of path) {
    const index = Number.isInteger(segment) && segment >= 0 ? segment : -1
    key = key ? `${key}.${index}` : String(index)
  }
  return key
}

/**
 * Indexes every object of an untouched asset clone by its `objectPath`.
 *
 * The index must be built before any patching happens: patching moves asset
 * nodes into delta containers, which changes the children order (and therefore
 * the index path) of every ancestor.
 */
export function buildAssetObjectPathIndex(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const index = new Map<string, THREE.Object3D>()
  if (!root) {
    return index
  }
  const visit = (object: THREE.Object3D, key: string): void => {
    index.set(key, object)
    const children = object.children
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const child = children[childIndex]
      if (!child) {
        continue
      }
      visit(child, key ? `${key}.${childIndex}` : String(childIndex))
    }
  }
  visit(root, '')
  return index
}

function resolveOwnMaterial(node: SceneNodeWithExtras): SceneNodeMaterial | null {
  if (!Array.isArray(node.materials) || !node.materials.length) {
    return null
  }
  return (node.materials[0] as SceneNodeMaterial | undefined) ?? null
}

function matchesAsset(node: SceneNodeWithExtras, assetId: string): boolean {
  const nodeAssetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId.trim() : ''
  return nodeAssetId === assetId
}

/**
 * Import subtrees that belong to a *different* asset are not part of this
 * clone; descending into them could only produce bogus path lookups.
 */
function belongsToForeignAsset(node: SceneNodeWithExtras, assetId: string): boolean {
  const nodeAssetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId.trim() : ''
  return Boolean(nodeAssetId) && nodeAssetId !== assetId
}

/**
 * Applies the exported lightweight child nodes of an expanded imported model
 * root onto the whole-model clone, in place.
 *
 * Each scene node wraps its asset node in a container that carries the node's
 * transform delta (and an explicit `visible` override), so untouched parts of
 * the model keep rendering from the single clone while overridden nodes stay
 * editable. Material overrides are applied afterwards, in document order, so a
 * descendant's own override wins over its ancestors' (matching the editor's
 * "nearest override wins" inheritance).
 */
export async function applyLightweightImportPatches(
  root: THREE.Object3D,
  nodes: SceneNodeWithExtras[] | null | undefined,
  options: LightweightImportPatchOptions,
): Promise<LightweightImportPatchResult> {
  const handledNodeIds = new Set<string>()
  const containerByNodeId = new Map<string, THREE.Object3D>()
  const result: LightweightImportPatchResult = {
    handledNodeIds,
    containerByNodeId,
    patchedNodeCount: 0,
  }
  if (!root || !Array.isArray(nodes) || !nodes.length) {
    return result
  }
  const assetId = typeof options.assetId === 'string' ? options.assetId.trim() : ''
  if (!assetId) {
    return result
  }

  const pathIndex = buildAssetObjectPathIndex(root)
  const targetByNodeId = new Map<string, THREE.Object3D>()

  // Pass 1 — structure. Containers must exist before any material is applied so
  // that an ancestor's override stops at its descendants' containers (see
  // `forEachOwnedObject` in `material.ts`).
  const patch = (list: SceneNodeWithExtras[] | null | undefined): void => {
    if (!Array.isArray(list) || !list.length) {
      return
    }
    for (const node of list) {
      if (!node || belongsToForeignAsset(node, assetId)) {
        continue
      }
      if (!isLightweightImportNode(node) || !matchesAsset(node, assetId)) {
        patch(node.children as SceneNodeWithExtras[] | undefined)
        continue
      }
      const key = objectPathKey(node.importMetadata?.objectPath)
      const target = key ? pathIndex.get(key) ?? null : null
      const parent = target?.parent ?? null
      if (!target || !parent) {
        options.hooks.warn(
          `轻量子节点无法定位资产节点 ${node.name ?? node.id} (${key || 'root'})`,
        )
        // The whole-model clone already renders this content, so keep the node
        // out of the regular build pass instead of rendering it twice.
        handledNodeIds.add(node.id)
        patch(node.children as SceneNodeWithExtras[] | undefined)
        continue
      }

      const container = new THREE.Group()
      container.name = node.name ?? 'Imported Node'
      options.hooks.applyTransform(container, node)
      if (typeof node.visible === 'boolean') {
        container.visible = node.visible
      }
      container.userData = {
        ...(container.userData ?? {}),
        lightweightImportNode: true,
        sourceAssetId: node.sourceAssetId ?? null,
        objectPath: node.importMetadata?.objectPath ?? null,
      }
      options.hooks.applyMetadata(container, node)

      // Take over the asset node's slot so sibling order (and therefore any
      // remaining objectPath of already indexed objects) stays unchanged.
      const slot = parent.children.indexOf(target)
      parent.add(container)
      container.add(target)
      if (slot >= 0) {
        const currentIndex = parent.children.indexOf(container)
        if (currentIndex >= 0 && currentIndex !== slot) {
          parent.children.splice(currentIndex, 1)
          parent.children.splice(slot, 0, container)
        }
      }

      handledNodeIds.add(node.id)
      containerByNodeId.set(node.id, container)
      targetByNodeId.set(node.id, target)
      result.patchedNodeCount += 1
      patch(node.children as SceneNodeWithExtras[] | undefined)
    }
  }
  patch(nodes)

  // Pass 2 — materials, in document order with inheritance.
  const applyMaterials = async (
    list: SceneNodeWithExtras[] | null | undefined,
    inherited: SceneNodeMaterial | null,
  ): Promise<void> => {
    if (!Array.isArray(list) || !list.length) {
      return
    }
    for (const node of list) {
      if (!node || belongsToForeignAsset(node, assetId)) {
        continue
      }
      if (!isLightweightImportNode(node) || !matchesAsset(node, assetId)) {
        await applyMaterials(node.children as SceneNodeWithExtras[] | undefined, inherited)
        continue
      }
      const effective = resolveOwnMaterial(node) ?? inherited
      const target = targetByNodeId.get(node.id) ?? null
      if (target && effective) {
        await options.hooks.applyMaterial(target, effective)
      }
      await applyMaterials(node.children as SceneNodeWithExtras[] | undefined, effective)
    }
  }
  await applyMaterials(nodes, options.inheritedMaterial)

  return result
}
