import type { Context } from 'koa'
import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { Types } from 'mongoose'
import { appConfig } from '@/config/env'
import { FileUploadModel } from '@/models/FileUpload'

type RequestFilesMap = Record<string, unknown> | undefined

type UploadedFilePayload = {
  filepath?: string
  originalFilename?: string | null
  newFilename?: string | null
  mimetype?: string | null
  size?: number
}

function toSafePage(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }
  return parsed
}

function toSafePageSize(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }
  return Math.min(parsed, 100)
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeModuleName(value: unknown): string {
  const fallback = 'general'
  const input = normalizeString(value)
  if (!input) {
    return fallback
  }
  return input.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || fallback
}

function sanitizeUploadedFilePayload(value: unknown): UploadedFilePayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const file = value as UploadedFilePayload & { path?: string }
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

function extractUploadedFile(files: RequestFilesMap, field: string): UploadedFilePayload | null {
  if (!files) {
    return null
  }
  const raw = files[field]
  const first = Array.isArray(raw) ? raw[0] : raw
  return sanitizeUploadedFilePayload(first)
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
    throw new Error('Invalid file path')
  }
  return absolutePath
}

async function ensureModuleStorageDir(moduleName: string): Promise<void> {
  const root = path.resolve(appConfig.assetStoragePath)
  await fs.ensureDir(path.join(root, 'file-uploads', moduleName))
}

async function storeFileUpload(file: UploadedFilePayload, moduleName: string): Promise<{ fileKey: string; url: string }> {
  if (!file.filepath) {
    throw new Error('Invalid upload payload')
  }
  await ensureModuleStorageDir(moduleName)
  const extension = typeof file.originalFilename === 'string' ? path.extname(file.originalFilename) : ''
  const fileKey = `file-uploads/${moduleName}/${Date.now()}-${nanoid(12)}${extension}`
  const targetPath = resolveStorageAbsolutePath(fileKey)
  await fs.copy(file.filepath, targetPath)
  await fs.remove(file.filepath).catch(() => undefined)
  return { fileKey, url: buildPublicUrl(fileKey) }
}

function getUploadFileLabel(file: UploadedFilePayload): string {
  return normalizeString(file.originalFilename ?? file.newFilename) || 'attachment'
}

function toUploadDto(upload: any) {
  return {
    id: String(upload._id),
    module: String(upload.module || 'general'),
    label: typeof upload.label === 'string' ? upload.label : null,
    fileKey: String(upload.fileKey || ''),
    url: String(upload.url || ''),
    originalFilename: typeof upload.originalFilename === 'string' ? upload.originalFilename : null,
    mimeType: typeof upload.mimeType === 'string' ? upload.mimeType : null,
    size: Number(upload.size || 0),
    uploaderAdminId: upload.uploaderAdminId ? String(upload.uploaderAdminId) : null,
    uploaderUsername: typeof upload.uploaderUsername === 'string' ? upload.uploaderUsername : null,
    createdAt: upload.createdAt ? new Date(upload.createdAt).toISOString() : null,
    updatedAt: upload.updatedAt ? new Date(upload.updatedAt).toISOString() : null,
  }
}

function toUploaderSnapshot(ctx: Context) {
  const adminId = ctx.state.adminAuthUser?.id
  return {
    uploaderAdminId: adminId && Types.ObjectId.isValid(adminId) ? new Types.ObjectId(adminId) : null,
    uploaderUsername: ctx.state.adminAuthUser?.username ?? null,
  }
}

export async function listFileUploads(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, module } = ctx.query as Record<string, string>
  const pageNumber = toSafePage(page, 1)
  const size = toSafePageSize(pageSize, 20)
  const skip = (pageNumber - 1) * size

  const filter: Record<string, unknown> = {}
  if (typeof module === 'string' && module.trim()) {
    filter.module = normalizeModuleName(module)
  }
  if (typeof keyword === 'string' && keyword.trim()) {
    const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { label: new RegExp(escaped, 'i') },
      { originalFilename: new RegExp(escaped, 'i') },
      { fileKey: new RegExp(escaped, 'i') },
      { uploaderUsername: new RegExp(escaped, 'i') },
    ]
  }

  const [total, rows] = await Promise.all([
    FileUploadModel.countDocuments(filter).exec(),
    FileUploadModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(size).lean().exec(),
  ])

  ctx.body = {
    data: rows.map(toUploadDto),
    page: pageNumber,
    pageSize: size,
    total,
  }
}

export async function getFileUpload(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid upload id')
  }
  const upload = await FileUploadModel.findById(id).lean().exec()
  if (!upload) {
    ctx.throw(404, 'Upload not found')
  }
  ctx.body = toUploadDto(upload)
}

export async function uploadFile(ctx: Context): Promise<void> {
  const files = ctx.request.files as RequestFilesMap
  const file = extractUploadedFile(files, 'file')
  if (!file) {
    ctx.throw(400, 'File is required')
  }

  const payload = ctx.request.body as Record<string, unknown> | undefined
  const moduleName = normalizeModuleName(payload?.module)
  const label = normalizeString(payload?.label) || getUploadFileLabel(file)
  let storedFile: { fileKey: string; url: string } | null = null

  try {
    storedFile = await storeFileUpload(file, moduleName)
    const snapshot = toUploaderSnapshot(ctx)
    const upload = await FileUploadModel.create({
      module: moduleName,
      label,
      fileKey: storedFile.fileKey,
      url: storedFile.url,
      originalFilename: normalizeString(file.originalFilename ?? file.newFilename) || null,
      mimeType: normalizeString(file.mimetype) || null,
      size: Number(file.size ?? 0),
      ...snapshot,
    })
    ctx.body = toUploadDto(upload)
  } catch (error) {
    if (storedFile) {
      await fs.remove(resolveStorageAbsolutePath(storedFile.fileKey)).catch(() => undefined)
    }
    if (file.filepath) {
     await fs.remove(file.filepath).catch(() => undefined)
    }
    ctx.throw(400, error instanceof Error ? error.message : 'Upload failed')
  }
}

export async function deleteFileUpload(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid upload id')
  }
  const upload = await FileUploadModel.findById(id).lean().exec()
  if (!upload) {
    ctx.throw(404, 'Upload not found')
  }
  await fs.remove(resolveStorageAbsolutePath(String(upload.fileKey))).catch(() => undefined)
  await FileUploadModel.findByIdAndDelete(id).exec()
  ctx.body = { success: true }
}