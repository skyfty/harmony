
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
  includeExtras: boolean
  rotateCoordinateSystem: boolean
  lazyLoadMeshes: boolean
}

export interface GLBExportSettings {
    includeAnimations?: boolean
    onlyVisible?: boolean
    includeCustomExtensions?: boolean
}