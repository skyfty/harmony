import type { GeometryType } from '@/plugins/geometry'
import type { SceneDynamicMesh } from '@/types/dynamic-mesh'
import type { SceneNodeMaterial } from '@/types/material'
import type { LightNodeProperties } from '@/types/light'
import type { SceneNodeComponentState } from '@/types/node-component'

export type SceneNodeType = 'Mesh' | 'Light' | 'Group' | 'Camera' | GeometryType

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
  components?: SceneNodeComponentState<any>[]
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
