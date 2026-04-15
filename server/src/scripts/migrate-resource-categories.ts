import '@/utils/cjsCompat'
import path from 'node:path'
import fs from 'fs-extra'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '@/config/database'

type BackupDirectory = {
  id: string
  name: string
  parentId: string | null
  pathIds: string[]
  pathNames: string[]
  depth: number
  createdAt: string
  updatedAt: string
}

type BackupAssetDirectoryRelation = {
  assetId: string
  assetName: string
  categoryId: string
  directoryId: string | null
}

type LegacyAssetRecord = {
  _id: mongoose.Types.ObjectId
  name: string
  categoryId: mongoose.Types.ObjectId
  directoryId?: mongoose.Types.ObjectId | null
}

async function main(): Promise<void> {
  await connectDatabase()
  console.log('[migrate:resource-categories] 数据库连接成功')

  const directoryCollection = mongoose.connection.db.collection<{
    _id: mongoose.Types.ObjectId
    name: string
    parentId?: mongoose.Types.ObjectId | null
    pathIds: mongoose.Types.ObjectId[]
    pathNames: string[]
    depth: number
    createdAt: Date
    updatedAt: Date
  }>('assetdirectories')
  const assetCollection = mongoose.connection.db.collection<LegacyAssetRecord>('assets')

  const [directories, assets] = await Promise.all([
    directoryCollection.find({}).sort({ depth: 1, name: 1 }).toArray(),
    assetCollection.find({}).project<LegacyAssetRecord>({ _id: 1, name: 1, categoryId: 1, directoryId: 1 }).toArray(),
  ])

  const backupPayload = {
    exportedAt: new Date().toISOString(),
    directories: directories.map<BackupDirectory>((directory) => ({
      id: directory._id.toString(),
      name: directory.name,
      parentId: directory.parentId ? directory.parentId.toString() : null,
      pathIds: directory.pathIds.map((value) => value.toString()),
      pathNames: [...directory.pathNames],
      depth: directory.depth,
      createdAt: directory.createdAt.toISOString(),
      updatedAt: directory.updatedAt.toISOString(),
    })),
    assetDirectoryRelations: assets.map<BackupAssetDirectoryRelation>((asset) => ({
      assetId: asset._id.toString(),
      assetName: asset.name,
      categoryId: asset.categoryId.toString(),
      directoryId: asset.directoryId ? asset.directoryId.toString() : null,
    })),
  }

  const backupDir = path.resolve(process.cwd(), 'backups')
  const backupFile = path.join(backupDir, `resource-category-unify-${Date.now()}.json`)
  await fs.ensureDir(backupDir)
  await fs.writeJson(backupFile, backupPayload, { spaces: 2 })

  const assetsToAlign = assets.filter((asset) => {
    const categoryId = asset.categoryId.toString()
    const directoryId = asset.directoryId ? asset.directoryId.toString() : null
    return directoryId !== categoryId
  })

  if (!assetsToAlign.length) {
    console.log(`[migrate:resource-categories] 未发现需要清理的历史 directoryId，备份已生成：${backupFile}`)
    return
  }

  const result = await assetCollection.updateMany(
    { _id: { $in: assetsToAlign.map((asset) => asset._id) } },
    { $unset: { directoryId: '' } },
  )

  console.log(
    `[migrate:resource-categories] 已导出旧目录备份：${backupFile}；清理 ${assetsToAlign.length} 条资产的历史 directoryId 字段，实际更新 ${result.modifiedCount} 条。`,
  )
  console.log('[migrate:resource-categories] 旧目录关系已仅保留在备份文件中。')
}

main()
  .catch((error) => {
    console.error('[migrate:resource-categories] 执行失败', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined)
    console.log('[migrate:resource-categories] 数据库连接已关闭')
  })