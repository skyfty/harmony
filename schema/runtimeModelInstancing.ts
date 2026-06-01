import type { SceneNode, SceneNodeComponentState } from './core'
import { ANIMATION_COMPONENT_TYPE } from './components/definitions/animationComponent'
import { clampSceneNodeInstanceLayout, resolveInstanceLayoutTemplateAssetId } from './instanceLayout'

function isSceneNodeComponentState(value: unknown): value is SceneNodeComponentState<unknown> {
  return typeof value === 'object' && value !== null && 'enabled' in value
}

export function hasEnabledAnimationComponent(node: SceneNode | null | undefined): boolean {
  if (!node?.components) {
    return false
  }
  const component = node.components[ANIMATION_COMPONENT_TYPE]
  if (!isSceneNodeComponentState(component)) {
    return false
  }
  return component.enabled !== false
}

export function canNodeUseRuntimeModelInstancing(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  return !hasEnabledAnimationComponent(node)
}

export function collectRuntimeModelNodesByAssetId(
  nodes: SceneNode[] | null | undefined,
): Map<string, SceneNode[]> {
  const map = new Map<string, SceneNode[]>()
  if (!Array.isArray(nodes) || !nodes.length) {
    return map
  }

  const ensureNodeAssetId = (assetId: string, node: SceneNode): void => {
    const normalized = assetId.trim()
    if (!normalized) {
      return
    }
    if (!map.has(normalized)) {
      map.set(normalized, [])
    }
    map.get(normalized)!.push(node)
  }

  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }

    if (canNodeUseRuntimeModelInstancing(node)) {
      const rawLayout = (node as { instanceLayout?: unknown }).instanceLayout
      const layout = rawLayout
        ? clampSceneNodeInstanceLayout(rawLayout)
        : { mode: 'single' as const, templateAssetId: null }
      const runtimeAssetId = resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId ?? null)
      if (runtimeAssetId) {
        ensureNodeAssetId(runtimeAssetId, node)
      }
    }

    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }

  return map
}
