import { getLastExtensionFromFilenameOrUrl, isSkyCubeArchiveExtension } from '@schema/assetTypeConversion'
import type { ProjectAsset } from '@/types/project-asset'
import { isFloorPresetFilename } from '@/utils/floorPreset'
import { isLandformPresetFilename } from '@/utils/landformPreset'
import { isLodPresetFilename } from '@/utils/lodPreset'
import { isRoadPresetFilename } from '@/utils/roadPreset'
import { isWallPresetFilename } from '@/utils/wallPreset'

export interface AssetTypePresentation {
  label: string
  shortLabel: string
  icon: string
  color: string
}

type AssetTypePresentationSource = Pick<ProjectAsset, 'type'>
  & Partial<Pick<ProjectAsset, 'name' | 'downloadUrl' | 'id' | 'extension'>>

type PresetAssetKind = 'wall' | 'floor' | 'road' | 'landform' | 'lod'

const ASSET_TYPE_PRESENTATIONS: Record<ProjectAsset['type'], AssetTypePresentation> = {
  model: {
    label: 'Model',
    shortLabel: 'MDL',
    icon: 'mdi-cube',
    color: '#26C6DA',
  },
  image: {
    label: 'Image',
    shortLabel: 'IMG',
    icon: 'mdi-image-outline',
    color: '#42A5F5',
  },
  texture: {
    label: 'Texture',
    shortLabel: 'TEX',
    icon: 'mdi-texture',
    color: '#AB47BC',
  },
  audio: {
    label: 'Audio',
    shortLabel: 'AUD',
    icon: 'mdi-music-note-outline',
    color: '#43A047',
  },
  hdri: {
    label: 'HDRI',
    shortLabel: 'HDRI',
    icon: 'mdi-image-filter-hdr',
    color: '#26A69A',
  },
  material: {
    label: 'Material',
    shortLabel: 'MAT',
    icon: 'mdi-palette',
    color: '#FFB74D',
  },
  file: {
    label: 'File',
    shortLabel: 'FILE',
    icon: 'mdi-file-outline',
    color: '#90A4AE',
  },
  prefab: {
    label: 'Prefab',
    shortLabel: 'PREF',
    icon: 'mdi-cube-outline',
    color: '#9575CD',
  },
  lod: {
    label: 'LOD',
    shortLabel: 'LOD',
    icon: 'mdi-layers-triple-outline',
    color: '#B0BEC5',
  },
  video: {
    label: 'Video',
    shortLabel: 'VID',
    icon: 'mdi-play-box-outline',
    color: '#FF8A65',
  },
  mesh: {
    label: 'Mesh',
    shortLabel: 'MSH',
    icon: 'mdi-vector-polygon',
    color: '#A1887F',
  },
  behavior: {
    label: 'Behavior',
    shortLabel: 'BHV',
    icon: 'mdi-script-text-outline',
    color: '#78909C',
  },
}

const PRESET_TYPE_PRESENTATIONS: Record<PresetAssetKind, AssetTypePresentation> = {
  wall: {
    label: 'Wall',
    shortLabel: 'WALL',
    icon: 'mdi-wall',
    color: '#8D6E63',
  },
  floor: {
    label: 'Floor',
    shortLabel: 'FLOOR',
    icon: 'mdi-floor-plan',
    color: '#78909C',
  },
  road: {
    label: 'Road',
    shortLabel: 'ROAD',
    icon: 'mdi-road-variant',
    color: '#607D8B',
  },
  landform: {
    label: 'Landform',
    shortLabel: 'LAND',
    icon: 'mdi-terrain',
    color: '#66BB6A',
  },
  lod: {
    label: 'LOD',
    shortLabel: 'LOD',
    icon: 'mdi-layers-triple-outline',
    color: '#B0BEC5',
  },
}

const SKYCUBE_PRESENTATION: AssetTypePresentation = {
  label: 'Skycube',
  shortLabel: 'SKY',
  icon: 'mdi-panorama-variant-outline',
  color: '#26A69A',
}

function isSkycubeFileAsset(asset: AssetTypePresentationSource): boolean {
  if (asset.type !== 'file') {
    return false
  }
  const extension = getLastExtensionFromFilenameOrUrl(asset.name || asset.downloadUrl || asset.id || '') ?? ''
  return isSkyCubeArchiveExtension(extension)
}

function normalizeAssetExtension(asset: AssetTypePresentationSource): string {
  const directExtension = typeof asset.extension === 'string' ? asset.extension.trim().toLowerCase().replace(/^\./, '') : ''
  if (directExtension.length > 0) {
    return directExtension
  }
  return getLastExtensionFromFilenameOrUrl(asset.name || asset.downloadUrl || asset.id || '') ?? ''
}

function resolvePresetPresentation(asset: AssetTypePresentationSource): AssetTypePresentation | null {
  const extension = normalizeAssetExtension(asset)
  const filename = asset.name || asset.downloadUrl || asset.id || ''

  if (extension === 'wall' || isWallPresetFilename(filename)) {
    return PRESET_TYPE_PRESENTATIONS.wall
  }
  if (extension === 'floor' || isFloorPresetFilename(filename)) {
    return PRESET_TYPE_PRESENTATIONS.floor
  }
  if (extension === 'road' || isRoadPresetFilename(filename)) {
    return PRESET_TYPE_PRESENTATIONS.road
  }
  if (extension === 'landform' || isLandformPresetFilename(filename)) {
    return PRESET_TYPE_PRESENTATIONS.landform
  }
  if (extension === 'lod' || isLodPresetFilename(filename)) {
    return PRESET_TYPE_PRESENTATIONS.lod
  }

  return null
}

export function getAssetTypePresentation(asset: AssetTypePresentationSource): AssetTypePresentation {
  const presetPresentation = resolvePresetPresentation(asset)
  if (presetPresentation) {
    return presetPresentation
  }
  if (isSkycubeFileAsset(asset)) {
    return SKYCUBE_PRESENTATION
  }
  return ASSET_TYPE_PRESENTATIONS[asset.type] ?? ASSET_TYPE_PRESENTATIONS.file
}

export function getAssetTypeIcon(type: ProjectAsset['type']): string {
  return ASSET_TYPE_PRESENTATIONS[type]?.icon ?? ASSET_TYPE_PRESENTATIONS.file.icon
}

export function getAssetTypeLabel(asset: AssetTypePresentationSource): string {
  return getAssetTypePresentation(asset).label
}