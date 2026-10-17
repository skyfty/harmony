/**
 * Shared tree LOD bands.
 *
 * Every boundary is a horizontal XZ distance. Using camera depth for one layer
 * and straight-line distance for another makes trees appear to pop when the
 * camera rotates or looks uphill, even though the camera has not moved.
 */
export interface TreeLodBands {
  /** 3D mesh starts dissolving at this distance. 0 disables the mesh layer. */
  meshNear: number
  /** 3D mesh is fully hidden at this distance. 0 disables the mesh layer. */
  meshFar: number
  /** Near cards start dissolving toward far cards at this distance. */
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
  // Keep the 3D handoff strictly inside the near-card range for extreme slider
  // combinations such as nearDistance=40 / nearTreeRadius=300.
  const meshFar = Math.max(1, Math.min(meshRadius, cardNear - 10))
  const meshNear = Math.max(0, meshFar * 0.66)
  return { meshNear, meshFar, cardNear, cardFar }
}
