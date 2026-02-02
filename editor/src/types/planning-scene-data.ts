export interface PlanningPoint {
  /** Optional stable vertex id; used to reconstruct shared vertices across polylines. */
  id?: string
  x: number
  y: number
}

export interface PlanningPolygonData {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  /** Optional; when true conversion may create/mark an air wall for this feature. */
  airWallEnabled?: boolean
  /** Optional; wall preset prefab asset id (.wall). When set, overrides the layer default. */
  wallPresetAssetId?: string | null
  /** Optional; floor preset prefab asset id (.floor). When set, overrides the layer default. */
  floorPresetAssetId?: string | null
}

export interface PlanningPolylineData {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  /** Optional per-vertex metadata aligned with `points` when layer kind is 'guide-route'. */
  waypoints?: Array<{
    name?: string
  }>
  /** 0-1. Only meaningful when layer kind is 'wall'. */
  cornerSmoothness?: number
  /** Optional; when true conversion may create/mark an air wall for this feature. */
  airWallEnabled?: boolean
  /** Optional; wall preset prefab asset id (.wall). When set, overrides the layer default. */
  wallPresetAssetId?: string | null
}

export interface PlanningImageData {
  id: string
  name: string
  url: string
  sizeLabel: string
  width: number
  height: number
  visible: boolean
  locked: boolean
  opacity: number
  position: { x: number; y: number }
  scale: number
  alignMarker?: { x: number; y: number }
}

export type PlanningLayerKind = 'terrain' | 'building' | 'road' | 'green' | 'wall' | 'floor' | 'water' | 'guide-route'

export interface PlanningLayerState {
  id: string
  /** Optional; older snapshots may not include it. */
  name?: string
  /** Optional; older snapshots may not include it. */
  kind?: PlanningLayerKind
  /** Optional; older snapshots may not include it. */
  color?: string
  visible: boolean
  /** Optional; older snapshots may not include it. */
  locked?: boolean
  /** Optional; currently used by road layers. */
  roadWidthMeters?: number
  /** Optional; controls how much road corners are rounded for this layer. */
  roadSmoothing?: number
  /** Optional; controls how smooth floor corners should be when converting. */
  floorSmooth?: number
  /** Optional; floor preset prefab asset id (expects .floor). */
  floorPresetAssetId?: string | null
  /** Optional; currently used by wall layers. */
  wallHeightMeters?: number
  /** Optional; currently used by wall layers. */
  wallThicknessMeters?: number
  /** Optional; wall preset prefab asset id (expects .wall). */
  wallPresetAssetId?: string | null
  /** Optional; controls water edge rounding when converting water layers. */
  waterSmoothing?: number
}

export interface PlanningSceneData {
  version: 1
  activeLayerId?: string
  layers?: PlanningLayerState[]
  viewTransform?: { scale: number; offset: { x: number; y: number } }
  /** Optional reference guides (axis-aligned) in world meters. */
  guides?: PlanningGuideData[]
  /** Optional terrain planning payload (procedural + structural). */
  terrain?: PlanningTerrainData
  polygons: PlanningPolygonData[]
  polylines: PlanningPolylineData[]
  images: PlanningImageData[]
}

export type PlanningTerrainMode = 'normal' | 'limited'

export type PlanningTerrainNoiseMode = 'simple' | 'perlin' | 'ridge' | 'voronoi' | 'flat'

export interface PlanningTerrainNoiseSettings {
  enabled: boolean
  seed?: number
  mode?: PlanningTerrainNoiseMode
  noiseScale?: number
  noiseAmplitude?: number
  noiseStrength?: number
  detailScale?: number
  detailAmplitude?: number
  edgeFalloff?: number
}

export type PlanningTerrainFalloff = 'linear' | 'smoothstep' | 'cosine'

export interface PlanningTerrainControlPoint {
  id: string
  name?: string
  x: number
  y: number
  radius: number
  /** Absolute target height in meters. */
  height: number
  falloff?: PlanningTerrainFalloff
}

export type PlanningTerrainLineKind = 'ridge' | 'valley'

export interface PlanningTerrainRidgeValleyLine {
  id: string
  name?: string
  kind: PlanningTerrainLineKind
  points: PlanningPoint[]
  /** Influence half-width in meters. */
  width: number
  /** Height delta amplitude in meters (ridge: +, valley: -). */
  strength: number
  profile?: PlanningTerrainFalloff
}

export interface PlanningTerrainAbsoluteOverrides {
  version: 1
  /** Absolute height overrides keyed by "row:col". */
  cells: Record<string, number>
}

export interface PlanningTerrainBudget {
  vertexCount: number
  expectedKeys: number
  limited: boolean
}

export interface PlanningTerrainGridSettings {
  /** Fixed grid cell size in meters. */
  cellSize: number
}

export interface PlanningTerrainData {
  version: 1
  mode?: PlanningTerrainMode
  grid?: PlanningTerrainGridSettings
  noise?: PlanningTerrainNoiseSettings
  controlPoints?: PlanningTerrainControlPoint[]
  ridgeValleyLines?: PlanningTerrainRidgeValleyLine[]
  /** Reserved for future 2D brush edits; defaults to absolute overrides. */
  overrides?: PlanningTerrainAbsoluteOverrides
  budget?: PlanningTerrainBudget
}

export type PlanningGuideAxis = 'x' | 'y'

export interface PlanningGuideData {
  id: string
  axis: PlanningGuideAxis
  /** World coordinate in meters. Can be negative. */
  value: number
}
