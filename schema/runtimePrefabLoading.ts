import type { SceneAssetRegistryEntry, RuntimePrefabInitializationMode, RuntimePrefabPlacementOptions, RuntimePrefabSpawnRequest, Vector3Like } from './core'
import { inferAssetTypeOrNull } from './assetTypeConversion'
import { parseRuntimePrefabData, type NodePrefabData } from './runtimePrefab'

export interface RuntimePrefabSource {
  prefab: NodePrefabData
  assetRegistry: Record<string, SceneAssetRegistryEntry> | null
}

export interface RuntimePrefabPreloadContext {
  assetRegistry: Record<string, SceneAssetRegistryEntry> | null
  meshAssetIds: string[]
  warmAssetIds: string[]
}

export interface ResolveRuntimePrefabSourceOptions {
  resolveText: (request: RuntimePrefabSpawnRequest) => Promise<string | null>
  cache?: Map<string, Promise<RuntimePrefabSource | null>>
  buildCacheKey?: (request: RuntimePrefabSpawnRequest) => string
  onError?: (requestKey: string, error: unknown) => void
}

export interface CollectRuntimePrefabPreloadContextOptions extends ResolveRuntimePrefabSourceOptions {}

function cloneVectorLikeValue(value: Vector3Like | null | undefined): Vector3Like | null {
  if (!value) {
    return null
  }
  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
    z: Number.isFinite(value.z) ? value.z : 0,
  }
}

export function normalizeAssetIdList(assetIds: Iterable<string>): string[] {
  const uniqueIds = new Set<string>()
  for (const assetId of assetIds) {
    if (typeof assetId !== 'string') {
      continue
    }
    const trimmed = assetId.trim()
    if (trimmed) {
      uniqueIds.add(trimmed)
    }
  }
  return Array.from(uniqueIds).sort()
}

export function collectRuntimePrefabAssetIds(assetRegistry: Record<string, SceneAssetRegistryEntry>): {
  meshAssetIds: string[]
  warmAssetIds: string[]
} {
  const meshAssetIds = new Set<string>()
  const warmAssetIds = new Set<string>()

  Object.entries(assetRegistry).forEach(([assetId, entry]) => {
    const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalizedAssetId) {
      return
    }
    warmAssetIds.add(normalizedAssetId)

    const assetType = entry?.assetType ?? inferAssetTypeOrNull({ nameOrUrl: normalizedAssetId })
    if (assetType === 'model' || assetType === 'mesh') {
      meshAssetIds.add(normalizedAssetId)
    }
  })

  return {
    meshAssetIds: normalizeAssetIdList(meshAssetIds),
    warmAssetIds: normalizeAssetIdList(warmAssetIds),
  }
}

export function buildRuntimePrefabRequestKey(request: RuntimePrefabSpawnRequest): string {
  const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : ''
  if (requestId.length) {
    return requestId
  }
  return JSON.stringify({
    assetId: request.assetId ?? null,
    assetUrl: request.assetUrl ?? null,
    targetNodeId: request.targetNodeId ?? null,
    targetNodeName: request.targetNodeName ?? null,
    position: request.position ?? null,
    rotation: request.rotation ?? null,
    scale: request.scale ?? null,
    initializationMode: request.initializationMode ?? 'full',
    placement: request.placement ?? null,
  })
}

function normalizeRuntimePrefabMode(value: unknown): RuntimePrefabInitializationMode {
  return value === 'render-only' ? 'render-only' : 'full'
}

function normalizeRuntimePrefabPlacement(value: unknown): RuntimePrefabPlacementOptions {
  const candidate = value && typeof value === 'object'
    ? value as Partial<RuntimePrefabPlacementOptions>
    : null
  const alignment = candidate?.alignment === 'bottom-to-anchor' || candidate?.alignment === 'center-to-anchor' || candidate?.alignment === 'place-on-surface' || candidate?.alignment === 'custom-offset'
    ? candidate.alignment
    : 'origin'
  return {
    alignment,
    offset: cloneVectorLikeValue(candidate?.offset),
  }
}

export function normalizeRuntimePrefabRequest(request: RuntimePrefabSpawnRequest | null | undefined): RuntimePrefabSpawnRequest | null {
  if (!request || typeof request !== 'object') {
    return null
  }
  const assetId = typeof request.assetId === 'string' ? request.assetId.trim() : ''
  const assetUrl = typeof request.assetUrl === 'string' ? request.assetUrl.trim() : ''
  const vehicleIdentifier = typeof request.vehicleIdentifier === 'string' ? request.vehicleIdentifier.trim() : ''
  const controllableIdentifier = typeof request.controllableIdentifier === 'string' ? request.controllableIdentifier.trim() : ''
  if (!assetId && !assetUrl) {
    return null
  }
  return {
    requestId: typeof request.requestId === 'string' ? request.requestId.trim() || null : null,
    vehicleIdentifier: vehicleIdentifier || null,
    controllableIdentifier: controllableIdentifier || null,
    controllableType: request.controllableType ?? null,
    assetId: assetId || null,
    assetUrl: assetUrl || null,
    targetNodeId: typeof request.targetNodeId === 'string' ? request.targetNodeId.trim() || null : null,
    targetNodeName: typeof request.targetNodeName === 'string' ? request.targetNodeName.trim() || null : null,
    position: request.position ?? null,
    rotation: request.rotation ?? null,
    scale: request.scale ?? null,
    initializationMode: normalizeRuntimePrefabMode(request.initializationMode),
    placement: normalizeRuntimePrefabPlacement(request.placement),
  }
}

function shouldPreloadRuntimePrefabRequest(request: RuntimePrefabSpawnRequest | null | undefined): boolean {
  return request?.preloadPolicy === 'before-entry'
}

export async function resolveRuntimePrefabSource(
  request: RuntimePrefabSpawnRequest,
  options: ResolveRuntimePrefabSourceOptions,
): Promise<RuntimePrefabSource | null> {
  const normalized = normalizeRuntimePrefabRequest(request)
  if (!normalized) {
    return null
  }

  const requestKey = options.buildCacheKey?.(normalized) ?? buildRuntimePrefabRequestKey(normalized)
  const cached = options.cache?.get(requestKey)
  if (cached) {
    return await cached
  }

  const task = (async () => {
    const raw = await options.resolveText(normalized)
    if (!raw) {
      return null
    }
    const prefab = parseRuntimePrefabData(raw)
    return {
      prefab,
      assetRegistry: prefab.assetRegistry
        ? JSON.parse(JSON.stringify(prefab.assetRegistry)) as Record<string, SceneAssetRegistryEntry>
        : null,
    }
  })().catch((error) => {
    options.onError?.(requestKey, error)
    return null
  })

  options.cache?.set(requestKey, task)
  return await task
}

export async function collectRuntimePrefabPreloadContext(
  requests: RuntimePrefabSpawnRequest[] | undefined,
  options: CollectRuntimePrefabPreloadContextOptions,
): Promise<RuntimePrefabPreloadContext | null> {
  if (!Array.isArray(requests) || !requests.length) {
    return null
  }

  const selectedRequests = requests.filter((request) => shouldPreloadRuntimePrefabRequest(request))
  if (!selectedRequests.length) {
    return null
  }

  const resolved = await Promise.all(selectedRequests.map((request) => resolveRuntimePrefabSource(request, options)))
  const mergedAssetRegistry: Record<string, SceneAssetRegistryEntry> = {}
  const meshAssetIds = new Set<string>()
  const warmAssetIds = new Set<string>()

  resolved.forEach((entry) => {
    if (!entry?.assetRegistry) {
      return
    }
    Object.assign(mergedAssetRegistry, entry.assetRegistry)
    const assetIds = collectRuntimePrefabAssetIds(entry.assetRegistry)
    assetIds.meshAssetIds.forEach((assetId) => meshAssetIds.add(assetId))
    assetIds.warmAssetIds.forEach((assetId) => warmAssetIds.add(assetId))
  })

  if (!Object.keys(mergedAssetRegistry).length && !meshAssetIds.size && !warmAssetIds.size) {
    return null
  }

  return {
    assetRegistry: Object.keys(mergedAssetRegistry).length ? mergedAssetRegistry : null,
    meshAssetIds: normalizeAssetIdList(meshAssetIds),
    warmAssetIds: normalizeAssetIdList(warmAssetIds),
  }
}
