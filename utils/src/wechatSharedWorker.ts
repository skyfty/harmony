export const WECHAT_SHARED_WORKER_PATH = 'pages/scenery/workers/index.js';

const INSTANCED_LOD_WORKER_SCOPE = 'instanced-lod';

function resolveWorkerScope(scriptPath: string): string | null {
  if (scriptPath.includes('physics-')) {
    return 'physics';
  }
  if (scriptPath.includes('instancedLod')) {
    return INSTANCED_LOD_WORKER_SCOPE;
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

  return {
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
      worker.postMessage(encodeOutgoingMessage(message, Boolean(transferables)) as never);
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
  };
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
