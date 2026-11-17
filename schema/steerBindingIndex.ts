import type { SceneNode, SceneNodeComponentState } from './core'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import {
  STEER_COMPONENT_TYPE,
  clampSteerComponentProps,
  type SteerComponentProps,
  type SteerControllableTargetType,
} from './components/definitions/steerComponent'

export interface ResolvedSteerBinding {
  steerNodeId: string
  steerNode: SceneNode
  steerComponent: SceneNodeComponentState<SteerComponentProps>
  steerProps: SteerComponentProps
  targetNodeId: string
}

export interface SteerBindingIndex {
  clear(): void
  removeNode(nodeId: string | null | undefined): void
  syncNode(node: SceneNode | null | undefined): void
  resolveByTargetNodeId(targetNodeId: string | null | undefined): ResolvedSteerBinding | null
}

export function resolveDefaultSteerBindingFromNodes(
  nodes: readonly SceneNode[] | null | undefined,
  defaultIdentifier: string | null | undefined,
  targetType: SteerControllableTargetType,
): ResolvedSteerBinding | null {
  const normalizedIdentifier = typeof defaultIdentifier === 'string'
    ? defaultIdentifier.trim()
    : ''
  const stack: SceneNode[] = [...(nodes ?? [])]
  let requestedTypeFallback: ResolvedSteerBinding | null = null
  let identifierFallback: ResolvedSteerBinding | null = null
  let anyTypeFallback: ResolvedSteerBinding | null = null

  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    const steerComponent = resolveEnabledComponentState<SteerComponentProps>(
      node,
      STEER_COMPONENT_TYPE,
    )
    if (steerComponent) {
      const steerProps = clampSteerComponentProps(steerComponent.props ?? null)
      if (steerProps.autoEnterOnSceneLoad && steerProps.targetNodeId) {
        const binding: ResolvedSteerBinding = {
          steerNodeId: node.id,
          steerNode: node,
          steerComponent,
          steerProps,
          targetNodeId: steerProps.targetNodeId,
        }
        if (steerProps.targetType === targetType) {
          if (normalizedIdentifier && steerProps.defaultIdentifier === normalizedIdentifier) {
            return binding
          }
          requestedTypeFallback ??= binding
        }
        if (normalizedIdentifier && steerProps.defaultIdentifier === normalizedIdentifier) {
          identifierFallback ??= binding
        }
        anyTypeFallback ??= binding
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }

  // A link may request an actor kind that this scene does not contain. Falling
  // back to the scene's configured auto-entry actor keeps the viewer usable
  // instead of silently loading a camera-only scene.
  return requestedTypeFallback ?? identifierFallback ?? anyTypeFallback
}

export function createSteerBindingIndex(): SteerBindingIndex {
  const steerBindingByTargetNodeId = new Map<string, ResolvedSteerBinding>()
  const steerBindingTargetNodeIdBySteerNodeId = new Map<string, string>()

  function clear(): void {
    steerBindingByTargetNodeId.clear()
    steerBindingTargetNodeIdBySteerNodeId.clear()
  }

  function removeNode(nodeId: string | null | undefined): void {
    const normalizedNodeId = typeof nodeId === 'string' ? nodeId.trim() : ''
    if (!normalizedNodeId) {
      return
    }
    const previousTargetNodeId = steerBindingTargetNodeIdBySteerNodeId.get(normalizedNodeId) ?? null
    if (previousTargetNodeId) {
      const previousBinding = steerBindingByTargetNodeId.get(previousTargetNodeId)
      if (previousBinding?.steerNodeId === normalizedNodeId) {
        steerBindingByTargetNodeId.delete(previousTargetNodeId)
      }
      steerBindingTargetNodeIdBySteerNodeId.delete(normalizedNodeId)
    }
  }

  function syncNode(node: SceneNode | null | undefined): void {
    const steerNodeId = node?.id ?? ''
    if (!steerNodeId) {
      return
    }
    const steerNode = node
    if (!steerNode) {
      return
    }
    removeNode(steerNodeId)
    const steerComponent = resolveEnabledComponentState<SteerComponentProps>(steerNode, STEER_COMPONENT_TYPE)
    if (!steerComponent) {
      return
    }
    const steerProps = clampSteerComponentProps(steerComponent.props ?? null)
    const targetNodeId = typeof steerProps.targetNodeId === 'string' ? steerProps.targetNodeId.trim() : ''
    if (!targetNodeId) {
      return
    }
    const binding: ResolvedSteerBinding = {
      steerNodeId,
      steerNode,
      steerComponent,
      steerProps,
      targetNodeId,
    }
    steerBindingByTargetNodeId.set(targetNodeId, binding)
    steerBindingTargetNodeIdBySteerNodeId.set(steerNodeId, targetNodeId)
  }

  function resolveByTargetNodeId(targetNodeId: string | null | undefined): ResolvedSteerBinding | null {
    const normalizedTargetNodeId = typeof targetNodeId === 'string' ? targetNodeId.trim() : ''
    if (!normalizedTargetNodeId) {
      return null
    }
    return steerBindingByTargetNodeId.get(normalizedTargetNodeId) ?? null
  }

  return {
    clear,
    removeNode,
    syncNode,
    resolveByTargetNodeId,
  }
}
