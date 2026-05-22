import { Types } from 'mongoose'
import { SceneSpotCategoryModel } from '@/models/SceneSpotCategory'

interface SpotCategorySeedNode {
  children?: SpotCategorySeedNode[]
  description: string
  isBuiltin: boolean
  name: string
  slug: string
  sortOrder: number
}

/**
 * Seed scenic spot categories as a tree structure.
 */
const spotCategoryTree: SpotCategorySeedNode[] = [
  {
    children: [
      { description: '自然景观-山脉', isBuiltin: true, name: '山脉', slug: 'mountain', sortOrder: 11 },
      { description: '自然景观-湖泊', isBuiltin: true, name: '湖泊', slug: 'lake', sortOrder: 12 },
      { description: '自然景观-森林', isBuiltin: true, name: '森林', slug: 'forest', sortOrder: 13 },
      { description: '自然景观-湿地', isBuiltin: true, name: '湿地', slug: 'wetland', sortOrder: 14 },
      { description: '自然景观-海滩', isBuiltin: true, name: '海滩', slug: 'beach', sortOrder: 15 },
    ],
    description: '自然形成的景观',
    isBuiltin: true,
    name: '自然景观',
    slug: 'nature',
    sortOrder: 10,
  },
  {
    children: [
      { description: '人文景观-宗教建筑', isBuiltin: true, name: '宗教建筑', slug: 'religious', sortOrder: 21 },
      { description: '人文景观-现代建筑', isBuiltin: true, name: '现代建筑', slug: 'modern', sortOrder: 22 },
      { description: '人文景观-公园广场', isBuiltin: true, name: '公园广场', slug: 'park', sortOrder: 23 },
      { description: '人文景观-文化街区', isBuiltin: true, name: '文化街区', slug: 'cultural-block', sortOrder: 24 },
      { description: '特色街区-民俗村', isBuiltin: true, name: '民俗村', slug: 'folk-village', sortOrder: 51 },
      { description: '特色街区-古镇', isBuiltin: true, name: '古镇', slug: 'ancient-town', sortOrder: 52 },
      { description: '特色街区-文创园', isBuiltin: true, name: '文创园', slug: 'creative-park', sortOrder: 53 },
    ],
    description: '人类活动形成的景观',
    isBuiltin: true,
    name: '人文景观',
    slug: 'culture',
    sortOrder: 20,
  },
  {
    children: [
      { description: '历史景观-古遗址', isBuiltin: true, name: '古遗址', slug: 'ancient-site', sortOrder: 31 },
      { description: '历史景观-古建筑', isBuiltin: true, name: '古建筑', slug: 'ancient-building', sortOrder: 32 },
      { description: '历史景观-革命遗址', isBuiltin: true, name: '革命遗址', slug: 'revolution-site', sortOrder: 33 },
      { description: '历史景观-纪念碑', isBuiltin: true, name: '纪念碑', slug: 'monument', sortOrder: 34 },
      { description: '博物馆-历史', isBuiltin: true, name: '历史博物馆', slug: 'history-museum', sortOrder: 41 },
      { description: '博物馆-军事', isBuiltin: true, name: '军事博物馆', slug: 'military-museum', sortOrder: 42 },
      { description: '博物馆-科技', isBuiltin: true, name: '科技博物馆', slug: 'science-museum', sortOrder: 43 },
      { description: '博物馆-艺术', isBuiltin: true, name: '艺术博物馆', slug: 'art-museum', sortOrder: 44 },
    ],
    description: '具有历史意义的景观',
    isBuiltin: true,
    name: '历史景观',
    slug: 'history',
    sortOrder: 30,
  },
]

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

async function upsertSeedNode(node: SpotCategorySeedNode, parentId: string | null): Promise<string> {
  const resolvedParentId = parentId ? new Types.ObjectId(parentId) : null
  const existing = await SceneSpotCategoryModel.findOne({ slug: node.slug }).exec()
  const payload = {
    description: node.description,
    enabled: true,
    isBuiltin: node.isBuiltin,
    name: node.name,
    normalizedName: normalizeName(node.name),
    parentId: resolvedParentId,
    sortOrder: node.sortOrder,
  }

  if (existing) {
    existing.name = payload.name
    existing.parentId = payload.parentId
    existing.description = payload.description
    existing.sortOrder = payload.sortOrder
    existing.enabled = payload.enabled
    existing.isBuiltin = payload.isBuiltin
    existing.normalizedName = payload.normalizedName
    await existing.save()
    return String(existing._id)
  }

  const created = await SceneSpotCategoryModel.create({
    ...payload,
    slug: node.slug,
  })
  return String(created._id)
}

async function seedCategoryTree(nodes: SpotCategorySeedNode[], parentId: string | null = null): Promise<void> {
  for (const node of nodes) {
    const currentId = await upsertSeedNode(node, parentId)
    if (Array.isArray(node.children) && node.children.length > 0) {
      await seedCategoryTree(node.children, currentId)
    }
  }
}

export async function seedSpotCategories() {
  await seedCategoryTree(spotCategoryTree)
}
