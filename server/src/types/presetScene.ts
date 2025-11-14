export interface PresetSceneSummary {
  id: string
  name: string
  thumbnailUrl: string | null
  description?: string | null
}

export interface PresetSceneDocument {
  name?: string
  thumbnail?: string | null
  nodes?: unknown
  materials?: unknown
  selectedNodeId?: string | null
  selectedNodeIds?: string[]
  camera?: Record<string, unknown>
  viewportSettings?: Record<string, unknown>
  skybox?: Record<string, unknown>
  shadowsEnabled?: boolean
  groundSettings?: Record<string, unknown>
  panelVisibility?: Record<string, unknown>
  panelPlacement?: Record<string, unknown>
  resourceProviderId?: string
  createdAt?: string
  updatedAt?: string
  assetCatalog?: Record<string, unknown>
  assetIndex?: Record<string, unknown>
  packageAssetMap?: Record<string, string>
}

export interface PresetSceneDetail extends PresetSceneSummary {
  document: PresetSceneDocument
}
