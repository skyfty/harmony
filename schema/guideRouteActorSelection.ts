import type { Vector3Like } from './core'
import type { GuideRouteTravelMode } from './components/definitions/guideRouteComponent'

export type GuideRouteActorCandidate = {
  nodeId: string
  kind: GuideRouteTravelMode
  position: Vector3Like
}

export function selectNearestGuideRouteActorNodeId(options: {
  candidates: Iterable<GuideRouteActorCandidate>
  requiredKind: GuideRouteTravelMode
  preferredNodeId?: string | null
  referencePosition: Vector3Like
}): string | null {
  const preferredNodeId = options.preferredNodeId?.trim() || null
  const reference = options.referencePosition
  let bestNodeId: string | null = null
  let bestDistanceSq = Number.POSITIVE_INFINITY
  for (const candidate of options.candidates) {
    if (candidate.kind !== options.requiredKind) {
      continue
    }
    if (preferredNodeId && candidate.nodeId === preferredNodeId) {
      return candidate.nodeId
    }
    const dx = candidate.position.x - reference.x
    const dy = candidate.position.y - reference.y
    const dz = candidate.position.z - reference.z
    const distanceSq = dx * dx + dy * dy + dz * dz
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestNodeId = candidate.nodeId
    }
  }
  return bestNodeId
}
