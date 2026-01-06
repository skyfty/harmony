import type { PointerMoveResult } from './SceneViewportPointerDownTypes'

export function handlePointerMoveBuildTools(
  event: PointerEvent,
  ctx: {
    floorBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    wallBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    roadBuildToolHandlePointerMove: (event: PointerEvent) => boolean
  },
): PointerMoveResult | null {
  if (ctx.floorBuildToolHandlePointerMove(event)) {
    return { handled: true }
  }

  if (ctx.wallBuildToolHandlePointerMove(event)) {
    return { handled: true }
  }

  if (ctx.roadBuildToolHandlePointerMove(event)) {
    return { handled: true }
  }

  return null
}
