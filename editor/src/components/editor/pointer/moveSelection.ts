import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'

type SelectionDragLike = {
  nodeId: string
  object: unknown
  hasDragged: boolean
}

export function handlePointerMoveSelection(
  event: PointerEvent,
  ctx: {
    clickDragThresholdPx: number
    isAltOverrideActive: boolean

    pointerInteractionUpdateMoved: (event: PointerEvent) => void

    pointerTrackingState: PointerTrackingState | null
    transformControlsDragging: boolean

    sceneStoreBeginTransformInteraction: (nodeId: string) => void
    onSelectionDragStart?: (nodeId: string) => void

    updateSelectDragPosition: (drag: any, event: PointerEvent) => boolean
  },
): void {
  ctx.pointerInteractionUpdateMoved(event)

  if (ctx.isAltOverrideActive) {
    return
  }

  if (!ctx.pointerTrackingState || event.pointerId !== ctx.pointerTrackingState.pointerId) {
    return
  }

  if (ctx.transformControlsDragging) {
    ctx.pointerTrackingState.moved = true
    return
  }

  const dx = event.clientX - ctx.pointerTrackingState.startX
  const dy = event.clientY - ctx.pointerTrackingState.startY
  const distance = Math.hypot(dx, dy)

  if (ctx.pointerTrackingState.button === 2) {
    if (!ctx.pointerTrackingState.moved && distance >= ctx.clickDragThresholdPx) {
      ctx.pointerTrackingState.moved = true
    }
    return
  }

  if (ctx.pointerTrackingState.button !== 0) {
    return
  }

  const drag = ctx.pointerTrackingState.selectionDrag as unknown as (SelectionDragLike | null)

  if (drag) {
    if (!drag.hasDragged) {
      if (distance < ctx.clickDragThresholdPx) {
        return
      }
      drag.hasDragged = true
      ctx.pointerTrackingState.moved = true
      ctx.sceneStoreBeginTransformInteraction(drag.nodeId)
      ctx.onSelectionDragStart?.(drag.nodeId)
    }

    if (ctx.updateSelectDragPosition(drag as any, event)) {
      return
    }

    return
  }

  if (!ctx.pointerTrackingState.moved && distance >= ctx.clickDragThresholdPx) {
    ctx.pointerTrackingState.moved = true
  }
}
