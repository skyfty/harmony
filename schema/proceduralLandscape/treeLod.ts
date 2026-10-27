/**
 * Shared tree LOD bands.
 *
 * Every boundary is a horizontal XZ distance. Using camera depth for one layer
 * and straight-line distance for another makes trees appear to pop when the
 * camera rotates or looks uphill, even though the camera has not moved.
 */
export interface TreeLodBands {
  /** Legacy dissolve start retained for foliage material uniforms. */
  cardNear: number
  /** Near cards are replaced by far cards at this distance. */
  cardFar: number
}

export function resolveTreeLodBands(nearDistance: number): TreeLodBands {
  const cardFar = Math.max(40, nearDistance)
  const cardNear = Math.max(20, cardFar * 0.7)
  return { cardNear, cardFar }
}
