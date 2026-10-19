import type { Object3D } from 'three'

/**
 * Marks the procedural road surface so collision diagnostics and physics
 * tooling can identify the generated ribbon.
 *
 * The road band is the rendered surface. Physics uses a decimated, invisible
 * collision-only ribbon at the same design height; the dense render mesh stays
 * out of the Ground Anchor collision index. The DEM readiness probe still
 * requires the underlying terrain mesh before physics starts, so do not treat a
 * road-only subtree as a fully loaded DEM source.
 */
export const PROCEDURAL_LANDSCAPE_ROAD_SURFACE_USER_DATA_KEY = 'proceduralLandscapeRoadSurface'
export const PROCEDURAL_LANDSCAPE_ROADBED_SURFACE_USER_DATA_KEY = 'proceduralLandscapeRoadbedSurface'
export const PROCEDURAL_LANDSCAPE_ROAD_COLLISION_USER_DATA_KEY = 'proceduralLandscapeRoadCollision'

export function markProceduralLandscapeRoadSurface(object: Object3D): void {
  object.userData[PROCEDURAL_LANDSCAPE_ROAD_SURFACE_USER_DATA_KEY] = true
}

export function isProceduralLandscapeRoadSurface(
  object: Object3D | null | undefined,
): boolean {
  if (!object) {
    return false
  }
  const userData = object.userData as Record<string, unknown> | undefined
  return userData?.[PROCEDURAL_LANDSCAPE_ROAD_SURFACE_USER_DATA_KEY] === true
}

export function markProceduralLandscapeRoadbedSurface(object: Object3D): void {
  object.userData[PROCEDURAL_LANDSCAPE_ROADBED_SURFACE_USER_DATA_KEY] = true
}

export function isProceduralLandscapeRoadbedSurface(
  object: Object3D | null | undefined,
): boolean {
  if (!object) {
    return false
  }
  const userData = object.userData as Record<string, unknown> | undefined
  return userData?.[PROCEDURAL_LANDSCAPE_ROADBED_SURFACE_USER_DATA_KEY] === true
}

export function markProceduralLandscapeRoadCollision(object: Object3D): void {
  object.userData[PROCEDURAL_LANDSCAPE_ROAD_COLLISION_USER_DATA_KEY] = true
}

export function isProceduralLandscapeRoadCollision(
  object: Object3D | null | undefined,
): boolean {
  if (!object) {
    return false
  }
  const userData = object.userData as Record<string, unknown> | undefined
  return userData?.[PROCEDURAL_LANDSCAPE_ROAD_COLLISION_USER_DATA_KEY] === true
}
