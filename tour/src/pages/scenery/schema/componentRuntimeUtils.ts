import type { SceneNode, SceneNodeComponentState } from './index'

/**
 * Resolve a node component by type, returning null when missing or disabled.
 * This is intended for runtime/preview code that frequently performs component lookups.
 */
export function resolveEnabledComponentState<TProps>(
  node: SceneNode | null | undefined,
  type: string,
): SceneNodeComponentState<TProps> | null {
  const component = node?.components?.[type] as SceneNodeComponentState<TProps> | undefined
  if (!component || !component.enabled) {
    return null
  }
  return component
}
