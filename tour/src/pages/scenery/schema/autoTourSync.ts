export interface AutoTourRuntimeLike {
  isTourActive(nodeId: string): boolean
}

/**
 * Keep a Set of active auto-tour node ids in sync with the runtime.
 * previewNodeIds: iterable of node ids known to the preview (e.g. previewNodeMap.keys()).
 */
export function syncAutoTourActiveNodesFromRuntime(
  activeSet: Set<string>,
  previewNodeIds: Iterable<string>,
  autoTourRuntime: AutoTourRuntimeLike,
): void {
  const nextActive = new Set<string>()
  for (const nodeId of previewNodeIds) {
    try {
      if (autoTourRuntime.isTourActive(nodeId)) {
        nextActive.add(nodeId)
      }
    } catch {
      // Guard against runtime implementations that might throw; ignore and continue.
    }
  }

  activeSet.forEach((nodeId) => {
    if (!nextActive.has(nodeId)) {
      activeSet.delete(nodeId)
    }
  })
  nextActive.forEach((nodeId) => {
    if (!activeSet.has(nodeId)) {
      activeSet.add(nodeId)
    }
  })
}

/**
 * Deterministically resolve which node id should be followed by the camera.
 * Priority: existingFollow (if still active) -> cameraViewTarget (if active) -> first item from activeSet -> first active from previewNodeIds.
 */
export function resolveAutoTourFollowNodeId(
  existingFollowId: string | null,
  cameraViewTargetId: string | null,
  activeSet: Set<string>,
  previewNodeIds: Iterable<string>,
  autoTourRuntime: AutoTourRuntimeLike,
): string | null {
  if (existingFollowId && autoTourRuntime.isTourActive(existingFollowId)) {
    return existingFollowId
  }
  if (cameraViewTargetId && autoTourRuntime.isTourActive(cameraViewTargetId)) {
    return cameraViewTargetId
  }
  for (const nodeId of activeSet) {
    try {
      if (autoTourRuntime.isTourActive(nodeId)) {
        return nodeId
      }
    } catch {
      // ignore
    }
  }
  for (const nodeId of previewNodeIds) {
    try {
      if (autoTourRuntime.isTourActive(nodeId)) {
        return nodeId
      }
    } catch {
      // ignore
    }
  }
  return null
}
