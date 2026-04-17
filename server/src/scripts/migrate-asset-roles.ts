import '@/utils/cjsCompat'
import path from 'node:path'
import fs from 'fs-extra'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { appConfig } from '@/config/env'

const MANIFEST_FILENAME = 'asset-manifest.json'

type LegacyAssetRoleRecord = {
  _id: mongoose.Types.ObjectId
  name: string
  bundleRole?: 'primary' | 'dependency' | null
  assetRole?: 'master' | 'dependant' | null
  contentHash?: string | null
  contentHashAlgorithm?: string | null
}

type BackupAssetRoleRecord = {
  assetId: string
  name: string
  bundleRole: 'primary' | 'dependency' | null
  previousAssetRole: 'master' | 'dependant' | null
  nextAssetRole: 'master' | 'dependant'
  contentHash: string | null
  contentHashAlgorithm: string | null
}

function resolveNextAssetRole(asset: LegacyAssetRoleRecord): 'master' | 'dependant' {
  if (asset.assetRole === 'master' || asset.assetRole === 'dependant') {
    return asset.assetRole
  }
  return asset.bundleRole === 'dependency' ? 'dependant' : 'master'
}

async function invalidatePersistedManifest(): Promise<boolean> {
  const manifestPath = path.join(appConfig.assetStoragePath, MANIFEST_FILENAME)
  if (!(await fs.pathExists(manifestPath))) {
    return false
  }
  await fs.remove(manifestPath)
  return true
}

async function main(): Promise<void> {
  await connectDatabase()
  console.log('[migrate:asset-roles] 数据库连接成功')

  const assetCollection = mongoose.connection.db.collection<LegacyAssetRoleRecord>('assets')
  const assets = await assetCollection
    .find({})
    .project<LegacyAssetRoleRecord>({
      _id: 1,
      name: 1,
      bundleRole: 1,
      assetRole: 1,
      contentHash: 1,
      contentHashAlgorithm: 1,
    })
    .toArray()

  const backupRecords = assets.map<BackupAssetRoleRecord>((asset) => ({
    assetId: asset._id.toString(),
    name: asset.name,
    bundleRole: asset.bundleRole ?? null,
    previousAssetRole: asset.assetRole ?? null,
    nextAssetRole: resolveNextAssetRole(asset),
    contentHash: asset.contentHash ?? null,
    contentHashAlgorithm: asset.contentHashAlgorithm ?? null,
  }))

  const backupDir = path.resolve(process.cwd(), 'backups')
  const backupFile = path.join(backupDir, `asset-role-backfill-${Date.now()}.json`)
  await fs.ensureDir(backupDir)
  await fs.writeJson(
    backupFile,
    {
      exportedAt: new Date().toISOString(),
      assets: backupRecords,
    },
    { spaces: 2 },
  )

  const dependantIds = backupRecords
    .filter((record) => record.nextAssetRole === 'dependant')
    .map((record) => new mongoose.Types.ObjectId(record.assetId))
  const masterIds = backupRecords
    .filter((record) => record.nextAssetRole === 'master')
    .map((record) => new mongoose.Types.ObjectId(record.assetId))

  let modifiedCount = 0
  if (dependantIds.length) {
    const dependantResult = await assetCollection.updateMany(
      { _id: { $in: dependantIds } },
      { $set: { assetRole: 'dependant' } },
    )
    modifiedCount += dependantResult.modifiedCount
  }
  if (masterIds.length) {
    const masterResult = await assetCollection.updateMany(
      { _id: { $in: masterIds } },
      { $set: { assetRole: 'master' } },
    )
    modifiedCount += masterResult.modifiedCount
  }

  const manifestRemoved = await invalidatePersistedManifest()
  console.log(
    `[migrate:asset-roles] 已生成备份：${backupFile}；扫描 ${assets.length} 条资产，写回 ${modifiedCount} 条 assetRole。`,
  )
  if (manifestRemoved) {
    console.log('[migrate:asset-roles] 已删除旧 asset manifest，系统将在下次读取时按新角色重建。')
  } else {
    console.log('[migrate:asset-roles] 未发现旧 asset manifest 文件，无需删除。')
  }
}

main()
  .catch((error) => {
    console.error('[migrate:asset-roles] 执行失败', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined)
    console.log('[migrate:asset-roles] 数据库连接已关闭')
  })