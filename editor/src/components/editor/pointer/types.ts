import type * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'
import type { WallWorldSegment } from '../wallPreviewGroupUtils'

export type InstancedEraseDragState = {
  pointerId: number
  lastKey: string | null
  lastAtMs: number
}

export type RoadVertexDragState = {
  pointerId: number
  nodeId: string
  vertexIndex: number
  startX: number
  startY: number
  moved: boolean
  startVertex: [number, number]
  containerObject: THREE.Object3D
  roadGroup: THREE.Object3D
  baseDefinition: RoadDynamicMesh
  workingDefinition: RoadDynamicMesh
}

export type WallEndpointDragState = {
  pointerId: number
  nodeId: string
  chainStartIndex: number
  chainEndIndex: number
  endpointKind: 'start' | 'end'

  startX: number
  startY: number
  moved: boolean

  containerObject: THREE.Object3D

  dimensions: { height: number; width: number; thickness: number }
  baseSegmentsWorld: WallWorldSegment[]
  workingSegmentsWorld: WallWorldSegment[]

  anchorPointWorld: THREE.Vector3
  startEndpointWorld: THREE.Vector3

  previewGroup: THREE.Group | null
  previewSignature: string | null
}

export type PointerDownResult = {
  handled: true
  clearPointerTrackingState?: boolean

  capturePointerId?: number
  preventDefault?: boolean
  stopPropagation?: boolean
  stopImmediatePropagation?: boolean

  nextPointerTrackingState?: PointerTrackingState | null
  nextInstancedEraseDragState?: InstancedEraseDragState | null
  nextRoadVertexDragState?: RoadVertexDragState | null
  nextWallEndpointDragState?: WallEndpointDragState | null
}

export type PointerMoveResult = {
  handled: true
  preventDefault?: boolean
  stopPropagation?: boolean
  stopImmediatePropagation?: boolean
}

export type PointerUpResult = {
  handled: true

  preventDefault?: boolean
  stopPropagation?: boolean
  stopImmediatePropagation?: boolean

  releaseIfCapturedPointerId?: number

  clearPointerTrackingState?: boolean
  nextPointerTrackingState?: PointerTrackingState | null

  nextInstancedEraseDragState?: InstancedEraseDragState | null
  nextRoadVertexDragState?: RoadVertexDragState | null
  nextWallEndpointDragState?: WallEndpointDragState | null
  clearFloorEdgeDragState?: boolean
}
