import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { UserSceneModel } from '@/models/UserScene'
import { appConfig } from '@/config/env'
import type { UploadedFilePayload } from '@/services/sceneService'
import type { UserSceneBundleRecord, UserSceneSummary } from '@/types/userScene'
import { readTextFileFromScenePackage, unzipScenePackage } from '@harmony/schema'

export type { UploadedFilePayload } from '@/services/sceneService'

const USER_SCENE_BUNDLE_STORAGE_PREFIX = 'user-scenes'

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

function resolveAbsolutePath(fileKey: string): string {
  const normalizedKey = fileKey.replace(/\\+/g, '/').replace(/^\/+/, '')
  const root = path.resolve(appConfig.assetStoragePath)
  const absolute = path.resolve(root, normalizedKey)
  if (!absolute.startsWith(root)) {
    throw new Error('Invalid bundle file key path')
  }
  return absolute
}

export function resolveUserSceneBundleFilePath(fileKey: string): string {
  return resolveAbsolutePath(fileKey)
}

async function ensureBundleStorageDir(): Promise<void> {
  const root = path.resolve(appConfig.assetStoragePath)
  const dir = path.join(root, USER_SCENE_BUNDLE_STORAGE_PREFIX)
  await fs.ensureDir(dir)
}

async function storeBundleFile(file: UploadedFilePayload): Promise<{
  fileKey: string
  fileSize: number
  fileType: string | null
  originalFilename: string | null
}> {
  const sourcePath = file.filepath
  if (!sourcePath) {
    throw new Error('Invalid upload payload')
  }
  await ensureBundleStorageDir()
  const original = sanitizeString(file.originalFilename ?? file.newFilename) || null
  const filename = `${nanoid(16)}.zip`
  const relativeKey = `${USER_SCENE_BUNDLE_STORAGE_PREFIX}/${filename}`
  const targetPath = resolveAbsolutePath(relativeKey)
  await fs.copy(sourcePath, targetPath)
  await fs.remove(sourcePath).catch(() => undefined)
  const fileSize = typeof file.size === 'number' ? file.size : await fs.stat(targetPath).then((stats) => stats.size)
  return {
    fileKey: relativeKey,
    fileSize,
    fileType: sanitizeString(file.mimetype) || 'application/zip',
    originalFilename: original,
  }
}

async function deleteBundleFile(fileKey: string | null | undefined): Promise<void> {
  if (!fileKey) return
  const absolute = resolveAbsolutePath(fileKey)
  const exists = await fs.pathExists(absolute)
  if (!exists) return
  await fs.remove(absolute).catch(() => undefined)
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
  if (sanitizeString(sceneEntry.sceneId) !== expectedSceneId) {
    throw new Error('Scene id mismatch between path and bundle manifest')
  }
  const sceneRaw = JSON.parse(readTextFileFromScenePackage(pkg, sceneEntry.path)) as any
  const id = sanitizeString(sceneRaw?.id) || expectedSceneId
  if (id !== expectedSceneId) {
    throw new Error('Scene id mismatch between path and scene.json')
  }
  const name = sanitizeString(sceneRaw?.name) || '未命名场景'
  const projectId = sanitizeString(sceneRaw?.projectId)
  if (!projectId) {
    throw new Error('scene.json missing projectId')
  }
  const thumbnail = typeof sceneRaw?.thumbnail === 'string' ? sceneRaw.thumbnail : null
  const updatedAt = toIsoString(sceneRaw?.updatedAt)
  const createdAt = toIsoString(sceneRaw?.createdAt ?? updatedAt)
  return { id, name, projectId, thumbnail, createdAt, updatedAt }
}

export async function listUserScenes(userId: string): Promise<UserSceneSummary[]> {
  const records = await UserSceneModel.find({ userId }).sort({ sceneUpdatedAt: -1 }).lean()
  return (records as any[]).map((entry) => {
    const sceneId = String(entry.sceneId)
    return {
      id: sceneId,
      name: String(entry.name ?? '未命名场景'),
      projectId: String(entry.projectId ?? ''),
      thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : null,
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

export async function getUserSceneBundle(userId: string, sceneId: string): Promise<UserSceneBundleRecord | null> {
  const record = await UserSceneModel.findOne({ userId, sceneId }).lean()
  if (!record) {
    return null
  }
  const entry = record as any
  return {
    id: sceneId,
    projectId: String(entry.projectId ?? ''),
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
): Promise<UserSceneSummary> {
  const sourcePath = file.filepath
  const zipBytes = await fs.readFile(sourcePath)
  const documentMeta = parseSceneDocumentFromBundle(zipBytes, sceneId)
  const stored = await storeBundleFile(file)
  const etag = `W/\"${stored.fileKey}-${stored.fileSize}\"`

  const existing = await UserSceneModel.findOne({ userId, sceneId }).lean()
  const previousFileKey = existing ? String((existing as any).bundleFileKey ?? '') : null

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

      bundleFileKey: stored.fileKey,
      bundleFileSize: stored.fileSize,
      bundleFileType: stored.fileType,
      bundleOriginalFilename: stored.originalFilename,
      bundleEtag: etag,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  if (previousFileKey && previousFileKey !== stored.fileKey) {
    await deleteBundleFile(previousFileKey)
  }

  return {
    id: sceneId,
    name: documentMeta.name,
    projectId: documentMeta.projectId,
    thumbnail: documentMeta.thumbnail,
    createdAt: documentMeta.createdAt,
    updatedAt: documentMeta.updatedAt,
    bundle: {
      url: buildBundleApiUrl(sceneId),
      size: stored.fileSize,
      etag,
      updatedAt: documentMeta.updatedAt,
    },
  }
}

export async function deleteUserScene(userId: string, sceneId: string): Promise<boolean> {
  const record = await UserSceneModel.findOneAndDelete({ userId, sceneId }).lean()
  if (record) {
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
  const existingIds = new Set(existing.map((entry) => String((entry as any).sceneId)))
  const notFoundIds = ids.filter((id) => !existingIds.has(id))
  try {
    await UserSceneModel.deleteMany({ userId, sceneId: { $in: ids } })
    await Promise.all(existing.map((entry) => deleteBundleFile(String((entry as any).bundleFileKey ?? ''))))
    return { deletedIds: ids.filter((id) => existingIds.has(id)), notFoundIds, failedIds: [] }
  } catch {
    return { deletedIds: [], notFoundIds, failedIds: ids }
  }
}
