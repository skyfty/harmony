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
