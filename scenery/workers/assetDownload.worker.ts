// Cross-platform asset download worker.
//
// H5: a module worker that fetches bytes off the render main thread and returns
// the joined ArrayBuffer via transfer (zero-copy).
// WeChat mini program: a logical worker running inside the shared worker
// dispatcher (pages/scenery/workers/index.js) that downloads via wx.request.
//
// Protocol mirrors schema/assetDownloadWorkerPool.ts:
//   in:  { type: 'ping' }
//   in:  { type: 'download', requestId, urlCandidates }
//   in:  { type: 'abort', requestId }
//   out: { type: 'pong' }
//        { type: 'progress', requestId, value }
//        { type: 'result', requestId, url, mimeType, filename, buffer }
//        { type: 'error', requestId, message }

declare const worker: unknown;

const ASSET_DOWNLOAD_WORKER_SCOPE = 'asset-download';

const inFlight = new Map<number, { abort: () => void }>();

// WeChat's worker runtime has no AbortController. The main-thread polyfill
// (@minisheep/mini-program-polyfill-core) is NOT loaded into the worker bundle,
// so provide a minimal, self-contained fallback here. On H5 the native
// AbortController is used so fetch() cancellation still works.
type AbortSignalLike = {
  readonly aborted: boolean
  addEventListener(type: string, listener: () => void, options?: unknown): void
  removeEventListener(type: string, listener: () => void): void
}

type AbortControllerLike = {
  readonly signal: AbortSignalLike
  abort(): void
}

function createAbortController(): AbortControllerLike {
  const Native = (globalThis as unknown as { AbortController?: new () => AbortController }).AbortController
  if (typeof Native === 'function') {
    const native = new Native()
    return {
      signal: native.signal as unknown as AbortSignalLike,
      abort: () => native.abort(),
    }
  }

  let aborted = false
  const listeners = new Set<() => void>()
  const signal: AbortSignalLike = {
    get aborted() {
      return aborted
    },
    addEventListener(type, listener) {
      if (type === 'abort') {
        listeners.add(listener)
      }
    },
    removeEventListener(type, listener) {
      if (type === 'abort') {
        listeners.delete(listener)
      }
    },
  }
  return {
    signal,
    abort() {
      if (aborted) {
        return
      }
      aborted = true
      listeners.forEach((listener) => {
        try {
          listener()
        } catch {
          /* noop */
        }
      })
      listeners.clear()
    },
  }
}

type DownloadRequestMessage = {
  type: 'download'
  requestId: number
  urlCandidates: string[]
}

type AbortRequestMessage = {
  type: 'abort'
  requestId: number
}

type PingRequestMessage = {
  type: 'ping'
}

type IncomingMessage = DownloadRequestMessage | AbortRequestMessage | PingRequestMessage

type ProgressMessage = {
  type: 'progress'
  requestId: number
  value: number
}

type ResultMessage = {
  type: 'result'
  requestId: number
  url: string
  mimeType: string | null
  filename: string | null
  buffer: ArrayBuffer
}

type ErrorMessage = {
  type: 'error'
  requestId: number
  message: string
}

type PongMessage = { type: 'pong' }
type OutgoingMessage = ProgressMessage | ResultMessage | ErrorMessage | PongMessage

type AssetDownloadEnvelope = {
  __scope: 'asset-download'
  clientId?: number
  message?: unknown
}

type WechatWorkerGlobalLike = {
  onMessage: (callback: (event: { data?: unknown }) => void) => void
  postMessage: (message: unknown, transferables?: ArrayBuffer[] | Transferable[]) => void
}

type SharedWorkerSelfLike = {
  addEventListener?: (type: 'message', callback: (event: { data?: unknown }) => void) => void
}

type H5WorkerScopeLike = {
  onmessage: ((event: { data?: unknown }) => void) | null
  postMessage: (message: unknown, transferables?: Transferable[]) => void
}

type WxRequestApi = {
  request: (options: {
    url: string
    method?: string
    responseType?: 'arraybuffer'
    header?: Record<string, string>
    success: (payload: { statusCode?: number; data?: unknown; header?: Record<string, string> }) => void
    fail: (error: unknown) => void
  }) => { abort?: () => void } | undefined
}

// WeChat Worker keeps only one worker.onMessage listener and its serialization
// cannot reliably carry TypedArray values. Mirror the minisheep worker-adapter
// MessageData protocol so the shared worker uses one consistent wire format.
const NO_TRANSFER_MARKER = '__message_data_no_transfer';

function encodeWorkerValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength === 0 ? '__arraybuffer:0' : value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    let normalizedView = view;
    if (view.byteOffset !== 0 || view.byteLength !== view.buffer.byteLength) {
      if (view instanceof DataView) {
        normalizedView = new DataView(
          view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
          0,
          view.byteLength,
        );
      } else {
        normalizedView = (view as unknown as { slice: () => ArrayBufferView }).slice();
      }
    }
    return {
      buffer: normalizedView.buffer,
      __typedArray: (value as { constructor: { name: string } }).constructor.name,
    };
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => encodeWorkerValue(item));
  }
  const ctor = (value as { constructor?: unknown }).constructor;
  if (typeof ctor !== 'function' || (ctor as { name?: string }).name !== 'Object') {
    return value;
  }
  const result: Record<string, unknown> = {};
  Object.keys(value as Record<string, unknown>).forEach((key) => {
    result[key] = encodeWorkerValue((value as Record<string, unknown>)[key]);
  });
  return result;
}

function decodeWorkerValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    if (value.startsWith('__arraybuffer')) {
      return new ArrayBuffer(0);
    }
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => decodeWorkerValue(item));
  }
  const record = value as Record<string, unknown>;
  const ctor = (value as { constructor?: unknown }).constructor;
  if (typeof ctor === 'function' && (ctor as { name?: string }).name === 'Object') {
    const keys = Object.keys(record);
    if (
      keys.length === 2
      && typeof record.__typedArray === 'string'
      && record.buffer instanceof ArrayBuffer
    ) {
      const TypedArrayCtor = (globalThis as Record<string, unknown>)[
        record.__typedArray
      ] as (new (buffer: ArrayBuffer) => unknown) | undefined;
      if (typeof TypedArrayCtor === 'function') {
        return new TypedArrayCtor(record.buffer);
      }
    }
    const result: Record<string, unknown> = {};
    Object.keys(record).forEach((key) => {
      result[key] = decodeWorkerValue(record[key]);
    });
    return result;
  }
  return value;
}

function decodeWorkerMessage(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && NO_TRANSFER_MARKER in value) {
    try {
      delete (value as Record<string, unknown>)[NO_TRANSFER_MARKER];
    } catch {
      // ignore
    }
    return value;
  }
  return decodeWorkerValue(value);
}

function extractFilenameFromHeaders(headers: Headers, url: string): string | null {
  const contentDisposition = headers.get('content-disposition')
  if (contentDisposition) {
    const match = /filename*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition)
    if (match) {
      const encoded = match[1] ?? match[2]
      if (encoded) {
        try {
          return decodeURIComponent(encoded)
        } catch {
          return encoded
        }
      }
    }
  }
  return extractFilenameFromUrl(url)
}

function extractFilenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : null
  } catch {
    return null
  }
}

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.byteLength)
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    return bytes.buffer
  }
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer
  }
  return new ArrayBuffer(0)
}

function resolveWxRequestApi(): WxRequestApi | null {
  const globalObject = globalThis as typeof globalThis & { wx?: WxRequestApi }
  const wxApi = globalObject.wx
  return wxApi && typeof wxApi.request === 'function' ? wxApi : null
}

async function downloadViaFetch(
  urlCandidates: string[],
  controller: AbortControllerLike,
  onProgress: (value: number) => void,
): Promise<{ url: string; mimeType: string | null; filename: string | null; buffer: ArrayBuffer }> {
  let lastNetworkError: unknown = null

  for (const candidate of urlCandidates) {
    try {
      const response = await fetch(candidate, { signal: controller.signal as unknown as AbortSignal })
      if (!response.ok) {
        throw new Error(`资源下载失败（${response.status}）`)
      }

      const mimeType = response.headers.get('content-type')
      const filename = extractFilenameFromHeaders(response.headers, response.url || candidate)
      const requestUrl = response.url || candidate
      const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10)

      if (!response.body) {
        const buffer = await response.arrayBuffer()
        onProgress(100)
        return { url: requestUrl, mimeType, filename, buffer }
      }

      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        if (value && value.byteLength) {
          chunks.push(value)
          received += value.byteLength
          if (total > 0) {
            onProgress(Math.min(99, Math.round((received / total) * 100)))
          } else {
            onProgress(Math.min(95, received % 100))
          }
        }
      }

      const joined = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        joined.set(chunk, offset)
        offset += chunk.byteLength
      }

      onProgress(100)
      return { url: requestUrl, mimeType, filename, buffer: joined.buffer }
    } catch (error) {
      if (error instanceof TypeError && candidate !== urlCandidates[0]) {
        lastNetworkError = error
        continue
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  if (lastNetworkError) {
    throw lastNetworkError instanceof Error ? lastNetworkError : new Error(String(lastNetworkError))
  }
  throw new Error('资源下载失败（网络错误）')
}

function downloadViaWxRequest(
  api: WxRequestApi,
  urlCandidates: string[],
  controller: AbortControllerLike,
  onProgress: (value: number) => void,
): Promise<{ url: string; mimeType: string | null; filename: string | null; buffer: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    const runCandidate = (index: number): void => {
      if (controller.signal.aborted) {
        reject(new Error('Aborted'))
        return
      }
      if (index >= urlCandidates.length) {
        reject(new Error('资源下载失败（网络错误）'))
        return
      }

      const candidate = urlCandidates[index]
      const task = api.request({
        url: candidate,
        method: 'GET',
        responseType: 'arraybuffer',
        success: (payload) => {
          const statusCode = payload.statusCode ?? 200
          if (statusCode < 200 || statusCode >= 300) {
            if (index + 1 < urlCandidates.length) {
              runCandidate(index + 1)
              return
            }
            reject(new Error(`资源下载失败（${statusCode}）`))
            return
          }
          const headers = normalizeResponseHeaders(payload.header)
          const mimeType = headers['content-type'] ?? null
          const filename = extractFilenameFromResponseHeader(headers, candidate)
          const buffer = toArrayBuffer(payload.data)
          onProgress(100)
          resolve({ url: candidate, mimeType, filename, buffer })
        },
        fail: (error) => {
          if (index + 1 < urlCandidates.length) {
            runCandidate(index + 1)
            return
          }
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      })

      if (task && typeof task.abort === 'function') {
        controller.signal.addEventListener('abort', () => task.abort?.(), { once: true })
      }
    }

    runCandidate(0)
  })
}

function normalizeResponseHeaders(headers?: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  if (!headers || typeof headers !== 'object') {
    return normalized
  }
  Object.entries(headers).forEach(([key, value]) => {
    const normalizedKey = typeof key === 'string' ? key.trim().toLowerCase() : ''
    const normalizedValue = typeof value === 'string' ? value.trim() : ''
    if (!normalizedKey || !normalizedValue) {
      return
    }
    normalized[normalizedKey] = normalizedValue
  })
  return normalized
}

function extractFilenameFromResponseHeader(headers: Record<string, string>, url: string): string | null {
  const contentDisposition = headers['content-disposition'] ?? headers['Content-Disposition']
  if (contentDisposition) {
    const match = /filename*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition)
    if (match) {
      const encoded = match[1] ?? match[2]
      if (encoded) {
        try {
          return decodeURIComponent(encoded)
        } catch {
          return encoded
        }
      }
    }
  }
  return extractFilenameFromUrl(url)
}

const workerGlobal = typeof worker !== 'undefined'
  ? (worker as unknown as WechatWorkerGlobalLike)
  : (globalThis as typeof globalThis & { worker?: WechatWorkerGlobalLike }).worker;

const sharedWorkerSelf = (globalThis as typeof globalThis & { __harmonyWorkerSelf?: SharedWorkerSelfLike })
  .__harmonyWorkerSelf;
const useSharedWorkerAdapter = Boolean(
  sharedWorkerSelf && typeof sharedWorkerSelf.addEventListener === 'function',
);

const h5WorkerScope = globalThis as unknown as H5WorkerScopeLike;
const isH5WorkerScope = typeof h5WorkerScope.postMessage === 'function' && !workerGlobal && !useSharedWorkerAdapter;

let currentClientId: number | null = null;

function postOutgoing(response: OutgoingMessage, transferables?: Transferable[]): void {
  if (workerGlobal && typeof workerGlobal.postMessage === 'function') {
    const envelope: AssetDownloadEnvelope = {
      __scope: ASSET_DOWNLOAD_WORKER_SCOPE,
      clientId: currentClientId ?? undefined,
      message: response,
    };
    workerGlobal.postMessage(encodeWorkerValue(envelope) as never);
    return;
  }
  if (isH5WorkerScope) {
    h5WorkerScope.postMessage(response, transferables ?? []);
  }
}

function postError(requestId: number, message: string): void {
  postOutgoing({ type: 'error', requestId, message });
}

function postProgress(requestId: number, value: number): void {
  postOutgoing({ type: 'progress', requestId, value });
}

function postResult(
  requestId: number,
  payload: { url: string; mimeType: string | null; filename: string | null; buffer: ArrayBuffer },
): void {
  postOutgoing(
    {
      type: 'result',
      requestId,
      url: payload.url,
      mimeType: payload.mimeType,
      filename: payload.filename,
      buffer: payload.buffer,
    },
    [payload.buffer],
  );
}

function handleWorkerMessage(event: unknown): void {
  // WeChat may deliver the raw message directly or wrapped in { data }.
  const runtimePayload = event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event;
  const rawData = useSharedWorkerAdapter ? runtimePayload : decodeWorkerMessage(runtimePayload);
  if (!rawData || typeof rawData !== 'object') {
    return;
  }

  let message: IncomingMessage | undefined;
  if (isH5WorkerScope) {
    // H5 dedicated worker: the posted message is the raw request (no envelope).
    message = rawData as IncomingMessage;
  } else {
    const envelope = rawData as AssetDownloadEnvelope;
    if (envelope.__scope !== ASSET_DOWNLOAD_WORKER_SCOPE) {
      return;
    }
    if (typeof envelope.clientId === 'number') {
      currentClientId = envelope.clientId;
    }
    message = envelope.message as IncomingMessage | undefined;
  }

  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'ping') {
    postOutgoing({ type: 'pong' });
    return;
  }

  if (message.type === 'abort') {
    const entry = inFlight.get(message.requestId);
    if (entry) {
      entry.abort();
      inFlight.delete(message.requestId);
    }
    return;
  }

  if (message.type !== 'download') {
    return;
  }

  const requestId = message.requestId;
  const urlCandidates = Array.isArray(message.urlCandidates) ? message.urlCandidates : [];
  if (!urlCandidates.length) {
    postError(requestId, '资源下载失败（无效的下载地址）');
    return;
  }

  const controller = createAbortController();
  inFlight.set(requestId, { abort: () => controller.abort() });

  const cleanup = () => {
    inFlight.delete(requestId);
  };

  const run = (): Promise<{ url: string; mimeType: string | null; filename: string | null; buffer: ArrayBuffer }> => {
    if (typeof fetch === 'function') {
      return downloadViaFetch(urlCandidates, controller, (value) => postProgress(requestId, value));
    }
    const wxApi = resolveWxRequestApi();
    if (wxApi) {
      return downloadViaWxRequest(wxApi, urlCandidates, controller, (value) => postProgress(requestId, value));
    }
    return Promise.reject(new Error('资源下载失败（当前 Worker 环境不支持下载）'));
  };

  run()
    .then((result) => {
      cleanup();
      postResult(requestId, result);
    })
    .catch((error) => {
      cleanup();
      const messageText = controller.signal.aborted
        ? 'Aborted'
        : error instanceof Error
          ? error.message
          : String(error);
      postError(requestId, messageText);
    });
}

if (useSharedWorkerAdapter) {
  sharedWorkerSelf?.addEventListener?.('message', handleWorkerMessage);
} else if (workerGlobal && typeof workerGlobal.onMessage === 'function') {
  workerGlobal.onMessage(handleWorkerMessage);
} else if (isH5WorkerScope) {
  h5WorkerScope.onmessage = (event) => {
    handleWorkerMessage(event);
  };
}

if (!useSharedWorkerAdapter && !workerGlobal && !isH5WorkerScope) {
  throw new Error('[asset-download-worker] not running inside a supported worker scope');
}
