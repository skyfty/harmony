export type DynamicMeshType = 'Ground' | 'Wall' | 'Platform'

const LEGACY_DYNAMIC_MESH_TYPE_MAP: Record<string, DynamicMeshType> = {
  ground: 'Ground',
  wall: 'Wall',
  platform: 'Platform',
}

export function normalizeDynamicMeshType(input: DynamicMeshType | string | null | undefined): DynamicMeshType {
  if (!input) {
    return 'Ground'
  }
  if (typeof input === 'string') {
    const legacy = LEGACY_DYNAMIC_MESH_TYPE_MAP[input]
    if (legacy) {
      return legacy
    }
    return input as DynamicMeshType
  }
  return input
}

export interface DynamicMeshVector3 {
  x: number
  y: number
  z: number
}

export interface GroundHeightMap {
  [key: string]: number
}

export interface GroundDynamicMesh {
  type: 'Ground'
  width: number
  depth: number
  rows: number
  columns: number
  cellSize: number
  heightMap: GroundHeightMap
  textureDataUrl?: string | null
  textureName?: string | null
}

export type WallSegment = {
  start: DynamicMeshVector3
  end: DynamicMeshVector3
  height: number
  width: number
  thickness: number
}

export interface WallDynamicMesh {
  type: 'Wall'
  /**
   * Placeholder control points describing wall segments in row-major order.
   * Each entry stores start and end positions in world space relative to the wall origin.
   */
  segments: WallSegment[]
}

export interface PlatformDynamicMesh {
  type: 'Platform'
  /**
   * Placeholder polygon footprint described in clockwise order.
   */
  footprint: DynamicMeshVector3[]
  height: number
}

export type SceneDynamicMesh = GroundDynamicMesh | WallDynamicMesh | PlatformDynamicMesh
