import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { buildServerApiUrl } from '@/api/serverApiConfig'
import { mapServerAssetToProjectAsset, normalizeServerAssetType } from '@/api/serverAssetTypes'
import { useAuthStore } from '@/stores/authStore'
import type { ResourceProvider } from './types'

interface AssetManifestTag {
  id: string
  name: string
}

interface AssetManifestEntry {
  id: string
  name: string
  type: ProjectAsset['type'] | 'model' | 'image' | 'texture' | 'material' | 'file'
  tags?: AssetManifestTag[]
  tagIds?: string[]
  downloadUrl: string
  previewUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  createdAt?: string
  updatedAt?: string
  size?: number
}

interface AssetManifest {
  generatedAt: string
  assets: AssetManifestEntry[]
}

const TYPE_LABELS: Record<string, string> = {
  model: 'Model',
  image: 'Image',
  texture: 'Texture',
  material: 'Material',
  file: 'File',
}

function buildManifestUrl(): string {
  return buildServerApiUrl('/resources/assets/manifest')
}

async function fetchManifest(): Promise<AssetManifest> {
  const url = buildManifestUrl()
  const authStore = useAuthStore()
  const headers = new Headers({ Accept: 'application/json' })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }
  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
    cache: 'no-cache',
  })
  if (!response.ok) {
    throw new Error(`资产清单请求失败 (${response.status})`)
  }

  const payload = (await response.json()) as AssetManifest
  if (!payload || !Array.isArray(payload.assets)) {
    throw new Error('资产清单格式不正确')
  }
  return payload
}

function mapManifestEntry(entry: AssetManifestEntry): ProjectAsset {
  return mapServerAssetToProjectAsset({
    id: entry.id,
    name: entry.name,
    type: entry.type,
    downloadUrl: entry.downloadUrl,
    url: entry.downloadUrl,
    previewUrl: entry.previewUrl ?? entry.thumbnailUrl ?? null,
    thumbnailUrl: entry.thumbnailUrl ?? null,
    description: entry.description ?? undefined,
    tags: entry.tags,
    tagIds: entry.tagIds,
  })
}

function buildDirectories(entries: AssetManifestEntry[]): ProjectDirectory[] {
  const grouped = new Map<string, ProjectAsset[]>()
  entries.forEach((entry) => {
    const asset = mapManifestEntry(entry)
    const type = normalizeServerAssetType(asset.type)
    if (!grouped.has(type)) {
      grouped.set(type, [])
    }
    grouped.get(type)!.push(asset)
  })

  return Array.from(grouped.entries()).map(([type, assets]) => ({
    id: `server-assets-${type}`,
    name: TYPE_LABELS[type] ?? type,
    assets,
  }))
}

export const assetProvider: ResourceProvider = {
  id: 'server-assets',
  name: 'Preset',
  url: null,
  includeInPackages: true,
  async load(): Promise<ProjectDirectory[]> {
    const manifest = await fetchManifest()
    return buildDirectories(manifest.assets)
  },
}
