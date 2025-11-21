import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { Types, type FilterQuery } from 'mongoose'
import { appConfig } from '@/config/env'
import { SceneModel } from '@/models/Scene'
import type { SceneDocument } from '@/types/models'

const SCENE_STORAGE_PREFIX = 'scenes'

export type UploadedFilePayload = {
  filepath: string
  originalFilename?: string | null
  newFilename?: string | null
  mimetype?: string | null
  size?: number
}

type StoredSceneFile = {
  fileKey: string
  fileUrl: string
  fileSize: number
  fileType: string | null
  originalFilename: string | null
}

export type SceneData = {
  id: string
  name: string
  description: string | null
  fileKey: string
  fileUrl: string
  fileSize: number
  fileType: string | null
  originalFilename: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export type SceneListQuery = {
  page: number
  pageSize: number
  keyword?: string
  createdFrom?: Date | null
  createdTo?: Date | null
}

export type SceneCreatePayload = {
  name: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  file: UploadedFilePayload
}

export type SceneUpdatePayload = {
  name?: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  file?: UploadedFilePayload | null
}

type SceneDocLike = SceneDocument & { _id: Types.ObjectId }

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPublicUrl(fileKey: string): string {
  const normalizedKey = fileKey.replace(/\\+/g, '/').replace(/^\/+/u, '')
  const base = appConfig.assetPublicUrl.replace(/\/?$/, '')
  return `${base}/${normalizedKey}`
}

async function ensureSceneStorageDir(): Promise<void> {
  const root = path.resolve(appConfig.assetStoragePath)
  const sceneDir = path.join(root, SCENE_STORAGE_PREFIX)
  await fs.ensureDir(sceneDir)
}

function resolveAbsolutePath(fileKey: string): string {
  const normalizedKey = fileKey.replace(/\\+/g, '/').replace(/^\/+/u, '')
  const root = path.resolve(appConfig.assetStoragePath)
  const absolute = path.resolve(root, normalizedKey)
  if (!absolute.startsWith(root)) {
    throw new Error('Invalid scene file key path')
  }
  return absolute
}

async function storeSceneFile(file: UploadedFilePayload): Promise<StoredSceneFile> {
  const sourcePath = file.filepath
  if (!sourcePath) {
    throw new Error('Invalid upload payload')
  }
  await ensureSceneStorageDir()
  const original = sanitizeString(file.originalFilename ?? file.newFilename)
  const extension = original ? path.extname(original) : ''
  const filename = `${nanoid(16)}${extension}`
  const relativeKey = `${SCENE_STORAGE_PREFIX}/${filename}`
  const targetPath = resolveAbsolutePath(relativeKey)
  await fs.copy(sourcePath, targetPath)
  await fs.remove(sourcePath).catch(() => undefined)
  const fileSize = typeof file.size === 'number' ? file.size : await fs.stat(targetPath).then((stats) => stats.size)
  return {
    fileKey: relativeKey,
    fileUrl: buildPublicUrl(relativeKey),
    fileSize,
    fileType: sanitizeString(file.mimetype),
    originalFilename: original,
  }
}

export async function deleteSceneFile(fileKey: string | null | undefined): Promise<void> {
  if (!fileKey) {
    return
  }
  const absolute = resolveAbsolutePath(fileKey)
  const exists = await fs.pathExists(absolute)
  if (!exists) {
    return
  }
  await fs.remove(absolute).catch(() => undefined)
}

function mapSceneDocument(scene: SceneDocLike): SceneData {
  const id = scene._id instanceof Types.ObjectId ? scene._id.toString() : String(scene._id)
  const description = sanitizeString(scene.description)
  const metadata = scene.metadata && typeof scene.metadata === 'object' ? (scene.metadata as Record<string, unknown>) : null
  const createdAt = scene.createdAt instanceof Date ? scene.createdAt.toISOString() : new Date(scene.createdAt).toISOString()
  const updatedAt = scene.updatedAt instanceof Date ? scene.updatedAt.toISOString() : new Date(scene.updatedAt).toISOString()
  return {
    id,
    name: scene.name,
    description: description ?? null,
    fileKey: scene.fileKey,
    fileUrl: scene.fileUrl,
    fileSize: scene.fileSize ?? 0,
    fileType: sanitizeString(scene.fileType),
    originalFilename: sanitizeString(scene.originalFilename),
    metadata,
    createdAt,
    updatedAt,
  }
}

export async function listScenes(query: SceneListQuery): Promise<{ data: SceneData[]; total: number }> {
  const filter: FilterQuery<SceneDocument> = {}
  if (query.keyword) {
    filter.name = new RegExp(escapeRegex(query.keyword), 'i')
  }
  if (query.createdFrom || query.createdTo) {
    const createdAt: Record<string, Date> = {}
    if (query.createdFrom) {
      createdAt.$gte = query.createdFrom
    }
    if (query.createdTo) {
      createdAt.$lte = query.createdTo
    }
    filter.createdAt = createdAt
  }
  const skip = (query.page - 1) * query.pageSize
  const [records, total] = await Promise.all([
    SceneModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.pageSize)
      .lean()
      .exec() as Promise<SceneDocLike[]>,
    SceneModel.countDocuments(filter).exec(),
  ])
  return {
    data: records.map(mapSceneDocument),
    total,
  }
}

export async function createScene(payload: SceneCreatePayload): Promise<SceneData> {
  const stored = await storeSceneFile(payload.file)
  try {
    const created = await SceneModel.create({
      name: payload.name,
      description: payload.description ?? null,
      fileKey: stored.fileKey,
      fileUrl: stored.fileUrl,
      fileSize: stored.fileSize,
      fileType: stored.fileType,
      originalFilename: stored.originalFilename,
      metadata: payload.metadata ?? null,
    })
    return mapSceneDocument(created.toObject() as SceneDocLike)
  } catch (error) {
    await deleteSceneFile(stored.fileKey)
    throw error
  }
}

export async function updateScene(id: string, payload: SceneUpdatePayload): Promise<SceneData | null> {
  const scene = await SceneModel.findById(id).exec()
  if (!scene) {
    return null
  }
  let newFile: StoredSceneFile | null = null
  if (payload.file) {
    newFile = await storeSceneFile(payload.file)
  }
  const previousFileKey = scene.fileKey
  if (typeof payload.name === 'string' && payload.name.trim().length) {
    scene.name = payload.name.trim()
  }
  if (payload.description !== undefined) {
    scene.description = payload.description ? payload.description.trim() : null
  }
  if (payload.metadata !== undefined) {
    scene.metadata = payload.metadata ?? null
  }
  if (newFile) {
    scene.fileKey = newFile.fileKey
    scene.fileUrl = newFile.fileUrl
    scene.fileSize = newFile.fileSize
    scene.fileType = newFile.fileType
    scene.originalFilename = newFile.originalFilename
  }
  try {
    await scene.save()
  } catch (error) {
    if (newFile) {
      await deleteSceneFile(newFile.fileKey)
    }
    throw error
  }
  if (newFile && previousFileKey !== newFile.fileKey) {
    await deleteSceneFile(previousFileKey)
  }
  return mapSceneDocument(scene.toObject() as SceneDocLike)
}

export async function deleteSceneById(id: string): Promise<boolean> {
  const deleted = (await SceneModel.findByIdAndDelete(id).lean().exec()) as SceneDocLike | null
  if (!deleted) {
    return false
  }
  await deleteSceneFile(deleted.fileKey)
  return true
}

export async function findSceneById(id: string): Promise<SceneData | null> {
  const scene = (await SceneModel.findById(id).lean().exec()) as SceneDocLike | null
  if (!scene) {
    return null
  }
  return mapSceneDocument(scene)
}

export async function findSceneDocument(id: string): Promise<SceneDocLike | null> {
  const scene = (await SceneModel.findById(id).lean().exec()) as SceneDocLike | null
  return scene
}

export function extractUploadedFile(files: Record<string, unknown> | undefined, field: string): UploadedFilePayload | null {
  if (!files) {
    return null
  }
  const raw = files[field]
  const payload = Array.isArray(raw) ? raw[0] : raw
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const file = payload as UploadedFilePayload & { path?: string }
  const filepath = file.filepath ?? file.path
  if (!filepath) {
    return null
  }
  return {
    filepath,
    originalFilename: file.originalFilename ?? file.newFilename ?? null,
    newFilename: file.newFilename ?? null,
    mimetype: file.mimetype ?? null,
    size: file.size,
  }
}

export function resolveSceneFilePath(fileKey: string): string {
  return resolveAbsolutePath(fileKey)
}
*** End of File
