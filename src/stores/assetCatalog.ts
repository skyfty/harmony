import { resourceProviders } from '@/resources/projectProviders'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'

export interface AssetCategoryDefinition {
  key: 'models' | 'images'  | 'others'
  id: string
  label: string
  extensions: string[]
}

export const ASSETS_ROOT_DIRECTORY_ID = 'dir-assets-root'
export const PACKAGES_ROOT_DIRECTORY_ID = 'dir-packages-root'
export const PACKAGE_DIRECTORY_PREFIX = 'dir-package-'

export const ASSET_CATEGORY_CONFIG: AssetCategoryDefinition[] = [
  {
    key: 'models',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-models`,
    label: 'Models',
    extensions: ['.glb', '.gltf', '.fbx', '.obj', '.stl', '.dae', '.3ds', '.ply', '.usdz', '.blend', '.3mf'],
  },
  {
    key: 'images',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-images`,
    label: 'Images',
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg', '.hdr', '.exr'],
  },
  {
    key: 'others',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-others`,
    label: 'Others',
    extensions: [],
  },
]

type AssetCategoryKey = AssetCategoryDefinition['key']

const ASSET_CATEGORY_ID_BY_KEY = ASSET_CATEGORY_CONFIG.reduce<Record<AssetCategoryKey, string>>((acc, category) => {
  acc[category.key] = category.id
  return acc
}, {} as Record<AssetCategoryKey, string>)

const ASSET_EXTENSION_CATEGORY_MAP = new Map<string, string>()
ASSET_CATEGORY_CONFIG.forEach((category) => {
  category.extensions.forEach((extension) => {
    const normalized = extension.trim().toLowerCase().replace(/^[.]/, '')
    if (normalized.length) {
      ASSET_EXTENSION_CATEGORY_MAP.set(normalized, category.id)
    }
  })
})

const FALLBACK_ASSET_CATEGORY_ID =
  ASSET_CATEGORY_ID_BY_KEY.others ?? ASSET_CATEGORY_CONFIG[ASSET_CATEGORY_CONFIG.length - 1]!.id

export function createEmptyAssetCatalog(): Record<string, ProjectAsset[]> {
  return ASSET_CATEGORY_CONFIG.reduce<Record<string, ProjectAsset[]>>((catalog, category) => {
    catalog[category.id] = []
    return catalog
  }, {})
}

export function cloneAssetList(list: ProjectAsset[]): ProjectAsset[] {
  return list.map((asset) => ({ ...asset }))
}

function extractExtension(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }
  const withoutFragment = trimmed.split(/[?#]/)[0] ?? trimmed
  const match = /\.([a-z0-9]+)$/i.exec(withoutFragment)
  return match ? match[1]!.toLowerCase() : null
}

function inferAssetExtension(asset: ProjectAsset): string | null {
  const candidates: Array<string | null | undefined> = [asset.downloadUrl, asset.description, asset.id, asset.thumbnail]
  for (const candidate of candidates) {
    const extension = extractExtension(candidate)
    if (extension) {
      return extension
    }
  }
  return null
}

export function determineAssetCategoryId(asset: ProjectAsset): string {
  const extension = inferAssetExtension(asset)
  if (extension) {
    const mapped = ASSET_EXTENSION_CATEGORY_MAP.get(extension)
    if (mapped) {
      return mapped
    }
  }
  switch (asset.type) {
    case 'model':
      return ASSET_CATEGORY_ID_BY_KEY.models
    case 'texture':
    case 'image':
      return ASSET_CATEGORY_ID_BY_KEY.images
    default:
      break
  }
  return FALLBACK_ASSET_CATEGORY_ID
}

export function buildPackageDirectoryId(providerId: string): string {
  return `${PACKAGE_DIRECTORY_PREFIX}${providerId}`
}

export function extractProviderIdFromPackageDirectoryId(directoryId: string): string | null {
  if (!directoryId.startsWith(PACKAGE_DIRECTORY_PREFIX)) {
    return null
  }
  return directoryId.slice(PACKAGE_DIRECTORY_PREFIX.length) || null
}

function createAssetsBranch(catalog: Record<string, ProjectAsset[]>): ProjectDirectory {
  return {
    id: ASSETS_ROOT_DIRECTORY_ID,
    name: 'Assets',
    children: ASSET_CATEGORY_CONFIG.map((category) => ({
      id: category.id,
      name: category.label,
      assets: cloneAssetList(catalog[category.id] ?? []),
    })),
  }
}

function createPackagesBranch(cache: Record<string, ProjectDirectory[]> = {}): ProjectDirectory {
  return {
    id: PACKAGES_ROOT_DIRECTORY_ID,
    name: 'Packages',
    children: resourceProviders
      .filter((provider) => provider.includeInPackages !== false && (provider.url || provider.load))
      .map((provider) => ({
        id: buildPackageDirectoryId(provider.id),
        name: provider.name,
        children: cache[provider.id] ? cloneProjectTree(cache[provider.id]!) : [],
      })),
  }
}

export function createProjectTreeFromCache(
  assetCatalog: Record<string, ProjectAsset[]>,
  cache: Record<string, ProjectDirectory[]> = {},
): ProjectDirectory[] {
  return [createAssetsBranch(assetCatalog), createPackagesBranch(cache)]
}

export function cloneProjectTree(tree: ProjectDirectory[]): ProjectDirectory[] {
  return tree.map((directory) => ({
    ...directory,
    children: directory.children ? cloneProjectTree(directory.children) : undefined,
    assets: directory.assets ? directory.assets.map((asset) => ({ ...asset })) : undefined,
  }))
}

export const defaultDirectoryId = ASSETS_ROOT_DIRECTORY_ID
