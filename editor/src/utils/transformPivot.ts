import type { SceneNode, TransformPivotMode } from '@schema/core'
import { isExpandedImportedModelRoot, isLightweightImportNode } from '@schema/core'

export type ResolvedTransformPivotMode = 'pivot' | 'center'

/**
 * Nodes whose runtime object is a container for asset-derived content: expanded
 * imported-model roots and their lightweight children.
 *
 * Such nodes keep an identity local transform while the asset geometry is baked
 * far away from the node origin (that is exactly how the 3dtiles exporter writes
 * merged terrain meshes), so anchoring the gizmo on the object origin puts it
 * far outside the viewport and makes rotate/scale fling the mesh away.
 */
export function isContentAnchoredNode(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  return isLightweightImportNode(node) || isExpandedImportedModelRoot(node)
}

/**
 * Legacy (pre-toggle) gizmo anchor rules: content-anchored import nodes and
 * instanced tiling proxies anchor on their content, everything else on its own
 * pivot (the object origin).
 */
export function resolveAutoTransformPivotMode(options: {
  contentAnchored: boolean
  hasInstanceProxy?: boolean
}): ResolvedTransformPivotMode {
  return options.contentAnchored || options.hasInstanceProxy === true ? 'center' : 'pivot'
}

/**
 * Effective gizmo anchor for the current viewport setting.
 * `transformPivotMode: 'auto'` keeps the legacy rules, an explicit value is
 * used as-is.
 */
export function resolveEffectiveTransformPivotMode(
  transformPivotMode: TransformPivotMode,
  auto: ResolvedTransformPivotMode,
): ResolvedTransformPivotMode {
  if (transformPivotMode === 'pivot' || transformPivotMode === 'center') {
    return transformPivotMode
  }
  return auto
}
