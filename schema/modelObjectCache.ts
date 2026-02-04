import {
  Box3,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { addMesh as markInstancedBoundsDirty } from './instancedBoundsTracker'

const DEFAULT_INSTANCE_CAPACITY = 2048

export interface ModelObjectCacheConfig {
  defaultInstanceCapacity: number
  capacityGrowthFactor: number
  maxInstanceCapacity: number
}

const modelObjectCacheConfig: ModelObjectCacheConfig = {
  defaultInstanceCapacity: DEFAULT_INSTANCE_CAPACITY,
  capacityGrowthFactor: 2,
  maxInstanceCapacity: 65536,
}

export function configureModelObjectCache(config: Partial<ModelObjectCacheConfig>): void {
  if (config.defaultInstanceCapacity !== undefined) {
    const value = config.defaultInstanceCapacity
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`defaultInstanceCapacity must be a positive integer, got ${value}`)
    }
    modelObjectCacheConfig.defaultInstanceCapacity = value
  }

  if (config.capacityGrowthFactor !== undefined) {
    const value = config.capacityGrowthFactor
    if (!Number.isFinite(value) || value <= 1) {
      throw new Error(`capacityGrowthFactor must be a number > 1, got ${value}`)
    }
    modelObjectCacheConfig.capacityGrowthFactor = value
  }

  if (config.maxInstanceCapacity !== undefined) {
    const value = config.maxInstanceCapacity
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`maxInstanceCapacity must be a positive integer, got ${value}`)
    }
    modelObjectCacheConfig.maxInstanceCapacity = value
  }

  if (modelObjectCacheConfig.maxInstanceCapacity < modelObjectCacheConfig.defaultInstanceCapacity) {
    throw new Error(
      `maxInstanceCapacity (${modelObjectCacheConfig.maxInstanceCapacity}) must be >= defaultInstanceCapacity (${modelObjectCacheConfig.defaultInstanceCapacity})`,
    )
  }
}

export function getModelObjectCacheConfig(): ModelObjectCacheConfig {
  return { ...modelObjectCacheConfig }
}

export interface ModelInstanceGroup {
  assetId: string
  object: Object3D
  boundingBox: Box3
  radius: number
  meshes: InstancedMesh[]
}

export interface ModelInstanceBinding {
  assetId: string
  nodeId: string
  bindingId: string
  slots: Array<{ mesh: InstancedMesh; handleId: string; index: number }>
}

type LoaderFn = () => Promise<Object3D>

type MeshMaterial = Material | Material[]

interface ParsedSubmesh {
  key: string
  geometry: BufferGeometry
  material: MeshMaterial
}

interface InstancedMeshHandle {
  id: string
  mesh: InstancedMesh
  capacity: number
  nextIndex: number
  freeSlots: number[]
  bindingByIndex: Map<number, string>
}

interface ModelAssetEntry extends ModelInstanceGroup {
  handles: InstancedMeshHandle[]
}

const modelObjectCache = new Map<string, ModelAssetEntry>()
const pendingLoads = new Map<string, Promise<ModelAssetEntry>>()
const bindingsById = new Map<string, ModelInstanceBinding>()
const bindingIdsByNodeId = new Map<string, Set<string>>()
const nodeIdByBindingId = new Map<string, string>()
const meshHandleLookup = new Map<string, InstancedMeshHandle>()
const instancedMeshListeners = new Set<(mesh: InstancedMesh, assetId: string) => void>()

const tempMatrix = new Matrix4()
const tempInstanceMatrix = new Matrix4()

export function getCachedModelObject(assetId: string): ModelInstanceGroup | null {
  const cached = modelObjectCache.get(assetId)
  return cached ? mapEntryToGroup(cached) : null
}

export function getOrLoadModelObject(assetId: string, loader: LoaderFn): Promise<ModelInstanceGroup> {
  const cached = modelObjectCache.get(assetId)
  if (cached) {
    return Promise.resolve(mapEntryToGroup(cached))
  }

  const pending = pendingLoads.get(assetId)
  if (pending) {
    return pending.then(mapEntryToGroup)
  }

  const promise = loader()
    .then((object) => {
      const entry = buildModelAssetEntry(assetId, object)
      modelObjectCache.set(assetId, entry)
      pendingLoads.delete(assetId)
      return entry
    })
    .catch((error) => {
      pendingLoads.delete(assetId)
      throw error
    })

  pendingLoads.set(assetId, promise)
  return promise.then(mapEntryToGroup)
}

export function allocateModelInstance(assetId: string, nodeId: string): ModelInstanceBinding | null {
  return allocateModelInstanceBinding(assetId, nodeId, nodeId)
}

export function allocateModelInstanceBinding(assetId: string, bindingId: string, nodeId: string): ModelInstanceBinding | null {
  if (!bindingId || !nodeId) {
    return null
  }

  const existing = bindingsById.get(bindingId)
  if (existing) {
    if (existing.assetId === assetId && existing.nodeId === nodeId) {
      return existing
    }
    releaseModelInstanceBinding(bindingId)
  }

  const entry = modelObjectCache.get(assetId)
  if (!entry || !entry.handles.length) {
    return null
  }

  const slots: ModelInstanceBinding['slots'] = []

  for (const handle of entry.handles) {
    let index = handle.freeSlots.pop()
    if (index === undefined) {
      if (handle.nextIndex >= handle.capacity) {
        const expanded = expandInstancedMeshHandleCapacity(handle, handle.nextIndex + 1)
        if (!expanded) {
          console.warn(
            `Instanced mesh capacity reached for asset ${assetId} (capacity=${handle.capacity}, max=${modelObjectCacheConfig.maxInstanceCapacity})`,
          )
          slots.forEach(({ handleId, index: allocatedIndex }) => {
            const allocatedHandle = meshHandleLookup.get(handleId)
            if (!allocatedHandle) {
              return
            }
            allocatedHandle.bindingByIndex.delete(allocatedIndex)
            allocatedHandle.freeSlots.push(allocatedIndex)
            if (allocatedIndex === allocatedHandle.mesh.count - 1) {
              let nextCount = allocatedHandle.mesh.count - 1
              while (nextCount > 0 && !allocatedHandle.bindingByIndex.has(nextCount - 1)) {
                nextCount -= 1
              }
              if (allocatedHandle.mesh.count !== nextCount) {
                allocatedHandle.mesh.count = nextCount
                markInstancedBoundsDirty(allocatedHandle.mesh)
              }
            }
          })
          return null
        }
      }
      index = handle.nextIndex
      handle.nextIndex += 1
    }
    handle.bindingByIndex.set(index, bindingId)
    const previousCount = handle.mesh.count
    handle.mesh.count = Math.max(handle.mesh.count, index + 1)
    if (handle.mesh.count !== previousCount) {
      markInstancedBoundsDirty(handle.mesh)
    }
    slots.push({ mesh: handle.mesh, handleId: handle.id, index })
  }

  const binding: ModelInstanceBinding = { assetId, nodeId, bindingId, slots }
  bindingsById.set(bindingId, binding)
  nodeIdByBindingId.set(bindingId, nodeId)
  const bucket = bindingIdsByNodeId.get(nodeId) ?? new Set<string>()
  bucket.add(bindingId)
  bindingIdsByNodeId.set(nodeId, bucket)
  return binding
}

export function getModelInstanceBindingsForNode(nodeId: string): ModelInstanceBinding[] {
  const bucket = bindingIdsByNodeId.get(nodeId)
  if (!bucket || bucket.size === 0) {
    return []
  }
  const result: ModelInstanceBinding[] = []
  bucket.forEach((bindingId) => {
    const binding = bindingsById.get(bindingId)
    if (binding) {
      result.push(binding)
    }
  })
  return result
}

export function releaseModelInstance(nodeId: string): void {
  releaseModelInstancesForNode(nodeId)
}

export function releaseModelInstancesForNode(nodeId: string): void {
  const bucket = bindingIdsByNodeId.get(nodeId)
  if (!bucket || bucket.size === 0) {
    return
  }
  Array.from(bucket.values()).forEach((bindingId) => {
    releaseModelInstanceBinding(bindingId)
  })
}

export function releaseModelInstanceBinding(bindingId: string): void {
  const binding = bindingsById.get(bindingId)
  if (!binding) {
    return
  }
  bindingsById.delete(bindingId)
  nodeIdByBindingId.delete(bindingId)

  const nodeBucket = bindingIdsByNodeId.get(binding.nodeId)
  if (nodeBucket) {
    nodeBucket.delete(bindingId)
    if (nodeBucket.size === 0) {
      bindingIdsByNodeId.delete(binding.nodeId)
    }
  }

  binding.slots.forEach(({ handleId, index }) => {
    const handle = meshHandleLookup.get(handleId)
    if (!handle) {
      return
    }
    const lastVisibleIndex = handle.mesh.count - 1
    handle.bindingByIndex.delete(index)

    let freedSlot = index

    if (lastVisibleIndex >= 0 && index !== lastVisibleIndex) {
      const movingBindingId = handle.bindingByIndex.get(lastVisibleIndex)
      if (movingBindingId) {
        handle.mesh.getMatrixAt(lastVisibleIndex, tempInstanceMatrix)
        handle.mesh.setMatrixAt(index, tempInstanceMatrix)
        handle.mesh.instanceMatrix.needsUpdate = true
        markInstancedBoundsDirty(handle.mesh)

        handle.bindingByIndex.set(index, movingBindingId)
        handle.bindingByIndex.delete(lastVisibleIndex)

        const movingBinding = bindingsById.get(movingBindingId)
        if (movingBinding) {
          const slot = movingBinding.slots.find(
            (entry) => entry.handleId === handleId && entry.index === lastVisibleIndex,
          )
          if (slot) {
            slot.index = index
          }
        }

        freedSlot = lastVisibleIndex
      }
    }

    handle.freeSlots.push(freedSlot)
    shrinkInstancedMeshCount(handle)
  })
}

export function getModelInstanceBinding(nodeId: string): ModelInstanceBinding | null {
  return bindingsById.get(nodeId) ?? null
}

export function updateModelInstanceMatrix(nodeId: string, matrix: Matrix4): void {
  const binding = bindingsById.get(nodeId)
  if (!binding) {
    return
  }
  binding.slots.forEach(({ mesh, index }) => {
    mesh.setMatrixAt(index, matrix)
    mesh.instanceMatrix.needsUpdate = true
    markInstancedBoundsDirty(mesh)
  })
}

export function updateModelInstanceBindingMatrix(bindingId: string, matrix: Matrix4): void {
  const binding = bindingsById.get(bindingId)
  if (!binding) {
    return
  }
  binding.slots.forEach(({ mesh, index }) => {
    mesh.setMatrixAt(index, matrix)
    mesh.instanceMatrix.needsUpdate = true
    markInstancedBoundsDirty(mesh)
  })
}

export function getInstancedMeshes(): InstancedMesh[] {
  return Array.from(meshHandleLookup.values()).map((handle) => handle.mesh)
}

export function subscribeInstancedMeshes(listener: (mesh: InstancedMesh, assetId: string) => void): () => void {
  instancedMeshListeners.add(listener)
  modelObjectCache.forEach((entry) => {
    entry.handles.forEach((handle) => listener(handle.mesh, entry.assetId))
  })
  return () => {
    instancedMeshListeners.delete(listener)
  }
}

export function ensureInstancedMeshesRegistered(assetId: string): void {
  const entry = modelObjectCache.get(assetId)
  if (!entry) {
    return
  }
  entry.handles.forEach((handle) => {
    instancedMeshListeners.forEach((listener) => listener(handle.mesh, assetId))
  })
}

export function findNodeIdForInstance(mesh: InstancedMesh, instanceIndex: number): string | null {
  const handle = meshHandleLookup.get(mesh.userData?.instancingHandleId as string)
  if (!handle) {
    return null
  }
  const bindingId = handle.bindingByIndex.get(instanceIndex) ?? null
  if (!bindingId) {
    return null
  }
  return nodeIdByBindingId.get(bindingId) ?? null
}

export function findBindingIdForInstance(mesh: InstancedMesh, instanceIndex: number): string | null {
  const handle = meshHandleLookup.get(mesh.userData?.instancingHandleId as string)
  if (!handle) {
    return null
  }
  return handle.bindingByIndex.get(instanceIndex) ?? null
}

export function getModelInstanceBindingById(bindingId: string): ModelInstanceBinding | null {
  return bindingsById.get(bindingId) ?? null
}

export function invalidateModelObject(assetId: string): void {
  const entry = modelObjectCache.get(assetId)
  if (!entry) {
    return
  }

  entry.handles.forEach((handle) => {
    meshHandleLookup.delete(handle.id)
    handle.mesh.dispose()
  })

  modelObjectCache.delete(assetId)
  pendingLoads.delete(assetId)

  Array.from(bindingsById.values())
    .filter((binding) => binding.assetId === assetId)
    .forEach((binding) => {
      releaseModelInstanceBinding(binding.bindingId)
    })
}

export function clearModelObjectCache(): void {
  modelObjectCache.forEach((entry) => {
    entry.handles.forEach((handle) => {
      handle.mesh.dispose()
    })
  })
  modelObjectCache.clear()
  pendingLoads.clear()
  bindingsById.clear()
  bindingIdsByNodeId.clear()
  nodeIdByBindingId.clear()
  meshHandleLookup.clear()
}

function mapEntryToGroup(entry: ModelAssetEntry): ModelInstanceGroup {
  return {
    assetId: entry.assetId,
    object: entry.object,
    boundingBox: entry.boundingBox.clone(),
    radius: entry.radius,
    meshes: entry.handles.map((handle) => handle.mesh),
  }
}

function buildModelAssetEntry(assetId: string, prepared: Object3D): ModelAssetEntry {
  prepared.updateMatrixWorld(true)
  const boundingBox = new Box3().setFromObject(prepared)
  const radius = boundingBox.getSize(new Vector3()).length() * 0.5
  const submeshes = extractSubmeshes(prepared)

  const initialCapacity = modelObjectCacheConfig.defaultInstanceCapacity

  const handles = submeshes.map((submesh, index) => {
    const mesh = new InstancedMesh(submesh.geometry, submesh.material, initialCapacity)
    mesh.name = `Instanced:${assetId}:${index}`
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.count = 0
    mesh.castShadow = true
    mesh.receiveShadow = true
    const handleId = `${assetId}:${index}:${mesh.uuid}`
    mesh.userData.assetId = assetId
    mesh.userData.instancingHandleId = handleId

    const handle: InstancedMeshHandle = {
      id: handleId,
      mesh,
      capacity: initialCapacity,
      nextIndex: 0,
      freeSlots: [],
      bindingByIndex: new Map(),
    }
    meshHandleLookup.set(handle.id, handle)
    instancedMeshListeners.forEach((listener) => listener(mesh, assetId))
    return handle
  })

  return {
    assetId,
    object: prepared,
    boundingBox,
    radius,
    handles,
    meshes: handles.map((handle) => handle.mesh),
  }
}

function expandInstancedMeshHandleCapacity(handle: InstancedMeshHandle, minCapacity: number): boolean {
  if (handle.capacity >= minCapacity) {
    return true
  }

  const expandedCapacity = computeExpandedInstanceCapacity(handle.capacity, minCapacity)
  if (expandedCapacity <= 0) {
    return false
  }

  resizeInstancedMesh(handle.mesh, expandedCapacity)
  handle.capacity = expandedCapacity
  return true
}

function computeExpandedInstanceCapacity(current: number, minRequired: number): number {
  const maxCapacity = modelObjectCacheConfig.maxInstanceCapacity
  if (minRequired > maxCapacity) {
    return 0
  }

  let next = Math.max(1, current)
  const growthFactor = modelObjectCacheConfig.capacityGrowthFactor
  while (next < minRequired && next < maxCapacity) {
    next = Math.min(maxCapacity, Math.ceil(next * growthFactor))
    if (next === maxCapacity) {
      break
    }
  }

  return next >= minRequired ? next : 0
}

function resizeInstancedMesh(mesh: InstancedMesh, capacity: number): void {
  const oldMatrixAttr = mesh.instanceMatrix
  const oldMatrixArray = oldMatrixAttr.array as Float32Array
  const newMatrixArray = new Float32Array(capacity * 16)
  newMatrixArray.set(oldMatrixArray.subarray(0, Math.min(oldMatrixArray.length, newMatrixArray.length)))

  const newMatrixAttr = new InstancedBufferAttribute(newMatrixArray, 16)
  newMatrixAttr.setUsage(oldMatrixAttr.usage)
  mesh.instanceMatrix = newMatrixAttr
  mesh.geometry.setAttribute('instanceMatrix', newMatrixAttr)
  mesh.instanceMatrix.needsUpdate = true

  if (mesh.instanceColor) {
    const oldColorAttr = mesh.instanceColor
    const oldColorArray = oldColorAttr.array as Float32Array
    const newColorArray = new Float32Array(capacity * 3)
    newColorArray.set(oldColorArray.subarray(0, Math.min(oldColorArray.length, newColorArray.length)))
    const newColorAttr = new InstancedBufferAttribute(newColorArray, 3)
    newColorAttr.setUsage(oldColorAttr.usage)
    mesh.instanceColor = newColorAttr
    mesh.geometry.setAttribute('instanceColor', newColorAttr)
    mesh.instanceColor.needsUpdate = true
  }
}

function extractSubmeshes(root: Object3D): ParsedSubmesh[] {
  const mergeBuckets = new Map<string, BufferGeometry[]>()
  const materials = new Map<string, Material>()
  const submeshes: ParsedSubmesh[] = []

  const rootInverse = new Matrix4().copy(root.matrixWorld).invert()

  root.traverse((child: Object3D) => {
    const mesh = child as Mesh
    if (!(mesh as any)?.isMesh) {
      return
    }
    if (!mesh.geometry) {
      return
    }

    const localGeometry = mesh.geometry.clone()
    const relativeMatrix = tempMatrix.copy(mesh.matrixWorld).premultiply(rootInverse)
    localGeometry.applyMatrix4(relativeMatrix)
    localGeometry.computeBoundingBox()
    localGeometry.computeBoundingSphere()

    const material = mesh.material
    const isMergeable = !Array.isArray(material)
    if (isMergeable) {
      const resolvedMaterial = material as Material
      const key = resolvedMaterial.uuid
      if (!mergeBuckets.has(key)) {
        mergeBuckets.set(key, [])
        materials.set(key, resolvedMaterial.clone())
      }
      mergeBuckets.get(key)!.push(localGeometry)
      return
    }

    const clonedMaterials = material
      .map((entry) => (entry?.clone ? entry.clone() : entry))
      .filter((entry): entry is Material => Boolean(entry))
    if (!clonedMaterials.length) {
      return
    }
    submeshes.push({
      key: `${mesh.uuid}`,
      geometry: localGeometry,
      material: clonedMaterials,
    })
  })

  mergeBuckets.forEach((geometries, key) => {
    const merged = geometries.length > 1 ? mergeGeometries(geometries, false) : geometries[0]
    if (!merged) {
      return
    }
    const material = materials.get(key)
    if (!material) {
      return
    }
    submeshes.push({
      key,
      geometry: merged,
      material,
    })
  })

  return submeshes
}

function shrinkInstancedMeshCount(handle: InstancedMeshHandle): void {
  let nextCount = handle.mesh.count
  while (nextCount > 0 && !handle.bindingByIndex.has(nextCount - 1)) {
    nextCount -= 1
  }
  if (nextCount !== handle.mesh.count) {
    handle.mesh.count = nextCount
    markInstancedBoundsDirty(handle.mesh)
  }
}
