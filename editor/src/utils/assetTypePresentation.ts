import { getLastExtensionFromFilenameOrUrl, isSkyCubeArchiveExtension } from '@schema/assetTypeConversion'
import type { ProjectAsset } from '@/types/project-asset'

export interface AssetTypePresentation {
  label: string
  shortLabel: string
  icon: string
  color: string
}

type AssetTypePresentationSource = Pick<ProjectAsset, 'type'>
  & Partial<Pick<ProjectAsset, 'name' | 'downloadUrl' | 'id'>>

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
  const extension = getLastExtensionFromFilenameOrUrl(asset.name || asset.downloadUrl || asset.id || '')
  return isSkyCubeArchiveExtension(extension)
}

export function getAssetTypePresentation(asset: AssetTypePresentationSource): AssetTypePresentation {
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