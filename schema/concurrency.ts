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

  /**
   * True when a permit is not immediately available, i.e. a caller would have to
   * queue. Used to decide whether it is worth handing the main thread back first.
   */
  isContended(): boolean {
    return this.available <= 0 || this.waiters.length > 0
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

type SchedulerWithYield = { yield?: () => Promise<void> }

let yieldChannel: MessageChannel | null = null
let yieldChannelUnavailable = false
let yieldResolvers: Array<() => void> = []

function ensureYieldChannel(): MessageChannel | null {
  if (yieldChannel) {
    return yieldChannel
  }
  if (yieldChannelUnavailable || typeof MessageChannel !== 'function') {
    return null
  }
  try {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      const resolvers = yieldResolvers
      yieldResolvers = []
      resolvers.forEach((resolve) => resolve())
    }
    yieldChannel = channel
    return channel
  } catch {
    yieldChannelUnavailable = true
    return null
  }
}

/**
 * Hand the main thread back so pending paint/input work can run.
 *
 * A semaphore alone only *orders* CPU-bound work: several queued model parses
 * still run back to back inside one task, so the render loop never gets a frame in
 * between and the frame rate collapses for the whole loading window. Awaiting this
 * between acquisitions gives the browser a chance to paint.
 *
 * Deliberately a macrotask (scheduler.yield / MessageChannel / setTimeout) rather
 * than requestAnimationFrame: we want to share the queue with rendering, not
 * compete for the frame callback slot.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    const scheduler = (globalThis as { scheduler?: SchedulerWithYield }).scheduler
    if (scheduler && typeof scheduler.yield === 'function') {
      void scheduler.yield().then(() => resolve(), () => resolve())
      return
    }
    const channel = ensureYieldChannel()
    if (channel) {
      yieldResolvers.push(resolve)
      channel.port2.postMessage(null)
      return
    }
    setTimeout(resolve, 0)
  })
}

/**
 * Like withSemaphore, but yields to the event loop first when the semaphore is
 * contended, so a queue of parses is spread across tasks instead of stacked into
 * one long main-thread block. Uncontended work runs without the extra hop.
 */
export async function withSemaphoreYielding<T>(semaphore: Semaphore, task: () => Promise<T>): Promise<T> {
  if (semaphore.isContended()) {
    await yieldToEventLoop()
  }
  return await withSemaphore(semaphore, task)
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
