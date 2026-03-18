import type {
  AssetManifest,
  AssetManifestAsset,
  AssetManifestDirectory,
  LegacyAssetManifest,
} from '@schema'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { buildServerApiUrl } from '@/api/serverApiConfig'
import { mapServerAssetToProjectAsset, normalizeServerAssetType } from '@/api/serverAssetTypes'
import { useAuthStore } from '@/stores/authStore'
import { useSceneStore } from '@/stores/sceneStore'
import type { ResourceProvider } from './types'

interface ApiEnvelope<T> {
  code: number
  data: T
  message: string
}

type AssetManifestLoader = () => Promise<AssetManifest>

const MANIFEST_ROOT_DIRECTORY_ID = 'asset-root'
const LEGACY_UNCATEGORIZED_DIRECTORY_ID = 'legacy-uncategorized'

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

  const payload = (await response.json()) as ApiEnvelope<AssetManifest | LegacyAssetManifest>
  const manifest = payload?.data
  if (!manifest) {
    throw new Error('资产清单格式不正确')
  }
  return normalizeManifest(manifest)
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

function mapManifestEntry(entry: AssetManifestAsset): ProjectAsset {
  const downloadUrl = entry.resource?.url ?? entry.downloadUrl
  const thumbnailUrl = entry.thumbnail?.url ?? entry.thumbnailUrl ?? null
  return mapServerAssetToProjectAsset({
    id: entry.id,
    name: entry.name,
    type: entry.type,
    categoryId: entry.categoryId ?? null,
    categoryPath: entry.categoryPath ?? null,
    categoryPathString: entry.categoryPathString ?? null,
    seriesId: entry.seriesId ?? null,
    seriesName: entry.seriesName ?? null,
    downloadUrl,
    url: downloadUrl,
    previewUrl: thumbnailUrl,
    thumbnailUrl,
    description: entry.description ?? undefined,
    tags: entry.tags,
    tagIds: entry.tagIds,
    color: entry.color ?? null,
    dimensionLength: entry.dimensionLength ?? null,
    dimensionWidth: entry.dimensionWidth ?? null,
    dimensionHeight: entry.dimensionHeight ?? null,
    sizeCategory: entry.sizeCategory ?? null,
    imageWidth: entry.imageWidth ?? null,
    imageHeight: entry.imageHeight ?? null,
    size: entry.size,
    terrainScatterPreset: entry.terrainScatterPreset ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })
}

function normalizeManifest(rawManifest: AssetManifest | LegacyAssetManifest): AssetManifest {
  if (isAssetManifest(rawManifest)) {
    return rawManifest
  }
  if (isLegacyManifest(rawManifest)) {
    return convertLegacyManifest(rawManifest)
  }
  throw new Error('资产清单格式不正确')
}

function isAssetManifest(value: unknown): value is AssetManifest {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<AssetManifest>
  return candidate.format === 'harmony-asset-manifest'
    && candidate.version === 2
    && typeof candidate.rootDirectoryId === 'string'
    && !!candidate.directoriesById
    && typeof candidate.directoriesById === 'object'
    && !!candidate.assetsById
    && typeof candidate.assetsById === 'object'
}

function isLegacyManifest(value: unknown): value is LegacyAssetManifest {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<LegacyAssetManifest>
  return Array.isArray(candidate.assets)
}

function ensureDirectory(
  directoriesById: Record<string, AssetManifestDirectory>,
  id: string,
  name: string,
  parentId: string | null,
): AssetManifestDirectory {
  const existing = directoriesById[id]
  if (existing) {
    return existing
  }
  const directory: AssetManifestDirectory = {
    id,
    name,
    parentId,
    directoryIds: [],
    assetIds: [],
  }
  directoriesById[id] = directory
  if (parentId) {
    const parent = directoriesById[parentId]
    if (parent && !parent.directoryIds.includes(id)) {
      parent.directoryIds.push(id)
    }
  }
  return directory
}

function convertLegacyManifest(manifest: LegacyAssetManifest): AssetManifest {
  const directoriesById: Record<string, AssetManifestDirectory> = {
    [MANIFEST_ROOT_DIRECTORY_ID]: {
      id: MANIFEST_ROOT_DIRECTORY_ID,
      name: 'Assets',
      parentId: null,
      directoryIds: [],
      assetIds: [],
    },
  }
  const assetsById: Record<string, AssetManifestAsset> = {}

  manifest.assets.forEach((entry) => {
    assetsById[entry.id] = entry
    const normalizedPath = Array.isArray(entry.categoryPath)
      ? entry.categoryPath.filter((item): item is { id: string; name: string } => !!item && typeof item.id === 'string' && typeof item.name === 'string')
      : []

    let parentId = MANIFEST_ROOT_DIRECTORY_ID
    if (!normalizedPath.length) {
      const uncategorized = ensureDirectory(directoriesById, LEGACY_UNCATEGORIZED_DIRECTORY_ID, 'Ungrouped', MANIFEST_ROOT_DIRECTORY_ID)
      uncategorized.assetIds.push(entry.id)
      return
    }

    normalizedPath.forEach((segment) => {
      ensureDirectory(directoriesById, segment.id, segment.name, parentId)
      parentId = segment.id
    })

    directoriesById[parentId]?.assetIds.push(entry.id)
  })

  return {
    format: 'harmony-asset-manifest',
    version: 2,
    generatedAt: manifest.generatedAt,
    rootDirectoryId: MANIFEST_ROOT_DIRECTORY_ID,
    directoriesById,
    assetsById,
  }
}

function buildDirectoryTree(
  manifest: AssetManifest,
  directoryId: string,
): ProjectDirectory | null {
  const directory = manifest.directoriesById[directoryId]
  if (!directory) {
    return null
  }

  const assets = directory.assetIds
    .map((assetId) => manifest.assetsById[assetId])
    .filter((asset): asset is AssetManifestAsset => !!asset)
    .map(mapManifestEntry)

  const children = directory.directoryIds
    .map((childId) => buildDirectoryTree(manifest, childId))
    .filter((child): child is ProjectDirectory => !!child)

  return {
    id: directory.id,
    name: directory.name,
    children: children.length ? children : undefined,
    assets: assets.length ? assets : undefined,
  }
}

function buildDirectories(manifest: AssetManifest): ProjectDirectory[] {
  const rootDirectory = manifest.directoriesById[manifest.rootDirectoryId]
  if (!rootDirectory) {
    return []
  }

  const topLevelDirectories = rootDirectory.directoryIds
    .map((childId) => buildDirectoryTree(manifest, childId))
    .filter((child): child is ProjectDirectory => !!child)

  if (rootDirectory.assetIds.length) {
    const ungroupedAssets = rootDirectory.assetIds
      .map((assetId) => manifest.assetsById[assetId])
      .filter((asset): asset is AssetManifestAsset => !!asset)
      .map(mapManifestEntry)
    topLevelDirectories.unshift({
      id: `${manifest.rootDirectoryId}-assets`,
      name: TYPE_LABELS[normalizeServerAssetType('file')] ?? 'Assets',
      assets: ungroupedAssets,
    })
  }

  return topLevelDirectories
}

export const assetProvider: ResourceProvider = {
  id: 'server-assets',
  name: 'Preset',
  url: null,
  includeInPackages: true,
  async load(): Promise<ProjectDirectory[]> {
    const manifest = await ensureManifest()
    return buildDirectories(manifest)
  },
}

export interface TerrainScatterPreset {
  label: string
  icon: string
  minScale: number
  maxScale: number
}

export interface ScatterAssetOption {
  asset: ProjectAsset
  providerAssetId: string
  source: 'server' | 'scene'
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

function loadSceneScatterAssets(category: TerrainScatterCategory): ScatterAssetOption[] {
  const sceneStore = useSceneStore()
  const merged = new Map<string, ScatterAssetOption>()

  Object.values(sceneStore.assetCatalog).forEach((assets) => {
    assets.forEach((asset) => {
      if (asset.terrainScatterPreset !== category) {
        return
      }
      merged.set(asset.id, {
        asset,
        providerAssetId: asset.id,
        source: 'scene',
      })
    })
  })

  return Array.from(merged.values())
}

function loadManifestScatterAssets(manifest: AssetManifest, category: TerrainScatterCategory): ScatterAssetOption[] {
  return Object.values(manifest.assetsById)
    .filter((entry) => entry.terrainScatterPreset === category)
    .map((entry) => {
      const asset = mapManifestEntry(entry)
      return {
        asset,
        providerAssetId: asset.id,
        source: 'server' as const,
      }
    })
}

export async function loadScatterAssets(category: TerrainScatterCategory): Promise<ScatterAssetOption[]> {
  const merged = new Map<string, ScatterAssetOption>()
  const sceneAssets = loadSceneScatterAssets(category)

  let manifestAssets: ScatterAssetOption[] = []
  let manifestError: Error | null = null
  try {
    const manifest = await ensureManifest()
    manifestAssets = loadManifestScatterAssets(manifest, category)
  } catch (error) {
    manifestError = error as Error
  }

  manifestAssets.forEach((entry) => {
    merged.set(entry.asset.id, entry)
  })
  sceneAssets.forEach((entry) => {
    merged.set(entry.asset.id, entry)
  })

  if (!merged.size && manifestError) {
    throw manifestError
  }

  return Array.from(merged.values())
}
