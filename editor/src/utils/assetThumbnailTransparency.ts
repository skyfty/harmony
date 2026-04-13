import type { ProjectAsset } from '@/types/project-asset'
import { isFloorPresetFilename } from '@/utils/floorPreset'
import { isLandformPresetFilename } from '@/utils/landformPreset'
import { isRoadPresetFilename } from '@/utils/roadPreset'
import { isWallPresetFilename } from '@/utils/wallPreset'

type AssetThumbnailTransparencySource = Pick<ProjectAsset, 'type'>
  & Partial<Pick<ProjectAsset, 'extension' | 'name' | 'description'>>

const TRANSPARENT_THUMBNAIL_TYPES = new Set<ProjectAsset['type']>(['model', 'mesh', 'lod', 'prefab', 'material'])
const TRANSPARENT_THUMBNAIL_EXTENSIONS = new Set(['wall', 'floor', 'road', 'landform'])

function normalizeExtension(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/^\./, '') : ''
}

function resolveAssetFilename(asset: Partial<Pick<ProjectAsset, 'name' | 'description'>>): string {
  if (typeof asset.description === 'string' && asset.description.trim().length > 0) {
    return asset.description.trim()
  }
  return typeof asset.name === 'string' ? asset.name.trim() : ''
}

export function usesTransparentThumbnailBackground(asset: AssetThumbnailTransparencySource | null | undefined): boolean {
  if (!asset) {
    return false
  }

  if (TRANSPARENT_THUMBNAIL_TYPES.has(asset.type)) {
    return true
  }

  const extension = normalizeExtension(asset.extension)
  if (TRANSPARENT_THUMBNAIL_EXTENSIONS.has(extension)) {
    return true
  }

  const filename = resolveAssetFilename(asset)
  return isWallPresetFilename(filename)
    || isFloorPresetFilename(filename)
    || isRoadPresetFilename(filename)
    || isLandformPresetFilename(filename)
}