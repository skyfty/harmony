export type CameraGestureFrameApi = {
  request: (callback: FrameRequestCallback) => number
  cancel: (handle: number) => void
}

export type LatestCameraGestureFrameCoalescer<T> = {
  push: (value: T) => void
  flush: () => boolean
  cancel: () => void
  dispose: () => void
}

export function createLatestCameraGestureFrameCoalescer<T>(
  onFlush: (value: T) => void,
  frameApi: CameraGestureFrameApi,
): LatestCameraGestureFrameCoalescer<T> {
  let pendingValue: T | null = null
  let frameHandle: number | null = null

  const cancelScheduledFrame = () => {
    if (frameHandle === null) {
      return
    }
    frameApi.cancel(frameHandle)
    frameHandle = null
  }

  const flush = (): boolean => {
    cancelScheduledFrame()
    if (pendingValue === null) {
      return false
    }
    const value = pendingValue
    pendingValue = null
    onFlush(value)
    return true
  }

  const push = (value: T) => {
    pendingValue = value
    if (frameHandle !== null) {
      return
    }
    frameHandle = frameApi.request(() => {
      frameHandle = null
      flush()
    })
  }

  const cancel = () => {
    cancelScheduledFrame()
    pendingValue = null
  }

  return {
    push,
    flush,
    cancel,
    dispose: cancel,
  }
}
