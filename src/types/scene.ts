
export type SceneNodeType = 'mesh' | 'light' | 'group'

export type LightNodeType = 'directional' | 'point' | 'spot' | 'ambient'

export interface LightNodeProperties {
  type: LightNodeType
  color: string
  intensity: number
  distance?: number
  angle?: number
  decay?: number
  penumbra?: number
  target?: Vector3Like
  castShadow?: boolean
}

export interface Vector3Like {
  x: number
  y: number
  z: number
}

export interface SceneNode {
  id: string
  name: string
  nodeType?: SceneNodeType
  material?: {
    color: string
    wireframe?: boolean
    opacity?: number
  }
  light?: LightNodeProperties
  position: Vector3Like
  rotation: Vector3Like
  scale: Vector3Like
  children?: SceneNode[]
  sourceAssetId?: string
  visible?: boolean
  locked?: boolean
  isPlaceholder?: boolean
  downloadProgress?: number
  downloadStatus?: 'idle' | 'downloading' | 'ready' | 'error'
  downloadError?: string | null
}
