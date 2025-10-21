export type DynamicMeshType = 'ground' | 'wall' | 'platform'

export interface DynamicMeshVector3 {
  x: number
  y: number
  z: number
}

export interface GroundHeightMap {
  [key: string]: number
}

export interface GroundDynamicMesh {
  type: 'ground'
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
  type: 'wall'
  /**
   * Placeholder control points describing wall segments in row-major order.
   * Each entry stores start and end positions in world space relative to the wall origin.
   */
  segments: WallSegment[]
}

export interface PlatformDynamicMesh {
  type: 'platform'
  /**
   * Placeholder polygon footprint described in clockwise order.
   */
  footprint: DynamicMeshVector3[]
  height: number
}

export type SceneDynamicMesh = GroundDynamicMesh | WallDynamicMesh | PlatformDynamicMesh
