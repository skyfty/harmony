import type { SceneJsonExportDocument, SceneNode } from './core'

export const RETIRED_SCENE_COMPONENT_TYPES = ['purePursuit'] as const

const retiredSceneComponentTypeSet = new Set<string>(RETIRED_SCENE_COMPONENT_TYPES)

export interface RetiredSceneComponentCleanup {
  removedCount: number
  removedTypes: string[]
}

function resolveComponentStateType(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' ? type : null
}

/**
 * Drops known retired component records from a persisted scene before runtime
 * registration or package export. Unknown component types are intentionally
 * preserved so ComponentManager can still report genuine compatibility gaps.
 */
export function stripRetiredSceneComponents(
  document: Pick<SceneJsonExportDocument, 'nodes'>,
): RetiredSceneComponentCleanup {
  const removedTypes = new Set<string>()
  let removedCount = 0

  const visit = (nodes: readonly SceneNode[] | null | undefined): void => {
    if (!Array.isArray(nodes)) {
      return
    }
    nodes.forEach((node) => {
      const components = node.components as Record<string, unknown> | undefined
      if (components) {
        Object.entries(components).forEach(([key, state]) => {
          const stateType = resolveComponentStateType(state)
          const retiredType = retiredSceneComponentTypeSet.has(key)
            ? key
            : stateType && retiredSceneComponentTypeSet.has(stateType)
              ? stateType
              : null
          if (!retiredType) {
            return
          }
          delete components[key]
          removedTypes.add(retiredType)
          removedCount += 1
        })
        if (Object.keys(components).length === 0) {
          delete node.components
        }
      }
      visit(node.children)
    })
  }

  visit(document.nodes)
  return {
    removedCount,
    removedTypes: RETIRED_SCENE_COMPONENT_TYPES.filter((type) => removedTypes.has(type)),
  }
}
