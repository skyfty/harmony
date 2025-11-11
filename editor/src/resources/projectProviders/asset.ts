import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { buildServerApiUrl } from '@/api/serverApiConfig'
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
  model: '模型',
  image: '图片',
  texture: '纹理',
  material: '材质',
  file: '文件',
}

const TYPE_COLORS: Record<ProjectAsset['type'], string> = {
  model: '#26C6DA',
  image: '#1E88E5',
  texture: '#8E24AA',
  material: '#FFB74D',
  behavior: '#4DB6AC',
  prefab: '#7986CB',
  file: '#546E7A',
}

function buildManifestUrl(): string {
  return buildServerApiUrl('/resources/assets/manifest')
}

async function fetchManifest(): Promise<AssetManifest> {
  const url = buildManifestUrl()
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
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

function normalizeAssetType(type: string | undefined): ProjectAsset['type'] {
  switch (type) {
    case 'model':
    case 'image':
    case 'texture':
    case 'material':
    case 'file':
    case 'behavior':
    case 'prefab':
      return type
    case 'mesh':
      return 'model'
    default:
      return 'file'
  }
}

function mapManifestEntry(entry: AssetManifestEntry): ProjectAsset {
  const assetType = normalizeAssetType(entry.type as string)
  const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => tag.name) : []
  const tagIds = Array.isArray(entry.tagIds) ? entry.tagIds : Array.isArray(entry.tags) ? entry.tags.map((tag) => tag.id) : []

  return {
    id: entry.id,
    name: entry.name,
    type: assetType,
    description: entry.description ?? undefined,
    downloadUrl: entry.downloadUrl,
    previewColor: TYPE_COLORS[assetType] ?? '#546E7A',
    thumbnail: entry.thumbnailUrl ?? null,
    tags,
    tagIds,
    gleaned: false,
  }
}

function buildDirectories(entries: AssetManifestEntry[]): ProjectDirectory[] {
  const grouped = new Map<string, ProjectAsset[]>()
  entries.forEach((entry) => {
    const type = normalizeAssetType(entry.type as string)
    if (!grouped.has(type)) {
      grouped.set(type, [])
    }
    grouped.get(type)!.push(mapManifestEntry(entry))
  })

  return Array.from(grouped.entries()).map(([type, assets]) => ({
    id: `server-assets-${type}`,
    name: TYPE_LABELS[type] ?? type,
    assets,
  }))
}

export const assetProvider: ResourceProvider = {
  id: 'server-assets',
  name: '服务器资产',
  url: null,
  includeInPackages: true,
  async load(): Promise<ProjectDirectory[]> {
    const manifest = await fetchManifest()
    return buildDirectories(manifest.assets)
  },
}
