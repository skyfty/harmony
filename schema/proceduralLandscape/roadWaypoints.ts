/**
 * Hand-drawn road guide waypoints (proceduralLandscape road path).
 *
 * Points are stored in the host node's local XZ plane; the runtime height
 * field supplies the actual Y when the trace is rebuilt. These helpers are
 * pure (no three.js dependency) so both the schema runtime and the editor
 * units can use them.
 */

export interface RoadWaypoint {
  x: number
  z: number
}

/** Consecutive duplicate points closer than this are merged (meters). */
export const ROAD_WAYPOINT_DEDUPE_DISTANCE = 0.5

/**
 * Sanitizes raw waypoint data coming from component props: drops non-finite
 * entries and merges consecutive duplicates. Route planning has its own
 * computational budgets; user waypoint storage has no fixed count limit.
 * Always returns a fresh array.
 */
export function clampRoadWaypoints(value: unknown): RoadWaypoint[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: RoadWaypoint[] = []
  for (const entry of value) {
    const raw = entry as { x?: unknown; z?: unknown } | null | undefined
    const x = typeof raw?.x === 'number' ? raw.x : Number(raw?.x)
    const z = typeof raw?.z === 'number' ? raw.z : Number(raw?.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    const previous = out[out.length - 1]
    if (previous && Math.hypot(previous.x - x, previous.z - z) < ROAD_WAYPOINT_DEDUPE_DISTANCE) {
      continue
    }
    out.push({ x, z })
  }
  return out
}

/**
 * Transforms node-local XZ waypoints into world space (XZ only).
 * `matrix` is compatible with `THREE.Matrix4` (column-major `elements`);
 * local Y is treated as 0 because waypoints only carry XZ.
 */
export function transformRoadWaypointsToWorld(
  matrix: { elements: ArrayLike<number> },
  waypoints: ReadonlyArray<RoadWaypoint>,
): RoadWaypoint[] {
  const e = matrix.elements
  const out: RoadWaypoint[] = []
  for (const point of waypoints) {
    const x = e[0]! * point.x + e[8]! * point.z + e[12]!
    const z = e[2]! * point.x + e[10]! * point.z + e[14]!
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    out.push({ x, z })
  }
  return out
}
