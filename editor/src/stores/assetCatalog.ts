import { resourceProviders } from '@/resources/projectProviders'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { ResourceCategory } from '@/types/resource-category'
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
    extensions: ['.glb', '.gltf', '.fbx'],
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
    extensions: ['.prefab', '.lod'],
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
  return {}
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

export function buildPackageDirectoryId(providerId: string): string {
  return `${PACKAGE_DIRECTORY_PREFIX}${providerId}`
}

export function extractProviderIdFromPackageDirectoryId(directoryId: string): string | null {
  if (!directoryId.startsWith(PACKAGE_DIRECTORY_PREFIX)) {
    return null
  }
  return directoryId.slice(PACKAGE_DIRECTORY_PREFIX.length) || null
}

function mapResourceCategoryTree(
  categories: ResourceCategory[] | undefined,
  catalog: Record<string, ProjectAsset[]>,
  parentId: string | null,
): ProjectDirectory[] {
  if (!Array.isArray(categories) || !categories.length) {
    return []
  }

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    kind: 'resource-category',
    parentId,
    children: mapResourceCategoryTree(category.children, catalog, category.id),
    assets: cloneAssetList(catalog[category.id] ?? []),
  }))
}

function resolveAssetsBranchContents(
  categories: ResourceCategory[] | undefined,
  catalog: Record<string, ProjectAsset[]>,
): { children: ProjectDirectory[]; assets: ProjectAsset[] } {
  if (!Array.isArray(categories) || !categories.length) {
    return { children: [], assets: [] }
  }

  if (categories.length === 1) {
    const [root] = categories
    return {
      children: mapResourceCategoryTree(root?.children, catalog, ASSETS_ROOT_DIRECTORY_ID),
      assets: cloneAssetList(catalog[root?.id ?? ''] ?? []),
    }
  }

  return {
    children: mapResourceCategoryTree(categories, catalog, ASSETS_ROOT_DIRECTORY_ID),
    assets: [],
  }
}

function createAssetsBranch(
  catalog: Record<string, ProjectAsset[]>,
  resourceCategories: ResourceCategory[] = [],
): ProjectDirectory {
  const { children, assets } = resolveAssetsBranchContents(resourceCategories, catalog)
  return {
    id: ASSETS_ROOT_DIRECTORY_ID,
    name: 'Assets',
    kind: 'assets-root',
    parentId: null,
    children,
    assets,
  }
}

function createPackagesBranch(cache: Record<string, ProjectDirectory[]> = {}): ProjectDirectory {
  return {
    id: PACKAGES_ROOT_DIRECTORY_ID,
    name: 'Packages',
    kind: 'package-root',
    parentId: null,
    children: resourceProviders
      .filter((provider) => provider.includeInPackages !== false && (provider.url || provider.load))
      .map((provider) => ({
        id: buildPackageDirectoryId(provider.id),
        name: provider.name,
        kind: 'package-provider',
        parentId: PACKAGES_ROOT_DIRECTORY_ID,
        children: cache[provider.id] ? cloneProjectTree(cache[provider.id]!) : [],
      })),
  }
}

export function createProjectTreeFromCache(
  assetCatalog: Record<string, ProjectAsset[]>,
  resourceCategories: ResourceCategory[] = [],
  cache: Record<string, ProjectDirectory[]> = {},
): ProjectDirectory[] {
  return [createAssetsBranch(assetCatalog, resourceCategories), createPackagesBranch(cache)]
}

export function cloneProjectTree(tree: ProjectDirectory[]): ProjectDirectory[] {
  return tree.map((directory) => ({
    ...directory,
    children: directory.children ? cloneProjectTree(directory.children) : undefined,
    assets: directory.assets ? directory.assets.map((asset) => ({ ...asset })) : undefined,
  }))
}

export const defaultDirectoryId = ASSETS_ROOT_DIRECTORY_ID
