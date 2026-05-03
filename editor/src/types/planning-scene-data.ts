import type { WaterPresetId } from '@schema/components'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'

export interface PlanningPoint {
  /** Optional stable vertex id; used to reconstruct shared vertices across polylines. */
  id?: string
  x: number
  y: number
}

export interface PlanningScatterAssignmentData {
  providerAssetId: string
  assetId: string
  category: TerrainScatterCategory
  name: string
  thumbnail: string | null
  densityPercent: number
  footprintAreaM2: number
  footprintMaxSizeM: number
}

export interface PlanningPolygonData {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  /** Optional; only meaningful when the polygon belongs to a terrain layer. Height delta in meters. */
  terrainHeightMeters?: number
  /** Optional; only meaningful when the polygon belongs to a terrain layer. Edge blend radius in meters. */
  terrainBlendMeters?: number
  /** Optional; only meaningful when the polygon belongs to a terrain layer. Null/undefined means no pond water preset. */
  terrainWaterPresetId?: WaterPresetId | null
  /** Optional; when true conversion may create/mark an air wall for this feature. */
  airWallEnabled?: boolean
  /** Optional green-layer scatter assignment metadata used during planning -> 3D conversion. */
  scatter?: PlanningScatterAssignmentData
}

export interface PlanningPolylineData {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
  /** Optional per-vertex metadata aligned with `points` when layer kind is 'guide-route'. */
  waypoints?: Array<{
    name?: string
    dock?: boolean
  }>
  /** Optional; when true conversion may create/mark an air wall for this feature. */
  airWallEnabled?: boolean
  /** Optional legacy scatter assignment metadata. Current conversion support is polygon-only. */
  scatter?: PlanningScatterAssignmentData
}

export interface PlanningImageData {
  id: string
  name: string
  url: string
  imageHash?: string
  filename?: string | null
  mimeType?: string | null
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

export type PlanningLayerKind = 'terrain' | 'green' | 'guide-route'

export interface PlanningLayerState {
  id: string
  name: string
  kind: PlanningLayerKind
  color: string
  visible: boolean
  locked: boolean
  conversionEnabled?: boolean
}

export interface PlanningSceneData {
  version: 1
  activeLayerId?: string
  layers: PlanningLayerState[]
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

export interface PlanningTerrainGeographicBounds {
  west: number
  south: number
  east: number
  north: number
  crs?: string | null
}

export interface PlanningTerrainWorldBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PlanningTerrainOrthophotoData {
  version: 1
  sourceFileHash?: string | null
  filename?: string | null
  mimeType?: string | null
  width?: number
  height?: number
  previewHash?: string | null
  previewSize?: { width: number; height: number } | null
  opacity?: number
  visible?: boolean
}

export type PlanningTerrainDemResolutionMode = 'auto' | 'manual'

export interface PlanningTerrainDemData {
  version: 1
  sourceFileHash?: string | null
  filename?: string | null
  mimeType?: string | null
  width?: number
  height?: number
  minElevation?: number | null
  maxElevation?: number | null
  sampleStepMeters?: number | null
  sourceSampleStepMeters?: number | null
  appliedSampleStepMeters?: number | null
  targetChunkResolution?: number | null
  resolutionMode?: PlanningTerrainDemResolutionMode | null
  geographicBounds?: PlanningTerrainGeographicBounds | null
  worldBounds?: PlanningTerrainWorldBounds | null
  previewHash?: string | null
  previewSize?: { width: number; height: number } | null
  orthophoto?: PlanningTerrainOrthophotoData | null
}

export interface PlanningTerrainData {
  version: 1
  mode?: PlanningTerrainMode
  grid?: PlanningTerrainGridSettings
  noise?: PlanningTerrainNoiseSettings
  controlPoints?: PlanningTerrainControlPoint[]
  ridgeValleyLines?: PlanningTerrainRidgeValleyLine[]
  dem?: PlanningTerrainDemData | null
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
