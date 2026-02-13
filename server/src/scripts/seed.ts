import '@/utils/cjsCompat'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import {
  createInitialAdmin,
  ensureEditorUser,
  ensureManagementPermissions,
  ensureUploaderUser,
} from '@/services/authService'
import { ensureOptimizeProductsSeeded } from '@/services/optimizeProductService'
import { SceneModel } from '@/models/Scene'
import { ProductModel } from '@/models/Product'
import { CouponModel } from '@/models/Coupon'
import { ensureCategoryPath } from '@/services/assetCategoryService'

type CategorySeedEntry = {
  path: string[]
  description?: string
}
const ASSET_CATEGORY_SEEDS: CategorySeedEntry[] = [
  {
    path: ['Architecture'],
    description: '3D or 2D assets related to buildings and structures.',
  },
  {
    path: ['Architecture', 'Residential'],
    description: 'Residential buildings such as apartments and villas.',
  },
  {
    path: ['Architecture', 'Commercial'],
    description: 'Commercial buildings like malls and office towers.',
  },
  {
    path: ['Architecture', 'Public Facilities'],
    description: 'Public facility buildings such as schools, hospitals, and stations.',
  },
  {
    path: ['Nature'],
    description: 'Assets and materials related to natural environments.',
  },
  {
    path: ['Nature', 'Plants'],
    description: 'Plant resources like trees, flowers, and shrubs.',
  },
  {
    path: ['Nature', 'Animals'],
    description: 'Animal models or materials.',
  },
  {
    path: ['Nature', 'Terrain'],
    description: 'Terrain and landform natural scene assets.',
  },
  {
    path: ['Characters'],
    description: 'Assets related to character models.',
  },
  {
    path: ['Characters', 'Modern Characters'],
    description: 'Modern-style character models.',
  },
  {
    path: ['Characters', 'Historical Characters'],
    description: 'Historical character models.',
  },
  {
    path: ['Characters', 'Fantasy Characters'],
    description: 'Fantasy, sci-fi, or magical themed characters.',
  },
]

async function ensureAssetCategoriesSeeded(): Promise<void> {
  for (const entry of ASSET_CATEGORY_SEEDS) {
    await ensureCategoryPath(entry.path, { description: entry.description ?? null })
  }
  console.log('[seed] 资产分类种子数据已初始化')
}

async function ensureSpacesSeeded(): Promise<void> {
  const seeds = [
    {
      name: '地坛公园',
      description: '北京市区著名的古代祭天场所与城市公园，适合休闲漫步与文化体验。',
      fileKey: 'seed-ditan',
      fileUrl: 'https://example.com/scene/ditan.glb',
      metadata: { location: '北京', url: 'https://example.com/scene/ditan' },
    },
    {
      name: '南湖公园',
      description: '城市中的湖泊公园，适合家庭游览与户外活动。',
      fileKey: 'seed-nanhu',
      fileUrl: 'https://example.com/scene/nanhu.glb',
      metadata: { location: '某市', url: 'https://example.com/scene/nanhu' },
    },
    {
      name: '天坛公园',
      description: '历史悠久的皇家祭祀场所，现为大型公园与文化景区。',
      fileKey: 'seed-tiantan',
      fileUrl: 'https://example.com/scene/tiantan.glb',
      metadata: { location: '北京', url: 'https://example.com/scene/tiantan' },
    },
  ]

  for (const entry of seeds) {
    const exists = await SceneModel.findOne({ name: entry.name }).lean().exec()
    if (exists) continue
    await SceneModel.create({
      name: entry.name,
      description: entry.description,
      fileKey: entry.fileKey,
      fileUrl: entry.fileUrl,
      metadata: entry.metadata,
    })
  }
}

async function ensurePropsSeeded(): Promise<void> {
  const props = [
    {
      name: '共享电动车',
      slug: 'vehicle-shared',
      category: 'vehicle',
      price: 0,
      summary: '用于景区内短途移动的车辆道具',
      validityDays: null,
      applicableSceneTags: ['park', 'garden'],
      usageConfig: { type: 'consumable' },
    },
    {
      name: '天气控制器（晴/雨）',
      slug: 'prop-weather',
      category: 'weather',
      price: 0,
      summary: '可以在场景中切换天气效果的道具',
      validityDays: 7,
      applicableSceneTags: ['*'],
      usageConfig: { type: 'consumable' },
    },
    {
      name: '时间穿梭器（白天/夜晚）',
      slug: 'prop-time',
      category: 'time',
      price: 0,
      summary: '切换场景时间（白天/夜晚）的道具',
      validityDays: 7,
      applicableSceneTags: ['park', 'exhibition'],
      usageConfig: { type: 'consumable' },
    },
  ]

  for (const item of props) {
    const exists = await ProductModel.findOne({ slug: item.slug }).lean().exec()
    if (exists) continue
    await ProductModel.create({
      name: item.name,
      slug: item.slug,
      category: item.category,
      price: item.price,
      summary: item.summary,
      validityDays: item.validityDays,
      applicableSceneTags: item.applicableSceneTags,
      usageConfig: item.usageConfig,
    })
  }
}

async function ensureCouponsSeeded(): Promise<void> {
  const now = new Date()
  const coupons = [
    {
      title: '五元优惠券',
      description: '满 0 元可用，直接抵扣 5 元',
      validUntil: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
      usageRules: { type: 'discount', amount: 5, minSpend: 0 },
    },
    {
      title: '景区门票（通用）',
      description: '通用门票一张，适用于合作景区，使用当天有效',
      validUntil: new Date(now.getTime() + 90 * 24 * 3600 * 1000),
      usageRules: { type: 'ticket', validDays: 1 },
    },
  ]

  for (const c of coupons) {
    const exists = await CouponModel.findOne({ title: c.title }).lean().exec()
    if (exists) continue
    await CouponModel.create({
      title: c.title,
      description: c.description,
      validUntil: c.validUntil,
      usageRules: c.usageRules,
    })
  }
}

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

  await ensureManagementPermissions().catch((error) => {
    console.warn('[seed] 初始化管理权限失败：', error)
  })
  console.log('[seed] 管理权限数据已初始化')

  await ensureOptimizeProductsSeeded().catch(() => undefined)
  console.log('[seed] 优化商城测试商品（若存在）已写入数据库')

  await ensureSpacesSeeded()
  console.log('[seed] 基础景区数据已写入数据库')

  await ensurePropsSeeded()
  console.log('[seed] 道具（商品）数据已写入数据库')

  await ensureCouponsSeeded()
  console.log('[seed] 卡券数据已写入数据库')

  await ensureAssetCategoriesSeeded().catch((error) => {
    console.warn('[seed] 初始化资产分类失败：', error)
  })
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
