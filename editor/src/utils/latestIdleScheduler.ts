type IdleCallbackHandle = number

type IdleSchedulerWindow = Window & {
  requestIdleCallback?: (callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void, options?: { timeout?: number }) => IdleCallbackHandle
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void
}

export type LatestIdleScheduler<T> = {
  schedule: (value: T) => void
  flushNow: () => void
  cancel: () => void
  hasPending: () => boolean
}

export function createLatestIdleScheduler<T>(
  run: (value: T) => void,
  options: {
    timeoutMs?: number
  } = {},
): LatestIdleScheduler<T> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 120)
  const host = typeof window !== 'undefined' ? (window as IdleSchedulerWindow) : null

  let latestValue: T | null = null
  let pending = false
  let idleHandle: IdleCallbackHandle | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const clearHandles = (): void => {
    if (idleHandle !== null && host?.cancelIdleCallback) {
      host.cancelIdleCallback(idleHandle)
    }
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
    }
    idleHandle = null
    timeoutHandle = null
  }

  const execute = (): void => {
    if (latestValue === null) {
      clearHandles()
      pending = false
      return
    }

    const nextValue = latestValue
    latestValue = null
    clearHandles()
    pending = false
    run(nextValue)
  }

  const schedule = (value: T): void => {
    latestValue = value
    if (pending) {
      return
    }
    pending = true

    if (host?.requestIdleCallback) {
      idleHandle = host.requestIdleCallback(() => {
        execute()
      }, { timeout: timeoutMs })
      return
    }

    timeoutHandle = setTimeout(() => {
      execute()
    }, timeoutMs)
  }

  const flushNow = (): void => {
    if (!pending && latestValue === null) {
      return
    }
    execute()
  }

  const cancel = (): void => {
    latestValue = null
    pending = false
    clearHandles()
  }

  return {
    schedule,
    flushNow,
    cancel,
    hasPending: () => pending && latestValue !== null,
  }
}
