import { DEFAULT_ASSET_TYPE, isAssetType } from '@schema'
import type { AssetBundleHashAlgorithm, AssetBundlePersistedRole, AssetPersistedRole } from '@schema'
import { resolveServerAssetDownloadUrl } from '@schema'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'
import { readServerDownloadBaseUrl } from '@/api/serverApiConfig'
import type { ProjectAsset, ProjectAssetMetadata, ServerAssetType } from '@/types/project-asset'
import { extractExtension } from '@/utils/blob'

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
  fileKey?: string | null
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
  contentHash?: string | null
  contentHashAlgorithm?: AssetBundleHashAlgorithm | null
  sourceLocalAssetId?: string | null
  assetRole?: AssetPersistedRole | null
  bundleRole?: AssetBundlePersistedRole | null
  bundlePrimaryAssetId?: string | null
  metadata?: ProjectAssetMetadata | null
  size?: number | null
  seriesId?: string | null
  seriesName?: string | null
  terrainScatterPreset?: TerrainScatterCategory | null
  createdAt?: string
  updatedAt?: string
}

export const SERVER_ASSET_PREVIEW_COLORS: Record<ProjectAsset['type'], string> = {
  model: '#26C6DA',
  image: '#1E88E5',
  texture: '#8E24AA',
  audio: '#43A047',
  hdri: '#546E7A',
  material: '#FFB74D',
  behavior: '#4DB6AC',
  prefab: '#7986CB',
  lod: '#7986CB',
  video: '#FF7043',
  mesh: '#26C6DA',
  file: '#546E7A',
}

const SERVER_ASSET_TYPE_ALIASES: Partial<Record<string, ServerAssetType>> = {
  meshes: 'mesh',
  videos: 'video',
  hdr: 'hdri',
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

function looksLikeGeneratedAssetName(value: string): boolean {
  const normalized = value.trim()
  if (!normalized.length) {
    return true
  }
  return /^sha256-[a-f0-9]+$/i.test(normalized) || /^[a-f0-9]{24}$/i.test(normalized)
}

export function mapServerAssetToProjectAsset(asset: ServerAssetDto, fallbackAsset?: ProjectAsset | null): ProjectAsset {
  const type = normalizeServerAssetType(asset.type)
  const downloadUrl = resolveServerAssetDownloadUrl({
    assetBaseUrl: readServerDownloadBaseUrl(),
    fileKey: asset.fileKey,
    downloadUrl: asset.downloadUrl,
    url: asset.url,
  }) ?? asset.downloadUrl ?? asset.url ?? ''
  const rawTags = Array.isArray(asset.tags) ? asset.tags.filter((tag): tag is ServerAssetTagDto => !!tag && typeof tag.id === 'string') : []
  const tagIds = Array.isArray(asset.tagIds) && asset.tagIds.length ? asset.tagIds.filter((id): id is string => typeof id === 'string') : rawTags.map((tag) => tag.id)
  const tagNames = rawTags.map((tag) => tag.name).filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
  const sourceLocalAssetId = typeof asset.sourceLocalAssetId === 'string' ? asset.sourceLocalAssetId.trim() : ''
  const fallbackName = typeof fallbackAsset?.name === 'string' ? fallbackAsset.name.trim() : ''
  const thumbnail = asset.thumbnailUrl ?? asset.previewUrl ?? fallbackAsset?.thumbnail ?? null
  const resolvedName = fallbackName && sourceLocalAssetId && looksLikeGeneratedAssetName(asset.name) ? fallbackName : asset.name
  const resolvedCategoryId = typeof asset.categoryId === 'string' && asset.categoryId.trim().length
    ? asset.categoryId
    : fallbackAsset?.categoryId
  const resolvedCategoryPath = Array.isArray(asset.categoryPath) && asset.categoryPath.length
    ? asset.categoryPath.filter((item): item is { id: string; name: string } => !!item && typeof item.id === 'string' && typeof item.name === 'string')
    : fallbackAsset?.categoryPath
  const resolvedCategoryPathString = typeof asset.categoryPathString === 'string' && asset.categoryPathString.trim().length
    ? asset.categoryPathString
    : fallbackAsset?.categoryPathString

  return {
    id: asset.id,
    name: resolvedName,
    categoryId: resolvedCategoryId,
    categoryPath: resolvedCategoryPath,
    categoryPathString: resolvedCategoryPathString,
    type,
    description: asset.description ?? undefined,
    downloadUrl,
    fileKey: typeof asset.fileKey === 'string' ? asset.fileKey : null,
    previewColor: SERVER_ASSET_PREVIEW_COLORS[type],
    thumbnail,
    tags: tagNames.length ? tagNames : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
    color: typeof asset.color === 'string' ? asset.color : undefined,
    dimensionLength: typeof asset.dimensionLength === 'number' ? asset.dimensionLength : undefined,
    dimensionWidth: typeof asset.dimensionWidth === 'number' ? asset.dimensionWidth : undefined,
    dimensionHeight: typeof asset.dimensionHeight === 'number' ? asset.dimensionHeight : undefined,
    sizeCategory: typeof asset.sizeCategory === 'string' ? asset.sizeCategory : undefined,
    imageWidth: typeof asset.imageWidth === 'number' ? asset.imageWidth : undefined,
    imageHeight: typeof asset.imageHeight === 'number' ? asset.imageHeight : undefined,
    contentHash: typeof asset.contentHash === 'string' ? asset.contentHash : undefined,
    contentHashAlgorithm: typeof asset.contentHashAlgorithm === 'string' ? asset.contentHashAlgorithm : undefined,
    sourceLocalAssetId: sourceLocalAssetId || undefined,
    assetRole: asset.assetRole === 'master' || asset.assetRole === 'dependant' ? asset.assetRole : 'master',
    bundleRole: typeof asset.bundleRole === 'string' ? asset.bundleRole : undefined,
    bundlePrimaryAssetId: typeof asset.bundlePrimaryAssetId === 'string' ? asset.bundlePrimaryAssetId : undefined,
    metadata: asset.metadata && typeof asset.metadata === 'object' ? { ...asset.metadata } : undefined,
    seriesId: 'seriesId' in asset ? (typeof asset.seriesId === 'string' ? asset.seriesId : null) : undefined,
    seriesName: typeof asset.seriesName === 'string' ? asset.seriesName : undefined,
    terrainScatterPreset:
      'terrainScatterPreset' in asset
        ? ((asset.terrainScatterPreset as TerrainScatterCategory | null | undefined) ?? null)
        : undefined,
    createdAt: typeof asset.createdAt === 'string' ? asset.createdAt : undefined,
    updatedAt: typeof asset.updatedAt === 'string' ? asset.updatedAt : undefined,
    gleaned: false,
    extension: extractExtension(downloadUrl) ?? null,
  }
}
