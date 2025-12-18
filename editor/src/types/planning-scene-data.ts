export interface PlanningPoint {
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

export interface PlanningLayerState {
  id: string
  visible: boolean
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
