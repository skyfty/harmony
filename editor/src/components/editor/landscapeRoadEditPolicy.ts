import type { SceneNode } from '@schema/core'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components'

/**
 * Node selection locks protect node-level selection and transforms. Waypoint
 * authoring is a component-level operation, so a locked terrain node remains
 * eligible while the landscape road tool is explicitly active.
 */
export function canEditLandscapeRoadWaypoints(
  node: SceneNode | null | undefined,
  options: { hasRuntimeObject: boolean },
): boolean {
  if (!node || !options.hasRuntimeObject) {
    return false
  }
  return Boolean(node.components?.[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE])
}

/**
 * Locking an actively edited terrain node must not tear down the road waypoint
 * session. Other lock actions retain the existing clear-selection behavior.
 */
export function shouldPreserveLandscapeRoadSelectionOnLock(options: {
  willLock: boolean
  activeBuildTool: string | null
  selectedNodeIds: readonly string[]
  nodeId: string
  node: SceneNode | null | undefined
}): boolean {
  return options.willLock
    && options.activeBuildTool === 'landscapeRoad'
    && options.selectedNodeIds.length === 1
    && options.selectedNodeIds[0] === options.nodeId
    && Boolean(options.node?.components?.[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE])
}
