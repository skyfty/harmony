import * as THREE from 'three'
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three'
import { addMesh as markInstancedBoundsDirty } from './instancedBoundsTracker'
import ResourceCache from './ResourceCache'

const BILLBOARD_BASE_POSITION_ATTRIBUTE = 'billboardBasePosition'
const DEFAULT_INSTANCE_CAPACITY = 2048

export interface BillboardInstanceCacheConfig {
  defaultInstanceCapacity: number
  capacityGrowthFactor: number
  maxInstanceCapacity: number
  alphaCutoff: number
}

export interface BillboardInstanceGroup {
  assetId: string
  mesh: InstancedMesh
  aspectRatio: number
  texture: Texture
}

export interface BillboardInstanceBinding {
  assetId: string
  nodeId: string
  bindingId: string
  slot: { mesh: InstancedMesh; handleId: string; index: number }
}

type BillboardShaderMaterial = ShaderMaterial & {
  uniforms: {
    map: { value: Texture | null }
    cameraWorldPosition: { value: Vector3 }
    alphaCutoff: { value: number }
  }
}

interface BillboardHandle extends BillboardInstanceGroup {
  id: string
  material: BillboardShaderMaterial
  capacity: number
  nextIndex: number
  freeSlots: number[]
  bindingByIndex: Map<number, string>
}

const billboardCacheConfig: BillboardInstanceCacheConfig = {
  defaultInstanceCapacity: DEFAULT_INSTANCE_CAPACITY,
  capacityGrowthFactor: 2,
  maxInstanceCapacity: 65536,
  alphaCutoff: 0.2,
}

const billboardHandleByAssetId = new Map<string, BillboardHandle>()
const billboardPendingLoads = new Map<string, Promise<BillboardHandle | null>>()
const billboardBindingsById = new Map<string, BillboardInstanceBinding>()
const billboardBindingIdsByNodeId = new Map<string, Set<string>>()
const billboardNodeIdByBindingId = new Map<string, string>()
const billboardHandleLookup = new Map<string, BillboardHandle>()
const billboardMeshListeners = new Set<(mesh: InstancedMesh, assetId: string) => void>()

const resizeMatrix = new Matrix4()
const sharedCameraWorldPosition = new Vector3(0, 0, 1)

export function configureBillboardInstanceCache(config: Partial<BillboardInstanceCacheConfig>): void {
  if (config.defaultInstanceCapacity !== undefined) {
    const value = config.defaultInstanceCapacity
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`defaultInstanceCapacity must be a positive integer, got ${value}`)
    }
    billboardCacheConfig.defaultInstanceCapacity = value
  }
  if (config.capacityGrowthFactor !== undefined) {
    const value = config.capacityGrowthFactor
    if (!Number.isFinite(value) || value <= 1) {
      throw new Error(`capacityGrowthFactor must be a number > 1, got ${value}`)
    }
    billboardCacheConfig.capacityGrowthFactor = value
  }
  if (config.maxInstanceCapacity !== undefined) {
    const value = config.maxInstanceCapacity
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`maxInstanceCapacity must be a positive integer, got ${value}`)
    }
    billboardCacheConfig.maxInstanceCapacity = value
  }
  if (config.alphaCutoff !== undefined) {
    const value = config.alphaCutoff
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`alphaCutoff must be between 0 and 1, got ${value}`)
    }
    billboardCacheConfig.alphaCutoff = value
  }
}

export function getBillboardInstanceCacheConfig(): BillboardInstanceCacheConfig {
  return { ...billboardCacheConfig }
}

export function getCachedBillboardInstanceGroup(assetId: string): BillboardInstanceGroup | null {
  const handle = billboardHandleByAssetId.get(assetId)
  return handle ? mapHandleToGroup(handle) : null
}

export async function ensureBillboardInstanceGroup(
  assetId: string,
  resourceCache: ResourceCache,
): Promise<BillboardInstanceGroup | null> {
  return getOrLoadBillboardInstanceGroup(assetId, async () => {
    const entry = await resourceCache.acquireAssetEntry(assetId)
    return entry?.blobUrl ?? entry?.downloadUrl ?? null
  })
}

export async function getOrLoadBillboardInstanceGroup(
  assetId: string,
  resolveUrl: () => Promise<string | null>,
): Promise<BillboardInstanceGroup | null> {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalized) {
    return null
  }

  const cached = billboardHandleByAssetId.get(normalized)
  if (cached) {
    return mapHandleToGroup(cached)
  }

  const pending = billboardPendingLoads.get(normalized)
  if (pending) {
    const handle = await pending
    return handle ? mapHandleToGroup(handle) : null
  }

  const task = loadBillboardHandle(normalized, resolveUrl)
    .then((handle) => {
      if (handle) {
        billboardHandleByAssetId.set(normalized, handle)
      }
      billboardPendingLoads.delete(normalized)
      return handle
    })
    .catch((error) => {
      billboardPendingLoads.delete(normalized)
      console.warn('[BillboardInstanceCache] Failed to load billboard texture', normalized, error)
      return null
    })

  billboardPendingLoads.set(normalized, task)
  const handle = await task
  return handle ? mapHandleToGroup(handle) : null
}

export function allocateBillboardInstance(assetId: string, nodeId: string): BillboardInstanceBinding | null {
  return allocateBillboardInstanceBinding(assetId, nodeId, nodeId)
}

export function allocateBillboardInstanceBinding(
  assetId: string,
  bindingId: string,
  nodeId: string,
): BillboardInstanceBinding | null {
  if (!assetId || !bindingId || !nodeId) {
    return null
  }

  const existing = billboardBindingsById.get(bindingId)
  if (existing) {
    if (existing.assetId === assetId && existing.nodeId === nodeId) {
      return existing
    }
    releaseBillboardInstanceBinding(bindingId)
  }

  const handle = billboardHandleByAssetId.get(assetId)
  if (!handle) {
    return null
  }

  let index = handle.freeSlots.pop()
  if (index === undefined) {
    if (handle.nextIndex >= handle.capacity) {
      const expanded = expandBillboardHandleCapacity(handle, handle.nextIndex + 1)
      if (!expanded) {
        console.warn(
          `Billboard instanced mesh capacity reached for asset ${assetId} (capacity=${handle.capacity}, max=${billboardCacheConfig.maxInstanceCapacity})`,
        )
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

  const binding: BillboardInstanceBinding = {
    assetId,
    nodeId,
    bindingId,
    slot: { mesh: handle.mesh, handleId: handle.id, index },
  }
  billboardBindingsById.set(bindingId, binding)
  billboardNodeIdByBindingId.set(bindingId, nodeId)
  const nodeBindings = billboardBindingIdsByNodeId.get(nodeId) ?? new Set<string>()
  nodeBindings.add(bindingId)
  billboardBindingIdsByNodeId.set(nodeId, nodeBindings)
  return binding
}

export function releaseBillboardInstance(nodeId: string): void {
  const bucket = billboardBindingIdsByNodeId.get(nodeId)
  if (!bucket || bucket.size === 0) {
    return
  }
  Array.from(bucket.values()).forEach((bindingId) => {
    releaseBillboardInstanceBinding(bindingId)
  })
}

export function releaseBillboardInstanceBinding(bindingId: string): void {
  const binding = billboardBindingsById.get(bindingId)
  if (!binding) {
    return
  }

  billboardBindingsById.delete(bindingId)
  billboardNodeIdByBindingId.delete(bindingId)

  const nodeBucket = billboardBindingIdsByNodeId.get(binding.nodeId)
  if (nodeBucket) {
    nodeBucket.delete(bindingId)
    if (nodeBucket.size === 0) {
      billboardBindingIdsByNodeId.delete(binding.nodeId)
    }
  }

  const { handleId, index } = binding.slot
  const handle = billboardHandleLookup.get(handleId)
  if (!handle) {
    return
  }

  const lastVisibleIndex = handle.mesh.count - 1
  handle.bindingByIndex.delete(index)
  let freedSlot = index

  if (lastVisibleIndex >= 0 && index !== lastVisibleIndex) {
    const movingBindingId = handle.bindingByIndex.get(lastVisibleIndex)
    if (movingBindingId) {
      handle.mesh.getMatrixAt(lastVisibleIndex, resizeMatrix)
      handle.mesh.setMatrixAt(index, resizeMatrix)
      handle.mesh.instanceMatrix.needsUpdate = true
      markInstancedBoundsDirty(handle.mesh)

      handle.bindingByIndex.set(index, movingBindingId)
      handle.bindingByIndex.delete(lastVisibleIndex)

      const movingBinding = billboardBindingsById.get(movingBindingId)
      if (movingBinding) {
        movingBinding.slot.index = index
      }

      freedSlot = lastVisibleIndex
    }
  }

  handle.freeSlots.push(freedSlot)
  shrinkBillboardMeshCount(handle)
}

export function updateBillboardInstanceMatrix(nodeId: string, matrix: Matrix4): void {
  const binding = billboardBindingsById.get(nodeId)
  if (!binding) {
    return
  }
  const { mesh, index } = binding.slot
  mesh.setMatrixAt(index, matrix)
  mesh.instanceMatrix.needsUpdate = true
  markInstancedBoundsDirty(mesh)
}

export function updateBillboardInstanceBindingMatrix(bindingId: string, matrix: Matrix4): void {
  const binding = billboardBindingsById.get(bindingId)
  if (!binding) {
    return
  }
  const { mesh, index } = binding.slot
  mesh.setMatrixAt(index, matrix)
  mesh.instanceMatrix.needsUpdate = true
  markInstancedBoundsDirty(mesh)
}

export function getBillboardInstanceBindingById(bindingId: string): BillboardInstanceBinding | null {
  return billboardBindingsById.get(bindingId) ?? null
}

export function getBillboardInstanceBindingsForNode(nodeId: string): BillboardInstanceBinding[] {
  const bucket = billboardBindingIdsByNodeId.get(nodeId)
  if (!bucket || bucket.size === 0) {
    return []
  }
  const result: BillboardInstanceBinding[] = []
  bucket.forEach((bindingId) => {
    const binding = billboardBindingsById.get(bindingId)
    if (binding) {
      result.push(binding)
    }
  })
  return result
}

export function subscribeBillboardInstancedMeshes(listener: (mesh: InstancedMesh, assetId: string) => void): () => void {
  billboardMeshListeners.add(listener)
  billboardHandleByAssetId.forEach((handle, assetId) => {
    listener(handle.mesh, assetId)
  })
  return () => {
    billboardMeshListeners.delete(listener)
  }
}

export function ensureBillboardInstancedMeshesRegistered(assetId: string): void {
  const handle = billboardHandleByAssetId.get(assetId)
  if (!handle) {
    return
  }
  billboardMeshListeners.forEach((listener) => listener(handle.mesh, assetId))
}

export function updateBillboardInstanceCameraWorldPosition(position: THREE.Vector3 | { x: number; y: number; z: number }): void {
  sharedCameraWorldPosition.set(position.x, position.y, position.z)
  billboardHandleByAssetId.forEach((handle) => {
    handle.material.uniforms.cameraWorldPosition.value.copy(sharedCameraWorldPosition)
  })
}

export function getBillboardAspectRatio(assetId: string): number | null {
  const handle = billboardHandleByAssetId.get(assetId)
  return handle ? handle.aspectRatio : null
}

export function findNodeIdForBillboardInstance(mesh: InstancedMesh, instanceIndex: number): string | null {
  const handle = billboardHandleLookup.get(mesh.userData?.billboardInstancingHandleId as string)
  if (!handle) {
    return null
  }
  const bindingId = handle.bindingByIndex.get(instanceIndex) ?? null
  if (!bindingId) {
    return null
  }
  return billboardNodeIdByBindingId.get(bindingId) ?? null
}

export function invalidateBillboardInstanceGroup(assetId: string): void {
  const handle = billboardHandleByAssetId.get(assetId)
  if (!handle) {
    return
  }

  Array.from(billboardBindingsById.values())
    .filter((binding) => binding.assetId === assetId)
    .forEach((binding) => {
      releaseBillboardInstanceBinding(binding.bindingId)
    })

  billboardHandleLookup.delete(handle.id)
  handle.material.dispose()
  handle.texture.dispose()
  handle.mesh.geometry.dispose()
  handle.mesh.dispose()
  billboardHandleByAssetId.delete(assetId)
  billboardPendingLoads.delete(assetId)
}

export function clearBillboardInstanceCache(): void {
  billboardHandleByAssetId.forEach((handle) => {
    handle.material.dispose()
    handle.texture.dispose()
    handle.mesh.geometry.dispose()
    handle.mesh.dispose()
  })
  billboardHandleByAssetId.clear()
  billboardPendingLoads.clear()
  billboardBindingsById.clear()
  billboardBindingIdsByNodeId.clear()
  billboardNodeIdByBindingId.clear()
  billboardHandleLookup.clear()
}

async function loadBillboardHandle(assetId: string, resolveUrl: () => Promise<string | null>): Promise<BillboardHandle | null> {
  const url = await resolveUrl()
  if (!url) {
    return null
  }

  const textureLoader = new THREE.TextureLoader()
  const texture = await textureLoader.loadAsync(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping

  const image = texture.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | undefined
  const width = image?.naturalWidth ?? image?.width ?? 1
  const height = image?.naturalHeight ?? image?.height ?? 1
  const aspectRatio = width > 0 && height > 0 ? width / height : 1

  const material = createBillboardShaderMaterial(texture)
  const mesh = new InstancedMesh(createBillboardGeometry(), material, billboardCacheConfig.defaultInstanceCapacity)
  mesh.name = `InstancedBillboard:${assetId}`
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count = 0
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.frustumCulled = true

  const handleId = `${assetId}:${mesh.uuid}`
  mesh.userData.assetId = assetId
  mesh.userData.billboardInstancingHandleId = handleId
  mesh.userData.instancingKind = 'billboard'
  material.uniforms.cameraWorldPosition.value.copy(sharedCameraWorldPosition)

  const handle: BillboardHandle = {
    assetId,
    id: handleId,
    mesh,
    texture,
    material,
    aspectRatio,
    capacity: billboardCacheConfig.defaultInstanceCapacity,
    nextIndex: 0,
    freeSlots: [],
    bindingByIndex: new Map(),
  }
  billboardHandleLookup.set(handleId, handle)
  billboardMeshListeners.forEach((listener) => listener(mesh, assetId))
  return handle
}

function mapHandleToGroup(handle: BillboardHandle): BillboardInstanceGroup {
  return {
    assetId: handle.assetId,
    mesh: handle.mesh,
    aspectRatio: handle.aspectRatio,
    texture: handle.texture,
  }
}

function createBillboardGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1, 1, 1)
  geometry.translate(0, 0.5, 0)
  const positionAttribute = geometry.getAttribute('position')
  geometry.setAttribute(
    BILLBOARD_BASE_POSITION_ATTRIBUTE,
    new THREE.Float32BufferAttribute(Array.from(positionAttribute.array as ArrayLike<number>), 3),
  )
  return geometry
}

function createBillboardShaderMaterial(texture: Texture): BillboardShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'HarmonyInstancedBillboardMaterial',
    uniforms: {
      map: { value: texture },
      cameraWorldPosition: { value: sharedCameraWorldPosition.clone() },
      alphaCutoff: { value: billboardCacheConfig.alphaCutoff },
    },
    vertexShader: `
      attribute vec3 billboardBasePosition;
      uniform vec3 cameraWorldPosition;
      varying vec2 vUv;

      void main() {
        mat4 worldMatrix = modelMatrix * instanceMatrix;
        vec3 objectCenter = vec3(worldMatrix[3].x, worldMatrix[3].y, worldMatrix[3].z);
        vec3 toCamera = cameraWorldPosition - objectCenter;
        toCamera.y = 0.0;

        float facingLengthSq = dot(toCamera, toCamera);
        vec3 forward = facingLengthSq > 1e-6 ? normalize(toCamera) : vec3(0.0, 0.0, 1.0);
        vec3 right = normalize(vec3(forward.z, 0.0, -forward.x));
        vec3 up = vec3(0.0, 1.0, 0.0);

        float scaleX = length(worldMatrix[0].xyz);
        float scaleY = length(worldMatrix[1].xyz);
        float scaleZ = length(worldMatrix[2].xyz);
        vec3 scaledLocal = vec3(
          billboardBasePosition.x * scaleX,
          billboardBasePosition.y * scaleY,
          billboardBasePosition.z * scaleZ
        );

        vec3 worldPosition = objectCenter
          + right * scaledLocal.x
          + up * scaledLocal.y
          + forward * scaledLocal.z;

        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float alphaCutoff;
      varying vec2 vUv;

      void main() {
        vec4 color = texture2D(map, vUv);
        if (color.a <= alphaCutoff) {
          discard;
        }
        gl_FragColor = color;
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
  }) as BillboardShaderMaterial
}

function expandBillboardHandleCapacity(handle: BillboardHandle, minCapacity: number): boolean {
  if (handle.capacity >= minCapacity) {
    return true
  }
  const expandedCapacity = computeExpandedInstanceCapacity(handle.capacity, minCapacity)
  if (expandedCapacity <= 0) {
    return false
  }
  resizeBillboardInstancedMesh(handle.mesh, expandedCapacity)
  handle.capacity = expandedCapacity
  return true
}

function computeExpandedInstanceCapacity(current: number, minRequired: number): number {
  const maxCapacity = billboardCacheConfig.maxInstanceCapacity
  if (minRequired > maxCapacity) {
    return 0
  }

  let next = Math.max(1, current)
  while (next < minRequired && next < maxCapacity) {
    next = Math.min(maxCapacity, Math.ceil(next * billboardCacheConfig.capacityGrowthFactor))
    if (next === maxCapacity) {
      break
    }
  }
  return next >= minRequired ? next : 0
}

function resizeBillboardInstancedMesh(mesh: InstancedMesh, capacity: number): void {
  const oldMatrixAttr = mesh.instanceMatrix
  const oldMatrixArray = oldMatrixAttr.array as Float32Array
  const newMatrixArray = new Float32Array(capacity * 16)
  newMatrixArray.set(oldMatrixArray.subarray(0, Math.min(oldMatrixArray.length, newMatrixArray.length)))

  const newMatrixAttr = new InstancedBufferAttribute(newMatrixArray, 16)
  newMatrixAttr.setUsage(oldMatrixAttr.usage)
  mesh.instanceMatrix = newMatrixAttr
  mesh.geometry.setAttribute('instanceMatrix', newMatrixAttr)
  mesh.instanceMatrix.needsUpdate = true
}

function shrinkBillboardMeshCount(handle: BillboardHandle): void {
  let nextCount = handle.mesh.count
  while (nextCount > 0 && !handle.bindingByIndex.has(nextCount - 1)) {
    nextCount -= 1
  }
  if (nextCount !== handle.mesh.count) {
    handle.mesh.count = nextCount
    markInstancedBoundsDirty(handle.mesh)
  }
}