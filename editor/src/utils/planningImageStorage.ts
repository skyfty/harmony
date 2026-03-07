import type { PlanningImageData } from '@/types/planning-scene-data'

export interface PlanningImageBlobRecord {
  hash: string
  blob: Blob
}

export interface PlanningImageLayerRecord {
  id: string
  sceneId: string | null
  name: string
  imageHash: string | null
  filename?: string | null
  mimeType?: string | null
  sizeLabel: string
  width: number
  height: number
  visible: boolean
  locked: boolean
  opacity: number
  position: { x: number; y: number }
  scale: number
  alignMarker: { x: number; y: number } | null
}

export type PlanningImagePersistenceState = Pick<
  PlanningImageData,
  'id' | 'name' | 'imageHash' | 'filename' | 'mimeType' | 'sizeLabel' | 'width' | 'height' | 'visible' | 'locked' | 'opacity' | 'position' | 'scale' | 'alignMarker'
> & {
  url?: string
}

export type LoadedPlanningImageRecord = PlanningImagePersistenceState & {
  url: string
}

const DB_NAME = 'harmony-planning-images'
const DB_VERSION = 2
const IMAGES_STORE = 'images'
const LAYERS_STORE = 'layers'

function hexFromBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function computeSha256Hex(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return hexFromBuffer(hash)
}

export function openPlanningImageDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IMAGES_STORE)) {
          db.createObjectStore(IMAGES_STORE, { keyPath: 'hash' })
        }
        if (!db.objectStoreNames.contains(LAYERS_STORE)) {
          const layersStore = db.createObjectStore(LAYERS_STORE, { keyPath: 'id' })
          layersStore.createIndex('by_scene', 'sceneId', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (error) {
      reject(error)
    }
  })
}

export function getPlanningImageByHash(db: IDBDatabase, hash: string) {
  return new Promise<PlanningImageBlobRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readonly')
    const req = tx.objectStore(IMAGES_STORE).get(hash)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function putPlanningImageBlob(db: IDBDatabase, hash: string, blob: Blob) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite')
    const store = tx.objectStore(IMAGES_STORE)
    const keyPath = store.keyPath
    const value = keyPath ? (typeof keyPath === 'string' ? { [keyPath]: hash, blob } : { hash, blob }) : { hash, blob }
    try {
      if (keyPath) {
        store.put(value)
      } else {
        store.put(value, hash)
      }
    } catch (error) {
      tx.abort()
      reject(error)
      return
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function putPlanningImageLayerRecord(db: IDBDatabase, record: PlanningImageLayerRecord) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LAYERS_STORE, 'readwrite')
    tx.objectStore(LAYERS_STORE).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function getPlanningImageLayerRecords(db: IDBDatabase, sceneId?: string | null) {
  return new Promise<PlanningImageLayerRecord[]>((resolve, reject) => {
    const tx = db.transaction(LAYERS_STORE, 'readonly')
    const store = tx.objectStore(LAYERS_STORE)
    if (sceneId) {
      const req = store.index('by_scene').getAll(sceneId)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      return
    }
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function storePlanningImageBlobByHash(hash: string, blob: Blob): Promise<void> {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : ''
  if (!normalizedHash || !blob) {
    return
  }
  const db = await openPlanningImageDB()
  try {
    const existing = await getPlanningImageByHash(db, normalizedHash)
    if (!existing?.blob) {
      await putPlanningImageBlob(db, normalizedHash, blob)
    }
  } finally {
    db.close()
  }
}

export async function getPlanningImageBlobByHash(hash: string): Promise<Blob | null> {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : ''
  if (!normalizedHash) {
    return null
  }
  const db = await openPlanningImageDB()
  try {
    const existing = await getPlanningImageByHash(db, normalizedHash)
    return existing?.blob ?? null
  } finally {
    db.close()
  }
}

export async function savePlanningImageToIndexedDB(
  image: PlanningImagePersistenceState,
  file: File,
  sceneId: string | null = null,
) {
  const db = await openPlanningImageDB()
  try {
    const buffer = await file.arrayBuffer()
    const hash = await computeSha256Hex(buffer)
    const existing = await getPlanningImageByHash(db, hash)
    if (!existing) {
      const blob = new Blob([buffer], { type: file.type })
      await putPlanningImageBlob(db, hash, blob)
    }
    image.imageHash = hash
    image.filename = file.name || image.filename || null
    image.mimeType = file.type || image.mimeType || null
    await putPlanningImageLayerRecord(db, {
      id: image.id,
      sceneId,
      name: image.name,
      imageHash: hash,
      filename: image.filename ?? null,
      mimeType: image.mimeType ?? null,
      sizeLabel: image.sizeLabel,
      width: image.width,
      height: image.height,
      visible: image.visible,
      locked: image.locked,
      opacity: image.opacity,
      position: { x: image.position.x, y: image.position.y },
      scale: image.scale,
      alignMarker: image.alignMarker ? { ...image.alignMarker } : null,
    })
  } finally {
    db.close()
  }
}

export async function persistPlanningImageLayersToIndexedDB(
  sceneId: string | null,
  images: readonly PlanningImagePersistenceState[],
): Promise<void> {
  try {
    const db = await openPlanningImageDB()
    const tx = db.transaction(LAYERS_STORE, 'readwrite')
    const store = tx.objectStore(LAYERS_STORE)
    for (const image of images) {
      const record: PlanningImageLayerRecord = {
        id: image.id,
        sceneId,
        name: image.name,
        imageHash: image.imageHash ?? null,
        filename: image.filename ?? null,
        mimeType: image.mimeType ?? null,
        sizeLabel: image.sizeLabel,
        width: image.width,
        height: image.height,
        visible: image.visible,
        locked: image.locked,
        opacity: image.opacity,
        position: image.position ? { x: image.position.x, y: image.position.y } : { x: 0, y: 0 },
        scale: typeof image.scale === 'number' ? image.scale : 1,
        alignMarker: image.alignMarker ? { ...image.alignMarker } : null,
      }
      store.put(record)
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (error) {
    console.warn('Failed to persist planning image layers to IndexedDB', error)
  }
}

export async function createPlanningImageUrlFromHash(hash: string): Promise<string | null> {
  const blob = await getPlanningImageBlobByHash(hash)
  if (!blob) {
    return null
  }
  const url = URL.createObjectURL(blob)
  await new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Image decode error'))
    image.src = url
  })
  return url
}

export async function loadPlanningImagesFromIndexedDB(sceneId?: string | null): Promise<LoadedPlanningImageRecord[]> {
  const db = await openPlanningImageDB()
  try {
    const layers = await getPlanningImageLayerRecords(db, sceneId)
    const results: LoadedPlanningImageRecord[] = []
    for (const record of layers) {
      try {
        if (!record.imageHash) continue
        const imageRecord = await getPlanningImageByHash(db, record.imageHash)
        if (!imageRecord?.blob) continue
        const url = URL.createObjectURL(imageRecord.blob)
        await new Promise<void>((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve()
          image.onerror = () => reject(new Error('Image decode error'))
          image.src = url
        })
        results.push({
          id: record.id,
          name: record.name,
          url,
          imageHash: record.imageHash ?? undefined,
          filename: record.filename ?? null,
          mimeType: record.mimeType ?? null,
          sizeLabel: record.sizeLabel ?? `${record.width} x ${record.height}`,
          width: record.width,
          height: record.height,
          visible: record.visible ?? true,
          locked: record.locked ?? false,
          opacity: typeof record.opacity === 'number' ? record.opacity : 1,
          position: record.position ?? { x: 0, y: 0 },
          scale: typeof record.scale === 'number' ? record.scale : 1,
          alignMarker: record.alignMarker ?? undefined,
        })
      } catch (error) {
        console.warn('Skipping corrupted planning image record', record?.id, error)
      }
    }
    return results
  } finally {
    db.close()
  }
}

export async function deletePlanningImageFromIndexedDB(id: string) {
  const db = await openPlanningImageDB()
  const tx = db.transaction([LAYERS_STORE, IMAGES_STORE], 'readwrite')
  const layersStore = tx.objectStore(LAYERS_STORE)
  const imagesStore = tx.objectStore(IMAGES_STORE)
  const getReq = layersStore.get(id)
  await new Promise<void>((resolve, reject) => {
    getReq.onsuccess = () => resolve()
    getReq.onerror = () => reject(getReq.error)
  })
  const record = getReq.result as PlanningImageLayerRecord | undefined
  if (record) {
    const hash = record.imageHash
    layersStore.delete(id)
    const allLayersReq = layersStore.getAll()
    const otherLayers = await new Promise<PlanningImageLayerRecord[]>((resolve, reject) => {
      allLayersReq.onsuccess = () => resolve(allLayersReq.result as PlanningImageLayerRecord[])
      allLayersReq.onerror = () => reject(allLayersReq.error)
    })
    const stillUsed = otherLayers.some((entry) => entry.imageHash === hash)
    if (!stillUsed && hash) {
      imagesStore.delete(hash)
    }
  }
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}