import type { PointerUpResult } from './SceneViewportPointerDownTypes'

export function handlePointerUpTools(
  event: PointerEvent,
  ctx: {
    maybeCancelBuildToolOnRightDoubleClick: (event: PointerEvent) => boolean

    handleGroundEditorPointerUp: (event: PointerEvent) => boolean
    wallBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    roadBuildToolHandlePointerUp: (event: PointerEvent) => boolean

    activeBuildTool: string | null
    floorBuildToolHandlePointerUp: (event: PointerEvent) => boolean
  },
): PointerUpResult | null {
  if (event.button === 2 && ctx.maybeCancelBuildToolOnRightDoubleClick(event)) {
    return { handled: true }
  }

  if (ctx.handleGroundEditorPointerUp(event)) {
    return { handled: true }
  }

  if (ctx.wallBuildToolHandlePointerUp(event)) {
    return { handled: true }
  }

  if (ctx.roadBuildToolHandlePointerUp(event)) {
    return { handled: true }
  }

  if (ctx.activeBuildTool === 'floor') {
    const handled = ctx.floorBuildToolHandlePointerUp(event)
    if (handled) {
      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }
    return { handled: true }
  }

  return null
}
