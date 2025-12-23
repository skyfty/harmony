import * as THREE from 'three'
import type { AssetCacheEntry } from './assetCache'
import ResourceCache from './ResourceCache'
import type { SceneJsonExportDocument, SceneNode, GroundDynamicMesh } from '@harmony/schema'
import type { TerrainScatterInstance, TerrainScatterLayer, TerrainScatterStoreSnapshot } from './terrain-scatter'
import { clampLodComponentProps, type LodComponentProps } from './components'
import { loadNodeObject } from './modelAssetLoader'
import {
  allocateModelInstance,
  getCachedModelObject,
  getOrLoadModelObject,
  releaseModelInstance,
  updateModelInstanceMatrix,
  ensureInstancedMeshesRegistered,
  type ModelInstanceGroup,
} from './modelObjectCache'
import { createInstancedBvhFrustumCuller } from './instancedBvhFrustumCuller'

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
}

type GroundScatterEntry = {
  nodeId: string
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
        entries.push({ nodeId: node.id, snapshot })
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return entries
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

function decodeAssetEntryText(entry: AssetCacheEntry): string | null {
  if (entry.arrayBuffer && entry.arrayBuffer.byteLength) {
    try {
      if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder().decode(new Uint8Array(entry.arrayBuffer))
      }
      const buffer = (globalThis as any).Buffer as { from: (data: ArrayBuffer) => { toString: (enc: string) => string } } | undefined
      if (buffer) {
        return buffer.from(entry.arrayBuffer).toString('utf-8')
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
  const text = decodeAssetEntryText(entry)
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
      return object
    })
    return group
  } catch (error) {
    console.warn('[TerrainScatterLOD] Failed to prepare instanced model', assetId, error)
    return null
  }
}

export function createTerrainScatterLodRuntime(options: { lodUpdateIntervalMs?: number } = {}): TerrainScatterLodRuntime {
  const lodUpdateIntervalMs = Number.isFinite(options.lodUpdateIntervalMs) && (options.lodUpdateIntervalMs as number) > 0
    ? (options.lodUpdateIntervalMs as number)
    : 200

  let resourceCache: ResourceCache | null = null
  const allocatedNodeIds = new Set<string>()
  const runtimeInstances = new Map<string, ScatterRuntimeInstance>()

  const frustumCuller = createInstancedBvhFrustumCuller()

  const lodPresetCache = new Map<string, LodPresetData | null>()
  const pendingLodPresetLoads = new Map<string, Promise<void>>()

  let lastLodUpdateAt = 0
  let pendingUpdate: Promise<void> | null = null

  function dispose(): void {
    allocatedNodeIds.forEach((nodeId) => releaseModelInstance(nodeId))
    allocatedNodeIds.clear()
    runtimeInstances.clear()
    resourceCache = null
    lodPresetCache.clear()
    pendingLodPresetLoads.clear()
    pendingUpdate = null
    lastLodUpdateAt = 0
    frustumCuller.dispose()
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
          const binding = allocateModelInstance(bindingAssetId, nodeId)
          if (!binding) {
            continue
          }
          const matrix = composeScatterMatrix(instance, groundMesh, scatterMatrixHelper)
          updateModelInstanceMatrix(nodeId, matrix)
          allocatedNodeIds.add(nodeId)
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

  async function updateInternal(camera: THREE.Camera, resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null): Promise<void> {
    const cache = resourceCache
    if (!cache) {
      return
    }

    const cameraPosition = (camera as THREE.Camera & { position: THREE.Vector3 }).position
    if (!cameraPosition || typeof cameraPosition.distanceTo !== 'function') {
      return
    }

    camera.updateMatrixWorld(true)
    scatterCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    scatterCullingFrustum.setFromProjectionMatrix(scatterCullingProjView)

    const candidateIds: string[] = []
    runtimeInstances.forEach((runtime, nodeId) => {
      if (runtime.presetAssetId) {
        candidateIds.push(nodeId)
      }
    })
    candidateIds.sort()
    frustumCuller.setIds(candidateIds)

    const visibleIds = frustumCuller.updateAndQueryVisible(scatterCullingFrustum, (nodeId, centerTarget) => {
      const runtime = runtimeInstances.get(nodeId)
      if (!runtime) {
        return null
      }
      const groundMesh = resolveGroundMeshObject(runtime.groundNodeId)
      if (!groundMesh) {
        return null
      }
      const matrix = composeScatterMatrix(runtime.instance, groundMesh, scatterMatrixHelper)
      centerTarget.setFromMatrixPosition(matrix)

      const boundAssetId = runtime.boundAssetId
      const baseRadius = getCachedModelObject(boundAssetId)?.radius ?? 0.5
      const scale = runtime.instance.localScale
      const scaleFactor = Math.max(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
      const radius = baseRadius * (Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1)
      return { radius }
    })

    for (const runtime of runtimeInstances.values()) {
      const presetAssetId = runtime.presetAssetId
      if (!presetAssetId) {
        continue
      }

      const isVisible = visibleIds.has(runtime.nodeId)
      if (!isVisible) {
        releaseModelInstance(runtime.nodeId)
        allocatedNodeIds.delete(runtime.nodeId)
        continue
      }

      await ensureLodPresetCached(presetAssetId)
      const preset = lodPresetCache.get(presetAssetId) ?? null
      if (!preset) {
        continue
      }

      const groundMesh = resolveGroundMeshObject(runtime.groundNodeId)
      if (!groundMesh) {
        continue
      }

      const matrix = composeScatterMatrix(runtime.instance, groundMesh, scatterMatrixHelper)
      scatterWorldPositionHelper.setFromMatrixPosition(matrix)
      const distance = scatterWorldPositionHelper.distanceTo(cameraPosition)
      if (!Number.isFinite(distance)) {
        continue
      }

      const desiredAssetId = chooseLodModelAssetId(preset, distance) ?? resolveLodBindingAssetId(preset)
      if (!desiredAssetId) {
        continue
      }

      if (desiredAssetId !== runtime.boundAssetId) {
        const group = await ensureModelInstanceGroup(desiredAssetId, cache)
        if (!group || !group.meshes.length) {
          continue
        }
        ensureInstancedMeshesRegistered(desiredAssetId)
        releaseModelInstance(runtime.nodeId)
        const binding = allocateModelInstance(desiredAssetId, runtime.nodeId)
        if (!binding) {
          continue
        }
        runtime.boundAssetId = desiredAssetId
        allocatedNodeIds.add(runtime.nodeId)
      } else {
        const binding = allocateModelInstance(runtime.boundAssetId, runtime.nodeId)
        if (!binding) {
          // Ensure cached for re-entry after culling.
          await ensureModelInstanceGroup(runtime.boundAssetId, cache)
          continue
        }
        allocatedNodeIds.add(runtime.nodeId)
      }

      updateModelInstanceMatrix(runtime.nodeId, matrix)
    }
  }

  function update(camera: THREE.Camera, resolveGroundMeshObject: (nodeId: string) => THREE.Mesh | null): void {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
    if (pendingUpdate) {
      return
    }
    if (now - lastLodUpdateAt < lodUpdateIntervalMs) {
      return
    }
    lastLodUpdateAt = now
    pendingUpdate = updateInternal(camera, resolveGroundMeshObject)
      .catch((error) => {
        console.warn('[TerrainScatterLOD] Failed to update scatter LOD', error)
      })
      .finally(() => {
        pendingUpdate = null
      })
  }

  return {
    sync,
    update,
    dispose,
  }
}
