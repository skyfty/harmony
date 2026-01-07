export interface AutoTourRuntimeLike {
  startTour(nodeId: string): void
  stopTour(nodeId: string): void
}

/**
 * Start an auto-tour and invoke `onFollow` so callers can set up follow state.
 */
export function startTourAndFollow(
  runtime: AutoTourRuntimeLike,
  nodeId: string,
  onFollow?: (nodeId: string) => void,
): void {
  try {
    runtime.startTour(nodeId)
  } catch {
    // ignore runtime errors here; callers may still want to attempt follow-side effects
  }
  try {
    onFollow?.(nodeId)
  } catch {
    // swallow
  }
}

/**
 * Stop an auto-tour and invoke `onUnfollow` so callers can tear down follow state.
 */
export function stopTourAndUnfollow(
  runtime: AutoTourRuntimeLike,
  nodeId: string,
  onUnfollow?: (nodeId: string) => void,
): void {
  try {
    runtime.stopTour(nodeId)
  } catch {
    // ignore
  }
  try {
    onUnfollow?.(nodeId)
  } catch {
    // ignore
  }
}
