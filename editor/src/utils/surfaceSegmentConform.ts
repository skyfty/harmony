import * as THREE from 'three'

export type SurfaceConformSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
}

type SurfaceHeightSampler = (x: number, z: number) => number | null

export function conformSegmentsToSurface(
  segments: readonly SurfaceConformSegment[],
  sampleHeight: SurfaceHeightSampler,
  maxStep = 4,
): SurfaceConformSegment[] {
  const stepLength = Number.isFinite(maxStep) && maxStep > 0 ? maxStep : 4
  const result: SurfaceConformSegment[] = []

  for (const segment of segments) {
    const start = segment.start.clone()
    const end = segment.end.clone()
    const sampledStart = sampleHeight(start.x, start.z)
    if (typeof sampledStart === 'number' && Number.isFinite(sampledStart)) {
      start.y = sampledStart
    }

    const horizontalLength = Math.hypot(end.x - start.x, end.z - start.z)
    const divisions = Math.max(1, Math.ceil(horizontalLength / stepLength))
    let previous = start
    for (let index = 1; index <= divisions; index += 1) {
      const t = index / divisions
      const next = start.clone().lerp(end, t)
      const sampled = sampleHeight(next.x, next.z)
      if (typeof sampled === 'number' && Number.isFinite(sampled)) {
        next.y = sampled
      }
      result.push({
        start: previous.clone(),
        end: next.clone(),
      })
      previous = next
    }
  }

  return result
}
