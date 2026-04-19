import type { PointerUpResult } from './types'

export function handlePointerUpTools(
  event: PointerEvent,
  ctx: {
    maybeHandleBuildToolRightClick: (event: PointerEvent) => boolean

    handleGroundEditorPointerUp: (event: PointerEvent) => boolean
    displayBoardBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    billboardBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    boundaryWallBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    landformBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    regionBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    guideRouteBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    waterBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    wallBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    roadBuildToolHandlePointerUp: (event: PointerEvent) => boolean
    displayBoardEditModeActive?: boolean
    waterEditModeActive?: boolean
    wallEditModeActive?: boolean
    roadEditModeActive?: boolean
    floorEditModeActive?: boolean

    activeBuildTool: string | null
    floorBuildToolHandlePointerUp: (event: PointerEvent) => boolean
  },
): PointerUpResult | null {
  if (event.button === 2 && ctx.maybeHandleBuildToolRightClick(event)) {
    return { handled: true }
  }

  if (ctx.handleGroundEditorPointerUp(event)) {
    return { handled: true }
  }

  if (!ctx.displayBoardEditModeActive && ctx.displayBoardBuildToolHandlePointerUp(event)) {
    return {
      handled: true,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  if (ctx.billboardBuildToolHandlePointerUp(event)) {
    return {
      handled: true,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  if (ctx.activeBuildTool === 'boundaryWall') {
    const handled = ctx.boundaryWallBuildToolHandlePointerUp(event)
    if (handled) {
      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    if (event.button === 0) {
      return { handled: true }
    }
    return null
  }

  if (ctx.activeBuildTool === 'landform') {
    const handled = ctx.landformBuildToolHandlePointerUp(event)
    if (handled) {
      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    if (event.button === 0) {
      return { handled: true }
    }
    return null
  }

  if (ctx.activeBuildTool === 'region') {
    const handled = ctx.regionBuildToolHandlePointerUp(event)
    if (handled) {
      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    if (event.button === 0) {
      return { handled: true }
    }
    return null
  }

  if (ctx.activeBuildTool === 'guideRoute') {
    const handled = ctx.guideRouteBuildToolHandlePointerUp(event)
    if (handled) {
      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    if (event.button === 0) {
      return { handled: true }
    }
    return null
  }

  if (!ctx.waterEditModeActive && ctx.waterBuildToolHandlePointerUp(event)) {
    return {
      handled: true,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  if (!ctx.wallEditModeActive && ctx.wallBuildToolHandlePointerUp(event)) {
    return { handled: true }
  }

  if (!ctx.roadEditModeActive && ctx.roadBuildToolHandlePointerUp(event)) {
    return { handled: true }
  }

  if (ctx.activeBuildTool === 'floor') {
    const handled = ctx.floorEditModeActive ? false : ctx.floorBuildToolHandlePointerUp(event)
    if (handled) {
      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    // Floor build tool interactions are on left click; swallow left-button releases so
    // they don't fall through to selection. Do not swallow middle-button releases so
    // the viewport can apply its "middle click cancels tool / middle drag pans" logic.
    if (event.button === 0) {
      return { handled: true }
    }
    return null
  }

  return null
}
