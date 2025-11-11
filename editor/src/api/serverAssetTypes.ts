import type { ProjectAsset } from '@/types/project-asset'

export interface ServerAssetTagDto {
  id: string
  name: string
  description?: string | null
}

export interface ServerAssetDto {
  id: string
  name: string
  type: string
  downloadUrl?: string | null
  url?: string | null
  previewUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  tags?: ServerAssetTagDto[] | null
  tagIds?: string[] | null
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

export function normalizeServerAssetType(type: string | undefined): ProjectAsset['type'] {
  switch (type) {
    case 'model':
    case 'image':
    case 'texture':
    case 'material':
    case 'file':
    case 'behavior':
    case 'prefab':
    case 'video':
    case 'mesh':
      return type
    case 'meshes':
      return 'mesh'
    case 'videos':
      return 'video'
    default:
      return 'file'
  }
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
    type,
    description: asset.description ?? undefined,
    downloadUrl,
    previewColor: SERVER_ASSET_PREVIEW_COLORS[type],
    thumbnail: asset.thumbnailUrl ?? asset.previewUrl ?? null,
    tags: tagNames.length ? tagNames : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
    gleaned: false,
  }
}
