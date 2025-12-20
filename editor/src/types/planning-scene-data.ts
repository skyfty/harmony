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
}

export interface PlanningPolylineData {
  id: string
  name: string
  layerId: string
  points: PlanningPoint[]
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
  scaleRatio?: number
  alignMarker?: { x: number; y: number }
}

export type PlanningLayerKind = 'terrain' | 'building' | 'road' | 'green' | 'wall'

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
}

export interface PlanningSceneData {
  version: 1
  activeLayerId?: string
  layers?: PlanningLayerState[]
  viewTransform?: { scale: number; offset: { x: number; y: number } }
  polygons: PlanningPolygonData[]
  polylines: PlanningPolylineData[]
  images: PlanningImageData[]
}
