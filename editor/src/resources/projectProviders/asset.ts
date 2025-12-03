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

export type TerrainScatterCategory = 'flora' | 'rocks' | 'trees' | 'water' | 'ground'

export interface TerrainScatterPreset {
  label: string
  icon: string
  path: string
  spacing: number
  minScale: number
  maxScale: number
}

const SCATTER_BASE_PATH = '/resources/assets/terrain'

export const terrainScatterPresets: Record<TerrainScatterCategory, TerrainScatterPreset> = {
  flora: {
    label: '花草',
    icon: 'mdi-flower',
    path: `${SCATTER_BASE_PATH}/flora`,
    spacing: 1.25,
    minScale: 0.85,
    maxScale: 1.2,
  },
  rocks: {
    label: '岩石',
    icon: 'mdi-terrain',
    path: `${SCATTER_BASE_PATH}/rocks`,
    spacing: 2.2,
    minScale: 0.9,
    maxScale: 1.15,
  },
  trees: {
    label: '树木',
    icon: 'mdi-pine-tree',
    path: `${SCATTER_BASE_PATH}/trees`,
    spacing: 3.2,
    minScale: 0.8,
    maxScale: 1.35,
  },
  water: {
    label: '水面',
    icon: 'mdi-water',
    path: `${SCATTER_BASE_PATH}/water`,
    spacing: 2.6,
    minScale: 0.95,
    maxScale: 1.05,
  },
  ground: {
    label: '地面',
    icon: 'mdi-grass',
    path: `${SCATTER_BASE_PATH}/ground`,
    spacing: 1.4,
    minScale: 0.9,
    maxScale: 1.1,
  },
}

export function invalidateAssetManifestCache(): void {
  manifestCache = null
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

function entryMatchesPath(entry: AssetManifestEntry, normalizedPath: string): boolean {
  const download = entry.downloadUrl?.toLowerCase() ?? ''
  const preview = entry.previewUrl?.toLowerCase() ?? ''
  const thumbnail = entry.thumbnailUrl?.toLowerCase() ?? ''
  return (
    (download && download.includes(normalizedPath)) ||
    (preview && preview.includes(normalizedPath)) ||
    (thumbnail && thumbnail.includes(normalizedPath))
  )
}

export async function loadAssetsByPath(path: string | string[]): Promise<ProjectAsset[]> {
  const manifest = await ensureManifest()
  const targets = (Array.isArray(path) ? path : [path]).map((entry) => normalizePath(entry)).filter(Boolean)
  if (!targets.length) {
    return []
  }
  const matches = manifest.assets.filter((entry) => targets.some((target) => entryMatchesPath(entry, target)))
  return matches.map(mapManifestEntry)
}

export async function loadScatterAssets(category: TerrainScatterCategory): Promise<ProjectAsset[]> {
  const preset = terrainScatterPresets[category]
  if (!preset) {
    return []
  }
  return loadAssetsByPath(preset.path)
}
