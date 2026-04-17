import { resourceProviders, type ResourceProvider } from '@/resources/projectProviders'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { getKnownExtensionFromFilename, normalizeExtension, type AssetType } from '@schema'

export interface AssetCategoryDefinition {
  key:
    | 'models'
    | 'meshes'
    | 'images'
    | 'textures'
    | 'materials'
    | 'behaviors'
    | 'prefabs'
    | 'lods'
    | 'wallPresets'
    | 'floorPresets'
    | 'videos'
    | 'hdri'
    | 'others'
  assetType?: AssetType
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
    assetType: 'model',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-models`,
    label: 'Models',
    extensions: ['.glb', '.gltf'],
  },
  {
    key: 'meshes',
    assetType: 'mesh',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-meshes`,
    label: 'Meshes',
    extensions: ['.mesh', '.geom'],
  },
  {
    key: 'images',
    assetType: 'image',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-images`,
    label: 'Images',
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg', '.hdr'],
  },
  {
    key: 'textures',
    assetType: 'texture',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-textures`,
    label: 'Textures',
    extensions: ['.ktx', '.ktx2', '.dds', '.tga'],
  },
  {
    key: 'materials',
    assetType: 'material',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-materials`,
    label: 'Materials',
    extensions: ['.material', '.material.json', '.mat', '.mat.json'],
  },
  {
    key: 'behaviors',
    assetType: 'behavior',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-behaviors`,
    label: 'Behaviors',
    extensions: ['.behavior'],
  },
  {
    key: 'prefabs',
    assetType: 'prefab',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-prefabs`,
    label: 'Prefabs',
    extensions: ['.prefab'],
  },
  {
    key: 'lods',
    assetType: 'lod',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-lods`,
    label: 'LOD Presets',
    extensions: ['.lod'],
  },
  {
    key: 'wallPresets',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-wall-presets`,
    label: 'Wall Presets',
    extensions: ['.wall'],
  },
  {
    key: 'floorPresets',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-floor-presets`,
    label: 'Floor Presets',
    extensions: ['.floor'],
  },
  {
    key: 'videos',
    assetType: 'video',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-videos`,
    label: 'Videos',
    extensions: ['.mp4', '.mov', '.webm', '.mkv', '.avi'],
  },
  {
    key: 'hdri',
    assetType: 'hdri',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-hdri`,
    label: 'HDRi',
    extensions: ['.hdr', '.exr'],
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

const ASSET_CATEGORY_ID_BY_ASSET_TYPE = ASSET_CATEGORY_CONFIG.reduce<Partial<Record<AssetType, string>>>((acc, category) => {
  if (category.assetType) {
    acc[category.assetType] = category.id
  }
  return acc
}, {})

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

const KNOWN_CATEGORY_EXTENSIONS = Array.from(
  new Set(
    ASSET_CATEGORY_CONFIG.flatMap((category) => category.extensions.map((extension) => normalizeExtension(extension))),
  ),
).filter((extension): extension is string => Boolean(extension))

function inferAssetExtension(asset: ProjectAsset): string | null {
  const candidates: Array<string | null | undefined> = [asset.downloadUrl, asset.description, asset.id, asset.thumbnail]
  for (const candidate of candidates) {
    const extension = getKnownExtensionFromFilename(candidate, KNOWN_CATEGORY_EXTENSIONS)
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
  const fallbackByType = ASSET_CATEGORY_ID_BY_ASSET_TYPE[asset.type]
  if (fallbackByType) {
    return fallbackByType
  }
  return FALLBACK_ASSET_CATEGORY_ID
}

function isVisiblePackageProvider(provider: ResourceProvider): boolean {
  return provider.includeInPackages !== false && Boolean(provider.url || provider.load)
}

export function getVisiblePackageProviders(): ResourceProvider[] {
  return resourceProviders.filter((provider) => isVisiblePackageProvider(provider))
}

export function getSingleVisiblePackageProviderId(): string | null {
  const visibleProviders = getVisiblePackageProviders()
  return visibleProviders.length === 1 ? visibleProviders[0]!.id : null
}

export function normalizePackageProviderDirectories(
  directories: ProjectDirectory[] = [],
): {
  assets?: ProjectAsset[]
  directories: ProjectDirectory[]
} {
  if (!directories.length) {
    return { directories: [] }
  }

  if (directories.length !== 1) {
    return { directories: cloneProjectTree(directories) }
  }

  const [rootDirectory] = directories
  return {
    assets: rootDirectory?.assets ? cloneAssetList(rootDirectory.assets) : undefined,
    directories: rootDirectory?.children ? cloneProjectTree(rootDirectory.children) : [],
  }
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
  const visibleProviders = getVisiblePackageProviders()
  if (visibleProviders.length === 1) {
    const provider = visibleProviders[0]!
    const normalized = normalizePackageProviderDirectories(cache[provider.id] ?? [])
    return {
      id: PACKAGES_ROOT_DIRECTORY_ID,
      name: 'Packages',
      children: normalized.directories,
      assets: normalized.assets,
    }
  }

  return {
    id: PACKAGES_ROOT_DIRECTORY_ID,
    name: 'Packages',
    children: visibleProviders
      .map((provider) => {
        const normalized = normalizePackageProviderDirectories(cache[provider.id] ?? [])
        return {
          id: buildPackageDirectoryId(provider.id),
          name: provider.name,
          children: normalized.directories,
          assets: normalized.assets,
        }
      }),
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
