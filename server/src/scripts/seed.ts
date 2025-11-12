import '@/utils/cjsCompat'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { createInitialAdmin, ensureEditorUser, ensureUploaderUser } from '@/services/authService'
import { ensureOptimizeProductsSeeded } from '@/services/optimizeProductService'

async function main(): Promise<void> {
  await connectDatabase()
  console.log('[seed] 数据库连接成功')

  await createInitialAdmin().catch((error) => {
    console.warn('[seed] 跳过创建初始管理员：', error)
  })

  await ensureEditorUser().catch((error) => {
    console.warn('[seed] 跳过创建测试账号：', error)
  })

  await ensureUploaderUser().catch((error) => {
    console.warn('[seed] 跳过创建上传账号：', error)
  })

  await ensureOptimizeProductsSeeded()
  console.log('[seed] 优化商城测试商品已写入数据库')
}

main()
  .catch((error) => {
    console.error('[seed] 执行失败', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined)
    console.log('[seed] 数据库连接已关闭')
  })
