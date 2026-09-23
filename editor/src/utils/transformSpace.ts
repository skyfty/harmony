import type { TransformSpace } from '@schema/core'
import type { EditorTool } from '@/types/editor-tool'

export type ResolvedTransformSpace = 'world' | 'local'

/**
 * Legacy (pre-toggle) gizmo orientation rules:
 * - multi-selection is always world oriented
 * - rotate defaults to world axes
 * - translate / scale (and select) default to the node's own axes
 */
export function resolveAutoTransformSpace(tool: EditorTool, isMultiSelection: boolean): ResolvedTransformSpace {
  if (isMultiSelection) {
    return 'world'
  }
  return tool === 'rotate' ? 'world' : 'local'
}

/**
 * Effective gizmo orientation for the current tool/selection.
 * `transformSpace: 'auto'` keeps the legacy rules, an explicit value is used
 * for single selections while multi-selection stays world oriented.
 */
export function resolveEffectiveTransformSpace(
  transformSpace: TransformSpace,
  tool: EditorTool,
  isMultiSelection: boolean,
): ResolvedTransformSpace {
  if (isMultiSelection) {
    return 'world'
  }
  if (transformSpace === 'world' || transformSpace === 'local') {
    return transformSpace
  }
  return resolveAutoTransformSpace(tool, isMultiSelection)
}
