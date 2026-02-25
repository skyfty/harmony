import '@/utils/cjsCompat'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { CouponModel } from '@/models/Coupon'
import { CouponTypeModel } from '@/models/CouponType'
import { ensureBuiltinCouponTypes } from '@/controllers/admin/couponTypeController'

async function main(): Promise<void> {
  await connectDatabase()
  console.log('[migrate:coupon-types] 数据库连接成功')

  await ensureBuiltinCouponTypes()

  const fallbackType = await CouponTypeModel.findOne({ code: 'ticket' }).lean().exec()
  if (!fallbackType) {
    throw new Error('默认卡券类型 ticket 不存在，无法执行迁移')
  }

  const result = await CouponModel.updateMany(
    {
      $or: [{ typeId: { $exists: false } }, { typeId: null }],
    },
    {
      $set: { typeId: fallbackType._id },
    },
  ).exec()

  console.log(
    `[migrate:coupon-types] 已补全历史卡券类型，匹配 ${result.matchedCount} 条，更新 ${result.modifiedCount} 条，默认类型：${fallbackType.name}(${fallbackType.code})`,
  )
}

main()
  .catch((error) => {
    console.error('[migrate:coupon-types] 执行失败', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined)
    console.log('[migrate:coupon-types] 数据库连接已关闭')
  })
