import {
	computeInstancedLodCullingResult,
	type InstancedLodCullingRequest,
	type InstancedLodCullingResponse,
	type InstancedLodCullingSyncRequest,
	type InstancedLodStaticCandidateSnapshot,
} from '@harmony/schema/core'

declare const worker: unknown;

const INSTANCED_LOD_WORKER_SCOPE = 'instanced-lod';

const instancedLodStaticCandidateCache: InstancedLodStaticCandidateSnapshot[] = [];
let instancedLodSyncedRevision = -1;

type InstancedLodEnvelope = {
  __scope: 'instanced-lod';
  clientId?: number;
  message?: unknown;
};

type WechatWorkerGlobalLike = {
  onMessage: (callback: (event: { data?: unknown }) => void) => void;
  postMessage: (message: unknown, transferables?: ArrayBuffer[] | Transferable[]) => void;
};

type SharedWorkerSelfLike = {
  addEventListener?: (type: 'message', callback: (event: { data?: unknown }) => void) => void;
};

type H5WorkerScopeLike = {
  onmessage: ((event: { data?: unknown }) => void) | null;
  postMessage: (message: unknown, transferables?: Transferable[]) => void;
};

// WeChat Worker keeps only one worker.onMessage listener and its serialization
// cannot reliably carry TypedArray values. Mirror the minisheep worker-adapter
// MessageData protocol so the shared worker uses one consistent wire format:
// typed arrays are encoded as { buffer, __typedArray } and restored on the
// receiving side.
const NO_TRANSFER_MARKER = '__message_data_no_transfer';

function encodeWorkerValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength === 0 ? '__arraybuffer:0' : value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value;
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

function createErrorResponse(message: InstancedLodCullingRequest, error: unknown): InstancedLodCullingResponse {
  return {
    kind: 'cull-instanced-lod-result',
    requestId: message.requestId,
    visibleIndices: new Uint32Array(0),
    targetKinds: new Uint8Array(0),
    targetAssetIds: [],
    targetSourceModelAssetIds: [],
    targetFaceCameras: new Uint8Array(0),
    targetForwardAxes: [],
    targetKeys: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

function collectResponseTransferables(response: InstancedLodCullingResponse): ArrayBuffer[] {
  return [
    response.visibleIndices.buffer,
    response.targetKinds.buffer,
    response.targetFaceCameras.buffer,
  ];
}

function syncInstancedLodCandidates(message: InstancedLodCullingSyncRequest): void {
  const revision = Number.isFinite(message.revision) ? Math.max(0, Math.trunc(message.revision)) : -1;
  if (revision < 0 || revision === instancedLodSyncedRevision) {
    return;
  }
  instancedLodStaticCandidateCache.length = 0;
  for (let i = 0; i < message.candidates.length; i += 1) {
    const candidate = message.candidates[i];
    if (!candidate) {
      continue;
    }
    instancedLodStaticCandidateCache.push({
      nodeId: typeof candidate.nodeId === 'string' ? candidate.nodeId : '',
      sourceAssetId: candidate.sourceAssetId ?? null,
      instanceLayout: candidate.instanceLayout ?? null,
      lodProps: candidate.lodProps ?? null,
    });
  }
  instancedLodSyncedRevision = revision;
}

function handleInstancedLodCullingMessage(
  message: unknown,
  postResponse: (response: InstancedLodCullingResponse) => void,
): void {
  if (!message || typeof message !== 'object') {
    return;
  }
  const kind = (message as { kind?: unknown }).kind;
  if (kind === 'sync-instanced-lod-candidates') {
    syncInstancedLodCandidates(message as InstancedLodCullingSyncRequest);
    return;
  }
  if (kind !== 'cull-instanced-lod') {
    return;
  }

  const request = message as InstancedLodCullingRequest;
  try {
    const response = computeInstancedLodCullingResult(request, instancedLodStaticCandidateCache);
    postResponse(response satisfies InstancedLodCullingResponse);
  } catch (error) {
    postResponse(createErrorResponse(request, error));
  }
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

function postInstancedLodResponse(
  response: InstancedLodCullingResponse,
  transferables: ArrayBuffer[],
): void {
  if (workerGlobal && typeof workerGlobal.postMessage === 'function') {
    const envelope: InstancedLodEnvelope = {
      __scope: INSTANCED_LOD_WORKER_SCOPE,
      clientId: currentClientId ?? undefined,
      message: response,
    };
    workerGlobal.postMessage(encodeWorkerValue(envelope) as never);
    return;
  }
  if (isH5WorkerScope) {
    h5WorkerScope.postMessage(response, transferables);
  }
}

function handleWorkerMessage(event: unknown): void {
  // WeChat may deliver the raw message directly or wrapped in { data }.
  // Normalize before decoding/routing.
  const runtimePayload = event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event;
  // When the shared worker dispatcher is active, worker-adapter already
  // decoded the message; otherwise decode the wire format here.
  const rawData = useSharedWorkerAdapter ? runtimePayload : decodeWorkerMessage(runtimePayload);
  if (!rawData || typeof rawData !== 'object') {
    return;
  }
  const envelope = rawData as InstancedLodEnvelope;
  if (envelope.__scope !== INSTANCED_LOD_WORKER_SCOPE) {
    return;
  }
  if (typeof envelope.clientId === 'number') {
    currentClientId = envelope.clientId;
  }
  handleInstancedLodCullingMessage(envelope.message, (response) => {
    postInstancedLodResponse(response, collectResponseTransferables(response));
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
  throw new Error('[instanced-lod-worker] not running inside a supported worker scope');
}
