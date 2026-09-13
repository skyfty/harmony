/**
 * Minimal counting semaphore for bounding concurrent async work (network
 * downloads, CPU-bound parsing) so that bursts of asset loads cannot saturate
 * the render main thread all at once.
 */
export class Semaphore {
  private available: number
  private readonly waiters: Array<() => void> = []

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`Semaphore capacity must be a positive integer, got ${capacity}`)
    }
    this.available = capacity
  }

  /**
   * Acquire a permit. Resolves with a release function. The release function
   * is idempotent-safe (releasing twice would over-count, so guard per call
   * site with try/finally).
   */
  acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1
      return Promise.resolve(() => this.release())
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => resolve(() => this.release()))
    })
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      next()
      return
    }
    this.available += 1
  }
}

/** Run `task` while holding one semaphore permit, releasing it on settle. */
export async function withSemaphore<T>(semaphore: Semaphore, task: () => Promise<T>): Promise<T> {
  const release = await semaphore.acquire()
  try {
    return await task()
  } finally {
    release()
  }
}
