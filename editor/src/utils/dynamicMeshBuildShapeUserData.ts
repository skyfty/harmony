import type { SceneNode, WallDynamicMesh } from '@schema'
import { compileWallSegmentsFromDefinition } from '@schema/wallLayout'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'
import { isWaterSurfaceNode } from '@/utils/waterBuildShapeUserData'

export const DYNAMIC_MESH_BUILD_SHAPE_USERDATA_KEY = '__harmonyBuildShape'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function mergeUserDataWithDynamicMeshBuildShape(
  userData: SceneNode['userData'] | undefined,
  buildShape: string,
): Record<string, unknown> {
  const base = isPlainRecord(userData) ? userData : {}
  return {
    ...base,
    [DYNAMIC_MESH_BUILD_SHAPE_USERDATA_KEY]: buildShape,
  }
}

export function readDynamicMeshBuildShapeFromUserData(userData: SceneNode['userData'] | undefined): string | null {
  if (!isPlainRecord(userData)) {
    return null
  }
  const raw = userData[DYNAMIC_MESH_BUILD_SHAPE_USERDATA_KEY]
  return typeof raw === 'string' && raw.trim().length ? raw : null
}

export function isFloorBuildShape(value: unknown): value is FloorBuildShape {
  return value === 'polygon' || value === 'rectangle' || value === 'circle'
}

export function isWallBuildShape(value: unknown): value is WallBuildShape {
  return value === 'line' || value === 'polygon' || value === 'rectangle' || value === 'circle'
}

function isClosedWallBuild(node: SceneNode | null | undefined): boolean {
  if (node?.dynamicMesh?.type !== 'Wall') {
    return false
  }

  const compiled = compileWallSegmentsFromDefinition(node.dynamicMesh as WallDynamicMesh)
  if (!compiled.length) {
    return false
  }

  const first = compiled[0]
  const last = compiled[compiled.length - 1]
  if (!first || !last) {
    return false
  }

  const dx = Math.abs(first.start.x - last.end.x)
  const dy = Math.abs(first.start.y - last.end.y)
  const dz = Math.abs(first.start.z - last.end.z)
  return dx <= 1e-6 && dy <= 1e-6 && dz <= 1e-6
}

export function readFloorBuildShapeFromNode(node: SceneNode | null | undefined): FloorBuildShape | null {
  const raw = readDynamicMeshBuildShapeFromUserData(node?.userData)
  return isFloorBuildShape(raw) ? raw : null
}

export function readWallBuildShapeFromNode(node: SceneNode | null | undefined): WallBuildShape | null {
  const raw = readDynamicMeshBuildShapeFromUserData(node?.userData)
  if (!isWallBuildShape(raw)) {
    return null
  }
  if (raw === 'polygon' && !isClosedWallBuild(node)) {
    return 'line'
  }
  return raw
}

export function isNodeExcludedFromSelectionBoundingBoxFallback(node: SceneNode | null | undefined): boolean {
  const dynamicMeshType = node?.dynamicMesh?.type
  if (
    dynamicMeshType === 'Road'
    || dynamicMeshType === 'Wall'
    || dynamicMeshType === 'Floor'
    || dynamicMeshType === 'Landform'
    || dynamicMeshType === 'Region'
  ) {
    return true
  }

  return isWaterSurfaceNode(node)
}
