import { AssetTypes } from '@harmony/schema/asset-types'

const typeLabelMap: Record<string, string> = {
  model: '模型',
  mesh: '网格',
  image: '图片',
  texture: '纹理',
  hdri: 'HDRI',
  material: '材质',
  prefab: 'Prefab',
  video: '视频',
  file: '文件',
}

const rootCategoryNames = ['资产库']

function normalizeSegment(segment: string): string {
  return segment.trim().toLowerCase()
}

const typeAliases = new Set<string>()
AssetTypes.forEach((type) => {
  const base = normalizeSegment(type)
  typeAliases.add(base)
  const label = typeLabelMap[type]
  if (label) {
    typeAliases.add(normalizeSegment(label))
  }
})

const rootAliases = new Set<string>(rootCategoryNames.map((name) => normalizeSegment(name)))

export function isAssetTypeName(name: string): boolean {
  return typeAliases.has(normalizeSegment(name))
}

export function isRootCategoryName(name: string): boolean {
  return rootAliases.has(normalizeSegment(name))
}

export function stripAssetTypeSegments(path: string[]): string[] {
  const segments = path.filter((segment) => segment && segment.trim().length)
  if (!segments.length) {
    return []
  }
  const withoutRoot = segments.filter((segment, index) => {
    if (index === 0 && isRootCategoryName(segment)) {
      return false
    }
    return true
  })
  const filtered = withoutRoot.filter((segment) => !isAssetTypeName(segment))
  if (filtered.length) {
    return filtered
  }
  if (withoutRoot.length) {
    return withoutRoot
  }
  return segments
}

export function buildCategoryPathString(path: string[]): string {
  const normalized = stripAssetTypeSegments(path)
  return (normalized.length ? normalized : path).join(' / ')
}
