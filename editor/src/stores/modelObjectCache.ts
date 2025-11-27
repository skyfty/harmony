import {
  Box3,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const DEFAULT_INSTANCE_CAPACITY = 2048

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
  nodeByIndex: Map<number, string>
}

interface ModelAssetEntry extends ModelInstanceGroup {
  handles: InstancedMeshHandle[]
}

const modelObjectCache = new Map<string, ModelAssetEntry>()
const pendingLoads = new Map<string, Promise<ModelAssetEntry>>()
const nodeBindings = new Map<string, ModelInstanceBinding>()
const meshHandleLookup = new Map<string, InstancedMeshHandle>()
const instancedMeshListeners = new Set<(mesh: InstancedMesh, assetId: string) => void>()

const tempMatrix = new Matrix4()

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
  const entry = modelObjectCache.get(assetId)
  if (!entry || !entry.handles.length) {
    return null
  }

  const slots: ModelInstanceBinding['slots'] = []

  for (const handle of entry.handles) {
    let index = handle.freeSlots.pop()
    if (index === undefined) {
      if (handle.nextIndex >= handle.capacity) {
        console.warn(`Instanced mesh capacity reached for asset ${assetId}`)
        slots.forEach(({ handleId, index: allocatedIndex }) => {
          const allocatedHandle = meshHandleLookup.get(handleId)
          if (!allocatedHandle) {
            return
          }
          allocatedHandle.nodeByIndex.delete(allocatedIndex)
          allocatedHandle.freeSlots.push(allocatedIndex)
          if (allocatedIndex === allocatedHandle.mesh.count - 1) {
            let nextCount = allocatedHandle.mesh.count - 1
            while (nextCount > 0 && !allocatedHandle.nodeByIndex.has(nextCount - 1)) {
              nextCount -= 1
            }
            allocatedHandle.mesh.count = nextCount
          }
        })
        return null
      }
      index = handle.nextIndex
      handle.nextIndex += 1
    }
    handle.nodeByIndex.set(index, nodeId)
    handle.mesh.count = Math.max(handle.mesh.count, index + 1)
    slots.push({ mesh: handle.mesh, handleId: handle.id, index })
  }

  const binding: ModelInstanceBinding = { assetId, nodeId, slots }
  nodeBindings.set(nodeId, binding)
  return binding
}

export function releaseModelInstance(nodeId: string): void {
  const binding = nodeBindings.get(nodeId)
  if (!binding) {
    return
  }
  nodeBindings.delete(nodeId)

  binding.slots.forEach(({ handleId, index }) => {
    const handle = meshHandleLookup.get(handleId)
    if (!handle) {
      return
    }
    handle.nodeByIndex.delete(index)
    handle.freeSlots.push(index)
    if (index === handle.mesh.count - 1) {
      // shrink visible count when releasing from the end
      let nextCount = handle.mesh.count - 1
      while (nextCount > 0 && !handle.nodeByIndex.has(nextCount - 1)) {
        nextCount -= 1
      }
      handle.mesh.count = nextCount
    }
  })
}

export function getModelInstanceBinding(nodeId: string): ModelInstanceBinding | null {
  return nodeBindings.get(nodeId) ?? null
}

export function updateModelInstanceMatrix(nodeId: string, matrix: Matrix4): void {
  const binding = nodeBindings.get(nodeId)
  if (!binding) {
    return
  }
  binding.slots.forEach(({ mesh, index }) => {
    mesh.setMatrixAt(index, matrix)
    mesh.instanceMatrix.needsUpdate = true
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
  return handle.nodeByIndex.get(instanceIndex) ?? null
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

  Array.from(nodeBindings.values())
    .filter((binding) => binding.assetId === assetId)
    .forEach((binding) => {
      nodeBindings.delete(binding.nodeId)
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
  nodeBindings.clear()
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

function buildModelAssetEntry(assetId: string, object: Object3D): ModelAssetEntry {
  const prepared = object.clone(true)
  prepared.updateMatrixWorld(true)
  const boundingBox = new Box3().setFromObject(prepared)
  const radius = boundingBox.getSize(new Vector3()).length() * 0.5
  const submeshes = extractSubmeshes(prepared)

  const handles = submeshes.map((submesh, index) => {
    const mesh = new InstancedMesh(submesh.geometry, submesh.material, DEFAULT_INSTANCE_CAPACITY)
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
      capacity: DEFAULT_INSTANCE_CAPACITY,
      nextIndex: 0,
      freeSlots: [],
      nodeByIndex: new Map(),
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

function extractSubmeshes(root: Object3D): ParsedSubmesh[] {
  const mergeBuckets = new Map<string, BufferGeometry[]>()
  const materials = new Map<string, Material>()
  const submeshes: ParsedSubmesh[] = []

  const rootInverse = new Matrix4().copy(root.matrixWorld).invert()

  root.traverse((child) => {
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
