import type * as THREE from 'three'

export type PlacementSurfaceHit = {
  point: THREE.Vector3
  normal: THREE.Vector3
  nodeId: string
  distance: number
}

/**
 * Selects the closest placement surface without giving any provider implicit
 * priority. Equal-distance candidates keep their input order, which lets the
 * caller define deterministic tie-breaking.
 */
export function selectNearestPlacementSurfaceHit(
  candidates: ReadonlyArray<PlacementSurfaceHit | null | undefined>,
): PlacementSurfaceHit | null {
  let nearest: PlacementSurfaceHit | null = null
  for (const candidate of candidates) {
    if (!candidate || !Number.isFinite(candidate.distance)) {
      continue
    }
    if (!nearest || candidate.distance < nearest.distance) {
      nearest = candidate
    }
  }
  return nearest
}
