import type { PointerMoveResult, InstancedEraseDragState } from './types'

type EraseRepairResult = {
  handled: boolean
  erasedKey?: string | null
}

export function handlePointerMoveScatter(
  event: PointerEvent,
  ctx: {
    scatterEraseModeActive: boolean
    hasInstancedMeshes: boolean

    updateRepairHoverHighlight: (event: PointerEvent) => void

    instancedEraseDragState: InstancedEraseDragState | null
    tryEraseRepairTargetAtPointer: (event: PointerEvent, options?: { skipKey?: string | null }) => EraseRepairResult

    pointerInteractionUpdateMoved: (event: PointerEvent) => void
  },
): PointerMoveResult | null {
  if (ctx.scatterEraseModeActive) {
    ctx.updateRepairHoverHighlight(event)

    if (ctx.instancedEraseDragState && ctx.instancedEraseDragState.pointerId === event.pointerId) {
      const isLeftDown = (event.buttons & 1) !== 0
      if (isLeftDown) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        // Throttle erase attempts slightly to avoid excessive updates.
        if (now - ctx.instancedEraseDragState.lastAtMs >= 24) {
          const result = ctx.tryEraseRepairTargetAtPointer(event, { skipKey: ctx.instancedEraseDragState.lastKey })
          ctx.instancedEraseDragState.lastAtMs = now
          if (result.handled && result.erasedKey) {
            ctx.instancedEraseDragState.lastKey = result.erasedKey
          }
        }
      }
    }

    ctx.pointerInteractionUpdateMoved(event)
  } else {
    ctx.updateRepairHoverHighlight(event)
  }

  return null
}
