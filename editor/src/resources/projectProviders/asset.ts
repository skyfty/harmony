import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
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
  type: ProjectAsset['type']
  tags?: AssetManifestTag[]
  tagIds?: string[]
  downloadUrl: string
  previewUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  createdAt?: string
  updatedAt?: string
  size?: number
  terrainScatterPreset?: TerrainScatterCategory | null
}

interface AssetManifest {
  generatedAt: string
  assets: AssetManifestEntry[]
}

type AssetManifestLoader = () => Promise<AssetManifest>

const TYPE_LABELS: Record<string, string> = {
  model: 'Model',
  image: 'Image',
  texture: 'Texture',
  material: 'Material',
  mesh: 'Mesh',
  prefab: 'Prefab',
  video: 'Video',
  behavior: 'Behavior',
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

let manifestCache: AssetManifest | null = null
let manifestPromise: Promise<AssetManifest> | null = null

async function ensureManifest(loader: AssetManifestLoader = fetchManifest): Promise<AssetManifest> {
  if (manifestCache) {
  return manifestCache
  }
  if (!manifestPromise) {
    manifestPromise = loader()
      .then((payload) => {
        manifestCache = payload
        return payload
      })
      .finally(() => {
        manifestPromise = null
      })
  }
  return manifestPromise
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
    terrainScatterPreset: entry.terrainScatterPreset ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
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
    const manifest = await ensureManifest()
    return buildDirectories(manifest.assets)
  },
}

export interface TerrainScatterPreset {
  label: string
  icon: string
  minScale: number
  maxScale: number
}

export const terrainScatterPresets: Record<TerrainScatterCategory, TerrainScatterPreset> = {
  flora: {
    label: 'Flora',
    icon: 'mdi-flower',
    minScale: 0.85,
    maxScale: 1.2,
  },
  rocks: {
    label: 'Rocks',
    icon: 'mdi-terrain',
    minScale: 0.9,
    maxScale: 1.15,
  },
  trees: {
    label: 'Trees',
    icon: 'mdi-pine-tree',
    minScale: 0.8,
    maxScale: 1.35,
  }
}

export function invalidateAssetManifestCache(): void {
  manifestCache = null
}

export async function loadScatterAssets(category: TerrainScatterCategory): Promise<ProjectAsset[]> {
  const manifest = await ensureManifest()
  return manifest.assets.filter((entry) => entry.terrainScatterPreset === category).map(mapManifestEntry)
}
