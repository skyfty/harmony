import type { SceneNodeBase } from '@harmony/scene-schema'
import type { SceneDynamicMesh } from '@/types/dynamic-mesh'
import type { SceneNodeMaterial } from '@/types/material'
import type { LightNodeProperties } from '@/types/light'
import type { SceneNodeComponentState } from '@/types/node-component'

export type { SceneNodeType, Vector3Like } from '@harmony/scene-schema'

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

export interface SceneNode extends SceneNodeBase<
  SceneNodeMaterial,
  SceneNodeComponentState<any>,
  LightNodeProperties,
  CameraNodeProperties,
  SceneDynamicMesh,
  SceneNodeImportMetadata
> {
  children?: SceneNode[]
}
