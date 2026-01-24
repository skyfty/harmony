import type { PointerUpResult, InstancedEraseDragState } from './types'

type EraseRepairResult = {
  handled: boolean
  erasedKey?: string | null
}

export function handlePointerUpScatter(
  event: PointerEvent,
  ctx: {
    instancedEraseDragState: InstancedEraseDragState | null
    pointerInteractionReleaseIfCaptured: (pointerId: number) => void

    scatterEraseModeActive: boolean
    pointerInteractionGet: () => any
    pointerInteractionEnsureMoved: (event: PointerEvent) => boolean
    pointerInteractionClearIfPointer: (pointerId: number) => void

    tryEraseRepairTargetAtPointer: (event: PointerEvent) => EraseRepairResult
  },
): PointerUpResult | null {
  if (ctx.instancedEraseDragState && event.pointerId === ctx.instancedEraseDragState.pointerId && event.button === 0) {
    ctx.pointerInteractionReleaseIfCaptured(event.pointerId)
    return {
      handled: true,
      nextInstancedEraseDragState: null,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  const interaction = ctx.pointerInteractionGet()
  if (
    ctx.scatterEraseModeActive &&
    interaction?.kind === 'repairClick' &&
    interaction.pointerId === event.pointerId &&
    event.button === 0
  ) {
    const moved = interaction.moved || ctx.pointerInteractionEnsureMoved(event)
    ctx.pointerInteractionClearIfPointer(event.pointerId)
    if (!moved) {
      const result = ctx.tryEraseRepairTargetAtPointer(event)
      if (result.handled) {
        return {
          handled: true,
          preventDefault: true,
          stopPropagation: true,
          stopImmediatePropagation: true,
        }
      }
    }
    return { handled: true }
  }

  return null
}
