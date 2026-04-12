import type { ProjectAsset } from '@/types/project-asset'

export type AssetSourceKind = 'builtin' | 'local' | 'remote'

export interface AssetSourcePresentation {
  kind: AssetSourceKind
  label: string
  color: string
}

type AssetSourcePresentationInput = Pick<ProjectAsset, 'id' | 'downloadUrl' | 'fileKey'> & {
  source?: ProjectAsset['source']
}

const SOURCE_PRESENTATIONS: Record<AssetSourceKind, AssetSourcePresentation> = {
  builtin: {
    kind: 'builtin',
    label: 'Builtin',
    color: '#9575CD',
  },
  local: {
    kind: 'local',
    label: 'Local',
    color: '#66BB6A',
  },
  remote: {
    kind: 'remote',
    label: 'Remote',
    color: '#42A5F5',
  },
}

function isBuiltinAssetId(assetId: string | null | undefined): boolean {
  return typeof assetId === 'string' && assetId.trim().startsWith('builtin://')
}

function resolveAssetSourceKind(asset: AssetSourcePresentationInput): AssetSourceKind {
  const sourceType = asset.source?.type ?? null
  if (sourceType === 'local') {
    return 'local'
  }
  if (sourceType === 'url' || sourceType === 'server') {
    return 'remote'
  }
  if (sourceType === 'package') {
    return 'builtin'
  }

  if (asset.fileKey?.trim()) {
    return 'remote'
  }
  if (isBuiltinAssetId(asset.id)) {
    return 'builtin'
  }

  const downloadUrl = asset.downloadUrl?.trim() ?? ''
  if (/^https?:\/\//i.test(downloadUrl)) {
    return 'remote'
  }

  return 'local'
}

export function getAssetSourcePresentation(asset: AssetSourcePresentationInput): AssetSourcePresentation {
  const kind = resolveAssetSourceKind(asset)
  return SOURCE_PRESENTATIONS[kind]
}
