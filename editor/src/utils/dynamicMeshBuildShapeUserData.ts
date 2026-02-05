import type { SceneNode } from '@harmony/schema'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'

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
  return value === 'polygon' || value === 'rectangle' || value === 'circle'
}

export function readFloorBuildShapeFromNode(node: SceneNode | null | undefined): FloorBuildShape | null {
  const raw = readDynamicMeshBuildShapeFromUserData(node?.userData)
  return isFloorBuildShape(raw) ? raw : null
}

export function readWallBuildShapeFromNode(node: SceneNode | null | undefined): WallBuildShape | null {
  const raw = readDynamicMeshBuildShapeFromUserData(node?.userData)
  return isWallBuildShape(raw) ? raw : null
}
