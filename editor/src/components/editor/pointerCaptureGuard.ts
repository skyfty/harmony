export type PointerCaptureGuard = {
  capture(pointerId: number): boolean
  release(pointerId: number): boolean
  releaseIfCaptured(pointerId: number): boolean
  hasCaptured(pointerId: number): boolean
}

export function createPointerCaptureGuard(getCanvas: () => HTMLCanvasElement | null): PointerCaptureGuard {
  const captured = new Set<number>()

  const capture = (pointerId: number): boolean => {
    const canvas = getCanvas()
    if (!canvas) {
      return false
    }
    try {
      canvas.setPointerCapture(pointerId)
      captured.add(pointerId)
      return true
    } catch {
      return false
    }
  }

  const release = (pointerId: number): boolean => {
    const canvas = getCanvas()
    captured.delete(pointerId)
    if (!canvas) {
      return false
    }
    try {
      if (typeof canvas.hasPointerCapture === 'function' && !canvas.hasPointerCapture(pointerId)) {
        return true
      }
      canvas.releasePointerCapture(pointerId)
      return true
    } catch {
      return false
    }
  }

  const releaseIfCaptured = (pointerId: number): boolean => {
    if (captured.has(pointerId)) {
      return release(pointerId)
    }

    const canvas = getCanvas()
    if (!canvas) {
      return false
    }
    try {
      if (typeof canvas.hasPointerCapture === 'function' && canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId)
        return true
      }
    } catch {
      return false
    }

    return false
  }

  return {
    hasCaptured: (pointerId) => captured.has(pointerId),
    capture,
    release,
    releaseIfCaptured,
  }
}
