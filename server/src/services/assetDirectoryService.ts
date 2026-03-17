import { MongoServerError } from 'mongodb'
import { startSession, Types } from 'mongoose'
import type { AssetDirectoryDocument } from '@/types/models'
import { AssetDirectoryModel, normalizeDirectoryName } from '@/models/AssetDirectory'
import { AssetModel } from '@/models/Asset'

const ROOT_DIRECTORY_NAME = '全部资源'
const ROOT_DIRECTORY_NORMALIZED = normalizeDirectoryName(ROOT_DIRECTORY_NAME)

type LeanDirectory = {
  _id: Types.ObjectId
  name: string
  parentId?: Types.ObjectId | null
  depth: number
  pathIds: Types.ObjectId[]
  pathNames: string[]
  rootId: Types.ObjectId
  normalizedName: string
  createdAt: Date
  updatedAt: Date
}

export interface DirectoryNodeDto {
  id: string
  name: string
  parentId: string | null
  depth: number
  pathIds: string[]
  pathNames: string[]
  hasChildren: boolean
  createdAt: string
  updatedAt: string
}

export interface DirectoryTreeNode extends DirectoryNodeDto {
  children: DirectoryTreeNode[]
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

function toIsoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toDto(directory: LeanDirectory, childCountMap: Map<string, number>): DirectoryNodeDto {
  const id = directory._id.toString()
  return {
    id,
    name: directory.name,
    parentId: directory.parentId ? directory.parentId.toString() : null,
    depth: directory.depth,
    pathIds: directory.pathIds.map((value) => value.toString()),
    pathNames: [...directory.pathNames],
    hasChildren: (childCountMap.get(id) ?? 0) > 0,
    createdAt: toIsoDate(directory.createdAt),
    updatedAt: toIsoDate(directory.updatedAt),
  }
}

async function loadChildCountsForParents(parentIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (!parentIds.length) {
    return new Map()
  }
  const results = await AssetDirectoryModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { parentId: { $in: parentIds } } },
    { $group: { _id: '$parentId', count: { $sum: 1 } } },
  ])
  return results.reduce<Map<string, number>>((acc, entry) => {
    acc.set(entry._id.toString(), entry.count)
    return acc
  }, new Map())
}

function ensurePathArrays(directory: AssetDirectoryDocument, parent: AssetDirectoryDocument | null): void {
  const parentPathIds = parent ? parent.pathIds.map((value) => value as Types.ObjectId) : []
  const parentPathNames = parent ? [...parent.pathNames] : []
  directory.pathIds = [...parentPathIds, directory._id as Types.ObjectId]
  directory.pathNames = [...parentPathNames, directory.name]
  directory.depth = directory.pathIds.length - 1
  directory.rootId = parent ? (parent.rootId as Types.ObjectId) : (directory._id as Types.ObjectId)
}

export async function ensureRootDirectory(): Promise<AssetDirectoryDocument> {
  let root = await AssetDirectoryModel.findOne({ parentId: null, normalizedName: ROOT_DIRECTORY_NORMALIZED }).exec()
  if (!root) {
    root = new AssetDirectoryModel({
      name: ROOT_DIRECTORY_NAME,
      parentId: null,
      depth: 0,
      pathIds: [],
      pathNames: [],
      rootId: undefined,
      normalizedName: ROOT_DIRECTORY_NORMALIZED,
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

export async function getRootDirectory(): Promise<AssetDirectoryDocument | null> {
  return AssetDirectoryModel.findOne({ parentId: null, normalizedName: ROOT_DIRECTORY_NORMALIZED }).exec()
}

export async function getDirectoryById(directoryId: string | Types.ObjectId): Promise<AssetDirectoryDocument | null> {
  const objectId = toObjectId(directoryId)
  if (!objectId) {
    return null
  }
  return AssetDirectoryModel.findById(objectId).exec()
}

export async function getDirectoryTree(): Promise<DirectoryTreeNode[]> {
  const directories = await AssetDirectoryModel.find().sort({ depth: 1, name: 1 }).lean<LeanDirectory[]>().exec()
  const childCountMap = directories.reduce<Map<string, number>>((acc, directory) => {
    const parentId = directory.parentId ? directory.parentId.toString() : null
    if (parentId) {
      acc.set(parentId, (acc.get(parentId) ?? 0) + 1)
    }
    return acc
  }, new Map())

  const nodeMap = new Map<string, DirectoryTreeNode>()
  const roots: DirectoryTreeNode[] = []

  directories.forEach((directory) => {
    const dto = toDto(directory, childCountMap)
    nodeMap.set(dto.id, { ...dto, children: [] })
  })

  directories.forEach((directory) => {
    const id = directory._id.toString()
    const parentId = directory.parentId ? directory.parentId.toString() : null
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

export async function listDirectoryChildren(parentId?: string | Types.ObjectId | null): Promise<DirectoryNodeDto[]> {
  const objectId = toObjectId(parentId ?? null)
  const query = objectId ? { parentId: objectId } : { parentId: null }
  const directories = await AssetDirectoryModel.find(query).sort({ name: 1 }).lean<LeanDirectory[]>().exec()
  const childCounts = await loadChildCountsForParents(directories.map((directory) => directory._id))
  return directories.map((directory) => toDto(directory, childCounts))
}

async function rebuildSubtreePaths(directoryId: Types.ObjectId): Promise<void> {
  const movedDirectory = await AssetDirectoryModel.findById(directoryId).exec()
  if (!movedDirectory) {
    throw new Error('Directory not found')
  }

  const parent = movedDirectory.parentId ? await AssetDirectoryModel.findById(movedDirectory.parentId).exec() : null
  const parentPathIds = parent ? parent.pathIds.map((id) => id as Types.ObjectId) : []
  const parentPathNames = parent ? [...parent.pathNames] : []
  const nextPathIds = [...parentPathIds, movedDirectory._id as Types.ObjectId]
  const nextPathNames = [...parentPathNames, movedDirectory.name]
  const nextRootId = parent ? (parent.rootId as Types.ObjectId) : (movedDirectory._id as Types.ObjectId)

  movedDirectory.pathIds = nextPathIds
  movedDirectory.pathNames = nextPathNames
  movedDirectory.depth = nextPathIds.length - 1
  movedDirectory.rootId = nextRootId
  await movedDirectory.save()

  const descendants = await AssetDirectoryModel.find({ pathIds: directoryId, _id: { $ne: directoryId } }).sort({ depth: 1 }).exec()
  if (!descendants.length) {
    return
  }

  const updates = descendants
    .map((descendant) => {
      const anchor = descendant.pathIds.findIndex((id) => id.equals(directoryId))
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
    .filter((item): item is { updateOne: { filter: { _id: Types.ObjectId }; update: { $set: { depth: number; pathIds: Types.ObjectId[]; pathNames: string[]; rootId: Types.ObjectId } } } } => Boolean(item))

  if (updates.length) {
    await AssetDirectoryModel.bulkWrite(updates)
  }
}

export async function createDirectory(name: string, parentId?: null | string): Promise<AssetDirectoryDocument> {
  const trimmedName = name.trim()
  if (!trimmedName.length) {
    throw new Error('Directory name is required')
  }

  let parent: AssetDirectoryDocument | null = null
  if (parentId) {
    const parentObjectId = toObjectId(parentId)
    if (!parentObjectId) {
      throw new Error('Invalid parent directory id')
    }
    parent = await AssetDirectoryModel.findById(parentObjectId).exec()
    if (!parent) {
      throw new Error('Parent directory not found')
    }
  }

  const newId = new Types.ObjectId()
  const directory = new AssetDirectoryModel({
    _id: newId,
    name: trimmedName,
    parentId: parent ? (parent._id as Types.ObjectId) : null,
    depth: parent ? parent.depth + 1 : 0,
    pathIds: parent ? [...parent.pathIds, newId] : [newId],
    pathNames: parent ? [...parent.pathNames, trimmedName] : [trimmedName],
    rootId: parent ? (parent.rootId as Types.ObjectId) : newId,
    normalizedName: normalizeDirectoryName(trimmedName),
  })

  try {
    await directory.save()
    return directory
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new Error('Directory name already exists at this level')
    }
    throw error
  }
}

export async function updateDirectoryInfo(
  directoryId: string,
  updates: { name?: string },
): Promise<AssetDirectoryDocument> {
  const objectId = toObjectId(directoryId)
  if (!objectId) {
    throw new Error('Invalid directory id')
  }
  const directory = await AssetDirectoryModel.findById(objectId).exec()
  if (!directory) {
    throw new Error('Directory not found')
  }

  if (updates.name !== undefined) {
    const trimmed = updates.name.trim()
    if (!trimmed.length) {
      throw new Error('Directory name is required')
    }
    const normalizedName = normalizeDirectoryName(trimmed)
    const existing = await AssetDirectoryModel.findOne({
      _id: { $ne: objectId },
      parentId: directory.parentId ?? null,
      normalizedName,
    })
      .select('_id')
      .lean()
      .exec()
    if (existing) {
      throw new Error('Directory name already exists at this level')
    }
    if (directory.name !== trimmed) {
      directory.name = trimmed
      directory.normalizedName = normalizedName
      directory.pathNames[directory.pathNames.length - 1] = trimmed
      await directory.save()

      const descendants = await AssetDirectoryModel.find({ pathIds: directory._id, _id: { $ne: directory._id } }).exec()
      await Promise.all(
        descendants.map(async (descendant) => {
          const index = descendant.pathIds.findIndex((id) => id.equals(directory._id as Types.ObjectId))
          if (index >= 0) {
            descendant.pathNames[index] = trimmed
            await descendant.save()
          }
        }),
      )
      return directory
    }
  }

  await directory.save()
  return directory
}

export async function moveDirectory(directoryId: string, targetParentId: null | string): Promise<AssetDirectoryDocument> {
  const sourceId = toObjectId(directoryId)
  if (!sourceId) {
    throw new Error('Invalid directory id')
  }
  const nextParentId = targetParentId === null ? null : toObjectId(targetParentId)
  if (targetParentId !== null && !nextParentId) {
    throw new Error('Invalid target parent directory id')
  }
  if (nextParentId && nextParentId.equals(sourceId)) {
    throw new Error('Cannot move directory to itself')
  }

  const session = await startSession()
  try {
    let moved: AssetDirectoryDocument | null = null
    await session.withTransaction(async () => {
      const source = await AssetDirectoryModel.findById(sourceId).session(session).exec()
      if (!source) {
        throw new Error('Directory not found')
      }
      if (!source.parentId) {
        throw new Error('Root directory cannot be moved')
      }

      const parent = nextParentId ? await AssetDirectoryModel.findById(nextParentId).session(session).exec() : null
      if (nextParentId && !parent) {
        throw new Error('Target parent directory not found')
      }
      if (parent && parent.pathIds.some((id) => id.equals(sourceId))) {
        throw new Error('Cannot move directory into its own descendant')
      }

      const duplicate = await AssetDirectoryModel.findOne({
        _id: { $ne: sourceId },
        parentId: nextParentId ?? null,
        normalizedName: source.normalizedName,
      })
        .select('_id')
        .session(session)
        .lean()
        .exec()
      if (duplicate) {
        throw new Error('Directory name already exists at target level')
      }

      source.parentId = nextParentId
      await source.save({ session })
      await rebuildSubtreePaths(sourceId)
      moved = await AssetDirectoryModel.findById(sourceId).session(session).exec()
    })

    if (!moved) {
      throw new Error('Failed to move directory')
    }
    return moved
  } finally {
    await session.endSession()
  }
}

export async function deleteDirectoryStrict(directoryId: string): Promise<void> {
  const objectId = toObjectId(directoryId)
  if (!objectId) {
    throw new Error('Invalid directory id')
  }

  const directory = await AssetDirectoryModel.findById(objectId).select('_id parentId').lean().exec()
  if (!directory) {
    throw new Error('Directory not found')
  }
  if (!directory.parentId) {
    throw new Error('Root directory cannot be deleted')
  }

  const childCount = await AssetDirectoryModel.countDocuments({ parentId: objectId }).exec()
  if (childCount > 0) {
    throw new Error('Directory has child directories and cannot be deleted')
  }

  const assetCount = await AssetModel.countDocuments({ directoryId: objectId }).exec()
  if (assetCount > 0) {
    throw new Error('Directory still contains assets and cannot be deleted')
  }

  await AssetDirectoryModel.deleteOne({ _id: objectId }).exec()
}

export async function bulkMoveAssetsToDirectory(params: {
  assetIds: string[]
  targetDirectoryId: string
}): Promise<{ matchedCount: number; modifiedCount: number }> {
  const targetDirectoryId = toObjectId(params.targetDirectoryId)
  if (!targetDirectoryId) {
    throw new Error('Invalid target directory id')
  }
  const targetExists = await AssetDirectoryModel.exists({ _id: targetDirectoryId }).exec()
  if (!targetExists) {
    throw new Error('Target directory not found')
  }

  const uniqueAssetIds = Array.from(new Set(params.assetIds))
  if (!uniqueAssetIds.length) {
    throw new Error('Asset ids are required')
  }

  const objectIds = uniqueAssetIds.map((id) => toObjectId(id))
  if (objectIds.some((id) => !id)) {
    throw new Error('Invalid asset id')
  }

  const result = await AssetModel.updateMany(
    { _id: { $in: objectIds }, directoryId: { $ne: targetDirectoryId } },
    { $set: { directoryId: targetDirectoryId } },
  ).exec()

  return {
    matchedCount: result.matchedCount ?? 0,
    modifiedCount: result.modifiedCount ?? 0,
  }
}
