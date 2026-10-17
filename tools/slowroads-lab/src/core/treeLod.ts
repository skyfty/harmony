/**
 * Tree LOD bands shared by the card, far-card and 3D mesh shaders.
 *
 * All distances are horizontal XZ distances. Keeping one metric avoids trees
 * switching at different times as the camera rotates or looks uphill.
 */
export interface TreeLodBands {
  /** 3D mesh starts fading out at this distance. 0 disables the 3D layer. */
  meshNear: number
  /** 3D mesh is fully hidden at this distance. 0 disables the 3D layer. */
  meshFar: number
  /** Near cards start fading out at this distance. */
  cardNear: number
  /** Near cards are fully replaced by far cards at this distance. */
  cardFar: number
}

export function resolveTreeLodBands(nearDistance: number, meshRadius: number): TreeLodBands {
  const cardFar = Math.max(40, nearDistance)
  const cardNear = Math.max(20, cardFar * 0.7)
  if (!(meshRadius > 0)) {
    return { meshNear: 0, meshFar: 0, cardNear, cardFar }
  }
  // Keep the 3D handoff strictly inside the near-card range even when the
  // user drags the sliders to values that would otherwise overlap.
  const meshFar = Math.max(1, Math.min(meshRadius, cardNear - 10))
  const meshNear = Math.max(0, meshFar * 0.66)
  return { meshNear, meshFar, cardNear, cardFar }
}
