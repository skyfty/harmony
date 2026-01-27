
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
  /** When true, export embeds all referenced runtime assets into the ZIP for offline use. */
  embedAssets: boolean
}

export interface GLBExportSettings {
    onlyVisible?: boolean
    includeCustomExtensions?: boolean
}