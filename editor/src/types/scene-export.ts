
export type SceneExportResult = {
  blob: Blob
}

export type SceneExportFormat =  'glb' | 'json'

export interface SceneExportOptions {
  format: SceneExportFormat
  fileName: string
  includeLights: boolean
  includeHiddenNodes: boolean
  includeSkeletons: boolean
  includeExtras: boolean
  rotateCoordinateSystem: boolean
  lazyLoadMeshes: boolean
}

export interface GLBExportSettings {
    onlyVisible?: boolean
    includeCustomExtensions?: boolean
}