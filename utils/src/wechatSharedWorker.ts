export const WECHAT_SHARED_WORKER_PATH = 'pages/scenery/workers/index.js';

const INSTANCED_LOD_WORKER_SCOPE = 'instanced-lod';

function resolveWorkerScope(scriptPath: string): string | null {
  if (scriptPath.includes('physics-')) {
    return 'physics';
  }
  if (scriptPath.includes('instancedLod')) {
    return INSTANCED_LOD_WORKER_SCOPE;
  }
  if (scriptPath.includes('assetDownload')) {
    return 'asset-download';
  }
  return null;
}

type WechatWorkerLike = {
  postMessage(message: any, transferables?: Transferable[] | ArrayBuffer[]): void;
  onMessage(callback: (event: { data: any }) => void): void;
  terminate(): void;
};

type WxWorkerApi = {
  createWorker?: (scriptPath: string) => WechatWorkerLike;
};

type WorkerFacadeListener = (event: { data: any }) => void;

type WorkerFacadeState = {
  id: number;
  scriptPath: string;
  alive: boolean;
  listeners: Set<WorkerFacadeListener>;
};

type SharedWechatWorkerState = {
  realWorker: WechatWorkerLike | null;
  nextClientId: number;
  clients: Map<number, WorkerFacadeState>;
  lastRawClientId: number | null;
};

let sharedWorkerState: SharedWechatWorkerState | null = null;
let globalWorkerShimInstalled = false;

// WeChat Worker structured clone cannot reliably carry TypedArray values, so
// the worker side (minisheep worker-adapter + physics worker) uses a wire
// format that encodes typed arrays as { buffer, __typedArray }. Mirror the
// same MessageData protocol here so physics and KTX2 messages are encoded
// before posting and decoded before they reach facade listeners.
const NO_TRANSFER_MARKER = '__message_data_no_transfer';

/**
 * Raw (scope-less) workers all share one physical WeChat worker, so their
 * replies arrive on the same channel. Spark runs two of them (sort + LOD) and
 * keys its promises by RPC id, so "deliver to whoever posted last" silently
 * starves one of them. Namespace every outgoing raw RPC id per client and
 * restore it on the way back, which makes the reply routing exact.
 */
const RAW_ID_PREFIX = 'harmony-raw:';
const rawRoutedIds = new Map<string, { clientId: number; id: number | string }>();

/** Tag an outgoing raw RPC with its owning client so the reply can be routed. */
function namespaceRawMessageId(message: unknown, clientId: number): unknown {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return message;
  }
  const record = message as Record<string, unknown>;
  const originalId = record.id;
  if (typeof originalId !== 'number' && typeof originalId !== 'string') {
    return message;
  }
  const namespacedId = `${RAW_ID_PREFIX}${clientId}:${String(originalId)}`;
  rawRoutedIds.set(namespacedId, { clientId, id: originalId });
  // A worker that never answers would otherwise grow this forever; the map is
  // insertion ordered, so dropping the oldest entries keeps it bounded.
  while (rawRoutedIds.size > 4096) {
    const oldest = rawRoutedIds.keys().next();
    if (oldest.done) {
      break;
    }
    rawRoutedIds.delete(oldest.value);
  }
  return { ...record, id: namespacedId };
}

/** Resolve a worker reply back to the client that issued the RPC. */
function takeRawRoutedDelivery(
  payload: unknown,
): { clientId: number; message: unknown } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== 'string' || !id.startsWith(RAW_ID_PREFIX)) {
    return null;
  }
  const entry = rawRoutedIds.get(id);
  if (!entry) {
    return null;
  }
  // Spark sends progress messages (`{id, status}`) before the terminal reply
  // (`{id, result}` / `{id, error}`), all carrying the same RPC id. Dropping the
  // routing entry on the first message left the terminal reply unrouted, so the
  // caller's promise never settled (a pager fetcher stayed pending forever).
  const terminal = 'result' in record || 'error' in record;
  if (terminal) {
    rawRoutedIds.delete(id);
  }
  return { clientId: entry.clientId, message: { ...record, id: entry.id } };
}

function forgetRawRoutedIds(clientId: number): void {
  for (const [key, entry] of rawRoutedIds) {
    if (entry.clientId === clientId) {
      rawRoutedIds.delete(key);
    }
  }
}

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
    if (value.startsWith('__bigint') && typeof BigInt === 'function') {
      return BigInt(value.slice(9));
    }
    if (value.startsWith('__symbol') && typeof Symbol === 'function' && typeof Symbol.for === 'function') {
      const symbolName = value.slice(9);
      return Symbol.for(symbolName) || Symbol(symbolName);
    }
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

function encodeOutgoingMessage(value: unknown, withTransfer: boolean): unknown {
  if (typeof value === 'object' && value !== null) {
    if (withTransfer) {
      return encodeWorkerValue(value);
    }
    (value as Record<string, unknown>)[NO_TRANSFER_MARKER] = true;
    return value;
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

function getWxWorkerApi(): WxWorkerApi | null {
  const globalObject = globalThis as typeof globalThis & { wx?: WxWorkerApi };
  const wxApi = globalObject.wx;
  return wxApi && typeof wxApi.createWorker === 'function' ? wxApi : null;
}

export function isWechatSharedWorkerSupported(): boolean {
  return getWxWorkerApi() !== null;
}

function getOrCreateState(): SharedWechatWorkerState | null {
  if (!isWechatSharedWorkerSupported()) {
    return null;
  }
  if (!sharedWorkerState) {
    sharedWorkerState = {
      realWorker: null,
      nextClientId: 1,
      clients: new Map(),
      lastRawClientId: null,
    };
  }
  return sharedWorkerState;
}

function ensureRealWorker(state: SharedWechatWorkerState): WechatWorkerLike {
  if (state.realWorker) {
    return state.realWorker;
  }

  const wxApi = getWxWorkerApi();
  if (!wxApi || !wxApi.createWorker) {
    throw new Error('WeChat Worker is not available');
  }

  const worker = wxApi.createWorker(WECHAT_SHARED_WORKER_PATH);
  worker.onMessage((event) => {
    // WeChat may deliver the raw message directly or wrapped in { data }.
    // Normalize so both shapes reach the router.
    const runtimePayload = event && typeof event === 'object' && 'data' in event
      ? (event as { data?: unknown }).data
      : event;
    const payload = decodeWorkerMessage(runtimePayload);
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const rawDelivery = takeRawRoutedDelivery(payload);
    if (rawDelivery) {
      deliverToClient(state, rawDelivery.clientId, { data: rawDelivery.message });
      return;
    }

    const envelope = payload as { __scope?: unknown; clientId?: unknown; message?: unknown };
    if (typeof envelope.__scope === 'string' && typeof envelope.clientId === 'number') {
      const scopedClient = state.clients.get(envelope.clientId);
      if (scopedClient && scopedClient.alive && resolveWorkerScope(scopedClient.scriptPath) === envelope.__scope) {
        deliverToClient(state, envelope.clientId, { data: envelope.message });
        return;
      }
    }

    if (typeof state.lastRawClientId === 'number') {
      const lastRawClient = state.clients.get(state.lastRawClientId);
      if (lastRawClient && lastRawClient.alive) {
        deliverToClient(state, lastRawClient.id, { data: payload });
        return;
      }
      state.lastRawClientId = null;
    }

    state.clients.forEach((client) => {
      if (client.alive) {
        deliverToClient(state, client.id, { data: payload });
      }
    });
  });

  state.realWorker = worker;
  return worker;
}

function deliverToClient(
  state: SharedWechatWorkerState,
  clientId: number,
  event: { data: unknown },
): void {
  const client = state.clients.get(clientId);
  if (!client || !client.alive) {
    return;
  }
  client.listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.warn('[harmony-wechat-worker] client listener failed', error);
    }
  });
}

function removeClient(state: SharedWechatWorkerState, clientId: number): void {
  const client = state.clients.get(clientId);
  if (!client) {
    return;
  }
  client.alive = false;
  client.listeners.clear();
  state.clients.delete(clientId);
  forgetRawRoutedIds(clientId);

  if (state.lastRawClientId === clientId) {
    state.lastRawClientId = null;
  }

  if (!state.clients.size && state.realWorker) {
    try {
      state.realWorker.terminate();
    } catch (error) {
      console.warn('[harmony-wechat-worker] failed to terminate shared worker', error);
    }
    state.realWorker = null;
  }
}

export type WechatWorkerFacade = WechatWorkerLike & {
  addEventListener(type: string, listener: WorkerFacadeListener): void;
  removeEventListener(type: string, listener: WorkerFacadeListener): void;
  /**
   * DOM-style message subscription. Libraries such as Spark's `SplatWorker`
   * assign `worker.onmessage = handler` instead of calling `onMessage` /
   * `addEventListener`, so the facade has to honour the property form too.
   */
  onmessage: ((event: { data: unknown }) => void) | null;
};

export function createWechatWorkerFacade(scriptPath: string): WechatWorkerFacade {
  const state = getOrCreateState();
  if (!state) {
    throw new Error('WeChat Worker is not available');
  }

  const clientId = state.nextClientId;
  state.nextClientId += 1;
  const client: WorkerFacadeState = {
    id: clientId,
    scriptPath,
    alive: true,
    listeners: new Set(),
  };
  state.clients.set(clientId, client);

  const scope = resolveWorkerScope(scriptPath);
  ensureRealWorker(state);

  let onmessageListener: WorkerFacadeListener | null = null;
  const facade: WechatWorkerFacade = {
    postMessage(message, transferables) {
      if (!client.alive) {
        return;
      }
      const worker = ensureRealWorker(state);
      if (scope !== null) {
        worker.postMessage(encodeOutgoingMessage({
          __scope: scope,
          clientId,
          message,
        }, true) as never);
        return;
      }
      state.lastRawClientId = clientId;
      const routed = namespaceRawMessageId(message, clientId);
      worker.postMessage(encodeOutgoingMessage(routed, Boolean(transferables)) as never);
    },
    onMessage<TPayload>(listener: (event: { data: TPayload }) => void) {
      client.listeners.add(listener);
    },
    addEventListener<TPayload>(type: string, listener: (event: { data: TPayload }) => void) {
      if (type === 'message') {
        client.listeners.add(listener);
      }
    },
    removeEventListener<TPayload>(type: string, listener: (event: { data: TPayload }) => void) {
      if (type === 'message') {
        client.listeners.delete(listener);
      }
    },
    terminate() {
      removeClient(state, clientId);
    },
    onmessage: null,
  };
  Object.defineProperty(facade, 'onmessage', {
    configurable: true,
    enumerable: true,
    get: () => onmessageListener,
    set: (listener: unknown) => {
      if (onmessageListener) {
        client.listeners.delete(onmessageListener);
      }
      onmessageListener = typeof listener === 'function' ? (listener as WorkerFacadeListener) : null;
      if (onmessageListener) {
        client.listeners.add(onmessageListener);
      }
    },
  });
  return facade;
}

export function terminateWechatSharedWorker(): void {
  if (!sharedWorkerState) {
    return;
  }
  const state = sharedWorkerState;
  const clientIds = Array.from(state.clients.keys());
  clientIds.forEach((clientId) => removeClient(state, clientId));
  sharedWorkerState = null;
}

export function installWechatWorkerShim(): void {
  if (globalWorkerShimInstalled || !isWechatSharedWorkerSupported()) {
    return;
  }

  const globalObject = globalThis as typeof globalThis & {
    Worker?: new (scriptPath: string, options?: unknown) => unknown;
  };

  (globalObject as unknown as Record<string, unknown>).Worker = class WechatSharedWorkerShim {
    constructor(scriptPath: string | URL, _options?: unknown) {
      return createWechatWorkerFacade(String(scriptPath));
    }
  };

  globalWorkerShimInstalled = true;
}

export function isWechatWorkerShimInstalled(): boolean {
  return globalWorkerShimInstalled;
}
