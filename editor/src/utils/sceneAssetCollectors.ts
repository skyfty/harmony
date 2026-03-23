import type { SceneNode } from '@schema'
import { clampSceneNodeInstanceLayout, resolveInstanceLayoutTemplateAssetId } from '@schema/instanceLayout'
import type { SceneMaterial } from '@/types/material'

const PREFAB_SOURCE_METADATA_KEY = '__prefabAssetId'
const ASSET_REFERENCE_SKIP_KEYS = new Set<string>([PREFAB_SOURCE_METADATA_KEY])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAssetReferenceKey(key: string | null | undefined): boolean {
  if (!key) {
    return false
  }
  const normalized = key.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return normalized.includes('assetid')
}

function normalizeAssetIdCandidate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  let candidate = value.trim()
  if (!candidate) {
    return null
  }
  const assetProtocol = 'asset://'
  if (candidate.startsWith(assetProtocol)) {
    candidate = candidate.slice(assetProtocol.length)
  }
  if (!candidate) {
    return null
  }
  if (candidate.startsWith('embedded://')) {
    return null
  }
  if (/^(?:https?:|data:|blob:)/i.test(candidate)) {
    return null
  }
  if (candidate.length > 256) {
    return null
  }
  return candidate
}

function collectAssetIdCandidate(bucket: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetIdCandidate(bucket, entry))
    return
  }
  const normalized = normalizeAssetIdCandidate(value)
  if (normalized) {
    bucket.add(normalized)
  }
}

function collectAssetIdsFromUnknown(value: unknown, bucket: Set<string>): void {
  if (!value) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetIdsFromUnknown(entry, bucket))
    return
  }
  if (!isPlainObject(value)) {
    return
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (ASSET_REFERENCE_SKIP_KEYS.has(key)) {
      return
    }
    if (isAssetReferenceKey(key)) {
      collectAssetIdCandidate(bucket, entry)
      return
    }
    collectAssetIdsFromUnknown(entry, bucket)
  })
}

export function collectRuntimeModelNodesByAssetId(
  nodes: SceneNode[] | null | undefined,
): Map<string, SceneNode[]> {
  const map = new Map<string, SceneNode[]>()
  if (!Array.isArray(nodes) || !nodes.length) {
    return map
  }

  const ensureNodeAssetId = (assetId: string, node: SceneNode): void => {
    const normalized = assetId.trim()
    if (!normalized) {
      return
    }
    if (!map.has(normalized)) {
      map.set(normalized, [])
    }
    map.get(normalized)!.push(node)
  }

  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }

    const rawLayout = (node as { instanceLayout?: unknown }).instanceLayout
    const layout = rawLayout
      ? clampSceneNodeInstanceLayout(rawLayout)
      : { mode: 'single' as const, templateAssetId: null }
    const runtimeAssetId = resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId ?? null)
    if (runtimeAssetId) {
      ensureNodeAssetId(runtimeAssetId, node)
    }

    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }

  return map
}

export function collectSceneNodeDependencyAssetIds(
  nodes: SceneNode[] | null | undefined,
  sharedMaterials: ReadonlyArray<SceneMaterial | ({ id: string } & Record<string, unknown>)> = [],
): Set<string> {
  const bucket = new Set<string>()
  if (!Array.isArray(nodes) || !nodes.length) {
    return bucket
  }

  const materialIds = new Set<string>()
  const stack: SceneNode[] = [...nodes]

  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }

    collectAssetIdCandidate(bucket, node.sourceAssetId)
    collectAssetIdCandidate(bucket, node.importMetadata?.assetId)

    const rawLayout = (node as { instanceLayout?: unknown }).instanceLayout
    if (rawLayout) {
      const layout = clampSceneNodeInstanceLayout(rawLayout)
      const templateAssetId = resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId)
      collectAssetIdCandidate(bucket, templateAssetId)
    }

    if (Array.isArray(node.materials) && node.materials.length) {
      node.materials.forEach((material) => {
        collectAssetIdsFromUnknown(material, bucket)
        const materialId = typeof material?.materialId === 'string' ? material.materialId.trim() : ''
        if (materialId) {
          materialIds.add(materialId)
        }
      })
    }

    if (node.components) {
      Object.values(node.components).forEach((component) => {
        if (component?.props) {
          collectAssetIdsFromUnknown(component.props, bucket)
        }
      })
    }

    if (node.dynamicMesh) {
      collectAssetIdsFromUnknown(node.dynamicMesh as unknown, bucket)
    }

    if (node.userData) {
      collectAssetIdsFromUnknown(node.userData, bucket)
    }

    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }

  if (materialIds.size && sharedMaterials.length) {
    const materialById = new Map<string, SceneMaterial | ({ id: string } & Record<string, unknown>)>()
    sharedMaterials.forEach((material) => {
      const materialId = typeof material?.id === 'string' ? material.id.trim() : ''
      if (materialId) {
        materialById.set(materialId, material)
      }
    })
    materialIds.forEach((materialId) => {
      const shared = materialById.get(materialId)
      if (shared) {
        collectAssetIdsFromUnknown(shared, bucket)
      }
    })
  }

  return bucket
}
