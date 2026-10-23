import { describe, expect, it, vi } from 'vitest'
import {
  createLatestCameraGestureFrameCoalescer,
  type CameraGestureFrameApi,
} from '../cameraGestureFrameCoalescer'

function createFrameApi() {
  let nextHandle = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const request = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle
    nextHandle += 1
    callbacks.set(handle, callback)
    return handle
  })
  const cancel = vi.fn((handle: number) => {
    callbacks.delete(handle)
  })
  const runNext = () => {
    const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined
    if (!entry) {
      return false
    }
    const [handle, callback] = entry
    callbacks.delete(handle)
    callback(16)
    return true
  }
  return { api: { request, cancel } satisfies CameraGestureFrameApi, request, cancel, runNext }
}

describe('createLatestCameraGestureFrameCoalescer', () => {
  it('applies only the latest pointer sample once per frame', () => {
    const frameApi = createFrameApi()
    const onFlush = vi.fn()
    const coalescer = createLatestCameraGestureFrameCoalescer(onFlush, frameApi.api)

    coalescer.push({ pointerId: 1, clientX: 10 })
    coalescer.push({ pointerId: 1, clientX: 20 })
    coalescer.push({ pointerId: 1, clientX: 30 })

    expect(frameApi.request).toHaveBeenCalledTimes(1)
    expect(onFlush).not.toHaveBeenCalled()

    expect(frameApi.runNext()).toBe(true)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenLastCalledWith({ pointerId: 1, clientX: 30 })

    coalescer.push({ pointerId: 1, clientX: 40 })
    expect(frameApi.request).toHaveBeenCalledTimes(2)
  })

  it('flushes the latest pending sample synchronously before pointer-up', () => {
    const frameApi = createFrameApi()
    const onFlush = vi.fn()
    const coalescer = createLatestCameraGestureFrameCoalescer(onFlush, frameApi.api)

    coalescer.push({ pointerId: 1, clientX: 12 })
    coalescer.push({ pointerId: 1, clientX: 24 })

    expect(coalescer.flush()).toBe(true)
    expect(frameApi.cancel).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledOnce()
    expect(onFlush).toHaveBeenLastCalledWith({ pointerId: 1, clientX: 24 })

    expect(frameApi.runNext()).toBe(false)
    expect(coalescer.flush()).toBe(false)
  })

  it('cancels pending input without applying it', () => {
    const frameApi = createFrameApi()
    const onFlush = vi.fn()
    const coalescer = createLatestCameraGestureFrameCoalescer(onFlush, frameApi.api)

    coalescer.push({ pointerId: 1, clientX: 12 })
    coalescer.dispose()

    expect(frameApi.cancel).toHaveBeenCalledTimes(1)
    expect(frameApi.runNext()).toBe(false)
    expect(coalescer.flush()).toBe(false)
    expect(onFlush).not.toHaveBeenCalled()
  })
})
