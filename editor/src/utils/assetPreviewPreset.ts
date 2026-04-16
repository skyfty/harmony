import type { ProjectAsset } from '@/types/project-asset'
import { isFloorPresetFilename } from '@/utils/floorPreset'
import { isLandformPresetFilename } from '@/utils/landformPreset'
import { isRoadPresetFilename } from '@/utils/roadPreset'
import { isWallPresetFilename } from '@/utils/wallPreset'

export type AssetPreviewPresetKind = 'wall' | 'floor' | 'road' | 'landform'

function resolvePresetFilenameCandidate(asset: Pick<ProjectAsset, 'type' | 'name' | 'description' | 'downloadUrl' | 'id'>): string | null {
  const description = typeof asset.description === 'string' ? asset.description.trim() : ''
  if (description.length && (isWallPresetFilename(description) || isFloorPresetFilename(description) || isRoadPresetFilename(description) || isLandformPresetFilename(description))) {
    return description
  }

  const name = typeof asset.name === 'string' ? asset.name.trim() : ''
  if (name.length && (isWallPresetFilename(name) || isFloorPresetFilename(name) || isRoadPresetFilename(name) || isLandformPresetFilename(name))) {
    return name
  }

  const downloadUrl = typeof asset.downloadUrl === 'string' ? asset.downloadUrl.trim() : ''
  if (downloadUrl.length && (isWallPresetFilename(downloadUrl) || isFloorPresetFilename(downloadUrl) || isRoadPresetFilename(downloadUrl) || isLandformPresetFilename(downloadUrl))) {
    return downloadUrl
  }

  const id = typeof asset.id === 'string' ? asset.id.trim() : ''
  if (id.length && (isWallPresetFilename(id) || isFloorPresetFilename(id) || isRoadPresetFilename(id) || isLandformPresetFilename(id))) {
    return id
  }

  return null
}

export function detectAssetPreviewPresetKind(
  asset: Pick<ProjectAsset, 'type' | 'name' | 'description' | 'downloadUrl' | 'id'>,
): AssetPreviewPresetKind | null {
  if (!asset) {
    return null
  }

  const candidate = resolvePresetFilenameCandidate(asset)
  if (!candidate) {
    return null
  }

  if (isWallPresetFilename(candidate)) {
    return 'wall'
  }
  if (isFloorPresetFilename(candidate)) {
    return 'floor'
  }
  if (isRoadPresetFilename(candidate)) {
    return 'road'
  }
  if (isLandformPresetFilename(candidate)) {
    return 'landform'
  }
  return null
}

export function isPresetPreviewAsset(asset: Pick<ProjectAsset, 'type' | 'name' | 'description' | 'downloadUrl' | 'id'>): boolean {
  return Boolean(detectAssetPreviewPresetKind(asset))
}
