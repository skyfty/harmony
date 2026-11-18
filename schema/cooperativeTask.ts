export interface CooperativeTaskOptions {
  now?: () => number
  timeBudgetMs?: number
  yieldToMainThread?: () => Promise<void>
  shouldAbort?: () => boolean
}

export interface CooperativeTask {
  now(): number
  assertActive(): void
  yieldIfNeeded(force?: boolean): Promise<void>
}

export class CooperativeTaskAbortedError extends Error {
  constructor() {
    super('Cooperative task aborted')
    this.name = 'CooperativeTaskAbortedError'
  }
}

const DEFAULT_COOPERATIVE_TIME_BUDGET_MS = 8

function defaultYieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

export function createCooperativeTask(
  options: CooperativeTaskOptions = {},
): CooperativeTask {
  const now = options.now ?? (() => Date.now())
  const timeBudgetMs = Math.max(0, options.timeBudgetMs ?? DEFAULT_COOPERATIVE_TIME_BUDGET_MS)
  const yieldToMainThread = options.yieldToMainThread ?? defaultYieldToMainThread
  const shouldAbort = options.shouldAbort ?? (() => false)
  let sliceStartedAtMs = now()

  const assertActive = (): void => {
    if (shouldAbort()) {
      throw new CooperativeTaskAbortedError()
    }
  }

  return {
    now,
    assertActive,
    async yieldIfNeeded(force = false) {
      assertActive()
      if (!force && now() - sliceStartedAtMs < timeBudgetMs) {
        return
      }
      await yieldToMainThread()
      assertActive()
      sliceStartedAtMs = now()
    },
  }
}
