import { DEFAULT_ASSET_TYPE, isAssetType } from '@harmony/schema/asset-types'
import type { ProjectAsset, ServerAssetType } from '@/types/project-asset'

export interface ServerAssetTagDto {
  id: string
  name: string
  description?: string | null
}

export interface ServerAssetDto {
  id: string
  name: string
  categoryId?: string | null
  categoryPath?: { id: string; name: string }[] | null
  categoryPathString?: string | null
  type: string
  downloadUrl?: string | null
  url?: string | null
  previewUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  tags?: ServerAssetTagDto[] | null
  tagIds?: string[] | null
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  sizeCategory?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
}

export const SERVER_ASSET_PREVIEW_COLORS: Record<ProjectAsset['type'], string> = {
  model: '#26C6DA',
  image: '#1E88E5',
  texture: '#8E24AA',
  material: '#FFB74D',
  behavior: '#4DB6AC',
  prefab: '#7986CB',
  video: '#FF7043',
  mesh: '#26C6DA',
  file: '#546E7A',
}

const SERVER_ASSET_TYPE_ALIASES: Partial<Record<string, ServerAssetType>> = {
  meshes: 'mesh',
  videos: 'video',
}

export function normalizeServerAssetType(type: string | undefined): ProjectAsset['type'] {
  if (!type) {
    return DEFAULT_ASSET_TYPE
  }
  const normalized = type.trim().toLowerCase()
  if (normalized === 'behavior') {
    return 'behavior'
  }
  const aliased = SERVER_ASSET_TYPE_ALIASES[normalized]
  if (aliased) {
    return aliased
  }
  if (isAssetType(normalized)) {
    return normalized
  }
  return DEFAULT_ASSET_TYPE
}

export function mapServerAssetToProjectAsset(asset: ServerAssetDto): ProjectAsset {
  const type = normalizeServerAssetType(asset.type)
  const downloadUrl = asset.downloadUrl ?? asset.url ?? ''
  const rawTags = Array.isArray(asset.tags) ? asset.tags.filter((tag): tag is ServerAssetTagDto => !!tag && typeof tag.id === 'string') : []
  const tagIds = Array.isArray(asset.tagIds) && asset.tagIds.length ? asset.tagIds.filter((id): id is string => typeof id === 'string') : rawTags.map((tag) => tag.id)
  const tagNames = rawTags.map((tag) => tag.name).filter((name): name is string => typeof name === 'string' && name.trim().length > 0)

  return {
    id: asset.id,
    name: asset.name,
    categoryId: typeof asset.categoryId === 'string' ? asset.categoryId : undefined,
    categoryPath: Array.isArray(asset.categoryPath)
      ? asset.categoryPath.filter((item): item is { id: string; name: string } => !!item && typeof item.id === 'string' && typeof item.name === 'string')
      : undefined,
    categoryPathString: typeof asset.categoryPathString === 'string' ? asset.categoryPathString : undefined,
    type,
    description: asset.description ?? undefined,
    downloadUrl,
    previewColor: SERVER_ASSET_PREVIEW_COLORS[type],
    thumbnail: asset.thumbnailUrl ?? asset.previewUrl ?? null,
    tags: tagNames.length ? tagNames : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
    color: typeof asset.color === 'string' ? asset.color : undefined,
    dimensionLength: typeof asset.dimensionLength === 'number' ? asset.dimensionLength : undefined,
    dimensionWidth: typeof asset.dimensionWidth === 'number' ? asset.dimensionWidth : undefined,
    dimensionHeight: typeof asset.dimensionHeight === 'number' ? asset.dimensionHeight : undefined,
    sizeCategory: typeof asset.sizeCategory === 'string' ? asset.sizeCategory : undefined,
    imageWidth: typeof asset.imageWidth === 'number' ? asset.imageWidth : undefined,
    imageHeight: typeof asset.imageHeight === 'number' ? asset.imageHeight : undefined,
    gleaned: false,
  }
}
