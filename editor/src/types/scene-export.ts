import type { AssetIndexEntry } from '@/types/asset-index-entry'
import type { SceneNode } from '@/types/scene'
import type { SceneMaterial } from '@/types/material'
import type { SceneJsonExportDocument as BaseSceneJsonExportDocument } from '@harmony/scene-schema'

export type SceneExportResult = {
  blob: Blob
}

export type SceneExportFormat =  'glb' | 'json'

export interface SceneExportOptions {
    format: SceneExportFormat
    fileName: string
    includeTextures: boolean
    includeAnimations: boolean
    includeSkybox: boolean
    includeLights: boolean
    includeHiddenNodes: boolean
    includeSkeletons: boolean
    includeCameras: boolean
    includeExtras: boolean
    rotateCoordinateSystem: boolean
}

export interface GLBExportSettings {
    includeAnimations?: boolean
    onlyVisible?: boolean
    includeCustomExtensions?: boolean
}


export type SceneJsonExportDocument = BaseSceneJsonExportDocument<
  SceneNode,
  SceneMaterial,
  Record<string, AssetIndexEntry>,
  Record<string, string>
>
