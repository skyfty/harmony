import type * as THREE from 'three'
import type { FloorDynamicMesh, RoadDynamicMesh } from '@harmony/schema'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'
import type { WallWorldSegment } from '../wallPreviewGroupUtils'

export type EndpointGizmoDragMode = 'free' | 'axis'

export type RectangleCornerSide = { x: 'min' | 'max'; z: 'min' | 'max' }

export type RectangleEditConstraint = {
  cornerSides: [
    RectangleCornerSide,
    RectangleCornerSide,
    RectangleCornerSide,
    RectangleCornerSide,
  ]
  draggedCornerIndex: 0 | 1 | 2 | 3
  oppositeCornerWorld: THREE.Vector3
}

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

  dragMode: EndpointGizmoDragMode
  axisWorld: THREE.Vector3 | null
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3

  startVertex: [number, number]
  containerObject: THREE.Object3D
  roadGroup: THREE.Object3D
  baseDefinition: RoadDynamicMesh
  workingDefinition: RoadDynamicMesh
}

export type FloorVertexDragState = {
  pointerId: number
  nodeId: string
  vertexIndex: number
  startX: number
  startY: number
  moved: boolean

  /** Captured from the current floor brush at drag start. */
  floorBuildShape: FloorBuildShape

  /** Shape-specific constraints captured when drag begins (threshold crossed). */
  editConstraint:
    | null
    | {
        kind: 'rectangle'
        boundsStart: { minX: number; maxX: number; minZ: number; maxZ: number }
        draggedSide: { x: 'min' | 'max'; z: 'min' | 'max' }
      }
    | {
        kind: 'circle'
        centerLocal: { x: number; z: number }
        segments: number
      }

  dragMode: EndpointGizmoDragMode
  axisWorld: THREE.Vector3 | null
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3

  // Captured when drag actually begins (threshold crossed). Use as baseline
  // to compute deltas and avoid an initial jump.
  startHitWorld: THREE.Vector3 | null

  startVertex: [number, number]
  containerObject: THREE.Object3D
  runtimeObject: THREE.Object3D
  baseDefinition: FloorDynamicMesh
  workingDefinition: FloorDynamicMesh
}

export type WallEndpointDragState = {
  pointerId: number
  nodeId: string
  chainStartIndex: number
  chainEndIndex: number
  endpointKind: 'start' | 'end'

  wallBuildShape: WallBuildShape
  rectangleConstraint: RectangleEditConstraint | null

  startX: number
  startY: number
  moved: boolean

  dragMode: EndpointGizmoDragMode
  axisWorld: THREE.Vector3 | null
  dragPlane: THREE.Plane

  containerObject: THREE.Object3D

  dimensions: { height: number; width: number; thickness: number }
  baseSegmentsWorld: WallWorldSegment[]
  workingSegmentsWorld: WallWorldSegment[]

  anchorPointWorld: THREE.Vector3
  startEndpointWorld: THREE.Vector3

  previewGroup: THREE.Group | null
  previewSignature: string | null
}

export type WallJointDragState = {
  pointerId: number
  nodeId: string
  chainStartIndex: number
  chainEndIndex: number
  /** Segment index i where the joint is between segments[i].end and segments[i+1].start */
  jointIndex: number

  wallBuildShape: WallBuildShape
  rectangleConstraint: RectangleEditConstraint | null

  startX: number
  startY: number
  moved: boolean

  dragMode: EndpointGizmoDragMode
  axisWorld: THREE.Vector3 | null
  dragPlane: THREE.Plane

  containerObject: THREE.Object3D

  dimensions: { height: number; width: number; thickness: number }
  baseSegmentsWorld: WallWorldSegment[]
  workingSegmentsWorld: WallWorldSegment[]

  startJointWorld: THREE.Vector3

  previewGroup: THREE.Group | null
  previewSignature: string | null
}

export type WallHeightDragState = {
  pointerId: number
  nodeId: string

  startX: number
  startY: number
  moved: boolean

  // Always axis drag along world up (+Y). `axisSign` indicates whether the picked arrow
  // was +Y (1) or -Y (-1), so dragging up/down feels consistent with the arrow direction.
  axisSign: 1 | -1
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3

  // Captured when the interaction crosses the click-drag threshold.
  // Used as the reference point for delta computation to avoid an initial jump.
  startHitWorld: THREE.Vector3 | null

  startHeight: number

  containerObject: THREE.Object3D

  dimensions: { height: number; width: number; thickness: number }
  baseSegmentsWorld: WallWorldSegment[]
  workingSegmentsWorld: WallWorldSegment[]

  previewGroup: THREE.Group | null
  previewSignature: string | null
}

export type WallCircleCenterDragState = {
  pointerId: number
  nodeId: string
  chainStartIndex: number
  chainEndIndex: number

  startX: number
  startY: number
  moved: boolean

  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null

  containerObject: THREE.Object3D

  dimensions: { height: number; width: number; thickness: number }
  baseSegmentsWorld: WallWorldSegment[]
  workingSegmentsWorld: WallWorldSegment[]

  startCenterWorld: THREE.Vector3

  previewGroup: THREE.Group | null
  previewSignature: string | null
}

export type WallCircleRadiusDragState = {
  pointerId: number
  nodeId: string
  chainStartIndex: number
  chainEndIndex: number

  startX: number
  startY: number
  moved: boolean

  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null

  containerObject: THREE.Object3D

  dimensions: { height: number; width: number; thickness: number }
  baseSegmentsWorld: WallWorldSegment[]
  workingSegmentsWorld: WallWorldSegment[]

  centerWorld: THREE.Vector3
  startRadius: number

  previewGroup: THREE.Group | null
  previewSignature: string | null
}

export type FloorThicknessDragState = {
  pointerId: number
  nodeId: string
  vertexIndex: number

  startX: number
  startY: number
  moved: boolean

  // Always axis drag along world up (+Y). `axisSign` indicates whether the picked arrow
  // was +Y (1) or -Y (-1), so dragging up/down feels consistent with the arrow direction.
  axisSign: 1 | -1
  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3

  // Captured when the interaction crosses the click-drag threshold.
  // Used as the reference point for delta computation to avoid an initial jump.
  startHitWorld: THREE.Vector3 | null

  startThickness: number
  thickness: number

  containerObject: THREE.Object3D
}

export type FloorCircleCenterDragState = {
  pointerId: number
  nodeId: string

  startX: number
  startY: number
  moved: boolean

  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null

  containerObject: THREE.Object3D
  runtimeObject: THREE.Object3D

  baseDefinition: FloorDynamicMesh
  workingDefinition: FloorDynamicMesh

  startCenterLocal: { x: number; z: number }
  segments: number
}

export type FloorCircleRadiusDragState = {
  pointerId: number
  nodeId: string

  startX: number
  startY: number
  moved: boolean

  dragPlane: THREE.Plane
  startPointWorld: THREE.Vector3
  startHitWorld: THREE.Vector3 | null

  containerObject: THREE.Object3D
  runtimeObject: THREE.Object3D

  baseDefinition: FloorDynamicMesh
  workingDefinition: FloorDynamicMesh

  centerLocal: { x: number; z: number }
  segments: number
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
  nextFloorVertexDragState?: FloorVertexDragState | null
  nextFloorThicknessDragState?: FloorThicknessDragState | null
  nextFloorCircleCenterDragState?: FloorCircleCenterDragState | null
  nextFloorCircleRadiusDragState?: FloorCircleRadiusDragState | null
  nextWallEndpointDragState?: WallEndpointDragState | null
  nextWallJointDragState?: WallJointDragState | null
  nextWallHeightDragState?: WallHeightDragState | null
  nextWallCircleCenterDragState?: WallCircleCenterDragState | null
  nextWallCircleRadiusDragState?: WallCircleRadiusDragState | null
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
  nextFloorVertexDragState?: FloorVertexDragState | null
  nextFloorThicknessDragState?: FloorThicknessDragState | null
  nextFloorCircleCenterDragState?: FloorCircleCenterDragState | null
  nextFloorCircleRadiusDragState?: FloorCircleRadiusDragState | null
  nextWallEndpointDragState?: WallEndpointDragState | null
  nextWallJointDragState?: WallJointDragState | null
  nextWallHeightDragState?: WallHeightDragState | null
  nextWallCircleCenterDragState?: WallCircleCenterDragState | null
  nextWallCircleRadiusDragState?: WallCircleRadiusDragState | null
  clearFloorEdgeDragState?: boolean
}
