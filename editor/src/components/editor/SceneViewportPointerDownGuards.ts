import type { PointerDownResult } from './SceneViewportPointerDownTypes'

export function handlePointerDownGuards(
  event: PointerEvent,
  ctx: {
    hasCanvas: boolean
    hasCamera: boolean
    hasScene: boolean
    isAltOverrideActive: boolean
  },
): PointerDownResult | null {
  if (!ctx.hasCanvas || !ctx.hasCamera || !ctx.hasScene) {
    return { handled: true, clearPointerTrackingState: true }
  }

  if (!event.isPrimary) {
    return { handled: true, clearPointerTrackingState: true }
  }

  if (ctx.isAltOverrideActive) {
    return { handled: true, clearPointerTrackingState: true }
  }

  return null
}
