import { SceneSpotCategoryModel } from '@/models/SceneSpotCategory'

/**
 * 预制景点分类数据（平铺结构，三级分类）
 */
export async function seedSpotCategories() {
  const presetCategories = [
    // 一级分类
    { name: '自然景观', description: '自然形成的景观', slug: 'nature', sortOrder: 10, isBuiltin: true },
    { name: '人文景观', description: '人类活动形成的景观', slug: 'culture', sortOrder: 20, isBuiltin: true },
    { name: '历史景观', description: '具有历史意义的景观', slug: 'history', sortOrder: 30, isBuiltin: true },
    // 二级分类
    { name: '山脉', description: '自然景观-山脉', slug: 'mountain', sortOrder: 11, isBuiltin: true },
    { name: '湖泊', description: '自然景观-湖泊', slug: 'lake', sortOrder: 12, isBuiltin: true },
    { name: '森林', description: '自然景观-森林', slug: 'forest', sortOrder: 13, isBuiltin: true },
    { name: '湿地', description: '自然景观-湿地', slug: 'wetland', sortOrder: 14, isBuiltin: true },
    { name: '海滩', description: '自然景观-海滩', slug: 'beach', sortOrder: 15, isBuiltin: true },
    { name: '宗教建筑', description: '人文景观-宗教建筑', slug: 'religious', sortOrder: 21, isBuiltin: true },
    { name: '现代建筑', description: '人文景观-现代建筑', slug: 'modern', sortOrder: 22, isBuiltin: true },
    { name: '公园广场', description: '人文景观-公园广场', slug: 'park', sortOrder: 23, isBuiltin: true },
    { name: '文化街区', description: '人文景观-文化街区', slug: 'cultural-block', sortOrder: 24, isBuiltin: true },
    { name: '古遗址', description: '历史景观-古遗址', slug: 'ancient-site', sortOrder: 31, isBuiltin: true },
    { name: '古建筑', description: '历史景观-古建筑', slug: 'ancient-building', sortOrder: 32, isBuiltin: true },
    { name: '革命遗址', description: '历史景观-革命遗址', slug: 'revolution-site', sortOrder: 33, isBuiltin: true },
    { name: '纪念碑', description: '历史景观-纪念碑', slug: 'monument', sortOrder: 34, isBuiltin: true },
    // 三级分类
    { name: '历史博物馆', description: '博物馆-历史', slug: 'history-museum', sortOrder: 41, isBuiltin: true },
    { name: '军事博物馆', description: '博物馆-军事', slug: 'military-museum', sortOrder: 42, isBuiltin: true },
    { name: '科技博物馆', description: '博物馆-科技', slug: 'science-museum', sortOrder: 43, isBuiltin: true },
    { name: '艺术博物馆', description: '博物馆-艺术', slug: 'art-museum', sortOrder: 44, isBuiltin: true },
    { name: '民俗村', description: '特色街区-民俗村', slug: 'folk-village', sortOrder: 51, isBuiltin: true },
    { name: '古镇', description: '特色街区-古镇', slug: 'ancient-town', sortOrder: 52, isBuiltin: true },
    { name: '文化创意园', description: '特色街区-文创园', slug: 'creative-park', sortOrder: 53, isBuiltin: true },
  ]

  for (const cat of presetCategories) {
    const exists = await SceneSpotCategoryModel.findOne({ slug: cat.slug }).lean().exec()
    if (!exists) {
      await SceneSpotCategoryModel.create({
        ...cat,
        enabled: true,
        normalizedName: cat.name.trim().toLowerCase(),
      })
    } 
  }
}
