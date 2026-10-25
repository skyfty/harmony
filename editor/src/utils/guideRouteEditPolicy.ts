import {
  clampGuideRouteComponentProps,
  type GuideRouteComponentProps,
} from '@schema/components'
import type { Vector3Like } from '@schema/core'

export type GuideRouteEndpointKind = 'start' | 'end'

export type GuideRoutePathHandle = {
  key: string
  vertexIndex: number
  legId: string
  anchorId: string
  anchor: Vector3Like
  endpoint: GuideRouteEndpointKind | null
  locked: boolean
  lockReason: 'road-boundary' | 'branch-origin' | null
}

/**
 * Resolve logical path anchors rather than sampled display vertices. A handle
 * stays locked only where the path is attached to a road or its parent branch.
 */
export function resolveGuideRoutePathHandles(
  props: Partial<GuideRouteComponentProps> | null | undefined,
): GuideRoutePathHandle[] {
  const normalized = clampGuideRouteComponentProps(props)
  const handles: GuideRoutePathHandle[] = []
  let vertexIndex = 0
  const lastLegIndex = normalized.legs.length - 1

  normalized.legs.forEach((leg, legIndex) => {
    if (leg.kind !== 'path') {
      return
    }
    const previousLeg = legIndex > 0 ? normalized.legs[legIndex - 1] : null
    const nextLeg = legIndex < lastLegIndex ? normalized.legs[legIndex + 1] : null
    leg.anchors.forEach((anchor, anchorIndex) => {
      const anchorId = anchor.id?.trim() || `anchor-${anchorIndex + 1}`
      const isOverallStart = legIndex === 0 && anchorIndex === 0
      const isOverallEnd = legIndex === lastLegIndex && anchorIndex === leg.anchors.length - 1
      const branchLocked = isOverallStart && normalized.branchOrigin !== null
      const previousRoadLocked = anchorIndex === 0 && previousLeg?.kind === 'road'
      const nextRoadLocked = (
        anchorIndex === leg.anchors.length - 1
        && nextLeg?.kind === 'road'
      )
      const lockReason = branchLocked
        ? 'branch-origin'
        : previousRoadLocked || nextRoadLocked
          ? 'road-boundary'
          : null

      handles.push({
        key: `${leg.id}:${anchorId}`,
        vertexIndex,
        legId: leg.id,
        anchorId,
        anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
        endpoint: isOverallStart ? 'start' : isOverallEnd ? 'end' : null,
        locked: lockReason !== null,
        lockReason,
      })
      vertexIndex += 1
    })
  })

  return handles
}

export function findGuideRoutePathHandle(
  props: Partial<GuideRouteComponentProps> | null | undefined,
  legId: string,
  anchorId: string,
): GuideRoutePathHandle | null {
  return resolveGuideRoutePathHandles(props).find((handle) => (
    handle.legId === legId && handle.anchorId === anchorId
  )) ?? null
}

export function resolveGuideRouteEndpointHandle(
  props: Partial<GuideRouteComponentProps> | null | undefined,
  endpoint: GuideRouteEndpointKind,
): GuideRoutePathHandle | null {
  return resolveGuideRoutePathHandles(props).find((handle) => handle.endpoint === endpoint) ?? null
}
