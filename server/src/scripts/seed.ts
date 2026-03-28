import '@/utils/cjsCompat'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { createInitialAdminV2, ensureAdminPermissionsV2 } from '@/services/adminAuthService'
import { ensureMiniProgramTestUserV2 } from '@/services/miniAuthService'
import { ensureEditorAuthBootstrap } from '@/services/authService'
import { ensureBuiltinCouponTypes } from '@/controllers/admin/couponTypeController'


async function main(): Promise<void> {
  await connectDatabase()
  console.log('[seed] 数据库连接成功')

  await createInitialAdminV2().catch((error) => {
    console.warn('[seed] 跳过创建初始管理员：', error)
  })

  await ensureEditorAuthBootstrap().catch((error) => {
    console.warn('[seed] 跳过创建编辑器/上传器账号：', error)
  })

  await ensureAdminPermissionsV2().catch((error) => {
    console.warn('[seed] 初始化管理权限失败：', error)
  })
  console.log('[seed] 管理权限数据已初始化')

  await ensureBuiltinCouponTypes().catch((error) => {
    console.warn('[seed] 初始化卡券类型失败：', error)
  })
  console.log('[seed] 卡券类型数据已初始化')

  console.log('[seed] 小程序演示数据（成就/地址/反馈）已初始化')
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
