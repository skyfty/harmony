import fs from 'fs-extra'
import { Types } from 'mongoose'
import { FileUploadModel } from '@/models/FileUpload'
import { UserSceneModel } from '@/models/UserScene'
import { SceneModel } from '@/models/Scene'
import { deleteStoredFile, resolveStorageAbsolutePath, storeUploadedFile, type UploadedFilePayload } from '@/services/uploadStorageService'
import type { UserSceneBundleRecord, UserSceneSummary } from '@/types/userScene'
import { decodeScenePackageSceneDocument, readBinaryFileFromScenePackage, unzipScenePackage } from '@harmony/schema/core'

export type { UploadedFilePayload } from '@/services/uploadStorageService'

export interface UserSceneQueryOptions {
  includeDeleted?: boolean
  deletedOnly?: boolean
  projectId: string
}

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function toIsoString(value: unknown): string {
  const raw = sanitizeString(value)
  if (raw) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  return new Date().toISOString()
}

function buildBundleApiUrl(sceneId: string): string {
  return `/api/user-scenes/${encodeURIComponent(sceneId)}/bundle`
}

function buildDeletionFilter(options?: UserSceneQueryOptions): Record<string, unknown> {
  if (options?.deletedOnly) {
    return { deletedAt: { $ne: null } }
  }
  if (options?.includeDeleted) {
    return {}
  }
  return { deletedAt: null }
}

export function resolveUserSceneBundleFilePath(fileKey: string): string {
  return resolveStorageAbsolutePath(fileKey)
}

async function deleteBundleFile(fileKey: string | null | undefined): Promise<void> {
  if (!fileKey) return
  await deleteStoredFile(fileKey)
}

function parseSceneDocumentFromBundle(zipBytes: Uint8Array | ArrayBuffer, expectedSceneId: string): {
  id: string
  name: string
  projectId: string
  thumbnail: string | null
  createdAt: string
  updatedAt: string
} {
  const pkg = unzipScenePackage(zipBytes)
  if (!pkg.manifest.scenes?.length) {
    throw new Error('Scene bundle missing scenes entry')
  }
  if (pkg.manifest.scenes.length !== 1) {
    throw new Error('User scene bundle must contain exactly one scene')
  }
  const sceneEntry = pkg.manifest.scenes[0]!
  const groundScatterPath = sanitizeString(sceneEntry.groundScatterPath)
  if (sanitizeString(sceneEntry.sceneId) !== expectedSceneId) {
    throw new Error('Scene id mismatch between path and bundle manifest')
  }
  const sceneRaw = decodeScenePackageSceneDocument(readBinaryFileFromScenePackage(pkg, sceneEntry.path)) as any
  if (groundScatterPath && !pkg.files[groundScatterPath]) {
    throw new Error('Scene bundle missing ground scatter sidecar file')
  }
  const id = sanitizeString(sceneRaw?.id) || expectedSceneId
  if (id !== expectedSceneId) {
    throw new Error('Scene id mismatch between path and scene document')
  }
  const name = sanitizeString(sceneRaw?.name) || '未命名场景'
  const projectId = sanitizeString(sceneRaw?.projectId)
  if (!projectId) {
    throw new Error('Scene document missing projectId')
  }
  const thumbnail = typeof sceneRaw?.thumbnail === 'string' ? sceneRaw.thumbnail : null
  const updatedAt = toIsoString(sceneRaw?.updatedAt)
  const createdAt = toIsoString(sceneRaw?.createdAt ?? updatedAt)
  return { id, name, projectId, thumbnail, createdAt, updatedAt }
}

async function loadSceneCheckpointTotalMap(sceneIds: string[]): Promise<Map<string, number>> {
  const normalizedSceneIds = Array.from(new Set(sceneIds.filter((id) => Types.ObjectId.isValid(id))))
  if (!normalizedSceneIds.length) {
    return new Map()
  }

  const rows = await SceneModel.find(
    { _id: { $in: normalizedSceneIds.map((id) => new Types.ObjectId(id)) } },
    { _id: 1, checkpointTotal: 1 },
  )
    .lean()
    .exec()

  const out = new Map<string, number>()
  for (const row of rows) {
    const id = String((row as { _id?: unknown })._id ?? '')
    const raw = Number((row as { checkpointTotal?: unknown }).checkpointTotal)
    out.set(id, Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0)
  }
  return out
}

export async function listUserScenes(userId: string, options?: UserSceneQueryOptions): Promise<UserSceneSummary[]> {
  const projectId = sanitizeString(options?.projectId)
  const query: Record<string, unknown> = { userId, ...buildDeletionFilter(options) }
  if (projectId) {
    query.projectId = projectId
  }
  const records = await UserSceneModel.find(query).sort({ sceneUpdatedAt: -1 }).lean()
  const sceneIds = (records as any[]).map((entry) => String(entry.sceneId ?? '')).filter(Boolean)
  const checkpointMap = await loadSceneCheckpointTotalMap(sceneIds)
  return (records as any[]).map((entry) => {
    const sceneId = String(entry.sceneId)
    return {
      id: sceneId,
      name: String(entry.name ?? '未命名场景'),
      projectId: String(entry.projectId ?? ''),
      thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : null,
      checkpointTotal: checkpointMap.get(sceneId) ?? 0,
      createdAt: new Date(entry.sceneCreatedAt).toISOString(),
      updatedAt: new Date(entry.sceneUpdatedAt).toISOString(),
      bundle: {
        url: buildBundleApiUrl(sceneId),
        size: Number(entry.bundleFileSize ?? 0),
        etag: String(entry.bundleEtag ?? ''),
        updatedAt: new Date(entry.sceneUpdatedAt).toISOString(),
      },
    } satisfies UserSceneSummary
  })
}

export async function getUserSceneBundle(userId: string, sceneId: string, options?: UserSceneQueryOptions): Promise<UserSceneBundleRecord | null> {
  const record = await UserSceneModel.findOne({ userId, sceneId, ...buildDeletionFilter(options) }).lean()
  if (!record) {
    return null
  }
  const checkpointMap = await loadSceneCheckpointTotalMap([sceneId])
  const entry = record as any
  return {
    id: sceneId,
    projectId: String(entry.projectId ?? ''),
    checkpointTotal: checkpointMap.get(sceneId) ?? 0,
    bundle: {
      url: buildBundleApiUrl(sceneId),
      size: Number(entry.bundleFileSize ?? 0),
      etag: String(entry.bundleEtag ?? ''),
      updatedAt: new Date(entry.sceneUpdatedAt).toISOString(),
      fileKey: String(entry.bundleFileKey ?? ''),
    },
  }
}

export async function saveUserSceneBundle(
  userId: string,
  sceneId: string,
  file: UploadedFilePayload,
  uploaderAdminId?: string | null,
  uploaderUsername?: string | null,
): Promise<UserSceneSummary> {
  const sourcePath = file.filepath
  if (!sourcePath) {
    throw new Error('Invalid upload payload')
  }
  const zipBytes = await fs.readFile(sourcePath)
  const documentMeta = parseSceneDocumentFromBundle(zipBytes, sceneId)
  const stored = await storeUploadedFile(file, 'user-scene-bundle')
  const upload = await FileUploadModel.create({
    module: 'user-scene-bundle',
    label: documentMeta.name,
    fileKey: stored.fileKey,
    url: stored.url,
    originalFilename: stored.originalFilename,
    mimeType: stored.mimeType,
    size: stored.size,
    uploaderAdminId: uploaderAdminId && Types.ObjectId.isValid(uploaderAdminId) ? new Types.ObjectId(uploaderAdminId) : null,
    uploaderUsername: uploaderUsername ?? null,
  })
  const etag = `W/"${stored.fileKey}-${stored.size}"`

  const existing = await UserSceneModel.findOne({ userId, sceneId }).lean()
  const previousFileKey = existing ? String((existing as any).bundleFileKey ?? '') : null
  const previousBundleUploadId = existing ? (existing as any).bundleUploadId ?? null : null

  try {
    await UserSceneModel.findOneAndUpdate(
      { userId, sceneId },
      {
        userId,
        sceneId,
        projectId: documentMeta.projectId,
        name: documentMeta.name,
        thumbnail: documentMeta.thumbnail,
        sceneCreatedAt: new Date(documentMeta.createdAt),
        sceneUpdatedAt: new Date(documentMeta.updatedAt),

        bundleUploadId: upload._id,
        bundleFileKey: stored.fileKey,
        bundleFileSize: stored.size,
        bundleFileType: stored.mimeType,
        bundleOriginalFilename: stored.originalFilename,
        bundleEtag: etag,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  } catch (error) {
    await FileUploadModel.findByIdAndDelete(upload._id).exec().catch(() => undefined)
    await deleteStoredFile(stored.fileKey)
    throw error
  }

  if (previousFileKey && previousFileKey !== stored.fileKey) {
    await deleteBundleFile(previousFileKey)
  }
  if (previousBundleUploadId && String(previousBundleUploadId) !== String(upload._id)) {
    await FileUploadModel.findByIdAndDelete(previousBundleUploadId).exec().catch(() => undefined)
  }

  const checkpointMap = await loadSceneCheckpointTotalMap([sceneId])

  return {
    id: sceneId,
    name: documentMeta.name,
    projectId: documentMeta.projectId,
    thumbnail: documentMeta.thumbnail,
    checkpointTotal: checkpointMap.get(sceneId) ?? 0,
    createdAt: documentMeta.createdAt,
    updatedAt: documentMeta.updatedAt,
    bundle: {
      url: buildBundleApiUrl(sceneId),
      size: stored.size,
      etag,
      updatedAt: documentMeta.updatedAt,
    },
  }
}

export async function deleteUserScene(userId: string, sceneId: string): Promise<boolean> {
  const record = await UserSceneModel.findOneAndDelete({ userId, sceneId }).lean()
  if (record) {
    await FileUploadModel.findByIdAndDelete((record as any).bundleUploadId ?? null).exec().catch(() => undefined)
    await deleteBundleFile(String((record as any).bundleFileKey ?? ''))
    return true
  }
  return false
}

export async function deleteUserScenesBulk(
  userId: string,
  sceneIds: string[],
): Promise<{ deletedIds: string[]; notFoundIds: string[]; failedIds: string[] }> {
  const ids = Array.from(new Set(sceneIds.map((id) => id.trim()).filter(Boolean)))
  if (!ids.length) {
    return { deletedIds: [], notFoundIds: [], failedIds: [] }
  }
  const existing = await UserSceneModel.find({ userId, sceneId: { $in: ids } }).lean()
  const existingIds = new Set(existing.map((entry: unknown) => String((entry as any).sceneId)))
  const notFoundIds = ids.filter((id) => !existingIds.has(id))
  try {
    await UserSceneModel.deleteMany({ userId, sceneId: { $in: ids } })
    await Promise.all(
      existing.flatMap((entry: unknown) => [
        FileUploadModel.findByIdAndDelete((entry as any).bundleUploadId ?? null).exec().catch(() => undefined),
        deleteBundleFile(String((entry as any).bundleFileKey ?? '')),
      ]),
    )
    return { deletedIds: ids.filter((id) => existingIds.has(id)), notFoundIds, failedIds: [] }
  } catch {
    return { deletedIds: [], notFoundIds, failedIds: ids }
  }
}

export async function trashUserScenesBulk(
  userId: string,
  sceneIds: string[],
  deletedAt = new Date(),
): Promise<{ trashedIds: string[]; notFoundIds: string[] }> {
  const ids = Array.from(new Set(sceneIds.map((id) => id.trim()).filter(Boolean)))
  if (!ids.length) {
    return { trashedIds: [], notFoundIds: [] }
  }
  const existing = await UserSceneModel.find({ userId, sceneId: { $in: ids }, deletedAt: null }, { sceneId: 1 }).lean()
  const existingIds = new Set(existing.map((entry: unknown) => String((entry as any).sceneId ?? '')))
  const notFoundIds = ids.filter((id) => !existingIds.has(id))
  if (existingIds.size) {
    await UserSceneModel.updateMany(
      { userId, sceneId: { $in: Array.from(existingIds) }, deletedAt: null },
      { $set: { isDeleted: true, deletedAt } },
    ).exec()
  }
  return { trashedIds: ids.filter((id) => existingIds.has(id)), notFoundIds }
}

export async function restoreUserScenesBulk(
  userId: string,
  sceneIds: string[],
): Promise<{ restoredIds: string[]; notFoundIds: string[] }> {
  const ids = Array.from(new Set(sceneIds.map((id) => id.trim()).filter(Boolean)))
  if (!ids.length) {
    return { restoredIds: [], notFoundIds: [] }
  }
  const existing = await UserSceneModel.find({ userId, sceneId: { $in: ids }, deletedAt: { $ne: null } }, { sceneId: 1 }).lean()
  const existingIds = new Set(existing.map((entry: unknown) => String((entry as any).sceneId ?? '')))
  const notFoundIds = ids.filter((id) => !existingIds.has(id))
  if (existingIds.size) {
    await UserSceneModel.updateMany(
      { userId, sceneId: { $in: Array.from(existingIds) }, deletedAt: { $ne: null } },
      { $set: { isDeleted: false, deletedAt: null } },
    ).exec()
  }
  return { restoredIds: ids.filter((id) => existingIds.has(id)), notFoundIds }
}
