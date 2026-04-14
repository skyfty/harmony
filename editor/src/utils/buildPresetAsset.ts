import type { ProjectAsset } from '@/types/project-asset'
import { isFloorPresetFilename } from '@/utils/floorPreset'
import { isRoadPresetFilename } from '@/utils/roadPreset'
import { isWallPresetFilename } from '@/utils/wallPreset'

export type BuildPresetAssetKind = 'wall' | 'floor' | 'road'

function resolveBuildPresetFilenameCandidate(
  asset: Pick<ProjectAsset, 'name' | 'description' | 'downloadUrl' | 'id'>,
): string | null {
  const description = typeof asset.description === 'string' ? asset.description.trim() : ''
  if (description.length) {
    return description
  }

  const name = typeof asset.name === 'string' ? asset.name.trim() : ''
  if (name.length) {
    return name
  }

  const downloadUrl = typeof asset.downloadUrl === 'string' ? asset.downloadUrl.trim() : ''
  if (downloadUrl.length) {
    return downloadUrl
  }

  const id = typeof asset.id === 'string' ? asset.id.trim() : ''
  return id.length ? id : null
}

export function detectBuildPresetAssetKind(
  asset: Pick<ProjectAsset, 'type' | 'name' | 'description' | 'downloadUrl' | 'id' | 'extension'> | null | undefined,
): BuildPresetAssetKind | null {
  if (!asset || asset.type !== 'prefab') {
    return null
  }

  const extension = typeof asset.extension === 'string' ? asset.extension.trim().toLowerCase() : ''
  if (extension === 'wall') {
    return 'wall'
  }
  if (extension === 'floor') {
    return 'floor'
  }
  if (extension === 'road') {
    return 'road'
  }

  const candidate = resolveBuildPresetFilenameCandidate(asset)
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
  return null
}

export function isBuildPresetAsset(
  asset: Pick<ProjectAsset, 'type' | 'name' | 'description' | 'downloadUrl' | 'id' | 'extension'> | null | undefined,
): boolean {
  return Boolean(detectBuildPresetAssetKind(asset))
}