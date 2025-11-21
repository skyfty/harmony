import type { SceneJsonExportDocument } from '@harmony/schema'
import { deflate, inflate } from 'pako'

export interface ScenePreviewSnapshot {
  revision: number
  document: SceneJsonExportDocument
  timestamp: string
}

type PreviewListener = (snapshot: ScenePreviewSnapshot) => void

type PreviewMessageEvent = {
  type: 'scene-update'
  payload: ScenePreviewSnapshot
}

const CHANNEL_NAME = 'harmony-scene-preview'
const SNAPSHOT_RECORD_KEY = 'harmony:scene-preview:last'
const SNAPSHOT_STORAGE_VERSION = 1
const MAX_STORAGE_BYTES = 4 * 1024 * 1024
const MIN_PERSIST_INTERVAL_MS = 1000
const SNAPSHOT_DB_NAME = 'harmony-scene-preview'
const SNAPSHOT_DB_VERSION = 1
const SNAPSHOT_STORE_NAME = 'snapshots'

const listeners = new Set<PreviewListener>()
let channel: BroadcastChannel | null = null
let storageDisabled = false
let lastPersistTimestamp = 0
let snapshotDbPromise: Promise<IDBDatabase | null> | null = null

const NodeBuffer = typeof globalThis !== 'undefined' && (globalThis as any).Buffer
  ? (globalThis as any).Buffer
  : undefined

type SnapshotStorageEnvelope = {
  version: typeof SNAPSHOT_STORAGE_VERSION
  encoding: 'json' | 'deflate-base64'
  data: string
}

function ensureChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null
  }
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.addEventListener('message', handleChannelMessage)
  }
  return channel
}

function handleChannelMessage(event: MessageEvent<PreviewMessageEvent | undefined>) {
  const data = event.data
  if (!data || data.type !== 'scene-update' || !data.payload) {
    return
  }
  notifyListeners(data.payload)
}

function notifyListeners(snapshot: ScenePreviewSnapshot) {
  listeners.forEach((listener) => {
    try {
      listener(snapshot)
    } catch (error) {
      console.warn('[PreviewChannel] listener failed', error)
    }
  })
}

function safeParseSnapshot(payload: string): ScenePreviewSnapshot | null {
  try {
    const parsed = JSON.parse(payload) as ScenePreviewSnapshot | SnapshotStorageEnvelope | null
    if (isSnapshotEnvelope(parsed)) {
      return decodeSnapshotEnvelope(parsed)
    }
    return validateSnapshotPayload(parsed)
  } catch (error) {
    console.warn('[PreviewChannel] failed to parse snapshot', error)
    return null
  }
}

async function persistSnapshot(snapshot: ScenePreviewSnapshot) {
  if (typeof window === 'undefined' || storageDisabled) {
    return
  }
  if (!isIndexedDbAvailable()) {
    disableSnapshotPersistence('IndexedDB is not available, snapshot persistence disabled')
    return
  }
  const now = Date.now()
  if (now - lastPersistTimestamp < MIN_PERSIST_INTERVAL_MS) {
    return
  }
  lastPersistTimestamp = now
  try {
    const serialized = JSON.stringify(snapshot)
    const envelope = encodeSnapshotPayload(serialized)
    if (!envelope) {
      disableSnapshotPersistence('snapshot payload exceeds storage budget, persistence disabled')
      return
    }
    const envelopeString = JSON.stringify(envelope)
    if (estimateByteSize(envelopeString) > MAX_STORAGE_BYTES) {
      disableSnapshotPersistence('snapshot envelope exceeds storage budget, persistence disabled')
      return
    }
    await writeSnapshotEnvelope(envelopeString)
  } catch (error) {
    if (isQuotaExceededError(error)) {
      disableSnapshotPersistence('IndexedDB quota exceeded, snapshot persistence disabled', error)
      try {
        await clearSnapshotEnvelope()
      } catch {
        // ignore cleanup errors
      }
      return
    }
    console.warn('[PreviewChannel] failed to persist snapshot', error)
  }
}

export function broadcastScenePreviewUpdate(snapshot: ScenePreviewSnapshot): void {
  if (typeof window === 'undefined') {
    return
  }
  void persistSnapshot(snapshot)
  const channelInstance = ensureChannel()
  if (channelInstance) {
    try {
      const message: PreviewMessageEvent = {
        type: 'scene-update',
        payload: snapshot,
      }
      channelInstance.postMessage(message)
    } catch (error) {
      console.warn('[PreviewChannel] failed to post broadcast message', error)
    }
  }
  notifyListeners(snapshot)
}

export function subscribeToScenePreview(listener: PreviewListener): () => void {
  listeners.add(listener)
  ensureChannel()
  void readStoredScenePreviewSnapshot()
    .then((snapshot) => {
      if (!snapshot) {
        return
      }
      const schedule = typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (cb: () => void) => Promise.resolve().then(cb)
      schedule(() => listener(snapshot))
    })
    .catch((error) => {
      console.warn('[PreviewChannel] failed to deliver stored snapshot', error)
    })
  return () => {
    listeners.delete(listener)
    if (!listeners.size && channel) {
      channel.removeEventListener('message', handleChannelMessage)
      channel.close()
      channel = null
    }
  }
}

export async function readStoredScenePreviewSnapshot(): Promise<ScenePreviewSnapshot | null> {
  if (typeof window === 'undefined' || !isIndexedDbAvailable()) {
    return null
  }
  try {
    const serialized = await readSnapshotEnvelope()
    if (!serialized) {
      return null
    }
    const snapshot = safeParseSnapshot(serialized)
    if (snapshot) {
      return snapshot
    }
    await clearSnapshotEnvelope()
    return null
  } catch (error) {
    console.warn('[PreviewChannel] failed to read stored snapshot', error)
    return null
  }
}

function validateSnapshotPayload(payload: unknown): ScenePreviewSnapshot | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const candidate = payload as ScenePreviewSnapshot
  if (!candidate.document) {
    return null
  }
  return candidate
}

function isSnapshotEnvelope(value: unknown): value is SnapshotStorageEnvelope {
  if (!value || typeof value !== 'object') {
    return false
  }
  const envelope = value as Partial<SnapshotStorageEnvelope>
  return envelope.version === SNAPSHOT_STORAGE_VERSION
    && typeof envelope.encoding === 'string'
    && typeof envelope.data === 'string'
}

function decodeSnapshotEnvelope(envelope: SnapshotStorageEnvelope): ScenePreviewSnapshot | null {
  const raw = envelope.encoding === 'json'
    ? envelope.data
    : envelope.encoding === 'deflate-base64'
      ? decompressSnapshotPayload(envelope.data)
      : null
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    return validateSnapshotPayload(parsed)
  } catch (error) {
    console.warn('[PreviewChannel] failed to decode snapshot envelope', error)
    return null
  }
}

function encodeSnapshotPayload(serialized: string): SnapshotStorageEnvelope | null {
  const plainBytes = estimateByteSize(serialized)
  if (plainBytes <= MAX_STORAGE_BYTES) {
    return {
      version: SNAPSHOT_STORAGE_VERSION,
      encoding: 'json',
      data: serialized,
    }
  }
  const compressed = compressSnapshotPayload(serialized)
  if (!compressed) {
    return null
  }
  return {
    version: SNAPSHOT_STORAGE_VERSION,
    encoding: 'deflate-base64',
    data: compressed,
  }
}

function compressSnapshotPayload(serialized: string): string | null {
  try {
    const bytes = textEncode(serialized)
    const compressed = deflate(bytes)
    return bufferToBase64(compressed)
  } catch (error) {
    console.warn('[PreviewChannel] failed to compress snapshot payload', error)
    return null
  }
}

function decompressSnapshotPayload(payload: string): string | null {
  try {
    const buffer = base64ToBuffer(payload)
    if (!buffer) {
      return null
    }
    const result = inflate(buffer)
    return textDecode(result)
  } catch (error) {
    console.warn('[PreviewChannel] failed to decompress snapshot payload', error)
    return null
  }
}

function bufferToBase64(buffer: Uint8Array): string {
  if (typeof btoa === 'function') {
    const chunkSize = 0x8000
    let binary = ''
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const chunk = buffer.subarray(offset, offset + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }
  if (NodeBuffer) {
    return NodeBuffer.from(buffer).toString('base64')
  }
  let fallback = ''
  buffer.forEach((byte) => {
    fallback += String.fromCharCode(byte)
  })
  return fallback
}

function base64ToBuffer(value: string): Uint8Array | null {
  try {
    if (typeof atob === 'function') {
      const binary = atob(value)
      const length = binary.length
      const bytes = new Uint8Array(length)
      for (let i = 0; i < length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    }
    if (NodeBuffer) {
      const buf = NodeBuffer.from(value, 'base64')
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    }
  } catch (error) {
    console.warn('[PreviewChannel] failed to decode base64 payload', error)
    return null
  }
  return null
}

function textEncode(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value)
  }
  if (NodeBuffer) {
    const buf = NodeBuffer.from(value, 'utf-8')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  throw new Error('TextEncoder is not available in this environment')
}

function textDecode(buffer: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(buffer)
  }
  if (NodeBuffer) {
    return NodeBuffer.from(buffer).toString('utf-8')
  }
  throw new Error('TextDecoder is not available in this environment')
}

function estimateByteSize(value: string): number {
  if (typeof Blob !== 'undefined') {
    return new Blob([value]).size
  }
  return value.length * 2
}

function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const domError = error as { name?: string; code?: number }
  return domError.name === 'QuotaExceededError' || domError.code === 22
}

function disableSnapshotPersistence(message: string, error?: unknown) {
  if (storageDisabled) {
    return
  }
  storageDisabled = true
  if (error) {
    console.warn(`[PreviewChannel] ${message}`, error)
  } else {
    console.warn(`[PreviewChannel] ${message}`)
  }
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

async function getSnapshotDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) {
    return null
  }
  if (snapshotDbPromise) {
    return snapshotDbPromise
  }
  snapshotDbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = window.indexedDB.open(SNAPSHOT_DB_NAME, SNAPSHOT_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
          db.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        request.result.onclose = () => {
          snapshotDbPromise = null
        }
        resolve(request.result)
      }
      request.onerror = () => {
        console.warn('[PreviewChannel] failed to open IndexedDB', request.error)
        snapshotDbPromise = null
        resolve(null)
      }
      request.onblocked = () => {
        console.warn('[PreviewChannel] IndexedDB upgrade blocked')
      }
    } catch (error) {
      console.warn('[PreviewChannel] unexpected error while opening IndexedDB', error)
      snapshotDbPromise = null
      resolve(null)
    }
  })
  return snapshotDbPromise
}

type SnapshotRecord = {
  key: typeof SNAPSHOT_RECORD_KEY
  envelope: string
  updatedAt: number
}

async function readSnapshotEnvelope(): Promise<string | null> {
  const db = await getSnapshotDb()
  if (!db) {
    return null
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly')
    const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
    const request = store.get(SNAPSHOT_RECORD_KEY)
    let settled = false
    const rejectOnce = (reason: unknown) => {
      if (settled) {
        return
      }
      settled = true
      reject(reason)
    }
    request.onsuccess = () => {
      if (settled) {
        return
      }
      settled = true
      const record = request.result as SnapshotRecord | undefined
      resolve(record?.envelope ?? null)
    }
    request.onerror = () => {
      rejectOnce(request.error ?? new Error('IndexedDB request failed'))
    }
    transaction.onabort = () => {
      rejectOnce(transaction.error ?? new Error('IndexedDB transaction aborted'))
    }
    transaction.onerror = () => {
      rejectOnce(transaction.error ?? new Error('IndexedDB transaction failed'))
    }
  })
}

async function writeSnapshotEnvelope(envelope: string): Promise<void> {
  const db = await getSnapshotDb()
  if (!db) {
    throw new Error('IndexedDB is not available')
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
    const record: SnapshotRecord = {
      key: SNAPSHOT_RECORD_KEY,
      envelope,
      updatedAt: Date.now(),
    }
    const request = store.put(record)
    let settled = false
    const rejectOnce = (reason: unknown) => {
      if (settled) {
        return
      }
      settled = true
      reject(reason)
    }
    transaction.oncomplete = () => {
      if (settled) {
        return
      }
      settled = true
      resolve()
    }
    request.onerror = () => rejectOnce(request.error ?? new Error('IndexedDB request failed'))
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

async function clearSnapshotEnvelope(): Promise<void> {
  const db = await getSnapshotDb()
  if (!db) {
    return
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
    const request = store.delete(SNAPSHOT_RECORD_KEY)
    let settled = false
    const rejectOnce = (reason: unknown) => {
      if (settled) {
        return
      }
      settled = true
      reject(reason)
    }
    transaction.oncomplete = () => {
      if (settled) {
        return
      }
      settled = true
      resolve()
    }
    request.onerror = () => rejectOnce(request.error ?? new Error('IndexedDB request failed'))
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}