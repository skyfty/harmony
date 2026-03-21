import type { NodeHitResult } from './scene-viewport-node-hit-result'
import type { SelectionDragState } from './scene-viewport-selection-drag'

export interface DeferredDuplicateDragState {
  nodeIds: string[]
  primaryId: string
}

export interface PointerTrackingState {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  button: number
  hitResult: NodeHitResult | null
  selectionDrag: SelectionDragState | null
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  transformAxis: string | null
  deferredDuplicateDrag: DeferredDuplicateDragState | null
  deferredDuplicateInFlight: boolean
}
