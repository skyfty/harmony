
export type SceneExportResult = {
  blob: Blob
}

export type SceneExportFormat =  'glb' | 'json'

export type SceneExportLogLevel = 'info' | 'success' | 'warning' | 'error'

export type SceneExportPhase =
  | 'project'
  | 'scene'
  | 'node'
  | 'asset'
  | 'sidecar'
  | 'manifest'
  | 'archive'
  | 'diagnostics'

export type SceneExportLogStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface SceneExportProgressEvent {
  phase: SceneExportPhase
  message: string
  progress?: number
  level?: SceneExportLogLevel
  status?: SceneExportLogStatus
  sceneId?: string | null
  sceneName?: string | null
  nodeId?: string | null
  nodeName?: string | null
  assetId?: string | null
  assetName?: string | null
  current?: number
  total?: number
  detail?: string | null
}

export interface SceneExportLogEntry extends SceneExportProgressEvent {
  id: string
  timestamp: number
  level: SceneExportLogLevel
  status: SceneExportLogStatus
}

export interface SceneExportEntityProgress {
  current: number
  total: number
}

export interface SceneExportProgressSummary {
  phase: SceneExportPhase
  phaseLabel: string
  scenes: SceneExportEntityProgress | null
  nodes: SceneExportEntityProgress | null
  assets: SceneExportEntityProgress | null
  logs: number
}

export type SceneExportEventReporter = (event: SceneExportProgressEvent) => void

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