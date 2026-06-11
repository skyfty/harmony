import '@/utils/cjsCompat'
import path from 'node:path'
import fs from 'fs-extra'
import mongoose, { Types } from 'mongoose'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { appConfig } from '@/config/env'
import { AdminModel } from '@/models/Admin'
import { FileUploadModel } from '@/models/FileUpload'
import { SceneModel } from '@/models/Scene'
import { UserSceneModel } from '@/models/UserScene'

type SceneRecord = {
  _id: mongoose.Types.ObjectId
  name: string
  fileKey: string
  fileUrl: string
  fileSize: number
  fileType?: string | null
  originalFilename?: string | null
  publishedBy?: mongoose.Types.ObjectId | null
  publishedByType: 'User' | 'Admin'
  fileUploadId?: mongoose.Types.ObjectId | null
}

type UserSceneRecord = {
  _id: mongoose.Types.ObjectId
  userId: string
  sceneId: string
  projectId: string
  name: string
  bundleFileKey: string
  bundleFileSize: number
  bundleFileType?: string | null
  bundleOriginalFilename?: string | null
  bundleEtag: string
  bundleUploadId?: mongoose.Types.ObjectId | null
}

type AdminRecord = {
  _id: mongoose.Types.ObjectId
  username: string
}

type FileUploadSeed = {
  module: string
  label: string | null
  fileKey: string
  url: string
  originalFilename: string | null
  mimeType: string | null
  size: number
  uploaderAdminId: mongoose.Types.ObjectId | null
  uploaderUsername: string | null
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeFileKey(input: string): string {
  return input.replace(/\\+/g, '/').replace(/^\/+/, '')
}

function buildPublicUrl(fileKey: string): string {
  const base = appConfig.assetPublicUrl.replace(/\/?$/, '')
  return `${base}/${normalizeFileKey(fileKey)}`
}

function resolveStorageAbsolutePath(fileKey: string): string {
  const root = path.resolve(appConfig.assetStoragePath)
  const absolutePath = path.resolve(root, normalizeFileKey(fileKey))
  if (!absolutePath.startsWith(root)) {
    throw new Error('Invalid file key')
  }
  return absolutePath
}

async function resolveStoredFileSize(fileKey: string): Promise<number> {
  try {
    const absolutePath = resolveStorageAbsolutePath(fileKey)
    if (!(await fs.pathExists(absolutePath))) {
      return 0
    }
    return await fs.stat(absolutePath).then((stats) => stats.size)
  } catch {
    return 0
  }
}

async function ensureFileUpload(seed: FileUploadSeed): Promise<'created' | 'updated' | 'skipped'> {
  const result = await FileUploadModel.updateOne(
    { fileKey: seed.fileKey },
    {
      $setOnInsert: {
        module: seed.module,
        label: seed.label,
        fileKey: seed.fileKey,
        url: seed.url,
        originalFilename: seed.originalFilename,
        mimeType: seed.mimeType,
        size: seed.size,
        uploaderAdminId: seed.uploaderAdminId,
        uploaderUsername: seed.uploaderUsername,
      },
      $set: {
        module: seed.module,
        label: seed.label,
        url: seed.url,
        originalFilename: seed.originalFilename,
        mimeType: seed.mimeType,
        size: seed.size,
        uploaderAdminId: seed.uploaderAdminId,
        uploaderUsername: seed.uploaderUsername,
      },
    },
    { upsert: true },
  )
  if (result.upsertedCount > 0) {
    return 'created'
  }
  return result.modifiedCount > 0 ? 'updated' : 'skipped'
}

async function main(): Promise<void> {
  await connectDatabase()
  console.log('[migrate:admin-upload-assets] database connected')

  const scenes = await SceneModel.find(
    {},
    { _id: 1, name: 1, fileKey: 1, fileUrl: 1, fileSize: 1, fileType: 1, originalFilename: 1, publishedBy: 1, publishedByType: 1, fileUploadId: 1 },
  )
    .lean()
    .exec() as SceneRecord[]

  const userScenes = await UserSceneModel.find(
    {},
    { _id: 1, userId: 1, sceneId: 1, projectId: 1, name: 1, bundleFileKey: 1, bundleFileSize: 1, bundleFileType: 1, bundleOriginalFilename: 1, bundleEtag: 1, bundleUploadId: 1 },
  )
    .lean()
    .exec() as UserSceneRecord[]

  const adminIds = Array.from(
    new Set(
      scenes
        .map((scene) => scene.publishedBy?.toString())
        .filter((value): value is string => typeof value === 'string' && value.length > 0 && Types.ObjectId.isValid(value)),
    ),
  ).map((value) => new Types.ObjectId(value))

  const adminRecords = adminIds.length
    ? ((await AdminModel.find({ _id: { $in: adminIds } }, { _id: 1, username: 1 }).lean().exec()) as AdminRecord[])
    : []
  const adminById = new Map<string, AdminRecord>()
  adminRecords.forEach((admin) => {
    adminById.set(admin._id.toString(), admin)
  })

  let createdCount = 0
  let updatedCount = 0
  let skippedCount = 0

  for (const scene of scenes) {
    const uploaderAdminId = scene.publishedBy && Types.ObjectId.isValid(scene.publishedBy.toString()) ? scene.publishedBy : null
    const uploaderUsername = uploaderAdminId ? adminById.get(uploaderAdminId.toString())?.username ?? null : null
    const seed: FileUploadSeed = {
      module: 'scene',
      label: normalizeString(scene.name),
      fileKey: normalizeFileKey(scene.fileKey),
      url: normalizeString(scene.fileUrl) ?? buildPublicUrl(scene.fileKey),
      originalFilename: normalizeString(scene.originalFilename),
      mimeType: normalizeString(scene.fileType),
      size: Number.isFinite(scene.fileSize) && scene.fileSize >= 0 ? Math.floor(scene.fileSize) : await resolveStoredFileSize(scene.fileKey),
      uploaderAdminId,
      uploaderUsername,
    }
    const result = await ensureFileUpload(seed)
    if (result === 'created') {
      createdCount += 1
    } else if (result === 'updated') {
      updatedCount += 1
    } else {
      skippedCount += 1
    }
  }

  for (const bundle of userScenes) {
    const seed: FileUploadSeed = {
      module: 'user-scene-bundle',
      label: normalizeString(bundle.name),
      fileKey: normalizeFileKey(bundle.bundleFileKey),
      url: buildPublicUrl(bundle.bundleFileKey),
      originalFilename: normalizeString(bundle.bundleOriginalFilename),
      mimeType: normalizeString(bundle.bundleFileType) || 'application/zip',
      size: Number.isFinite(bundle.bundleFileSize) && bundle.bundleFileSize >= 0 ? Math.floor(bundle.bundleFileSize) : await resolveStoredFileSize(bundle.bundleFileKey),
      uploaderAdminId: null,
      uploaderUsername: null,
    }
    const result = await ensureFileUpload(seed)
    if (result === 'created') {
      createdCount += 1
    } else if (result === 'updated') {
      updatedCount += 1
    } else {
      skippedCount += 1
    }
  }

  const fileUploads = await FileUploadModel.find({}, { _id: 1, fileKey: 1 }).lean().exec()
  const uploadIdByKey = new Map(fileUploads.map((upload: any) => [String(upload.fileKey), upload._id as Types.ObjectId]))

  let boundSceneCount = 0
  let boundUserSceneCount = 0

  for (const scene of scenes) {
    const uploadId = uploadIdByKey.get(normalizeFileKey(scene.fileKey)) ?? null
    if (!uploadId) {
      continue
    }
    const needsUpdate = !scene.fileUploadId || String(scene.fileUploadId) !== String(uploadId)
    if (needsUpdate) {
      await SceneModel.updateOne({ _id: scene._id }, { $set: { fileUploadId: uploadId } }).exec()
      boundSceneCount += 1
    }
  }

  for (const bundle of userScenes) {
    const uploadId = uploadIdByKey.get(normalizeFileKey(bundle.bundleFileKey)) ?? null
    if (!uploadId) {
      continue
    }
    const needsUpdate = !bundle.bundleUploadId || String(bundle.bundleUploadId) !== String(uploadId)
    if (needsUpdate) {
      await UserSceneModel.updateOne({ _id: bundle._id }, { $set: { bundleUploadId: uploadId } }).exec()
      boundUserSceneCount += 1
    }
  }

  console.log(
    `[migrate:admin-upload-assets] scenes=${scenes.length}, userScenes=${userScenes.length}, created=${createdCount}, updated=${updatedCount}, skipped=${skippedCount}, boundScenes=${boundSceneCount}, boundUserScenes=${boundUserSceneCount}`,
  )
}

main()
  .catch((error) => {
    console.error('[migrate:admin-upload-assets] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined)
    console.log('[migrate:admin-upload-assets] database disconnected')
  })