import type { PointerMoveResult } from './SceneViewportPointerDownTypes'

export function handlePointerMoveTools(
  event: PointerEvent,
  ctx: {
    nodePickerActive: boolean
    pickNodeAtPointer: (event: PointerEvent) => unknown | null
    updateNodePickerHighlight: (hit: unknown | null) => void

    handleGroundEditorPointerMove: (event: PointerEvent) => boolean
  },
): PointerMoveResult | null {
  if (ctx.nodePickerActive) {
    const hit = ctx.pickNodeAtPointer(event)
    ctx.updateNodePickerHighlight(hit)
    return {
      handled: true,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  if (ctx.handleGroundEditorPointerMove(event)) {
    return { handled: true }
  }

  return null
}
