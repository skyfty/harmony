import type { Object3D } from 'three'
import type { StaticBoxCollisionProxy } from '../groundCollisionRuntimeBridge'

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
export const PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_COLLISION_USER_DATA_KEY = 'proceduralLandscapeRoadBoundaryCollision'
export const PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_COLLIDERS_USER_DATA_KEY = 'proceduralLandscapeRoadBoundaryColliders'
export const PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_VISUAL_USER_DATA_KEY = 'proceduralLandscapeRoadBoundaryVisual'
export const PROCEDURAL_LANDSCAPE_DEM_TERRAIN_USER_DATA_KEY = 'proceduralLandscapeDemTerrain'
export const PROCEDURAL_LANDSCAPE_DEM_COLLISION_SAMPLER_USER_DATA_KEY = 'proceduralLandscapeDemCollisionSampler'

export type ProceduralLandscapeDemCollisionSampler = {
  /** Visible DEM surface height in world space, or null outside the DEM bounds. */
  sampleHeightAt(worldX: number, worldZ: number): number | null
  /** Width of one rendered DEM cell in world meters. */
  cellSize: number
}

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

export function markProceduralLandscapeRoadBoundaryCollision(
  object: Object3D,
  colliders: ReadonlyArray<StaticBoxCollisionProxy>,
): void {
  object.userData[PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_COLLISION_USER_DATA_KEY] = true
  object.userData[PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_COLLIDERS_USER_DATA_KEY] = colliders.map(
    (collider) => ({
      center: [...collider.center],
      halfExtents: [...collider.halfExtents],
      rotation: [...collider.rotation],
    }),
  )
}

export function isProceduralLandscapeRoadBoundaryCollision(
  object: Object3D | null | undefined,
): boolean {
  if (!object) {
    return false
  }
  const userData = object.userData as Record<string, unknown> | undefined
  return userData?.[PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_COLLISION_USER_DATA_KEY] === true
}

export function resolveProceduralLandscapeRoadBoundaryColliders(
  object: Object3D | null | undefined,
): readonly StaticBoxCollisionProxy[] {
  if (!object) {
    return []
  }
  const userData = object.userData as Record<string, unknown> | undefined
  const candidate = userData?.[PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_COLLIDERS_USER_DATA_KEY]
  if (!Array.isArray(candidate)) {
    return []
  }
  const colliders: StaticBoxCollisionProxy[] = []
  for (const entry of candidate) {
    if (
      !entry
      || typeof entry !== 'object'
      || !Array.isArray((entry as StaticBoxCollisionProxy).center)
      || !Array.isArray((entry as StaticBoxCollisionProxy).halfExtents)
      || !Array.isArray((entry as StaticBoxCollisionProxy).rotation)
    ) {
      return []
    }
    const center = (entry as StaticBoxCollisionProxy).center
    const halfExtents = (entry as StaticBoxCollisionProxy).halfExtents
    const rotation = (entry as StaticBoxCollisionProxy).rotation
    if (
      center.length !== 3
      || halfExtents.length !== 3
      || rotation.length !== 4
      || ![...center, ...halfExtents, ...rotation].every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
      || !halfExtents.every((value) => value > 0)
    ) {
      return []
    }
    colliders.push({
      center: [center[0]!, center[1]!, center[2]!],
      halfExtents: [halfExtents[0]!, halfExtents[1]!, halfExtents[2]!],
      rotation: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!],
    })
  }
  return colliders
}

/**
 * The isolation wall has a dedicated, invisible collision prism. Its seasonal
 * rendered mesh is decoration only and must not add a duplicate physics body.
 */
export function markProceduralLandscapeRoadBoundaryVisual(object: Object3D): void {
  object.userData[PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_VISUAL_USER_DATA_KEY] = true
}

export function isProceduralLandscapeRoadBoundaryVisual(
  object: Object3D | null | undefined,
): boolean {
  if (!object) {
    return false
  }
  const userData = object.userData as Record<string, unknown> | undefined
  return userData?.[PROCEDURAL_LANDSCAPE_ROAD_BOUNDARY_VISUAL_USER_DATA_KEY] === true
}

/**
 * Marks the streamed DEM surface as the mandatory ground collision source.
 * Road and roadbed collision ribbons remain ordinary nearby chunks; the DEM
 * terrain chunk under each Ground Anchor must be retained regardless of the
 * global resident-chunk budget.
 */
export function markProceduralLandscapeDemTerrain(
  object: Object3D,
  sampler?: ProceduralLandscapeDemCollisionSampler | null,
): void {
  object.userData[PROCEDURAL_LANDSCAPE_DEM_TERRAIN_USER_DATA_KEY] = true
  if (sampler) {
    object.userData[PROCEDURAL_LANDSCAPE_DEM_COLLISION_SAMPLER_USER_DATA_KEY] = sampler
  }
}

export function isProceduralLandscapeDemTerrain(
  object: Object3D | null | undefined,
): boolean {
  if (!object) {
    return false
  }
  const userData = object.userData as Record<string, unknown> | undefined
  return userData?.[PROCEDURAL_LANDSCAPE_DEM_TERRAIN_USER_DATA_KEY] === true
}

export function resolveProceduralLandscapeDemCollisionSampler(
  object: Object3D | null | undefined,
): ProceduralLandscapeDemCollisionSampler | null {
  if (!object) {
    return null
  }
  const userData = object.userData as Record<string, unknown> | undefined
  const candidate = userData?.[PROCEDURAL_LANDSCAPE_DEM_COLLISION_SAMPLER_USER_DATA_KEY] as
    | Partial<ProceduralLandscapeDemCollisionSampler>
    | undefined
  if (
    !candidate
    || typeof candidate.sampleHeightAt !== 'function'
    || typeof candidate.cellSize !== 'number'
    || !Number.isFinite(candidate.cellSize)
    || candidate.cellSize <= 0
  ) {
    return null
  }
  return candidate as ProceduralLandscapeDemCollisionSampler
}
