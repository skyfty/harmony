import type { AssetBlobDownloader, AssetBlobPayload } from './assetCache';
import { AssetDownloadWorkerUnavailableError } from './assetCache';

export type AssetDownloadWorkerFactory = () => Worker | null;

type WorkerProgressMessage = {
  type: 'progress';
  requestId: number;
  value: number;
};

type WorkerResultMessage = {
  type: 'result';
  requestId: number;
  url: string;
  mimeType: string | null;
  filename: string | null;
  buffer: ArrayBuffer;
};

type WorkerErrorMessage = {
  type: 'error';
  requestId: number;
  message: string;
};

type WorkerReadyMessage = {
  type: 'ready';
};

type WorkerPongMessage = {
  type: 'pong';
};

type WorkerOutgoingMessage =
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage
  | WorkerReadyMessage
  | WorkerPongMessage;

type WorkerDownloadMessage = {
  type: 'download';
  requestId: number;
  urlCandidates: string[];
};

type WorkerAbortMessage = {
  type: 'abort';
  requestId: number;
};

type WorkerPingMessage = {
  type: 'ping';
};

type WorkerIncomingMessage = WorkerDownloadMessage | WorkerAbortMessage | WorkerPingMessage;

type QueuedTask = {
  requestId: number;
  urlCandidates: string[];
  controller: AbortController;
  onProgress: (value: number) => void;
  resolve: (value: AssetBlobPayload) => void;
  reject: (error: unknown) => void;
  abortListener?: () => void;
  assignedSlot?: WorkerSlot;
  settled?: boolean;
};

const DEFAULT_POOL_SIZE = 2;
const assetDownloadWorkerPoolModuleTag = Math.random().toString(36).slice(2, 10);

function normalizePoolSize(): number {
  const hardwareConcurrency = (globalThis as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency;
  if (typeof hardwareConcurrency === 'number' && isFinite(hardwareConcurrency)) {
    return Math.max(1, Math.min(4, Math.floor(hardwareConcurrency - 1)));
  }
  return DEFAULT_POOL_SIZE;
}

class WorkerSlot {
  private readonly worker: Worker;
  private busy = false;
  private alive = true;
  private activeRequestId: number | null = null;
  private activeResolve: ((value: AssetBlobPayload) => void) | null = null;
  private activeReject: ((error: unknown) => void) | null = null;
  private activeOnProgress: ((value: number) => void) | null = null;
  private activeTimeoutHandle: number | null = null;
  private handshakeOk = false;
  private handshakeWaiters: Array<() => void> = [];

  constructor(worker: Worker) {
    this.worker = worker;

    this.worker.addEventListener('error', () => {
      this.alive = false;
      if (this.activeRequestId !== null) {
        this.finishError(new AssetDownloadWorkerUnavailableError('资源下载 Worker 脚本加载失败'));
      }
    });

    this.worker.addEventListener('messageerror', () => {
      this.alive = false;
      if (this.activeRequestId !== null) {
        this.finishError(new AssetDownloadWorkerUnavailableError('资源下载 Worker 消息解析失败'));
      }
    });

    this.worker.addEventListener('message', (event: MessageEvent<WorkerOutgoingMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'ready' || message.type === 'pong') {
        this.handshakeOk = true;
        const waiters = this.handshakeWaiters;
        this.handshakeWaiters = [];
        for (const wake of waiters) {
          try {
            wake();
          } catch {
            /* noop */
          }
        }
        return;
      }

      if (this.activeRequestId === null || message.requestId !== this.activeRequestId) {
        return;
      }

      if (message.type === 'progress') {
        const value = typeof message.value === 'number' && isFinite(message.value) ? message.value : 0;
        this.activeOnProgress?.(Math.max(0, Math.min(99, Math.round(value))));
        return;
      }

      if (message.type === 'result') {
        this.activeOnProgress?.(100);
        this.finishSuccess({
          blob: new Blob([message.buffer], { type: message.mimeType ?? 'application/octet-stream' }),
          mimeType: message.mimeType,
          filename: message.filename,
          url: message.url,
        });
        return;
      }

      if (message.type === 'error') {
        this.finishError(message.message === 'Aborted' ? createAbortError() : new Error(message.message));
      }
    });
  }

  isBusy(): boolean {
    return this.busy;
  }

  isAlive(): boolean {
    return this.alive;
  }

  async ensureHandshake(timeoutMs: number): Promise<void> {
    if (!this.alive) {
      throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 不可用');
    }
    if (this.handshakeOk) {
      return;
    }

    try {
      this.worker.postMessage({ type: 'ping' } satisfies WorkerIncomingMessage);
    } catch {
      this.alive = false;
      throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 创建失败');
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.handshakeWaiters.indexOf(resolve);
        if (index >= 0) {
          this.handshakeWaiters.splice(index, 1);
        }
        reject(new AssetDownloadWorkerUnavailableError('资源下载 Worker 无响应（可能脚本加载失败）'));
      }, timeoutMs) as unknown as number;

      const wake = () => {
        clearTimeout(timer);
        resolve();
      };

      this.handshakeWaiters.push(wake);
    });
  }

  run(task: QueuedTask): Promise<AssetBlobPayload> {
    this.busy = true;
    this.activeRequestId = task.requestId;

    return new Promise<AssetBlobPayload>((resolve, reject) => {
      this.activeResolve = resolve;
      this.activeReject = reject;
      this.activeOnProgress = task.onProgress;

      this.ensureHandshake(1500)
        .then(() => {
          if (this.activeRequestId !== task.requestId) {
            return;
          }

          this.activeTimeoutHandle = setTimeout(() => {
            if (this.activeRequestId === task.requestId) {
              this.finishError(new Error('资源下载超时（Worker 无响应）'));
            }
          }, 1200_000) as unknown as number;

          try {
            this.worker.postMessage({
              type: 'download',
              requestId: task.requestId,
              urlCandidates: task.urlCandidates,
            } satisfies WorkerIncomingMessage);
          } catch (error) {
            this.finishError(error instanceof Error ? error : new Error(String(error)));
          }
        })
        .catch((error) => {
          this.alive = false;
          try {
            this.worker.terminate();
          } catch {
            /* noop */
          }
          this.finishError(error);
        });
    });
  }

  abort(requestId: number): void {
    try {
      this.worker.postMessage({ type: 'abort', requestId } satisfies WorkerIncomingMessage);
    } catch {
      /* noop */
    }
  }

  dispose(): void {
    this.alive = false;
    try {
      this.worker.terminate();
    } catch {
      /* noop */
    }
  }

  private finishSuccess(payload: AssetBlobPayload): void {
    const resolve = this.activeResolve;
    this.resetActive();
    resolve?.(payload);
  }

  private finishError(error: unknown): void {
    const reject = this.activeReject;
    this.resetActive();
    reject?.(error);
  }

  private resetActive(): void {
    if (this.activeTimeoutHandle !== null) {
      clearTimeout(this.activeTimeoutHandle);
      this.activeTimeoutHandle = null;
    }
    this.busy = false;
    this.activeRequestId = null;
    this.activeResolve = null;
    this.activeReject = null;
    this.activeOnProgress = null;
  }
}

class AssetDownloadWorkerPool {
  private readonly poolSize: number;
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: QueuedTask[] = [];
  private nextRequestId = 1;
  private disposed = false;
  private readonly factorySnapshot: AssetDownloadWorkerFactory;

  constructor(factorySnapshot: AssetDownloadWorkerFactory, poolSize: number) {
    this.factorySnapshot = factorySnapshot;
    this.poolSize = Math.max(1, poolSize);
  }

  dispose(): void {
    this.disposed = true;
    while (this.queue.length) {
      this.queue.shift()?.reject(new AssetDownloadWorkerUnavailableError('资源下载 Worker 不可用'));
    }
    for (const slot of this.workers) {
      slot.dispose();
    }
    this.workers.length = 0;
  }

  submit(urlCandidates: string[], controller: AbortController, onProgress: (value: number) => void): Promise<AssetBlobPayload> {
    if (this.disposed) {
      return Promise.reject(new AssetDownloadWorkerUnavailableError('资源下载 Worker 不可用'));
    }
    this.ensureWorkers();

    if (controller.signal.aborted) {
      return Promise.reject(createAbortError());
    }

    const requestId = this.nextRequestId++;
    return new Promise<AssetBlobPayload>((resolve, reject) => {
      const task: QueuedTask = {
        requestId,
        urlCandidates,
        controller,
        onProgress,
        resolve,
        reject,
      };

      const abortListener = () => {
        if (task.settled) {
          return;
        }
        task.settled = true;
        this.removeQueuedTask(task);
        task.assignedSlot?.abort(requestId);
        reject(createAbortError());
      };

      task.abortListener = abortListener;
      controller.signal.addEventListener('abort', abortListener);
      this.queue.push(task);
      this.pump();
    });
  }

  private ensureWorkers(): void {
    if (typeof Worker === 'undefined') {
      throw new AssetDownloadWorkerUnavailableError('当前环境不支持 Worker');
    }

    for (let index = this.workers.length - 1; index >= 0; index -= 1) {
      if (!this.workers[index]!.isAlive()) {
        this.workers[index]!.dispose();
        this.workers.splice(index, 1);
      }
    }

    while (this.workers.length < this.poolSize) {
      const worker = this.factorySnapshot();
      if (!worker) {
        throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 创建失败');
      }
      this.workers.push(new WorkerSlot(worker));
    }
  }

  private removeQueuedTask(task: QueuedTask): void {
    const index = this.queue.indexOf(task);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  private pump(): void {
    if (this.disposed) {
      return;
    }

    for (const slot of this.workers) {
      if (slot.isBusy()) {
        continue;
      }

      const task = this.queue.shift();
      if (!task) {
        break;
      }

      if (task.controller.signal.aborted) {
        task.settled = true;
        task.controller.signal.removeEventListener('abort', task.abortListener!);
        task.reject(createAbortError());
        continue;
      }

      task.assignedSlot = slot;
      slot
        .run(task)
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          task.settled = true;
          task.controller.signal.removeEventListener('abort', task.abortListener!);
          this.pump();
        });
    }
  }
}

export function createWorkerAssetBlobDownloader(
  factory: AssetDownloadWorkerFactory,
  options: {
    poolSize?: number;
  } = {},
): AssetBlobDownloader {
  if (typeof factory !== 'function') {
    throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 未配置');
  }

  let pool: AssetDownloadWorkerPool | null = null;
  const poolSize = typeof options.poolSize === 'number' && isFinite(options.poolSize)
    ? Math.max(1, options.poolSize)
    : normalizePoolSize();

  return async (urlCandidates: string[], controller: AbortController, onProgress: (value: number) => void) => {
    if (!pool) {
      pool = new AssetDownloadWorkerPool(factory, poolSize);
    }
    console.info('[harmony-schema][asset-download] dispatching request to worker pool', {
      moduleTag: assetDownloadWorkerPoolModuleTag,
      candidateCount: urlCandidates.length,
      poolSize,
    })
    return await pool.submit(urlCandidates, controller, onProgress);
  };
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError');
  }
  const error = new Error('Aborted');
  (error as { name?: string }).name = 'AbortError';
  return error;
}
