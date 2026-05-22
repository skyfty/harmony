import '@/utils/cjsCompat'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { seedSpotCategories } from './seed-spot-categories'

async function main(): Promise<void> {
  await connectDatabase()
  console.log('[repair:spot-categories] 数据库连接成功')

  await seedSpotCategories()
  console.log('[repair:spot-categories] 景点分类树已修补')
}

main()
  .catch((error) => {
    console.error('[repair:spot-categories] 执行失败', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined)
    console.log('[repair:spot-categories] 数据库连接已关闭')
  })
