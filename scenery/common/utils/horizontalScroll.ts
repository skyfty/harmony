type HorizontalScrollDeltaOptions = {
  deltaMode: number
  deltaX: number
  deltaY: number
  viewportWidth: number
}

const LINE_HEIGHT_PX = 16
const FALLBACK_VIEWPORT_WIDTH = 360

export function resolveHorizontalScrollDelta(
  options: HorizontalScrollDeltaOptions,
): number {
  const horizontal = Number.isFinite(options.deltaX) ? options.deltaX : 0
  const vertical = Number.isFinite(options.deltaY) ? options.deltaY : 0
  const delta = Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical
  if (!delta) {
    return 0
  }

  if (options.deltaMode === 1) {
    return delta * LINE_HEIGHT_PX
  }
  if (options.deltaMode === 2) {
    const viewportWidth = Number.isFinite(options.viewportWidth) && options.viewportWidth > 0
      ? options.viewportWidth
      : FALLBACK_VIEWPORT_WIDTH
    return delta * viewportWidth
  }
  return delta
}
