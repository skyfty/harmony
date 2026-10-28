type HorizontalScrollDeltaOptions = {
  deltaMode: number
  deltaX: number
  deltaY: number
  viewportWidth: number
}

type HorizontalDragScrollLeftOptions = {
  startScrollLeft: number
  startX: number
  currentX: number
  maxScrollLeft: number
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

export function resolveHorizontalDragScrollLeft(
  options: HorizontalDragScrollLeftOptions,
): number {
  const startScrollLeft = Number.isFinite(options.startScrollLeft)
    ? options.startScrollLeft
    : 0
  const startX = Number.isFinite(options.startX) ? options.startX : 0
  const currentX = Number.isFinite(options.currentX) ? options.currentX : startX
  const maxScrollLeft = Number.isFinite(options.maxScrollLeft)
    ? Math.max(options.maxScrollLeft, 0)
    : 0
  const target = startScrollLeft - (currentX - startX)
  return Math.min(Math.max(target, 0), maxScrollLeft)
}
