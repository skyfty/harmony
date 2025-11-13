import '@/utils/cjsCompat'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { createInitialAdmin, ensureEditorUser, ensureUploaderUser } from '@/services/authService'
import { ensureOptimizeProductsSeeded } from '@/services/optimizeProductService'
import { ensureCategoryPath } from '@/services/assetCategoryService'

type CategorySeedEntry = {
  path: string[]
  description?: string
}

const ASSET_CATEGORY_SEEDS: CategorySeedEntry[] = [
  {
    path: ['建筑'],
    description: '与建筑及结构相关的三维或二维资源。',
  },
  {
    path: ['建筑', '住宅'],
    description: '住宅类建筑，例如公寓、别墅等。',
  },
  {
    path: ['建筑', '商业'],
    description: '商业用途建筑，如商场、写字楼。',
  },
  {
    path: ['建筑', '公共设施'],
    description: '公共设施建筑，例如学校、医院、车站。',
  },
  {
    path: ['自然'],
    description: '自然环境相关的素材及资产。',
  },
  {
    path: ['自然', '植物'],
    description: '树木、花草等植物类资源。',
  },
  {
    path: ['自然', '动物'],
    description: '动物相关的模型或素材。',
  },
  {
    path: ['自然', '地形'],
    description: '地形、地貌等自然场景资源。',
  },
  {
    path: ['人物'],
    description: '人物角色相关的资产分类。',
  },
  {
    path: ['人物', '现代人物'],
    description: '现代风格的人物角色。',
  },
  {
    path: ['人物', '历史人物'],
    description: '具有历史背景的人物角色。',
  },
  {
    path: ['人物', '幻想人物'],
    description: '幻想、科幻或魔幻题材人物。',
  },
]

async function ensureAssetCategoriesSeeded(): Promise<void> {
  for (const entry of ASSET_CATEGORY_SEEDS) {
    await ensureCategoryPath(entry.path, { description: entry.description ?? null })
  }
  console.log('[seed] 资产分类种子数据已初始化')
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

  await ensureOptimizeProductsSeeded()
  console.log('[seed] 优化商城测试商品已写入数据库')

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
