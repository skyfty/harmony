import { createCannonPhysicsController } from '../../physics-cannon/engine/controller';
import { attachPhysicsWorkerRuntime } from '../physics-bridge/runtime';

declare const worker: unknown;

type WechatWorkerGlobal = {
  onMessage: (callback: (event: { data?: unknown }) => void) => void;
  postMessage: (message: unknown, transferables?: ArrayBuffer[] | Transferable[]) => void;
};

type SharedWorkerSelf = {
  addEventListener?: (type: 'message', callback: (event: { data?: unknown }) => void) => void;
};

type PhysicsEnvelope = {
  __scope: 'physics';
  clientId?: unknown;
  message?: unknown;
};

// WeChat Worker keeps only one worker.onMessage listener and its serialization
// cannot reliably carry TypedArray values. Mirror the minisheep worker-adapter
// MessageData protocol here so the shared worker (physics + basis) uses one
// consistent wire format: typed arrays are encoded as { buffer, __typedArray }
// and restored on the receiving side.
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

const workerGlobal = typeof worker !== 'undefined'
  ? (worker as unknown as WechatWorkerGlobal)
  : (globalThis as typeof globalThis & { worker?: WechatWorkerGlobal }).worker;

const sharedWorkerSelf = (globalThis as typeof globalThis & { __harmonyWorkerSelf?: SharedWorkerSelf })
  .__harmonyWorkerSelf;
const useSharedWorkerAdapter = Boolean(
  sharedWorkerSelf && typeof sharedWorkerSelf.addEventListener === 'function',
);

if (!workerGlobal || typeof workerGlobal.onMessage !== 'function' || typeof workerGlobal.postMessage !== 'function') {
  throw new Error('[physics-worker] not running inside a WeChat Worker');
}

let currentClientId: number | null = null;

function postPhysicsMessage(message: unknown): void {
  if (currentClientId === null) {
    return;
  }
  const envelope: PhysicsEnvelope = {
    __scope: 'physics',
    clientId: currentClientId,
    message,
  };
  // Transferable lists are not honored by the shared worker protocol; encode
  // typed arrays into { buffer, __typedArray } so the main thread can restore
  // them after structured clone.
  workerGlobal.postMessage(encodeWorkerValue(envelope) as never);
}

const physicsScope = {
  onmessage: null as ((event: { data: unknown }) => void) | null,
  postMessage(message: unknown, _transferables?: ArrayBuffer[] | Transferable[]) {
    postPhysicsMessage(message);
  },
};

attachPhysicsWorkerRuntime(physicsScope, createCannonPhysicsController());

function handleWorkerMessage(event: { data?: unknown }): void {
  // WeChat may deliver the raw message directly or wrapped in { data }.
  // Normalize before decoding/routing.
  const runtimePayload = event && typeof event === 'object' && 'data' in event
    ? event.data
    : event;
  // When the shared worker dispatcher is active, worker-adapter already
  // decoded the message; otherwise decode the wire format here.
  const rawData = useSharedWorkerAdapter ? runtimePayload : decodeWorkerMessage(runtimePayload);
  if (!rawData || typeof rawData !== 'object') {
    return;
  }
  const envelope = rawData as PhysicsEnvelope;
  if (envelope.__scope !== 'physics') {
    return;
  }
  if (typeof envelope.clientId === 'number') {
    currentClientId = envelope.clientId;
  }
  physicsScope.onmessage?.({ data: envelope.message });
}

if (useSharedWorkerAdapter) {
  sharedWorkerSelf?.addEventListener?.('message', handleWorkerMessage);
} else {
  workerGlobal.onMessage(handleWorkerMessage);
}
