import { MongoServerError } from 'mongodb'
import { startSession, Types } from 'mongoose'
import type { ClientSession } from 'mongoose'
import type { AssetCategoryDocument } from '@/types/models'
import { AssetCategoryModel, normalizeCategoryName } from '@/models/AssetCategory'
import { AssetModel } from '@/models/Asset'

const ROOT_CATEGORY_NAME = '资产库'
const ROOT_CATEGORY_DESCRIPTION = 'Default root bucket for uncategorized assets'
const ROOT_CATEGORY_NORMALIZED = normalizeCategoryName(ROOT_CATEGORY_NAME)

export interface CategoryNodeDto {
  id: string
  name: string
  description?: string | null
  parentId?: string | null
  depth: number
  pathIds: string[]
  pathNames: string[]
  hasChildren: boolean
  createdAt: string
  updatedAt: string
}

export interface CategoryTreeNode extends CategoryNodeDto {
  children: CategoryTreeNode[]
}

export interface CategoryPathItemDto {
  id: string
  name: string
}

export interface BulkMoveAssetsParams {
  assetIds?: string[]
  fromCategoryId?: string | Types.ObjectId
  includeDescendants?: boolean
  targetCategoryId: string | Types.ObjectId
}

export interface BulkMoveAssetsResult {
  matchedCount: number
  modifiedCount: number
}

export interface MergeCategoryParams {
  sourceCategoryId: string | Types.ObjectId
  targetCategoryId: string | Types.ObjectId
  moveChildren?: boolean
}

export interface MergeCategoryResult {
  deletedCategoryId: string
  movedAssetCount: number
  movedChildCount: number
}

type LeanCategory = {
  _id: Types.ObjectId
  name: string
  description?: string | null
  parentId?: Types.ObjectId | null
  depth: number
  pathIds: Types.ObjectId[]
  pathNames: string[]
  rootId: Types.ObjectId
  normalizedName: string
  createdAt: Date
  updatedAt: Date
}

export function sanitizeCategorySegments(input: unknown): string[] {
  if (!input) {
    return []
  }
  if (Array.isArray(input)) {
    return input
      .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
      .filter((segment): segment is string => segment.length > 0)
  }
  if (typeof input === 'string') {
    return input
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
  }
  return []
}

function toObjectId(id: string | Types.ObjectId | null | undefined): Types.ObjectId | null {
  if (!id) {
    return null
  }
  if (id instanceof Types.ObjectId) {
    return id
  }
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null
}

function buildPathItems(pathIds: Types.ObjectId[], pathNames: string[]): CategoryPathItemDto[] {
  return pathIds.map((id, index) => ({
    id: id.toString(),
    name: pathNames[index] ?? '',
  }))
}

function toDto(category: LeanCategory, childCountMap: Map<string, number>): CategoryNodeDto {
  const id = category._id.toString()
  const parentId = category.parentId ? category.parentId.toString() : null
  return {
    id,
    name: category.name,
    description: category.description ?? null,
    parentId,
    depth: category.depth,
    pathIds: category.pathIds.map((value) => value.toString()),
    pathNames: [...category.pathNames],
    hasChildren: (childCountMap.get(id) ?? 0) > 0,
    createdAt: category.createdAt instanceof Date ? category.createdAt.toISOString() : new Date(category.createdAt).toISOString(),
    updatedAt: category.updatedAt instanceof Date ? category.updatedAt.toISOString() : new Date(category.updatedAt).toISOString(),
  }
}

async function loadChildCountsForParents(parentIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (!parentIds.length) {
    return new Map()
  }
  const pipeline = [
    { $match: { parentId: { $in: parentIds } } },
    { $group: { _id: '$parentId', count: { $sum: 1 } } },
  ]
  const results = await AssetCategoryModel.aggregate<{ _id: Types.ObjectId; count: number }>(pipeline)
  return results.reduce<Map<string, number>>((acc, entry) => {
    acc.set(entry._id.toString(), entry.count)
    return acc
  }, new Map())
}

function ensurePathArrays(category: AssetCategoryDocument, parent: AssetCategoryDocument | null): void {
  const parentPathIds = parent ? parent.pathIds.map((value) => value as Types.ObjectId) : []
  const parentPathNames = parent ? [...parent.pathNames] : []
  category.pathIds = [...parentPathIds, category._id as Types.ObjectId]
  category.pathNames = [...parentPathNames, category.name]
  category.depth = category.pathIds.length - 1
  category.rootId = parent ? (parent.rootId as Types.ObjectId) : (category._id as Types.ObjectId)
}

export async function ensureRootCategory(): Promise<AssetCategoryDocument> {
  let root = await AssetCategoryModel.findOne({ parentId: null, normalizedName: ROOT_CATEGORY_NORMALIZED }).exec()
  if (!root) {
    root = new AssetCategoryModel({
      name: ROOT_CATEGORY_NAME,
      description: ROOT_CATEGORY_DESCRIPTION,
      parentId: null,
      depth: 0,
      pathIds: [],
      pathNames: [],
      rootId: undefined,
      normalizedName: ROOT_CATEGORY_NORMALIZED,
    })
    ensurePathArrays(root, null)
    await root.save()
    return root
  }

  let requiresSave = false
  if (root.parentId) {
    root.parentId = null
    requiresSave = true
  }
  const lastPathId = root.pathIds[root.pathIds.length - 1]
  if (root.depth !== 0 || !lastPathId || !lastPathId.equals(root._id as Types.ObjectId)) {
    ensurePathArrays(root, null)
    requiresSave = true
  }
  if (requiresSave) {
    await root.save()
  }
  return root
}

export async function getRootCategory(): Promise<AssetCategoryDocument | null> {
  return AssetCategoryModel.findOne({ parentId: null, normalizedName: ROOT_CATEGORY_NORMALIZED }).exec()
}

export async function ensureCategoryPath(
  segments: string[],
  options: { parentId?: string | Types.ObjectId | null; description?: string | null } = {},
): Promise<AssetCategoryDocument> {
  const normalizedSegments = segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0)
  if (!normalizedSegments.length) {
    throw new Error('Category path segments cannot be empty')
  }

  let parent: AssetCategoryDocument | null = null
  if (options.parentId) {
    const parentId = toObjectId(options.parentId)
    if (!parentId) {
      throw new Error('Invalid parent category id')
    }
    parent = await AssetCategoryModel.findById(parentId)
    if (!parent) {
      throw new Error('Parent category not found')
    }
  }

  const finalDescription = typeof options.description === 'string' ? options.description.trim() : undefined

  for (let index = 0; index < normalizedSegments.length; index += 1) {
    const segment = normalizedSegments[index]!
    const normalizedName = normalizeCategoryName(segment)
    const parentId = parent ? (parent._id as Types.ObjectId) : null

    let category = await AssetCategoryModel.findOne({ parentId, normalizedName }).exec()
    if (!category) {
      const newId = new Types.ObjectId()
      category = new AssetCategoryModel({
        _id: newId,
        name: segment,
        description: index === normalizedSegments.length - 1 ? finalDescription : undefined,
        parentId,
        depth: parent ? parent.depth + 1 : 0,
        pathIds: parent ? [...parent.pathIds, newId] : [newId],
        pathNames: parent ? [...parent.pathNames, segment] : [segment],
        rootId: parent ? (parent.rootId as Types.ObjectId) : newId,
        normalizedName,
      })
      try {
        await category.save()
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          category = await AssetCategoryModel.findOne({ parentId, normalizedName }).exec()
          if (!category) {
            throw error
          }
        } else {
          throw error
        }
      }
    } else if (index === normalizedSegments.length - 1 && finalDescription && !category.description) {
      category.description = finalDescription
      await category.save()
    }
    parent = category
  }

  if (!parent) {
    throw new Error('Failed to resolve category path')
  }

  return parent
}

export async function getCategoryById(categoryId: string | Types.ObjectId): Promise<AssetCategoryDocument | null> {
  const objectId = toObjectId(categoryId)
  if (!objectId) {
    return null
  }
  return AssetCategoryModel.findById(objectId)
}

export async function getCategoryPathItems(categoryId: string | Types.ObjectId): Promise<CategoryPathItemDto[]> {
  const category = await getCategoryById(categoryId)
  if (!category) {
    return []
  }
  return buildPathItems(category.pathIds.map((value) => value as Types.ObjectId), category.pathNames)
}

export async function listCategoryChildren(parentId?: string | Types.ObjectId | null): Promise<CategoryNodeDto[]> {
  const objectId = toObjectId(parentId ?? null)
  const query = objectId ? { parentId: objectId } : { parentId: null }
  const categories = await AssetCategoryModel.find(query).sort({ name: 1 }).lean<LeanCategory[]>().exec()
  const parentIds = categories.map((category) => category._id)
  const childCounts = await loadChildCountsForParents(parentIds)
  return categories.map((category) => toDto(category, childCounts))
}

export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const categories = await AssetCategoryModel.find().sort({ depth: 1, name: 1 }).lean<LeanCategory[]>().exec()
  const childCountMap = categories.reduce<Map<string, number>>((acc, category) => {
    const parentId = category.parentId ? category.parentId.toString() : null
    if (parentId) {
      acc.set(parentId, (acc.get(parentId) ?? 0) + 1)
    }
    return acc
  }, new Map())

  const nodeMap = new Map<string, CategoryTreeNode>()
  const roots: CategoryTreeNode[] = []

  categories.forEach((category) => {
    const dto = toDto(category, childCountMap)
    nodeMap.set(dto.id, { ...dto, children: [] })
  })

  categories.forEach((category) => {
    const id = category._id.toString()
    const parentId = category.parentId ? category.parentId.toString() : null
    const node = nodeMap.get(id)
    if (!node) {
      return
    }
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  return roots
}

export async function listDescendantCategoryIds(
  categoryId: string | Types.ObjectId,
  options: { session?: ClientSession } = {},
): Promise<string[]> {
  const objectId = toObjectId(categoryId)
  if (!objectId) {
    return []
  }
  const categories = await AssetCategoryModel.find({ pathIds: objectId })
    .select('_id')
    .session(options.session ?? null)
    .lean<{ _id: Types.ObjectId }[]>()
    .exec()
  return categories.map((category) => category._id.toString())
}

async function rebuildSubtreePaths(
  categoryId: Types.ObjectId,
  options: { session?: ClientSession } = {},
): Promise<void> {
  const movedCategory = await AssetCategoryModel.findById(categoryId)
    .session(options.session ?? null)
    .exec()
  if (!movedCategory) {
    throw new Error('Category not found')
  }

  const parent = movedCategory.parentId
    ? await AssetCategoryModel.findById(movedCategory.parentId).session(options.session ?? null).exec()
    : null

  const parentPathIds = parent ? parent.pathIds.map((id) => id as Types.ObjectId) : []
  const parentPathNames = parent ? [...parent.pathNames] : []
  const nextPathIds = [...parentPathIds, movedCategory._id as Types.ObjectId]
  const nextPathNames = [...parentPathNames, movedCategory.name]
  const nextRootId = parent ? (parent.rootId as Types.ObjectId) : (movedCategory._id as Types.ObjectId)

  movedCategory.pathIds = nextPathIds
  movedCategory.pathNames = nextPathNames
  movedCategory.depth = nextPathIds.length - 1
  movedCategory.rootId = nextRootId
  await movedCategory.save({ session: options.session })

  const descendants = await AssetCategoryModel.find({ pathIds: categoryId, _id: { $ne: categoryId } })
    .sort({ depth: 1 })
    .session(options.session ?? null)
    .exec()
  if (!descendants.length) {
    return
  }

  const updates = descendants
    .map((descendant) => {
      const anchor = descendant.pathIds.findIndex((id) => id.equals(categoryId))
      if (anchor < 0) {
        return null
      }
      const suffixIds = descendant.pathIds.slice(anchor + 1).map((id) => id as Types.ObjectId)
      const suffixNames = descendant.pathNames.slice(anchor + 1)
      const mergedPathIds = [...nextPathIds, ...suffixIds]
      const mergedPathNames = [...nextPathNames, ...suffixNames]
      return {
        updateOne: {
          filter: { _id: descendant._id as Types.ObjectId },
          update: {
            $set: {
              depth: mergedPathIds.length - 1,
              pathIds: mergedPathIds,
              pathNames: mergedPathNames,
              rootId: nextRootId,
            },
          },
        },
      }
    })
    .filter(
      (
        item,
      ): item is {
        updateOne: {
          filter: { _id: Types.ObjectId }
          update: {
            $set: {
              depth: number
              pathIds: Types.ObjectId[]
              pathNames: string[]
              rootId: Types.ObjectId
            }
          }
        }
      } => Boolean(item),
    )

  if (updates.length) {
    await AssetCategoryModel.bulkWrite(updates, { session: options.session })
  }
}

export async function moveCategory(
  categoryId: string | Types.ObjectId,
  targetParentId: null | string | Types.ObjectId,
): Promise<AssetCategoryDocument> {
  const sourceId = toObjectId(categoryId)
  if (!sourceId) {
    throw new Error('Invalid category id')
  }

  const nextParentId = targetParentId === null ? null : toObjectId(targetParentId)
  if (targetParentId !== null && !nextParentId) {
    throw new Error('Invalid target parent category id')
  }
  if (nextParentId && nextParentId.equals(sourceId)) {
    throw new Error('Cannot move category to itself')
  }

  const session = await startSession()
  try {
    let moved: AssetCategoryDocument | null = null
    await session.withTransaction(async () => {
      const source = await AssetCategoryModel.findById(sourceId).session(session).exec()
      if (!source) {
        throw new Error('Category not found')
      }
      if (!source.parentId) {
        throw new Error('Root category cannot be moved')
      }

      const parent = nextParentId
        ? await AssetCategoryModel.findById(nextParentId).session(session).exec()
        : null
      if (nextParentId && !parent) {
        throw new Error('Target parent category not found')
      }
      if (parent && parent.pathIds.some((id) => id.equals(sourceId))) {
        throw new Error('Cannot move category into its own descendant')
      }

      const duplicate = await AssetCategoryModel.findOne({
        _id: { $ne: sourceId },
        parentId: nextParentId ?? null,
        normalizedName: source.normalizedName,
      })
        .select('_id')
        .session(session)
        .lean()
        .exec()
      if (duplicate) {
        throw new Error('Category name already exists at target level')
      }

      source.parentId = nextParentId
      await source.save({ session })
      await rebuildSubtreePaths(sourceId, { session })
      moved = await AssetCategoryModel.findById(sourceId).session(session).exec()
    })

    if (!moved) {
      throw new Error('Failed to move category')
    }
    return moved
  } finally {
    await session.endSession()
  }
}

export async function bulkMoveAssetsToCategory(params: BulkMoveAssetsParams): Promise<BulkMoveAssetsResult> {
  const targetCategoryId = toObjectId(params.targetCategoryId)
  if (!targetCategoryId) {
    throw new Error('Invalid target category id')
  }
  const targetExists = await AssetCategoryModel.exists({ _id: targetCategoryId }).exec()
  if (!targetExists) {
    throw new Error('Target category not found')
  }

  const filter: Record<string, unknown> = {}
  if (Array.isArray(params.assetIds) && params.assetIds.length) {
    const uniqueIds = Array.from(new Set(params.assetIds))
    const objectIds = uniqueIds.map((id) => toObjectId(id))
    if (objectIds.some((id) => !id)) {
      throw new Error('Invalid asset id')
    }
    filter._id = { $in: objectIds }
  } else if (params.fromCategoryId) {
    const fromCategoryId = toObjectId(params.fromCategoryId)
    if (!fromCategoryId) {
      throw new Error('Invalid source category id')
    }
    const sourceExists = await AssetCategoryModel.exists({ _id: fromCategoryId }).exec()
    if (!sourceExists) {
      throw new Error('Source category not found')
    }
    const includeDescendants = params.includeDescendants !== false
    const categoryIds = includeDescendants
      ? await listDescendantCategoryIds(fromCategoryId)
      : [fromCategoryId.toString()]
    filter.categoryId = { $in: categoryIds.map((id) => new Types.ObjectId(id)) }
  } else {
    throw new Error('Either assetIds or fromCategoryId is required')
  }

  const existingCategoryFilter =
    typeof filter.categoryId === 'object' && filter.categoryId !== null
      ? (filter.categoryId as Record<string, unknown>)
      : {}
  filter.categoryId = {
    ...existingCategoryFilter,
    $ne: targetCategoryId,
  }

  const result = await AssetModel.updateMany(filter, { $set: { categoryId: targetCategoryId } }).exec()
  return {
    matchedCount: result.matchedCount ?? 0,
    modifiedCount: result.modifiedCount ?? 0,
  }
}

export async function mergeCategories(params: MergeCategoryParams): Promise<MergeCategoryResult> {
  const sourceId = toObjectId(params.sourceCategoryId)
  const targetId = toObjectId(params.targetCategoryId)
  if (!sourceId || !targetId) {
    throw new Error('Invalid category id')
  }
  if (sourceId.equals(targetId)) {
    throw new Error('Source and target categories cannot be the same')
  }

  const moveChildren = params.moveChildren !== false
  const session = await startSession()
  try {
    let movedAssetCount = 0
    let movedChildCount = 0

    await session.withTransaction(async () => {
      const source = await AssetCategoryModel.findById(sourceId).session(session).exec()
      if (!source) {
        throw new Error('Source category not found')
      }
      if (!source.parentId) {
        throw new Error('Root category cannot be merged')
      }

      const target = await AssetCategoryModel.findById(targetId).session(session).exec()
      if (!target) {
        throw new Error('Target category not found')
      }
      if (target.pathIds.some((id) => id.equals(sourceId))) {
        throw new Error('Cannot merge category into its own descendant')
      }

      const movedAssetResult = await AssetModel.updateMany(
        { categoryId: sourceId },
        { $set: { categoryId: targetId } },
        { session },
      ).exec()
      movedAssetCount = movedAssetResult.modifiedCount ?? 0

      const children = await AssetCategoryModel.find({ parentId: sourceId }).session(session).exec()
      if (!moveChildren && children.length > 0) {
        throw new Error('Source category has child categories')
      }

      if (moveChildren && children.length > 0) {
        for (const child of children) {
          const duplicate = await AssetCategoryModel.findOne({
            _id: { $ne: child._id },
            parentId: targetId,
            normalizedName: child.normalizedName,
          })
            .select('_id')
            .session(session)
            .lean()
            .exec()
          if (duplicate) {
            throw new Error(`Child category name conflict: ${child.name}`)
          }
        }

        for (const child of children) {
          child.parentId = targetId
          await child.save({ session })
          await rebuildSubtreePaths(child._id as Types.ObjectId, { session })
        }
        movedChildCount = children.length
      }

      await AssetCategoryModel.deleteOne({ _id: sourceId }, { session }).exec()
    })

    return {
      deletedCategoryId: sourceId.toString(),
      movedAssetCount,
      movedChildCount,
    }
  } finally {
    await session.endSession()
  }
}

export async function deleteCategoryStrict(categoryId: string | Types.ObjectId): Promise<void> {
  const objectId = toObjectId(categoryId)
  if (!objectId) {
    throw new Error('Invalid category id')
  }
  const childCount = await AssetCategoryModel.countDocuments({ parentId: objectId })
  if (childCount > 0) {
    throw new Error('该类别包含子类别，不能直接删除')
  }
  const assetCount = await AssetModel.countDocuments({ categoryId: objectId })
  if (assetCount > 0) {
    throw new Error('该类别下仍有关联的资产，不能直接删除')
  }
  await AssetCategoryModel.deleteOne({ _id: objectId })
}

export async function updateCategoryInfo(
  categoryId: string | Types.ObjectId,
  updates: { name?: string; description?: string | null },
): Promise<AssetCategoryDocument> {
  const objectId = toObjectId(categoryId)
  if (!objectId) {
    throw new Error('Invalid category id')
  }
  const category = await AssetCategoryModel.findById(objectId)
  if (!category) {
    throw new Error('Category not found')
  }

  let nameChanged = false
  if (typeof updates.name === 'string') {
    const trimmedName = updates.name.trim()
    if (!trimmedName.length) {
      throw new Error('类别名称不能为空')
    }
    const normalizedName = normalizeCategoryName(trimmedName)
    const existing = await AssetCategoryModel.findOne({
      parentId: category.parentId ?? null,
      normalizedName,
      _id: { $ne: objectId },
    })
      .lean()
      .exec()
    if (existing) {
      throw new Error('同一级别下已存在相同名称的类别')
    }
    if (category.name !== trimmedName) {
      category.name = trimmedName
      category.normalizedName = normalizedName
      nameChanged = true
    }
  }

  if (updates.description !== undefined) {
    const nextDescription = typeof updates.description === 'string' ? updates.description.trim() : null
    category.description = nextDescription ?? undefined
  }

  if (nameChanged) {
    category.pathNames[category.pathNames.length - 1] = category.name
  }

  await category.save()

  if (nameChanged) {
    const descendants = await AssetCategoryModel.find({ pathIds: category._id, _id: { $ne: category._id } })
      .select('pathIds pathNames')
      .exec()
    await Promise.all(
      descendants.map(async (descendant) => {
        const index = descendant.pathIds.findIndex((id) => id.equals(category._id))
        if (index >= 0) {
          descendant.pathNames[index] = category.name
          await descendant.save()
        }
      }),
    )
  }

  return category
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function searchCategories(keyword: string, limit = 50): Promise<CategoryNodeDto[]> {
  const trimmed = keyword.trim()
  if (!trimmed.length) {
    return []
  }
  const regex = new RegExp(escapeRegExp(trimmed), 'i')
  const categories = await AssetCategoryModel.find({
    $or: [{ name: regex }, { pathNames: regex }],
  })
    .sort({ depth: 1, name: 1 })
    .limit(limit)
    .lean<LeanCategory[]>()
    .exec()
  const parentIds = categories.map((category) => category._id)
  const childCounts = await loadChildCountsForParents(parentIds)
  return categories.map((category) => toDto(category, childCounts))
}

export async function ensureCategoryConsistency(): Promise<void> {
  const categories = await AssetCategoryModel.find().exec()
  await Promise.all(
    categories.map(async (category) => {
      const parent = category.parentId ? await AssetCategoryModel.findById(category.parentId) : null
      ensurePathArrays(category, parent ?? null)
      category.normalizedName = normalizeCategoryName(category.name)
      await category.save()
    }),
  )
}
