import type { PointerMoveResult } from './types'

export function handlePointerMoveBuildTools(
  event: PointerEvent,
  ctx: {
    displayBoardBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    billboardBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    landformBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    regionBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    waterBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    floorBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    wallBuildToolHandlePointerMove: (event: PointerEvent) => boolean
    roadBuildToolHandlePointerMove: (event: PointerEvent) => boolean
  },
): PointerMoveResult | null {
  if (ctx.displayBoardBuildToolHandlePointerMove(event)) {
    return { handled: true }
  }

  if (ctx.billboardBuildToolHandlePointerMove(event)) {
    return { handled: true }
  }

  if (ctx.landformBuildToolHandlePointerMove(event)) {
    return { handled: true }
  }

  if (ctx.regionBuildToolHandlePointerMove(event)) {
    return { handled: true }
  }

  if (ctx.waterBuildToolHandlePointerMove(event)) {
    return { handled: true }
  }

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
