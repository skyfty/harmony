import * as THREE from 'three'

/**
 * World-space circular keep-out area consumed by every procedural landscape
 * layer. Y is intentionally ignored: an exclusion applies through the full
 * vertical extent of the generated scene.
 */
export interface LandscapeExclusionCircle {
  id: string
  centerX: number
  centerZ: number
  radius: number
}

interface LandscapeExclusionRegistration {
  id: string
  object: THREE.Object3D | null
  radius: number
  enabled: boolean
}

const registrations = new Map<string, LandscapeExclusionRegistration>()
const worldPositionScratch = new THREE.Vector3()

function normalizeRadius(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

export function registerLandscapeExclusion(
  id: string,
  object: THREE.Object3D | null,
  radius: number,
  enabled = true,
): void {
  registrations.set(id, {
    id,
    object,
    radius: normalizeRadius(radius),
    enabled,
  })
}

export function updateLandscapeExclusion(
  id: string,
  patch: {
    object?: THREE.Object3D | null
    radius?: number
    enabled?: boolean
  },
): void {
  const current = registrations.get(id)
  if (!current) {
    return
  }
  if (patch.object !== undefined) {
    current.object = patch.object
  }
  if (patch.radius !== undefined) {
    current.radius = normalizeRadius(patch.radius)
  }
  if (patch.enabled !== undefined) {
    current.enabled = patch.enabled
  }
}

export function unregisterLandscapeExclusion(id: string): void {
  registrations.delete(id)
}

/**
 * Resolve the current world-space circles. Matrix reads happen here so moving
 * a parent node, using a transform proxy, or changing node scale is reflected
 * without a prop update. The radius itself is always in world meters.
 */
export function getLandscapeExclusionSnapshot(): LandscapeExclusionCircle[] {
  const circles: LandscapeExclusionCircle[] = []
  registrations.forEach((entry) => {
    if (!entry.enabled || !entry.object || !Number.isFinite(entry.radius) || entry.radius <= 0) {
      return
    }
    entry.object.updateWorldMatrix(true, false)
    worldPositionScratch.setFromMatrixPosition(entry.object.matrixWorld)
    if (
      !Number.isFinite(worldPositionScratch.x)
      || !Number.isFinite(worldPositionScratch.z)
    ) {
      return
    }
    circles.push({
      id: entry.id,
      centerX: worldPositionScratch.x,
      centerZ: worldPositionScratch.z,
      radius: entry.radius,
    })
  })
  circles.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  return circles
}

export function landscapeExclusionSignature(
  circles: ReadonlyArray<LandscapeExclusionCircle>,
): string {
  if (!circles.length) {
    return ''
  }
  return circles
    .map((circle) => [
      encodeURIComponent(circle.id),
      circle.centerX.toFixed(3),
      circle.centerZ.toFixed(3),
      circle.radius.toFixed(3),
    ].join(':'))
    .join('|')
}

export function isPointExcluded(
  x: number,
  z: number,
  circles: ReadonlyArray<LandscapeExclusionCircle>,
  margin = 0,
): boolean {
  for (const circle of circles) {
    const radius = circle.radius + Math.max(0, margin)
    const dx = x - circle.centerX
    const dz = z - circle.centerZ
    if (dx * dx + dz * dz <= radius * radius + 1e-9) {
      return true
    }
  }
  return false
}

/**
 * Squared point-to-segment distance. Kept local to avoid allocating projected
 * vectors while road and wall planning evaluate thousands of short segments.
 */
export function pointSegmentDistanceSquared(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= 1e-12) {
    const ox = px - ax
    const oz = pz - az
    return ox * ox + oz * oz
  }
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared),
  )
  const ox = px - (ax + dx * t)
  const oz = pz - (az + dz * t)
  return ox * ox + oz * oz
}

export function segmentIntersectsExclusion(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  circles: ReadonlyArray<LandscapeExclusionCircle>,
  margin = 0,
): boolean {
  for (const circle of circles) {
    const radius = circle.radius + Math.max(0, margin)
    if (
      pointSegmentDistanceSquared(
        circle.centerX,
        circle.centerZ,
        ax,
        az,
        bx,
        bz,
      ) <= radius * radius + 1e-9
    ) {
      return true
    }
  }
  return false
}

export function polylineIntersectsExclusion(
  points: ReadonlyArray<{ x: number; z: number }>,
  circles: ReadonlyArray<LandscapeExclusionCircle>,
  margin = 0,
): boolean {
  if (points.length < 2) {
    return false
  }
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const point = points[index]!
    if (segmentIntersectsExclusion(previous.x, previous.z, point.x, point.z, circles, margin)) {
      return true
    }
  }
  return false
}

export function filterLandscapeExclusionPlacements<T extends { x: number; z: number }>(
  placements: ReadonlyArray<T>,
  circles: ReadonlyArray<LandscapeExclusionCircle>,
  marginAt?: (placement: T) => number,
): T[] {
  if (!circles.length) {
    return placements.slice()
  }
  return placements.filter((placement) => (
    !isPointExcluded(
      placement.x,
      placement.z,
      circles,
      marginAt ? marginAt(placement) : 0,
    )
  ))
}

/** Test-only reset so independent registries cannot leak between unit tests. */
export function resetLandscapeExclusionsForTests(): void {
  registrations.clear()
}
