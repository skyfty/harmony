import * as THREE from 'three'
import type { SceneNode, Vector3Like, WaterSurfaceMeshMetadata } from '@schema'
import {
  WATER_SURFACE_MESH_USERDATA_KEY,
  cloneWaterSurfaceMeshMetadata,
  createWaterSurfaceBufferGeometryFromMetadata,
  extractWaterSurfaceMeshMetadataFromUserData,
  normalizeWaterSurfaceMeshInput,
} from '@schema'
import {
  buildCirclePlanarPoints,
  computeApproxCircleFromPlanarPoints,
} from './planarEditMath'

export const WATER_SURFACE_HANDLE_ELEVATION = 0.03

export type WaterContourPoint = [number, number]

export function getWaterSurfaceMeshMetadata(node: SceneNode | null | undefined): WaterSurfaceMeshMetadata | null {
  return extractWaterSurfaceMeshMetadataFromUserData(node?.userData)
}

export function getWaterContourLocalPoints(node: SceneNode | null | undefined): WaterContourPoint[] {
  const metadata = getWaterSurfaceMeshMetadata(node)
  if (!metadata) {
    return []
  }
  return getWaterContourLocalPointsFromMetadata(metadata)
}

export function getWaterContourLocalPointsFromMetadata(metadata: WaterSurfaceMeshMetadata | null | undefined): WaterContourPoint[] {
  if (!metadata || !Array.isArray(metadata.contour)) {
    return []
  }

  const points: WaterContourPoint[] = []
  for (let index = 0; index < metadata.contour.length; index += 2) {
    const x = Number(metadata.contour[index])
    const y = Number(metadata.contour[index + 1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }
    points.push([x, y])
  }
  return points
}

export function buildWaterSurfaceMetadataFromLocalPoints(points: WaterContourPoint[]): WaterSurfaceMeshMetadata | null {
  const contour = points.flatMap(([x, y]) => [Number(x), Number(y)])
  try {
    return normalizeWaterSurfaceMeshInput({ contour })
  } catch {
    return null
  }
}

export function computeWaterContourSignature(metadata: WaterSurfaceMeshMetadata | null | undefined): string {
  if (!metadata?.contour?.length) {
    return 'empty'
  }
  return metadata.contour.map((value) => `${Math.round(Number(value) * 1000)}`).join(',')
}

export function computeWaterCircleLocalFromPoints(points: WaterContourPoint[]): {
  centerX: number
  centerY: number
  radius: number
  segments: number
} | null {
  return computeApproxCircleFromPlanarPoints(points)
}

export function buildWaterCircleLocalPoints(options: {
  centerX: number
  centerY: number
  radius: number
  segments: number
}): WaterContourPoint[] {
  return buildCirclePlanarPoints({
    centerX: options.centerX,
    centerY: options.centerY,
    radius: options.radius,
    segments: Math.max(3, Math.trunc(Number(options.segments) || 0)),
    minSegments: 3,
  })
}

export function convertWaterContourLocalPointsToWorldPoints(
  runtimeObject: THREE.Object3D,
  points: WaterContourPoint[],
): Vector3Like[] {
  return points.map(([x, y]) => {
    const world = runtimeObject.localToWorld(new THREE.Vector3(x, y, 0))
    return { x: world.x, y: world.y, z: world.z }
  })
}

export function updateWaterSurfaceRuntimeMesh(
  runtimeObject: THREE.Object3D,
  metadata: WaterSurfaceMeshMetadata,
): boolean {
  const mesh = (runtimeObject as THREE.Mesh).isMesh
    ? (runtimeObject as THREE.Mesh)
    : (runtimeObject.getObjectByProperty('isMesh', true) as THREE.Mesh | null)

  if (!mesh) {
    return false
  }

  const nextGeometry = createWaterSurfaceBufferGeometryFromMetadata(metadata)
  mesh.geometry?.dispose?.()
  mesh.geometry = nextGeometry
  mesh.userData = {
    ...(mesh.userData ?? {}),
    [WATER_SURFACE_MESH_USERDATA_KEY]: cloneWaterSurfaceMeshMetadata(metadata),
  }
  mesh.updateMatrixWorld(true)
  return true
}
