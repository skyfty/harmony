import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { ResourceProvider } from './types'

type PresetCategory = 'models' | 'images' | 'others'

interface CategoryDefinition {
  key: PresetCategory
  label: string
  assetType: ProjectAsset['type']
  previewColor: string
}

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    key: 'models',
    label: 'Models',
    assetType: 'model',
    previewColor: '#26c6da',
  },
  {
    key: 'images',
    label: 'Images',
    assetType: 'image',
    previewColor: '#1e88e5',
  },
  {
    key: 'others',
    label: 'Others',
    assetType: 'file',
    previewColor: '#8e24aa',
  },
]

interface DirectoryNode {
  id: string
  name: string
  children: Map<string, DirectoryNode>
  assets: ProjectAsset[]
}

const presetModules = import.meta.glob<string>('@/preset/**/*', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized.length ? normalized : 'item'
}

function formatDisplayName(value: string): string {
  const withoutExtension = value.replace(/\.[^.]+$/, '')
  return withoutExtension
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function createDirectoryNode(id: string, name: string): DirectoryNode {
  return {
    id,
    name,
    children: new Map(),
    assets: [],
  }
}

function cloneDirectoryTree(directories: ProjectDirectory[]): ProjectDirectory[] {
  return directories.map((directory) => {
    const cloned: ProjectDirectory = {
      id: directory.id,
      name: directory.name,
    }
    if (directory.children?.length) {
      cloned.children = cloneDirectoryTree(directory.children)
    }
    if (directory.assets?.length) {
      cloned.assets = directory.assets.map((asset) => ({ ...asset }))
    }
    return cloned
  })
}

function insertAsset(node: DirectoryNode, segments: string[], asset: ProjectAsset, parentIdPrefix: string): void {
  if (!segments.length) {
    node.assets.push(asset)
    return
  }
  const [current, ...rest] = segments
  if (!current) {
    node.assets.push(asset)
    return
  }
  const slug = slugify(current)
  const nextId = `${parentIdPrefix}-${slug}`
  let child = node.children.get(current)
  if (!child) {
    child = createDirectoryNode(nextId, current)
    node.children.set(current, child)
  }
  insertAsset(child, rest, asset, nextId)
}

function normalizePath(path: string): { category: PresetCategory; segments: string[] } | null {
  const normalized = path.replace(/^[.\\/]+/, '').split(/[\\/]/).filter(Boolean)
  const presetIndex = normalized.indexOf('preset')
  if (presetIndex === -1) {
    return null
  }
  const relative = normalized.slice(presetIndex + 1)
  const category = relative[0] as PresetCategory | undefined
  if (!category || !CATEGORY_DEFINITIONS.some((definition) => definition.key === category)) {
    return null
  }
  const segments = relative.slice(1)
  if (!segments.length) {
    return null
  }
  return { category, segments }
}

function buildPresetAsset(
  definition: CategoryDefinition,
  relativeSegments: string[],
  url: string,
): ProjectAsset {
  const fileName = relativeSegments[relativeSegments.length - 1] ?? 'asset'
  const name = formatDisplayName(fileName)
  const idPath = relativeSegments.join('/').toLowerCase()
  return {
    id: `preset:${definition.key}/${idPath}`,
    name,
    type: definition.assetType,
    downloadUrl: url,
    previewColor: definition.previewColor,
    thumbnail: definition.key === 'images' ? url : null,
    description: `${definition.label}/${relativeSegments.join('/')}`,
    gleaned: false,
  }
}

function sortDirectoryNode(node: DirectoryNode): void {
  node.assets.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const sortedChildren = Array.from(node.children.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
  node.children = new Map(sortedChildren)
  node.children.forEach((child) => sortDirectoryNode(child))
}

function nodeToProjectDirectory(node: DirectoryNode): ProjectDirectory | null {
  const children = Array.from(node.children.values())
    .map(nodeToProjectDirectory)
    .filter((entry): entry is ProjectDirectory => !!entry)
  const assets = node.assets
  if (!children.length && !assets.length) {
    return null
  }
  const directory: ProjectDirectory = {
    id: node.id,
    name: node.name,
  }
  if (children.length) {
    directory.children = children
  }
  if (assets.length) {
    directory.assets = assets.map((asset) => ({ ...asset }))
  }
  return directory
}

function buildPresetDirectories(): ProjectDirectory[] {
  const categoryNodes = CATEGORY_DEFINITIONS.reduce<Record<PresetCategory, DirectoryNode>>((acc, definition) => {
    acc[definition.key] = createDirectoryNode(`preset-${definition.key}`, definition.label)
    return acc
  }, {} as Record<PresetCategory, DirectoryNode>)

  Object.entries(presetModules).forEach(([path, url]) => {
    const normalized = normalizePath(path)
    if (!normalized) {
      return
    }
    const definition = CATEGORY_DEFINITIONS.find((item) => item.key === normalized.category)
    if (!definition) {
      return
    }
    const asset = buildPresetAsset(definition, normalized.segments, url)
    const directorySegments = normalized.segments.slice(0, -1)
    const targetNode = categoryNodes[normalized.category]
    insertAsset(targetNode, directorySegments, asset, targetNode.id)
  })

  const result: ProjectDirectory[] = []
  CATEGORY_DEFINITIONS.forEach((definition) => {
    const node = categoryNodes[definition.key]
    sortDirectoryNode(node)
    const directory = nodeToProjectDirectory(node)
    if (directory) {
      result.push(directory)
    }
  })

  return result
}

const PRESET_DIRECTORIES = buildPresetDirectories()

export const presetProvider: ResourceProvider = {
  id: 'preset',
  name: 'Preset',
  url: null,
  includeInPackages: true,
  load: async () => cloneDirectoryTree(PRESET_DIRECTORIES),
}
