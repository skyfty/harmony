import type { SceneJsonExportDocument } from '@harmony/schema'
import type { SceneCameraState } from '@/types/scene-camera-state'

export interface ScenePreviewSnapshot {
  revision: number
  sceneId: string
  sceneName: string
  document: SceneJsonExportDocument
  timestamp: string
  camera: SceneCameraState | null
}

type PreviewListener = (snapshot: ScenePreviewSnapshot) => void

type PreviewMessageEvent = {
  type: 'scene-update'
  payload: ScenePreviewSnapshot
}

const CHANNEL_NAME = 'harmony-scene-preview'
const STORAGE_KEY = 'harmony:scene-preview:last'

const listeners = new Set<PreviewListener>()
let channel: BroadcastChannel | null = null
let storageListenerAttached = false

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

function ensureStorageListener() {
  if (storageListenerAttached || typeof window === 'undefined') {
    return
  }
  window.addEventListener('storage', handleStorageEvent)
  storageListenerAttached = true
}

function handleStorageEvent(event: StorageEvent) {
  if (!event.key || event.key !== STORAGE_KEY || !event.newValue) {
    return
  }
  const snapshot = safeParseSnapshot(event.newValue)
  if (snapshot) {
    notifyListeners(snapshot)
  }
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
    const parsed = JSON.parse(payload) as ScenePreviewSnapshot
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if (!parsed.sceneId || !parsed.document) {
      return null
    }
    return parsed
  } catch (error) {
    console.warn('[PreviewChannel] failed to parse snapshot', error)
    return null
  }
}

function persistSnapshot(snapshot: ScenePreviewSnapshot) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const serialized = JSON.stringify(snapshot)
    window.localStorage.setItem(STORAGE_KEY, serialized)
  } catch (error) {
    console.warn('[PreviewChannel] failed to persist snapshot', error)
  }
}

export function broadcastScenePreviewUpdate(snapshot: ScenePreviewSnapshot): void {
  if (typeof window === 'undefined') {
    return
  }
  persistSnapshot(snapshot)
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
  ensureStorageListener()
  const snapshot = readStoredScenePreviewSnapshot()
  if (snapshot) {
    const schedule = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (cb: () => void) => Promise.resolve().then(cb)
    schedule(() => listener(snapshot))
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size && channel) {
      channel.removeEventListener('message', handleChannelMessage)
      channel.close()
      channel = null
    }
  }
}

export function readStoredScenePreviewSnapshot(): ScenePreviewSnapshot | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY)
    if (!serialized) {
      return null
    }
    return safeParseSnapshot(serialized)
  } catch (error) {
    console.warn('[PreviewChannel] failed to read stored snapshot', error)
    return null
  }
}