import type { Object3D } from 'three'

/**
 * Marks the procedural road surface so the mesh collision streamer can skip it.
 *
 * The road band is draped onto the terrain and lifted by only a few centimetres.
 * The ground / terrain collision underneath already supports characters and
 * vehicles, so indexing the dense road ribbon again would only duplicate bodies.
 * Walls, barriers and the DEM roadbed intentionally keep their collision.
 */
export const PROCEDURAL_LANDSCAPE_ROAD_SURFACE_USER_DATA_KEY = 'proceduralLandscapeRoadSurface'

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
