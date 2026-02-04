import * as THREE from 'three'
import type { AssetCacheEntry } from './assetCache'
import ResourceCache from './ResourceCache'
import type { SceneJsonExportDocument, SceneNode, GroundDynamicMesh } from '@harmony/schema'
import type { TerrainScatterInstance, TerrainScatterLayer, TerrainScatterStoreSnapshot } from './terrain-scatter'
import { clampLodComponentProps, type LodComponentProps } from './components'
import { loadNodeObject } from './modelAssetLoader'
import { normalizeScatterMaterials } from './scatterMaterials'
import {
  allocateModelInstance,
  getCachedModelObject,
  getOrLoadModelObject,
  releaseModelInstance,
  updateModelInstanceMatrix,
  ensureInstancedMeshesRegistered,
  type ModelInstanceGroup,
} from './modelObjectCache'
import { resolveGroundChunkCells, resolveGroundChunkRadiusMeters } from './groundMesh'

export const LOD_PRESET_FORMAT_VERSION = 1

export interface LodPresetData {
  formatVersion: number
  id: string
  name: string
  props: LodComponentProps
}

export type TerrainScatterLodRuntime = {
  sync: (
    document: SceneJsonExportDocument,
    resourceCache: ResourceCache,
    resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null,
  ) => Promise<void>
  update: (camera: THREE.Camera, resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null) => void
  dispose: () => void
  getInstanceStats: () => { total: number; visible: number }
}

export type TerrainScatterLodRuntimeOptions = {
  // How often to run LOD switching (async asset work). Default: 200ms.
  lodUpdateIntervalMs?: number
  // How often to run frustum culling + matrix refresh. Default: equals lodUpdateIntervalMs (preserves legacy behavior).
  visibilityUpdateIntervalMs?: number
  // Spatial hysteresis: expand each instance culling sphere radius.
  cullRadiusMultiplier?: number
  // Temporal hysteresis: keep recently-visible instances allocated for a while after leaving the frustum.
  cullGraceMs?: number
  // Budget how many allocate/release operations can happen per visibility update.
  maxBindingChangesPerUpdate?: number
  // Optional chunk streaming to avoid iterating/allocating scatter across the entire ground.
  chunkStreaming?: {
    enabled?: boolean
    radiusMeters?: number
    unloadPaddingMeters?: number
    maxChunkChangesPerUpdate?: number
  }
}

type GroundScatterEntry = {
  nodeId: string
  definition: GroundDynamicMesh
  snapshot: TerrainScatterStoreSnapshot
}

type ScatterRuntimeInstance = {
  nodeId: string
  groundNodeId: string
  layerId: string | null
  instance: TerrainScatterInstance
  presetAssetId: string | null
  boundAssetId: string
}

const scatterLocalPositionHelper = new THREE.Vector3()
const scatterLocalRotationHelper = new THREE.Euler()
const scatterLocalScaleHelper = new THREE.Vector3()
const scatterQuaternionHelper = new THREE.Quaternion()
const scatterInstanceMatrixHelper = new THREE.Matrix4()
const scatterMatrixHelper = new THREE.Matrix4()
const scatterWorldPositionHelper = new THREE.Vector3()
const scatterCullingProjView = new THREE.Matrix4()
const scatterCullingFrustum = new THREE.Frustum()
const scatterCullingSphere = new THREE.Sphere()

function buildScatterNodeId(layerId: string | null | undefined, instanceId: string): string {
  const normalizedLayer = typeof layerId === 'string' && layerId.trim().length ? layerId.trim() : 'layer'
  return `scatter:${normalizedLayer}:${instanceId}`
}

function composeScatterMatrix(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Mesh,
  target?: THREE.Matrix4,
): THREE.Matrix4 {
  groundMesh.updateMatrixWorld(true)
  scatterLocalPositionHelper.set(
    instance.localPosition?.x ?? 0,
    instance.localPosition?.y ?? 0,
    instance.localPosition?.z ?? 0,
  )
  scatterLocalRotationHelper.set(
    instance.localRotation?.x ?? 0,
    instance.localRotation?.y ?? 0,
    instance.localRotation?.z ?? 0,
    'XYZ',
  )
  scatterQuaternionHelper.setFromEuler(scatterLocalRotationHelper)
  scatterLocalScaleHelper.set(instance.localScale?.x ?? 1, instance.localScale?.y ?? 1, instance.localScale?.z ?? 1)
  scatterInstanceMatrixHelper.compose(scatterLocalPositionHelper, scatterQuaternionHelper, scatterLocalScaleHelper)
  const output = target ?? new THREE.Matrix4()
  return output.copy(groundMesh.matrixWorld).multiply(scatterInstanceMatrixHelper)
}

function collectGroundScatterEntries(nodes: SceneNode[] | null | undefined): GroundScatterEntry[] {
  if (!Array.isArray(nodes) || !nodes.length) {
    return []
  }
  const stack: SceneNode[] = [...nodes]
  const entries: GroundScatterEntry[] = []
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.dynamicMesh?.type === 'Ground') {
      const definition = node.dynamicMesh as GroundDynamicMesh & {
        terrainScatter?: TerrainScatterStoreSnapshot | null
      }
      const snapshot = definition.terrainScatter
      if (snapshot && Array.isArray(snapshot.layers) && snapshot.layers.length) {
        entries.push({ nodeId: node.id, definition, snapshot })
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return entries
}

function clampFinite(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : fallback
}

function computeGroundChunkKeyFromLocal(definition: GroundDynamicMesh, chunkCells: number, localX: number, localZ: number): string {
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const normalizedColumn = (localX + halfWidth) / cellSize
  const normalizedRow = (localZ + halfDepth) / cellSize
  const column = THREE.MathUtils.clamp(Math.floor(normalizedColumn), 0, Math.max(0, definition.columns - 1))
  const row = THREE.MathUtils.clamp(Math.floor(normalizedRow), 0, Math.max(0, definition.rows - 1))
  const chunkRow = Math.floor(row / Math.max(1, chunkCells))
  const chunkColumn = Math.floor(column / Math.max(1, chunkCells))
  return `${chunkRow}:${chunkColumn}`
}

function computeChunkKeysInRadius(
  definition: GroundDynamicMesh,
  chunkCells: number,
  localX: number,
  localZ: number,
  radius: number,
): Set<string> {
  const effectiveRadius = clampFinite(radius, 0)
  if (!(effectiveRadius > 0)) {
    return new Set([computeGroundChunkKeyFromLocal(definition, chunkCells, localX, localZ)])
  }

  const chunkCellCount = Math.max(1, Math.round(chunkCells))
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1

  const minColumnUnclamped = Math.floor((localX - effectiveRadius + halfWidth) / cellSize)
  const maxColumnUnclamped = Math.ceil((localX + effectiveRadius + halfWidth) / cellSize)
  const minRowUnclamped = Math.floor((localZ - effectiveRadius + halfDepth) / cellSize)
  const maxRowUnclamped = Math.ceil((localZ + effectiveRadius + halfDepth) / cellSize)

  const minColumn = THREE.MathUtils.clamp(minColumnUnclamped, 0, Math.max(0, definition.columns - 1))
  const maxColumn = THREE.MathUtils.clamp(maxColumnUnclamped, 0, Math.max(0, definition.columns - 1))
  const minRow = THREE.MathUtils.clamp(minRowUnclamped, 0, Math.max(0, definition.rows - 1))
  const maxRow = THREE.MathUtils.clamp(maxRowUnclamped, 0, Math.max(0, definition.rows - 1))

  const minChunkColumn = Math.floor(minColumn / chunkCellCount)
  const maxChunkColumn = Math.floor(maxColumn / chunkCellCount)
  const minChunkRow = Math.floor(minRow / chunkCellCount)
  const maxChunkRow = Math.floor(maxRow / chunkCellCount)

  const keys = new Set<string>()
  for (let chunkRow = minChunkRow; chunkRow <= maxChunkRow; chunkRow += 1) {
    for (let chunkColumn = minChunkColumn; chunkColumn <= maxChunkColumn; chunkColumn += 1) {
      keys.add(`${chunkRow}:${chunkColumn}`)
    }
  }
  return keys
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getScatterLayerLodPresetId(layer: TerrainScatterLayer): string | null {
  const payload = isPlainRecord(layer?.params?.payload) ? (layer.params.payload as Record<string, unknown>) : null
  const fromPayload = normalizeText(payload?.lodPresetAssetId)
  if (fromPayload) {
    return fromPayload
  }
  const candidate = normalizeText(layer?.assetId) || normalizeText(layer?.profileId)
  if (candidate) {
    const lower = candidate.toLowerCase()
    if (lower.endsWith('.lod') || lower.endsWith('.prefab')) {
      return candidate
    }
  }
  return null
}

function safeParseLodPreset(raw: string): LodPresetData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const candidate = parsed as Partial<LodPresetData> & { props?: unknown; name?: unknown; formatVersion?: unknown }
  const formatVersion = Number.isFinite(candidate.formatVersion)
    ? Number(candidate.formatVersion)
    : LOD_PRESET_FORMAT_VERSION
  if (formatVersion !== LOD_PRESET_FORMAT_VERSION) {
    return null
  }
  const propsCandidate = candidate.props && typeof candidate.props === 'object'
    ? (candidate.props as Partial<LodComponentProps>)
    : null
  const name = normalizeText(typeof candidate.name === 'string' ? candidate.name : '') || 'LOD Preset'
  const props = clampLodComponentProps(propsCandidate)
  return {
    formatVersion: LOD_PRESET_FORMAT_VERSION,
    id: normalizeText(candidate.id) || '',
    name,
    props,
  }
}

async function decodeAssetEntryText(entry: AssetCacheEntry): Promise<string | null> {
  if (entry.blob) {
    try {
      if (typeof entry.blob.text === 'function') {
        return await entry.blob.text()
      }
      if (typeof entry.blob.arrayBuffer === 'function') {
        const buffer = await entry.blob.arrayBuffer()
        if (typeof TextDecoder !== 'undefined') {
          return new TextDecoder().decode(new Uint8Array(buffer))
        }
      }
    } catch {
      return null
    }
  }
  return null
}

async function loadLodPreset(resourceCache: ResourceCache, presetAssetId: string): Promise<LodPresetData | null> {
  const entry = await resourceCache.acquireAssetEntry(presetAssetId)
  if (!entry) {
    return null
  }
  const text = await decodeAssetEntryText(entry)
  if (!text) {
    return null
  }
  return safeParseLodPreset(text)
}

function resolveLodBindingAssetId(preset: LodPresetData | null): string | null {
  const levels = preset?.props?.levels
  if (!Array.isArray(levels) || levels.length === 0) {
    return null
  }
  for (const level of levels) {
    const id = normalizeText(level?.modelAssetId)
    if (id) {
      return id
    }
  }
  return null
}

function chooseLodModelAssetId(preset: LodPresetData, distance: number): string | null {
  const levels = Array.isArray(preset?.props?.levels) ? preset.props.levels : []
  if (!levels.length) {
    return null
  }
  let chosen: (typeof levels)[number] | undefined
  for (let i = levels.length - 1; i >= 0; i -= 1) {
    const candidate = levels[i]
    if (candidate && distance >= (candidate.distance ?? 0)) {
      chosen = candidate
      break
    }
  }
  const id = normalizeText(chosen?.modelAssetId)
  return id || null
}

async function ensureModelInstanceGroup(assetId: string, resourceCache: ResourceCache): Promise<ModelInstanceGroup | null> {
  if (!assetId) {
    return null
  }
  const cached = getCachedModelObject(assetId)
  if (cached) {
    return cached
  }
  try {
    const group = await getOrLoadModelObject(assetId, async () => {
      const object = await loadNodeObject(resourceCache, assetId, null)
      if (!object) {
        throw new Error('Instanced mesh loader returned empty object')
      }
      normalizeScatterMaterials(object)
      return object
    })
    return group
  } catch (error) {
    console.warn('[TerrainScatterLOD] Failed to prepare instanced model', assetId, error)
    return null
  }
}

export function createTerrainScatterLodRuntime(options: TerrainScatterLodRuntimeOptions = {}): TerrainScatterLodRuntime {
  const typedOptions = options as TerrainScatterLodRuntimeOptions

  const lodUpdateIntervalMs =
    Number.isFinite(typedOptions.lodUpdateIntervalMs) && (typedOptions.lodUpdateIntervalMs as number) > 0
      ? (typedOptions.lodUpdateIntervalMs as number)
      : 200

  const visibilityUpdateIntervalMs =
    Number.isFinite(typedOptions.visibilityUpdateIntervalMs) && (typedOptions.visibilityUpdateIntervalMs as number) >= 0
      ? (typedOptions.visibilityUpdateIntervalMs as number)
      : lodUpdateIntervalMs

  const cullRadiusMultiplier =
    Number.isFinite(typedOptions.cullRadiusMultiplier) && (typedOptions.cullRadiusMultiplier as number) > 0
      ? (typedOptions.cullRadiusMultiplier as number)
      : 1

  const cullGraceMs =
    Number.isFinite(typedOptions.cullGraceMs) && (typedOptions.cullGraceMs as number) > 0
      ? (typedOptions.cullGraceMs as number)
      : 0

  const maxBindingChangesPerUpdate =
    Number.isFinite(typedOptions.maxBindingChangesPerUpdate) && (typedOptions.maxBindingChangesPerUpdate as number) > 0
      ? (typedOptions.maxBindingChangesPerUpdate as number)
      : Number.POSITIVE_INFINITY

  const chunkStreamingOptions = typedOptions.chunkStreaming
  const chunkStreamingEnabled = Boolean(chunkStreamingOptions?.enabled)
  const chunkStreamingRadiusOverride = clampFinite(chunkStreamingOptions?.radiusMeters, Number.NaN)
  const chunkStreamingPaddingOverride = clampFinite(chunkStreamingOptions?.unloadPaddingMeters, Number.NaN)
  const maxChunkChangesPerUpdate =
    Number.isFinite(chunkStreamingOptions?.maxChunkChangesPerUpdate) && (chunkStreamingOptions?.maxChunkChangesPerUpdate as number) > 0
      ? Number(chunkStreamingOptions?.maxChunkChangesPerUpdate)
      : Number.POSITIVE_INFINITY

  let resourceCache: ResourceCache | null = null
  const allocatedNodeIds = new Set<string>()
  const visibleNodeIds = new Set<string>()
  const runtimeInstances = new Map<string, ScatterRuntimeInstance>()

  const runtimeInstancesByChunkKey = new Map<string, string[]>()
  const chunkKeysActive = new Set<string>()
  const chunkStreamingActiveNodeIds = new Set<string>()
  const chunkCellsByGroundNodeId = new Map<string, number>()
  const groundDefinitionByNodeId = new Map<string, GroundDynamicMesh>()

  const lastVisibleAt = new Map<string, number>()
  let lastFrustumVisibleIds: Set<string> = new Set<string>()

  const lodPresetCache = new Map<string, LodPresetData | null>()
  const pendingLodPresetLoads = new Map<string, Promise<void>>()

  let lastVisibilityUpdateAt = 0
  let lastLodUpdateAt = 0
  let pendingLodUpdate: Promise<void> | null = null

  function dispose(): void {
    allocatedNodeIds.forEach((nodeId) => releaseModelInstance(nodeId))
    allocatedNodeIds.clear()
    visibleNodeIds.clear()
    runtimeInstances.clear()
    runtimeInstancesByChunkKey.clear()
    chunkKeysActive.clear()
    chunkStreamingActiveNodeIds.clear()
    chunkCellsByGroundNodeId.clear()
    groundDefinitionByNodeId.clear()
    resourceCache = null
    lodPresetCache.clear()
    pendingLodPresetLoads.clear()
    pendingLodUpdate = null
    lastLodUpdateAt = 0
    lastVisibilityUpdateAt = 0
    lastVisibleAt.clear()
    lastFrustumVisibleIds = new Set<string>()
  }

  async function ensureLodPresetCached(presetAssetId: string): Promise<void> {
    const normalized = presetAssetId.trim()
    if (!normalized) {
      return
    }
    if (lodPresetCache.has(normalized)) {
      return
    }
    const existingPending = pendingLodPresetLoads.get(normalized)
    if (existingPending) {
      await existingPending
      return
    }
    const task = (async () => {
      try {
        if (!resourceCache) {
          lodPresetCache.set(normalized, null)
          return
        }
        const preset = await loadLodPreset(resourceCache, normalized)
        lodPresetCache.set(normalized, preset)
      } catch {
        lodPresetCache.set(normalized, null)
      }
    })().finally(() => {
      pendingLodPresetLoads.delete(normalized)
    })

    pendingLodPresetLoads.set(normalized, task)
    await task
  }

  async function sync(
    document: SceneJsonExportDocument,
    nextResourceCache: ResourceCache,
    resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null,
  ): Promise<void> {
    dispose()
    resourceCache = nextResourceCache

    const entries = collectGroundScatterEntries(document.nodes)
    if (!entries.length) {
      return
    }

    for (const entry of entries) {
      groundDefinitionByNodeId.set(entry.nodeId, entry.definition)
      const chunkCells = resolveGroundChunkCells(entry.definition)
      chunkCellsByGroundNodeId.set(entry.nodeId, chunkCells)

      const groundMesh = resolveGroundMeshObject(entry.nodeId)
      if (!groundMesh) {
        continue
      }

      for (const layer of entry.snapshot.layers ?? []) {
        const layerAssetId = normalizeText(layer?.assetId)
        const profileAssetId = normalizeText(layer?.profileId)
        const selectionId = layerAssetId || profileAssetId
        if (!selectionId) {
          continue
        }

        const presetAssetId = getScatterLayerLodPresetId(layer)
        if (presetAssetId) {
          await ensureLodPresetCached(presetAssetId)
        }

        const preset = presetAssetId ? (lodPresetCache.get(presetAssetId) ?? null) : null
        const presetBinding = resolveLodBindingAssetId(preset)
        const bindingAssetId = presetBinding || selectionId
        if (!bindingAssetId) {
          continue
        }

        const group = await ensureModelInstanceGroup(bindingAssetId, nextResourceCache)
        if (!group || !group.meshes.length) {
          continue
        }
        ensureInstancedMeshesRegistered(bindingAssetId)

        const instances = Array.isArray(layer.instances) ? (layer.instances as TerrainScatterInstance[]) : []
        for (const instance of instances) {
          const nodeId = buildScatterNodeId(layer?.id ?? null, instance.id)

          if (!chunkStreamingEnabled) {
            const binding = allocateModelInstance(bindingAssetId, nodeId)
            if (!binding) {
              continue
            }
            const matrix = composeScatterMatrix(instance, groundMesh, scatterMatrixHelper)
            updateModelInstanceMatrix(nodeId, matrix)
            allocatedNodeIds.add(nodeId)
            visibleNodeIds.add(nodeId)
          } else {
            const local = instance.localPosition
            const chunkKey = computeGroundChunkKeyFromLocal(entry.definition, chunkCells, local?.x ?? 0, local?.z ?? 0)
            const compositeKey = `${entry.nodeId}|${chunkKey}`
            const bucket = runtimeInstancesByChunkKey.get(compositeKey)
            if (bucket) {
              bucket.push(nodeId)
            } else {
              runtimeInstancesByChunkKey.set(compositeKey, [nodeId])
            }
          }

          runtimeInstances.set(nodeId, {
            nodeId,
            groundNodeId: entry.nodeId,
            layerId: layer?.id ?? null,
            instance,
            presetAssetId: preset ? presetAssetId : null,
            boundAssetId: bindingAssetId,
          })
        }
      }
    }
  }

  function updateChunkStreamingActiveWindow(camera: THREE.Camera, resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null): void {
    if (!chunkStreamingEnabled) {
      return
    }
    const cameraPosition = (camera as THREE.Camera & { position?: THREE.Vector3 }).position
    if (!cameraPosition) {
      return
    }

    const nextActiveChunkKeys = new Set<string>()
    const nextActiveNodeIds = new Set<string>()

    for (const [groundNodeId, definition] of groundDefinitionByNodeId.entries()) {
      const groundMesh = resolveGroundMeshObject(groundNodeId)
      if (!groundMesh) {
        continue
      }
      const chunkCells = chunkCellsByGroundNodeId.get(groundNodeId) ?? resolveGroundChunkCells(definition)
      const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
      const chunkWorldSize = Math.max(1, Math.round(chunkCells)) * cellSize

      const radius = Number.isFinite(chunkStreamingRadiusOverride)
        ? Math.max(0, chunkStreamingRadiusOverride)
        : resolveGroundChunkRadiusMeters(definition)
      const padding = Number.isFinite(chunkStreamingPaddingOverride)
        ? Math.max(0, chunkStreamingPaddingOverride)
        : chunkWorldSize

      groundMesh.updateMatrixWorld(true)
      const inv = scatterInstanceMatrixHelper.copy(groundMesh.matrixWorld).invert()
      scatterWorldPositionHelper.copy(cameraPosition).applyMatrix4(inv)
      const localX = scatterWorldPositionHelper.x
      const localZ = scatterWorldPositionHelper.z

      const desired = computeChunkKeysInRadius(definition, chunkCells, localX, localZ, radius)
      const retain = computeChunkKeysInRadius(definition, chunkCells, localX, localZ, radius + padding)

      desired.forEach((chunkKey) => {
        const compositeKey = `${groundNodeId}|${chunkKey}`
        nextActiveChunkKeys.add(compositeKey)
      })

      retain.forEach((chunkKey) => {
        const compositeKey = `${groundNodeId}|${chunkKey}`
        // retain doesn't automatically activate, but it prevents unload.
        // We'll merge retain later by keeping existing active keys if inside retain.
        if (chunkKeysActive.has(compositeKey)) {
          nextActiveChunkKeys.add(compositeKey)
        }
      })

      // Collect active nodeIds for the next chunk key set.
      // (We do this after finalizing nextActiveChunkKeys to avoid iterating buckets multiple times.)
      // Note: nodeIds will be filled after we compute the full set across grounds.
    }

    // Diff and apply chunk activation changes with a per-update budget.
    let chunkChanges = 0

    // Unload chunks leaving the retain window.
    for (const compositeKey of Array.from(chunkKeysActive.values())) {
      if (nextActiveChunkKeys.has(compositeKey)) {
        continue
      }
      if (chunkChanges >= maxChunkChangesPerUpdate) {
        break
      }
      chunkChanges += 1
      chunkKeysActive.delete(compositeKey)
      const nodeIds = runtimeInstancesByChunkKey.get(compositeKey) ?? []
      for (const nodeId of nodeIds) {
        if (allocatedNodeIds.has(nodeId)) {
          releaseModelInstance(nodeId)
          allocatedNodeIds.delete(nodeId)
          visibleNodeIds.delete(nodeId)
        }
        chunkStreamingActiveNodeIds.delete(nodeId)
        lastVisibleAt.delete(nodeId)
      }
    }

    // Activate desired chunks.
    for (const compositeKey of Array.from(nextActiveChunkKeys.values())) {
      if (chunkKeysActive.has(compositeKey)) {
        continue
      }
      if (chunkChanges >= maxChunkChangesPerUpdate) {
        break
      }
      chunkChanges += 1
      chunkKeysActive.add(compositeKey)
      const nodeIds = runtimeInstancesByChunkKey.get(compositeKey) ?? []
      for (const nodeId of nodeIds) {
        chunkStreamingActiveNodeIds.add(nodeId)
      }
    }

    // Refresh active node id set from currently active chunks.
    // This avoids leaving stale nodeIds around if an earlier budget-limited diff skipped some unloads.
    // (Costs: O(activeNodes) rather than O(totalNodes)).
    for (const compositeKey of chunkKeysActive.values()) {
      const nodeIds = runtimeInstancesByChunkKey.get(compositeKey) ?? []
      for (const nodeId of nodeIds) {
        nextActiveNodeIds.add(nodeId)
      }
    }
    chunkStreamingActiveNodeIds.clear()
    nextActiveNodeIds.forEach((nodeId) => chunkStreamingActiveNodeIds.add(nodeId))
  }

  function computeVisibleScatterIds(
    camera: THREE.Camera,
    resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null,
  ): Set<string> {
    camera.updateMatrixWorld(true)
    scatterCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    scatterCullingFrustum.setFromProjectionMatrix(scatterCullingProjView)
    const visibleIds = new Set<string>()

    const iterateIds = chunkStreamingEnabled ? Array.from(chunkStreamingActiveNodeIds.values()) : null
    if (iterateIds) {
      for (const nodeId of iterateIds) {
        const runtime = runtimeInstances.get(nodeId)
        if (!runtime) {
          continue
        }
        const groundMesh = resolveGroundMeshObject(runtime.groundNodeId)
        if (!groundMesh) {
          continue
        }

        const matrix = composeScatterMatrix(runtime.instance, groundMesh, scatterMatrixHelper)
        scatterWorldPositionHelper.setFromMatrixPosition(matrix)

        const boundAssetId = runtime.boundAssetId
        const baseRadius = getCachedModelObject(boundAssetId)?.radius ?? 0.5
        const scale = runtime.instance.localScale
        const scaleFactor = Math.max(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
        const radius =
          baseRadius * (Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1) * cullRadiusMultiplier

        scatterCullingSphere.center.copy(scatterWorldPositionHelper)
        scatterCullingSphere.radius = radius

        if (scatterCullingFrustum.intersectsSphere(scatterCullingSphere)) {
          visibleIds.add(nodeId)
        }
      }
      return visibleIds
    }

    runtimeInstances.forEach((runtime, nodeId) => {
      const groundMesh = resolveGroundMeshObject(runtime.groundNodeId)
      if (!groundMesh) {
        return
      }

      const matrix = composeScatterMatrix(runtime.instance, groundMesh, scatterMatrixHelper)
      scatterWorldPositionHelper.setFromMatrixPosition(matrix)

      const boundAssetId = runtime.boundAssetId
      const baseRadius = getCachedModelObject(boundAssetId)?.radius ?? 0.5
      const scale = runtime.instance.localScale
      const scaleFactor = Math.max(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
      const radius =
        baseRadius * (Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1) * cullRadiusMultiplier

      scatterCullingSphere.center.copy(scatterWorldPositionHelper)
      scatterCullingSphere.radius = radius

      if (scatterCullingFrustum.intersectsSphere(scatterCullingSphere)) {
        visibleIds.add(nodeId)
      }
    })

    return visibleIds
  }

  function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
  }

  function applyCullingAndUpdateVisibleMatrices(
    visibleIds: Set<string>,
    resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null,
  ): void {
    const now = nowMs()

    // Update last-seen timestamps for frustum-visible instances.
    visibleIds.forEach((nodeId) => {
      lastVisibleAt.set(nodeId, now)
    })
    lastFrustumVisibleIds = visibleIds

    // Release instances that were visible but are now culled.
    let bindingChanges = 0

    for (const nodeId of Array.from(visibleNodeIds.values())) {
      if (visibleIds.has(nodeId)) {
        continue
      }

      const lastSeen = lastVisibleAt.get(nodeId) ?? 0
      if (cullGraceMs > 0 && now - lastSeen < cullGraceMs) {
        continue
      }

      if (bindingChanges >= maxBindingChangesPerUpdate) {
        continue
      }

      releaseModelInstance(nodeId)
      bindingChanges += 1
      allocatedNodeIds.delete(nodeId)
      visibleNodeIds.delete(nodeId)
    }

    // Allocate (if needed) and update matrices for currently visible instances.
    visibleIds.forEach((nodeId) => {
      const runtime = runtimeInstances.get(nodeId)
      if (!runtime) {
        return
      }

      // If this is a newly visible instance, ensure it is allocated.
      if (!visibleNodeIds.has(nodeId)) {
        if (bindingChanges >= maxBindingChangesPerUpdate) {
          return
        }
        const binding = allocateModelInstance(runtime.boundAssetId, runtime.nodeId)
        if (!binding) {
          return
        }
        bindingChanges += 1
        allocatedNodeIds.add(runtime.nodeId)
        visibleNodeIds.add(runtime.nodeId)
      }

      const groundMesh = resolveGroundMeshObject(runtime.groundNodeId)
      if (!groundMesh) {
        return
      }

      const matrix = composeScatterMatrix(runtime.instance, groundMesh, scatterMatrixHelper)
      updateModelInstanceMatrix(runtime.nodeId, matrix)
    })
  }

  async function updateInternalLod(camera: THREE.Camera, resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null): Promise<void> {
    const cache = resourceCache
    if (!cache) {
      return
    }

    const cameraPosition = (camera as THREE.Camera & { position: THREE.Vector3 }).position
    if (!cameraPosition || typeof cameraPosition.distanceTo !== 'function') {
      return
    }

    const allocatedSnapshot = Array.from(allocatedNodeIds.values())
    for (const nodeId of allocatedSnapshot) {
      const runtime = runtimeInstances.get(nodeId)
      if (!runtime) {
        continue
      }
      // Frustum culling is applied each frame in `update()`. Here we only handle LOD switching,
      // and must not resurrect instances that have been culled since the last visibility update.
      if (!allocatedNodeIds.has(runtime.nodeId)) {
        continue
      }

      // Avoid LOD churn for grace-kept instances that are currently outside the frustum.
      if (!lastFrustumVisibleIds.has(runtime.nodeId)) {
        continue
      }

      const groundMesh = resolveGroundMeshObject(runtime.groundNodeId)
      if (!groundMesh) {
        continue
      }

      const matrix = composeScatterMatrix(runtime.instance, groundMesh, scatterMatrixHelper)

      const presetAssetId = runtime.presetAssetId
      if (presetAssetId) {
        await ensureLodPresetCached(presetAssetId)
        const preset = lodPresetCache.get(presetAssetId) ?? null
        if (preset) {
          scatterWorldPositionHelper.setFromMatrixPosition(matrix)
          const distance = scatterWorldPositionHelper.distanceTo(cameraPosition)
          if (Number.isFinite(distance)) {
            const desiredAssetId = chooseLodModelAssetId(preset, distance) ?? resolveLodBindingAssetId(preset)
            if (desiredAssetId && desiredAssetId !== runtime.boundAssetId) {
              const group = await ensureModelInstanceGroup(desiredAssetId, cache)
              if (group && group.meshes.length) {
                ensureInstancedMeshesRegistered(desiredAssetId)
                if (allocatedNodeIds.has(runtime.nodeId)) {
                  releaseModelInstance(runtime.nodeId)
                  const binding = allocateModelInstance(desiredAssetId, runtime.nodeId)
                  if (binding) {
                    runtime.boundAssetId = desiredAssetId
                    allocatedNodeIds.add(runtime.nodeId)
                  }
                }
              }
            }
          }
        }
      }

      const binding = allocateModelInstance(runtime.boundAssetId, runtime.nodeId)
      if (!binding) {
        // Ensure cached for re-entry after culling.
        await ensureModelInstanceGroup(runtime.boundAssetId, cache)
        continue
      }
      allocatedNodeIds.add(runtime.nodeId)
      updateModelInstanceMatrix(runtime.nodeId, matrix)
    }
  }

  function update(camera: THREE.Camera, resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null): void {
    const now = nowMs()

    // Fast path: update frustum culling + visible matrices (sync) at its own cadence.
    if (now - lastVisibilityUpdateAt >= visibilityUpdateIntervalMs) {
      lastVisibilityUpdateAt = now
      updateChunkStreamingActiveWindow(camera, resolveGroundMeshObject)
      const visibleIds = computeVisibleScatterIds(camera, resolveGroundMeshObject)
      applyCullingAndUpdateVisibleMatrices(visibleIds, resolveGroundMeshObject)
    }

    // Slow path: LOD switching (async) at its own cadence.
    if (pendingLodUpdate) {
      return
    }
    if (now - lastLodUpdateAt < lodUpdateIntervalMs) {
      return
    }
    lastLodUpdateAt = now
    pendingLodUpdate = updateInternalLod(camera, resolveGroundMeshObject)
      .catch((error) => {
        console.warn('[TerrainScatterLOD] Failed to update scatter LOD', error)
      })
      .finally(() => {
        pendingLodUpdate = null
      })
  }

  function getInstanceStats(): { total: number; visible: number } {
    return {
      total: runtimeInstances.size,
      visible: visibleNodeIds.size,
    }
  }

  return {
    sync,
    update,
    dispose,
    getInstanceStats,
  }
}
