import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { appConfig } from '@/config/env'

export type UploadedFilePayload = {
  filepath?: string
  originalFilename?: string | null
  newFilename?: string | null
  mimetype?: string | null
  size?: number
}

export type StoredUploadFile = {
  fileKey: string
  url: string
  size: number
  originalFilename: string | null
  mimeType: string | null
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeModuleName(value: unknown): string {
  const fallback = 'general'
  const input = normalizeString(value)
  if (!input) {
    return fallback
  }
  return input.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || fallback
}

export function normalizeFileKey(input: string): string {
  return input.replace(/\\+/g, '/').replace(/^\/+/, '')
}

export function buildPublicUrl(fileKey: string): string {
  const base = appConfig.assetPublicUrl.replace(/\/?$/, '')
  return `${base}/${normalizeFileKey(fileKey)}`
}

export function resolveStorageAbsolutePath(fileKey: string): string {
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

export async function storeUploadedFile(file: UploadedFilePayload, moduleName: string): Promise<StoredUploadFile> {
  if (!file.filepath) {
    throw new Error('Invalid upload payload')
  }
  const normalizedModuleName = normalizeModuleName(moduleName)
  await ensureModuleStorageDir(normalizedModuleName)
  const originalFilename = normalizeString(file.originalFilename ?? file.newFilename) || null
  const extension = originalFilename ? path.extname(originalFilename) : ''
  const fileKey = `file-uploads/${normalizedModuleName}/${Date.now()}-${nanoid(16)}${extension}`
  const targetPath = resolveStorageAbsolutePath(fileKey)
  await fs.copy(file.filepath, targetPath)
  await fs.remove(file.filepath).catch(() => undefined)
  const size = typeof file.size === 'number' ? file.size : await fs.stat(targetPath).then((stats) => stats.size)
  return {
    fileKey,
    url: buildPublicUrl(fileKey),
    size,
    originalFilename,
    mimeType: normalizeString(file.mimetype) || null,
  }
}

export async function deleteStoredFile(fileKey: string | null | undefined): Promise<void> {
  if (!fileKey) {
    return
  }
  const absolutePath = resolveStorageAbsolutePath(fileKey)
  const exists = await fs.pathExists(absolutePath)
  if (!exists) {
    return
  }
  await fs.remove(absolutePath).catch(() => undefined)
}