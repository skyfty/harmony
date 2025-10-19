import type { Context } from 'koa'
import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { Types } from 'mongoose'
import type { AssetCategoryDocument, AssetDocument } from '@/types/models'
import { AssetCategoryModel } from '@/models/AssetCategory'
import { AssetModel } from '@/models/Asset'
import { appConfig } from '@/config/env'

const ASSET_COLORS: Record<string, string> = {
  model: '#26c6da',
  image: '#1e88e5',
  texture: '#8e24aa',
  file: '#6d4c41',
}

const ASSET_TYPES: AssetDocument['type'][] = ['model', 'image', 'texture', 'file']

type AssetCategoryData = {
  _id: Types.ObjectId
  name: AssetCategoryDocument['name']
  type: AssetCategoryDocument['type']
  description?: AssetCategoryDocument['description']
  createdAt: Date
  updatedAt: Date
}

type AssetData = {
  _id: Types.ObjectId
  name: AssetDocument['name']
  categoryId: Types.ObjectId
  type: AssetDocument['type']
  size: number
  url: string
  previewUrl?: string | null
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

interface ProjectDirectoryAsset {
  id: string
  name: string
  type: AssetDocument['type']
  downloadUrl: string
  previewColor: string
  thumbnail: string | null
  description: string | null
  gleaned: boolean
}

interface ProjectDirectory {
  id: string
  name: string
  type: AssetCategoryDocument['type']
  assets: ProjectDirectoryAsset[]
}

type AssetSource = AssetDocument | AssetData

function mapAsset(asset: AssetSource) {
  const assetId = (asset._id as Types.ObjectId).toString()
  const categoryObjectId = (asset.categoryId as Types.ObjectId).toString()
  return {
    id: assetId,
    name: asset.name,
    categoryId: categoryObjectId,
    type: asset.type,
    size: asset.size,
    url: asset.url,
    previewUrl: asset.previewUrl ?? null,
    metadata: asset.metadata ?? {},
    createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : new Date(asset.createdAt).toISOString(),
    updatedAt: asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : new Date(asset.updatedAt).toISOString(),
  }
}

function mapDirectory(categories: AssetCategoryData[], assets: AssetData[]): ProjectDirectory[] {
  return categories.map((category) => {
    const categoryAssets = assets
      .filter((asset) => asset.categoryId.toString() === category._id.toString())
      .map((asset): ProjectDirectoryAsset => {
        const description = typeof asset.metadata?.description === 'string' ? asset.metadata.description : null
        return {
          id: asset._id.toString(),
          name: asset.name,
          type: asset.type,
          downloadUrl: asset.url,
          previewColor: ASSET_COLORS[asset.type] ?? '#546e7a',
          thumbnail: asset.previewUrl ?? null,
          description,
          gleaned: false,
        }
      })

    return {
      id: category._id.toString(),
      name: category.name,
      type: category.type,
      assets: categoryAssets,
    }
  })
}

async function ensureStorageDir(): Promise<void> {
  await fs.ensureDir(appConfig.assetStoragePath)
}

function resolveAssetType(input: unknown, fallback: AssetDocument['type'] = 'file'): AssetDocument['type'] {
  if (typeof input === 'string' && ASSET_TYPES.includes(input as AssetDocument['type'])) {
    return input as AssetDocument['type']
  }
  return fallback
}

export async function listResourceCategories(ctx: Context): Promise<void> {
  const categories = (await AssetCategoryModel.find().sort({ createdAt: 1 }).lean().exec()) as AssetCategoryData[]
  if (!categories.length) {
    const defaults = [
      { name: 'Models', type: 'model' },
      { name: 'Images', type: 'image' },
      { name: 'Textures', type: 'texture' },
      { name: 'Files', type: 'file' },
    ]
    const created = (await AssetCategoryModel.insertMany(defaults)) as AssetCategoryDocument[]
    ctx.body = created.map((category) => ({
      id: (category._id as Types.ObjectId).toString(),
      name: category.name,
      type: category.type,
      description: category.description ?? null,
    }))
    return
  }
  ctx.body = categories.map((category: AssetCategoryData) => ({
    id: category._id.toString(),
    name: category.name,
    type: category.type,
    description: category.description ?? null,
  }))
}

export async function listAssets(ctx: Context): Promise<void> {
  const { page = 1, pageSize = 12, keyword, categoryId } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.name = new RegExp(keyword, 'i')
  }
  if (categoryId && Types.ObjectId.isValid(categoryId)) {
    filter.categoryId = categoryId
  }
  const pageNumber = Number(page)
  const limit = Number(pageSize)
  const skip = (pageNumber - 1) * limit
  const assetsPromise = AssetModel.find(filter)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 })
    .lean()
    .exec() as Promise<AssetData[]>
  const [assets, total] = await Promise.all([assetsPromise, AssetModel.countDocuments(filter)])
  ctx.body = {
    data: assets.map(mapAsset),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function uploadAsset(ctx: Context): Promise<void> {
  const queryParams = ctx.query as Record<string, string | undefined>
  const bodyParams = ctx.request.body as Record<string, unknown> | undefined
  const categoryId = (bodyParams?.categoryId as string | undefined) ?? queryParams?.categoryId
  if (!categoryId || !Types.ObjectId.isValid(categoryId)) {
    ctx.throw(400, 'Invalid category id')
  }
  const files = ctx.request.files as Record<string, unknown> | undefined
  const fileField = files?.file
  const file = Array.isArray(fileField) ? fileField[0] : fileField
  if (!file || typeof file !== 'object') {
    ctx.throw(400, 'File is required')
  }
  await ensureStorageDir()
  const originalName =
    (file as { originalFilename?: string | null }).originalFilename ??
    (file as { name?: string | null }).name ??
    undefined
  const extension = path.extname(originalName ?? '').toLowerCase()
  const fileName = `${nanoid(16)}${extension}`
  const targetPath = path.join(appConfig.assetStoragePath, fileName)
  const temporaryPath =
    (file as { filepath?: string }).filepath ?? (file as { path?: string }).path
  if (!temporaryPath) {
    ctx.throw(400, 'Invalid upload payload')
  }
  await fs.copy(temporaryPath, targetPath)
  await fs.remove(temporaryPath).catch(() => undefined)
  const publicUrl = `${appConfig.assetPublicUrl.replace(/\/$/, '')}/${fileName}`
  const hintedType =
    bodyParams?.type ??
    queryParams?.type ??
    ((file as { mimetype?: string }).mimetype?.startsWith('image/') ? 'image' : undefined)
  const type = resolveAssetType(hintedType)
  const asset = await AssetModel.create({
    name:
      (typeof bodyParams?.name === 'string' && bodyParams.name.trim()) ||
      originalName ||
      fileName,
    categoryId,
    type,
    size: Number((file as { size?: number }).size ?? 0),
    url: publicUrl,
    previewUrl: type === 'image' ? publicUrl : null,
  })
  ctx.body = { asset: mapAsset(asset) }
}

export async function deleteAsset(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid asset id')
  }
  const asset = await AssetModel.findByIdAndDelete(id)
  if (asset) {
    const filePath = path.join(appConfig.assetStoragePath, path.basename(asset.url))
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath)
    }
  }
  ctx.status = 204
}

export async function getProjectDirectories(ctx: Context): Promise<void> {
  const [categories, assets] = await Promise.all([
    (await AssetCategoryModel.find().lean().exec()) as AssetCategoryData[],
    (await AssetModel.find().lean().exec()) as AssetData[],
  ])
  const directories = mapDirectory(categories, assets)
  ctx.body = directories
}
