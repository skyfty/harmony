import type { GeometryType } from '@/plugins/geometry'
import type { SceneDynamicMesh } from '@/types/dynamic-mesh'
import type { SceneNodeMaterial } from '@/types/material'

export type SceneNodeType = 'mesh' | 'light' | 'group' | 'camera' | GeometryType

export interface CameraNodeProperties {
  kind: 'perspective' | 'orthographic'
  fov?: number
  near: number
  far: number
  aspect?: number
  zoom?: number
}

export interface SceneNodeImportMetadata {
  assetId: string
  objectPath: number[]
}

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
  nodeType: SceneNodeType
  materials?: SceneNodeMaterial[]
  light?: LightNodeProperties
  camera?: CameraNodeProperties
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
  dynamicMesh?: SceneDynamicMesh
  importMetadata?: SceneNodeImportMetadata
}
