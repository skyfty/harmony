export type GeometryType = 'box' | 'sphere' | 'plane' | 'external'

export interface Vector3Like {
  x: number
  y: number
  z: number
}

export interface SceneNode {
  id: string
  name: string
  geometry: GeometryType
  material: {
    color: string
    wireframe?: boolean
    opacity?: number
  }
  position: Vector3Like
  rotation: Vector3Like
  scale: Vector3Like
  children?: SceneNode[]
  /**
   * Optional runtime resource identifier used for externally loaded meshes.
   * Values in this field are not persisted across sessions.
   */
  resourceId?: string
}
