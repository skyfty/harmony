import * as THREE from 'three'
import { resolveInfiniteGroundChunkKeyFromInstanceId } from '@schema/groundMesh'
import { resolveGroundRuntimeObject } from './groundRuntimeObject'

export type GroundSurfaceSampleSource = 'compiled' | 'flat' | 'sculpted' | 'fallback'

export type GroundSurfaceSample = {
  point: THREE.Vector3
  height: number
  source: GroundSurfaceSampleSource
}

const DEFAULT_GROUND_SURFACE_RAYCAST_DISTANCE = 20000
const DEFAULT_GROUND_SURFACE_PROBE_ORIGIN_Y = 10000

const groundSurfaceRaycaster = new THREE.Raycaster()

function resolveGroundSurfaceSource(intersection: THREE.Intersection): GroundSurfaceSampleSource {
  const object = intersection.object as THREE.Object3D | null
  const userData = object?.userData as Record<string, unknown> | undefined
  if (userData?.compiledGroundTile === true) {
    return 'compiled'
  }
  if (
    typeof intersection.instanceId === 'number'
    && intersection.instanceId >= 0
    && resolveInfiniteGroundChunkKeyFromInstanceId(intersection.object, intersection.instanceId)
  ) {
    return 'flat'
  }
  if (userData?.groundChunkBatch || userData?.groundChunk) {
    return 'flat'
  }
  return 'sculpted'
}

export function raycastGroundRuntimeSurface(
  ray: THREE.Ray,
  groundObject: THREE.Object3D | null | undefined,
  options: {
    maxDistance?: number
  } = {},
): GroundSurfaceSample | null {
  const runtimeGroundObject = resolveGroundRuntimeObject(groundObject) ?? groundObject ?? null
  if (!runtimeGroundObject) {
    return null
  }

  runtimeGroundObject.updateMatrixWorld(true)
  groundSurfaceRaycaster.near = 0
  groundSurfaceRaycaster.far = Number.isFinite(options.maxDistance)
    ? Math.max(0, Number(options.maxDistance))
    : DEFAULT_GROUND_SURFACE_RAYCAST_DISTANCE
  groundSurfaceRaycaster.ray.copy(ray)

  const intersections = groundSurfaceRaycaster.intersectObject(runtimeGroundObject, true)
  for (const intersection of intersections) {
    const point = intersection.point
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      continue
    }
    return {
      point: point.clone(),
      height: point.y,
      source: resolveGroundSurfaceSource(intersection),
    }
  }

  return null
}

export function sampleGroundRuntimeSurfaceAtWorldXZ(
  groundObject: THREE.Object3D | null | undefined,
  worldX: number,
  worldZ: number,
  options: {
    originY?: number
    maxDistance?: number
  } = {},
): GroundSurfaceSample | null {
  const ray = new THREE.Ray(
    new THREE.Vector3(
      worldX,
      Number.isFinite(options.originY) ? Number(options.originY) : DEFAULT_GROUND_SURFACE_PROBE_ORIGIN_Y,
      worldZ,
    ),
    new THREE.Vector3(0, -1, 0),
  )
  return raycastGroundRuntimeSurface(ray, groundObject, {
    maxDistance: options.maxDistance,
  })
}
