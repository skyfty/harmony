
import type { GroundSettings } from '@/types/ground-settings'
import type { AssetIndexEntry } from '@/types/asset-index-entry'
import type { SceneNode } from '@/types/scene'
import type { SceneMaterial } from '@/types/material'

export type SceneExportResult = {
  blob: Blob
}

export type SceneExportFormat =  'GLB' | 'JSON'

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
    onProgress: (progress: number, message?: string) => void
}

export interface GLBExportSettings {
    includeAnimations?: boolean
    onlyVisible?: boolean
    includeCustomExtensions?: boolean
}


export interface SceneJsonExportDocument {
  id: string
  name: string
  nodes: SceneNode[]
  materials: SceneMaterial[]
  groundSettings: GroundSettings
  assetIndex: Record<string, AssetIndexEntry>
  packageAssetMap: Record<string, string>
}
