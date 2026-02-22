import { Types } from 'mongoose'
import { AppUserModel } from '@/models/AppUser'
import { MiniAchievementModel } from '@/models/MiniAchievement'
import { MiniAddressModel } from '@/models/MiniAddress'
import { MiniFeedbackModel } from '@/models/MiniFeedback'

async function resolveSeedUserId(): Promise<Types.ObjectId | null> {
  const preferredUsername = process.env.MINI_SEED_USERNAME || process.env.VITE_MINI_TEST_USERNAME || 'test'
  const byUsername = await AppUserModel.findOne({ username: preferredUsername }).select({ _id: 1 }).lean().exec()
  if (byUsername?._id) {
    return new Types.ObjectId(byUsername._id)
  }

  const fallbackUser = await AppUserModel.findOne({ status: 'active' }).sort({ createdAt: 1 }).select({ _id: 1 }).lean().exec()
  if (fallbackUser?._id) {
    return new Types.ObjectId(fallbackUser._id)
  }

  return null
}

export async function ensureMiniDemoDataSeeded(): Promise<void> {
  const userId = await resolveSeedUserId()
  if (!userId) {
    console.warn('[seed] 未找到可用小程序用户，跳过 mini 演示数据写入')
    return
  }

  const [achievementCount, addressCount, feedbackCount] = await Promise.all([
    MiniAchievementModel.countDocuments({ userId }).exec(),
    MiniAddressModel.countDocuments({ userId }).exec(),
    MiniFeedbackModel.countDocuments({ userId }).exec(),
  ])

  if (achievementCount === 0) {
    await MiniAchievementModel.insertMany([
      {
        userId,
        title: '首次游览',
        description: '完成首次景区游览',
        progress: 1,
        achievedAt: new Date(),
      },
      {
        userId,
        title: '景点打卡达人',
        description: '累计完成 10 个景点打卡',
        progress: 0.4,
        achievedAt: new Date(),
      },
    ])
  }

  if (addressCount === 0) {
    await MiniAddressModel.insertMany([
      {
        userId,
        receiverName: '张三',
        phone: '13800000000',
        region: '浙江省/杭州市/西湖区',
        detail: '文三路 1 号',
        isDefault: true,
      },
      {
        userId,
        receiverName: '李四',
        phone: '13900000000',
        region: '上海市/上海市/浦东新区',
        detail: '世纪大道 88 号',
        isDefault: false,
      },
    ])
  }

  if (feedbackCount === 0) {
    await MiniFeedbackModel.insertMany([
      {
        userId,
        category: 'feature',
        content: '希望增加景点路线推荐功能。',
        contact: 'wechat:test-user',
        status: 'new',
      },
      {
        userId,
        category: 'bug',
        content: '部分页面首次加载较慢。',
        contact: '13800000000',
        status: 'in_progress',
        reply: '已收到，正在优化接口响应。',
      },
    ])
  }
}
