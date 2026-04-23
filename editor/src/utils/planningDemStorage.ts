import type { PlanningTerrainDemData, PlanningTerrainOrthophotoData } from '@/types/planning-scene-data'

export interface PlanningDemBlobRecord {
  hash: string
  blob: Blob
}

export interface PlanningDemSceneRecord {
  sceneId: string | null
  dem: PlanningTerrainDemData | null
}

const DB_NAME = 'harmony-planning-dems'
const DB_VERSION = 1
const BLOBS_STORE = 'blobs'
const SCENES_STORE = 'scenes'

function hexFromBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function computeSha256Hex(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return hexFromBuffer(hash)
}

export function openPlanningDemDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(BLOBS_STORE)) {
          db.createObjectStore(BLOBS_STORE, { keyPath: 'hash' })
        }
        if (!db.objectStoreNames.contains(SCENES_STORE)) {
          const scenesStore = db.createObjectStore(SCENES_STORE, { keyPath: 'sceneId' })
          scenesStore.createIndex('by_scene', 'sceneId', { unique: true })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (error) {
      reject(error)
    }
  })
}

export function getPlanningDemBlobByHash(db: IDBDatabase, hash: string) {
  return new Promise<PlanningDemBlobRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(BLOBS_STORE, 'readonly')
    const req = tx.objectStore(BLOBS_STORE).get(hash)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function putPlanningDemBlob(db: IDBDatabase, hash: string, blob: Blob) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOBS_STORE, 'readwrite')
    tx.objectStore(BLOBS_STORE).put({ hash, blob } satisfies PlanningDemBlobRecord)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function deletePlanningDemBlob(db: IDBDatabase, hash: string) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOBS_STORE, 'readwrite')
    tx.objectStore(BLOBS_STORE).delete(hash)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function putPlanningDemSceneRecord(db: IDBDatabase, record: PlanningDemSceneRecord) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SCENES_STORE, 'readwrite')
    tx.objectStore(SCENES_STORE).put({
      sceneId: record.sceneId,
      dem: record.dem ? clonePlanningTerrainDemData(record.dem) : null,
    } satisfies PlanningDemSceneRecord)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function getPlanningDemSceneRecord(db: IDBDatabase, sceneId: string | null) {
  return new Promise<PlanningDemSceneRecord | undefined>((resolve, reject) => {
    if (sceneId === null) {
      resolve(undefined)
      return
    }
    const tx = db.transaction(SCENES_STORE, 'readonly')
    const req = tx.objectStore(SCENES_STORE).get(sceneId)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function clonePlanningTerrainOrthophotoData(data: PlanningTerrainOrthophotoData | null | undefined): PlanningTerrainOrthophotoData | null {
  if (!data) {
    return null
  }
  return {
    version: 1,
    sourceFileHash: data.sourceFileHash ?? null,
    filename: data.filename ?? null,
    mimeType: data.mimeType ?? null,
    width: data.width,
    height: data.height,
    previewHash: data.previewHash ?? null,
    previewSize: data.previewSize ? { width: data.previewSize.width, height: data.previewSize.height } : null,
    opacity: data.opacity,
    visible: data.visible,
  }
}

function clonePlanningTerrainDemData(data: PlanningTerrainDemData | null | undefined): PlanningTerrainDemData | null {
  if (!data) {
    return null
  }
  return {
    version: 1,
    sourceFileHash: data.sourceFileHash ?? null,
    filename: data.filename ?? null,
    mimeType: data.mimeType ?? null,
    width: data.width,
    height: data.height,
    minElevation: data.minElevation ?? null,
    maxElevation: data.maxElevation ?? null,
    sampleStepMeters: data.sampleStepMeters ?? null,
    geographicBounds: data.geographicBounds ? { ...data.geographicBounds } : null,
    worldBounds: data.worldBounds ? { ...data.worldBounds } : null,
    previewHash: data.previewHash ?? null,
    previewSize: data.previewSize ? { width: data.previewSize.width, height: data.previewSize.height } : null,
    orthophoto: clonePlanningTerrainOrthophotoData(data.orthophoto ?? null),
  }
}

export async function savePlanningDemToIndexedDB(sceneId: string | null, dem: PlanningTerrainDemData | null): Promise<void> {
  const db = await openPlanningDemDB()
  try {
    await putPlanningDemSceneRecord(db, { sceneId, dem })
  } finally {
    db.close()
  }
}

export async function loadPlanningDemFromIndexedDB(sceneId: string | null): Promise<PlanningTerrainDemData | null> {
  const db = await openPlanningDemDB()
  try {
    const record = await getPlanningDemSceneRecord(db, sceneId)
    return record?.dem ?? null
  } finally {
    db.close()
  }
}

export async function storePlanningDemBlobByHash(hash: string, blob: Blob): Promise<void> {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : ''
  if (!normalizedHash || !blob) {
    return
  }
  const db = await openPlanningDemDB()
  try {
    const existing = await getPlanningDemBlobByHash(db, normalizedHash)
    if (!existing?.blob) {
      await putPlanningDemBlob(db, normalizedHash, blob)
    }
  } finally {
    db.close()
  }
}

export async function createPlanningDemUrlFromHash(hash: string): Promise<string | null> {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : ''
  if (!normalizedHash) {
    return null
  }
  const db = await openPlanningDemDB()
  try {
    const record = await getPlanningDemBlobByHash(db, normalizedHash)
    if (!record?.blob) {
      return null
    }
    const url = URL.createObjectURL(record.blob)
    return url
  } finally {
    db.close()
  }
}

export async function loadPlanningDemBlobByHash(hash: string): Promise<Blob | null> {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : ''
  if (!normalizedHash) {
    return null
  }
  const db = await openPlanningDemDB()
  try {
    const record = await getPlanningDemBlobByHash(db, normalizedHash)
    return record?.blob ?? null
  } finally {
    db.close()
  }
}

export async function deletePlanningDemFromIndexedDB(hash: string): Promise<void> {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : ''
  if (!normalizedHash) {
    return
  }
  const db = await openPlanningDemDB()
  try {
    await deletePlanningDemBlob(db, normalizedHash)
  } finally {
    db.close()
  }
}