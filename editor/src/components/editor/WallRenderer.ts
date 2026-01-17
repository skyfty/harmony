import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState, WallDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import {
  getCachedModelObject,
  getOrLoadModelObject,
  releaseModelInstancesForNode,
} from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'
import { createWallGroup, updateWallGroup, type WallRenderOptions } from '@schema/wallMesh'
import { WALL_COMPONENT_TYPE, clampWallProps, type WallComponentProps } from '@schema/components'
import { syncInstancedModelCommittedLocalMatrices } from '@schema/continuousInstancedModel'

const AIR_WALL_OPACITY = 0.35
const AIR_WALL_MATERIAL_ORIGINAL_KEY = '__harmonyAirWallOriginal'

type AirWallMaterialOriginalState = {
  transparent?: boolean
  opacity?: number
  depthWrite?: boolean
}

function applyAirWallMaterialOverride(material: THREE.Material, isAirWall: boolean): void {
  const mat = material as THREE.Material & {
    transparent?: boolean
    opacity?: number
    depthWrite?: boolean
    userData?: Record<string, unknown>
  }
  const userData = (mat.userData ??= {})

  if (isAirWall) {
    if (!userData[AIR_WALL_MATERIAL_ORIGINAL_KEY]) {
      const snapshot: AirWallMaterialOriginalState = {
        transparent: Boolean(mat.transparent),
        opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
        depthWrite: typeof mat.depthWrite === 'boolean' ? mat.depthWrite : true,
      }
      userData[AIR_WALL_MATERIAL_ORIGINAL_KEY] = snapshot
    }
    mat.opacity = AIR_WALL_OPACITY
    mat.depthWrite = false
    mat.needsUpdate = true
    
    return
  }

  const original = userData[AIR_WALL_MATERIAL_ORIGINAL_KEY] as AirWallMaterialOriginalState | undefined
  if (!original) {
    return
  }
  mat.transparent = Boolean(original.transparent)
  mat.opacity = typeof original.opacity === 'number' ? original.opacity : 1
  mat.depthWrite = typeof original.depthWrite === 'boolean' ? original.depthWrite : true
  delete userData[AIR_WALL_MATERIAL_ORIGINAL_KEY]
}

export function applyAirWallVisualToWallGroup(group: THREE.Group, isAirWall: boolean): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
      return
    }
    const tag = (mesh.userData as any)?.dynamicMeshType
    if (tag !== 'Wall') {
      return
    }
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] | null }).material
    if (!material) {
      return
    }
    if (Array.isArray(material)) {
      material.forEach((entry) => entry && applyAirWallMaterialOverride(entry, isAirWall))
      return
    }
    applyAirWallMaterialOverride(material, isAirWall)
  })
}

export function computeWallDynamicMeshSignature(
  definition: WallDynamicMesh,
  options: { smoothing?: number } = {},
): string {
  const serialized = stableSerialize({
    segments: definition.segments ?? [],
    smoothing: Number.isFinite(options.smoothing) ? options.smoothing : 0,
  })
  return hashString(serialized)
}

type WallRendererOptions = {
  assetCacheStore: {
    createFileFromCache: (assetId: string) => File | null
    loadFromIndexedDb: (assetId: string) => Promise<unknown>
    releaseInMemoryBlob: (assetId: string) => void
  }
  getNodeById: (nodeId: string) => SceneNode | null
  getObjectById: (nodeId: string) => THREE.Object3D | null
  ensureInstancedPickProxy: (container: THREE.Object3D, node: SceneNode) => void
  removeInstancedPickProxy: (container: THREE.Object3D) => void
}

function disposeWallGroupResources(group: THREE.Group): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
      return
    }
    const geometry = (mesh as unknown as { geometry?: THREE.BufferGeometry | null }).geometry
    if (geometry) {
      geometry.dispose()
    }
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] | null }).material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose())
    } else if (material) {
      material.dispose()
    }
  })
}

function resolveWallSmoothingFromNode(node: SceneNode): number {
  const component = node.components?.[WALL_COMPONENT_TYPE] as
    | SceneNodeComponentState<WallComponentProps>
    | undefined
  if (!component) {
    return 0
  }
  return clampWallProps(component.props ?? null).smoothing
}

const wallSyncPosHelper = new THREE.Vector3()
const wallSyncScaleHelper = new THREE.Vector3(1, 1, 1)
const wallSyncBaseSizeHelper = new THREE.Vector3()
const wallSyncStartHelper = new THREE.Vector3()
const wallSyncEndHelper = new THREE.Vector3()
const wallSyncLocalStartHelper = new THREE.Vector3()
const wallSyncLocalEndHelper = new THREE.Vector3()
const wallSyncLocalDirHelper = new THREE.Vector3()
const wallSyncLocalUnitDirHelper = new THREE.Vector3()
const wallSyncLocalMinPointHelper = new THREE.Vector3()
const wallSyncLocalOffsetHelper = new THREE.Vector3()
const wallSyncLocalMatrixHelper = new THREE.Matrix4()
const wallSyncIncomingHelper = new THREE.Vector3()
const wallSyncOutgoingHelper = new THREE.Vector3()
const wallSyncBisectorHelper = new THREE.Vector3()

const WALL_SYNC_EPSILON = 1e-6
const WALL_SYNC_MIN_TILE_LENGTH = 1e-4

function distanceSqXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

function wallDirectionToQuaternion(direction: THREE.Vector3, baseAxis: 'x' | 'z' = 'x'): THREE.Quaternion {
  const base = baseAxis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
  const target = direction.clone()
  target.y = 0
  if (target.lengthSq() < 1e-6) {
    return new THREE.Quaternion()
  }
  target.normalize()
  return new THREE.Quaternion().setFromUnitVectors(base, target)
}

export function createWallRenderer(options: WallRendererOptions) {
  const wallModelRequestCache = new Map<string, Promise<void>>()
  const wallAssetWaiters = new Map<string, Set<string>>()
  const resyncSignatureKeyByNodeId = new Map<string, string>()

  const pendingResyncNodeIds = new Set<string>()
  let wallResyncRafHandle: number | null = null

  const FALLBACK_SIGNATURE_KEY = '__harmonyDynamicMeshSignature'

  function scheduleWallResync(nodeId: string): void {
    pendingResyncNodeIds.add(nodeId)

    if (wallResyncRafHandle !== null) {
      return
    }

    const raf =
      typeof globalThis !== 'undefined' && typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null

    const schedule = (callback: () => void) => {
      if (raf) {
        wallResyncRafHandle = raf(callback)
        return
      }
      // Fallback: microtask flush (shouldn't happen in the editor runtime).
      wallResyncRafHandle = 1
      void Promise.resolve().then(callback)
    }

    schedule(() => {
      wallResyncRafHandle = null
      const nodeIds = Array.from(pendingResyncNodeIds)
      pendingResyncNodeIds.clear()

      nodeIds.forEach((id) => {
        const node = options.getNodeById(id)
        const object = options.getObjectById(id)
        if (!node || !object) {
          return
        }
        const signatureKey = resyncSignatureKeyByNodeId.get(id) ?? FALLBACK_SIGNATURE_KEY
        syncWallContainer(object, node, signatureKey)
      })
    })
  }

  function computeWallBodyLocalMatrices(definition: WallDynamicMesh, bounds: THREE.Box3): THREE.Matrix4[] {
    const matrices: THREE.Matrix4[] = []
    const baseSize = bounds.getSize(wallSyncBaseSizeHelper)

    definition.segments.forEach((segment) => {
      wallSyncLocalStartHelper.set(segment.start.x, segment.start.y, segment.start.z)
      wallSyncLocalEndHelper.set(segment.end.x, segment.end.y, segment.end.z)
      wallSyncLocalDirHelper.subVectors(wallSyncLocalEndHelper, wallSyncLocalStartHelper)
      wallSyncLocalDirHelper.y = 0

      const lengthLocal = wallSyncLocalDirHelper.length()
      if (lengthLocal <= WALL_SYNC_EPSILON) {
        return
      }

      // Convention: model local +Z is the "along-wall" axis.
      const baseAxisForQuaternion: 'z' = 'z'
      const tileLengthLocal = Math.max(WALL_SYNC_MIN_TILE_LENGTH, Math.abs(baseSize.z))
      if (tileLengthLocal <= WALL_SYNC_EPSILON) {
        return
      }

      const minAlongAxis = bounds.min.z
      const maxAlongAxis = bounds.max.z

      wallSyncLocalUnitDirHelper.copy(wallSyncLocalDirHelper).normalize()

      // Strict endpoint coverage without scaling tiles:
      // - Place tiles starting from the segment start.
      // - Place the last tile so its max-face aligns exactly with the segment end.
      // This may create overlap near the end, but never overshoots.
      if (lengthLocal < tileLengthLocal - WALL_SYNC_EPSILON) {
        return
      }

      const instanceCount = Math.max(1, Math.ceil(lengthLocal / tileLengthLocal - 1e-9))

      const quatLocal = wallDirectionToQuaternion(wallSyncLocalDirHelper, baseAxisForQuaternion)

      for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
        if (instanceIndex === instanceCount - 1) {
          // Last tile: align max face to segment end.
          wallSyncLocalOffsetHelper.set(0, 0, maxAlongAxis)
          wallSyncLocalOffsetHelper.applyQuaternion(quatLocal)
          wallSyncPosHelper.copy(wallSyncLocalEndHelper).sub(wallSyncLocalOffsetHelper)
        } else {
          const along = instanceIndex * tileLengthLocal
          wallSyncLocalMinPointHelper.copy(wallSyncLocalStartHelper).addScaledVector(wallSyncLocalUnitDirHelper, along)

          // Place the model so that its local min face along the length axis matches the desired min point.
          wallSyncLocalOffsetHelper.set(0, 0, minAlongAxis)
          wallSyncLocalOffsetHelper.applyQuaternion(quatLocal)
          wallSyncPosHelper.copy(wallSyncLocalMinPointHelper).sub(wallSyncLocalOffsetHelper)
        }

        wallSyncScaleHelper.set(1, 1, 1)
        wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quatLocal, wallSyncScaleHelper)
        matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
      }
    })

    return matrices
  }

  function computeWallJointLocalMatrices(definition: WallDynamicMesh): THREE.Matrix4[] {
    const matrices: THREE.Matrix4[] = []
    if (definition.segments.length < 2) {
      return matrices
    }

    const buildCorner = (current: WallDynamicMesh['segments'][number], next: WallDynamicMesh['segments'][number], corner: THREE.Vector3) => {
      wallSyncStartHelper.set(current.start.x, current.start.y, current.start.z)
      wallSyncEndHelper.set(current.end.x, current.end.y, current.end.z)
      wallSyncIncomingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
      wallSyncIncomingHelper.y = 0

      wallSyncStartHelper.set(next.start.x, next.start.y, next.start.z)
      wallSyncEndHelper.set(next.end.x, next.end.y, next.end.z)
      wallSyncOutgoingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
      wallSyncOutgoingHelper.y = 0

      if (wallSyncIncomingHelper.lengthSq() < WALL_SYNC_EPSILON || wallSyncOutgoingHelper.lengthSq() < WALL_SYNC_EPSILON) {
        return
      }
      wallSyncIncomingHelper.normalize()
      wallSyncOutgoingHelper.normalize()

      const dot = THREE.MathUtils.clamp(wallSyncIncomingHelper.dot(wallSyncOutgoingHelper), -1, 1)
      const angle = Math.acos(dot)
      if (!Number.isFinite(angle) || angle < 1e-3) {
        return
      }

      wallSyncBisectorHelper.copy(wallSyncIncomingHelper).add(wallSyncOutgoingHelper)
      if (wallSyncBisectorHelper.lengthSq() < WALL_SYNC_EPSILON) {
        wallSyncBisectorHelper.copy(wallSyncOutgoingHelper)
      }

      const quat = wallDirectionToQuaternion(wallSyncBisectorHelper, 'z')
      wallSyncScaleHelper.set(1, 1, 1)
      wallSyncPosHelper.copy(corner)
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
      matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
    }

    for (let i = 0; i < definition.segments.length - 1; i += 1) {
      const current = definition.segments[i]!
      const next = definition.segments[i + 1]!

      wallSyncPosHelper.set(current.end.x, current.end.y, current.end.z)
      buildCorner(current, next, wallSyncPosHelper)
    }

    // Closed loop: add corner for last -> first.
    const first = definition.segments[0]!
    const last = definition.segments[definition.segments.length - 1]!
    wallSyncStartHelper.set(first.start.x, first.start.y, first.start.z)
    wallSyncEndHelper.set(last.end.x, last.end.y, last.end.z)
    if (distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) <= 1e-8) {
      wallSyncPosHelper.copy(wallSyncEndHelper)
      buildCorner(last, first, wallSyncPosHelper)
    }

    return matrices
  }

  function computeWallEndCapLocalMatrices(definition: WallDynamicMesh, bounds: THREE.Box3): THREE.Matrix4[] {
    const matrices: THREE.Matrix4[] = []
    if (!definition.segments.length) {
      return matrices
    }

    // Determine if the path is closed: first.start == last.end (XZ plane).
    const firstSeg = definition.segments[0]!
    const lastSeg = definition.segments[definition.segments.length - 1]!
    wallSyncStartHelper.set(firstSeg.start.x, firstSeg.start.y, firstSeg.start.z)
    wallSyncEndHelper.set(lastSeg.end.x, lastSeg.end.y, lastSeg.end.z)
    const closed = distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) <= 1e-8
    if (closed) {
      return matrices
    }

    const minAlongAxis = bounds.min.z

    const findDirectionForSegment = (segment: WallDynamicMesh['segments'][number] | null, fallback: THREE.Vector3): THREE.Vector3 => {
      if (!segment) {
        return fallback
      }
      fallback.set(segment.end.x - segment.start.x, 0, segment.end.z - segment.start.z)
      if (fallback.lengthSq() <= WALL_SYNC_EPSILON) {
        return fallback
      }
      return fallback.normalize()
    }

    // Start cap points outward: opposite of the first segment direction.
    const firstDir = findDirectionForSegment(firstSeg, wallSyncLocalUnitDirHelper)
    if (firstDir.lengthSq() > WALL_SYNC_EPSILON) {
      wallSyncLocalDirHelper.copy(firstDir).multiplyScalar(-1)
      const quat = wallDirectionToQuaternion(wallSyncLocalDirHelper, 'z')
      wallSyncLocalOffsetHelper.set(0, 0, minAlongAxis)
      wallSyncLocalOffsetHelper.applyQuaternion(quat)
      wallSyncPosHelper.set(firstSeg.start.x, firstSeg.start.y, firstSeg.start.z)
      wallSyncPosHelper.sub(wallSyncLocalOffsetHelper)
      wallSyncScaleHelper.set(1, 1, 1)
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
      matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
    }

    // End cap points outward: along the last segment direction.
    const lastDir = findDirectionForSegment(lastSeg, wallSyncLocalUnitDirHelper)
    if (lastDir.lengthSq() > WALL_SYNC_EPSILON) {
      wallSyncLocalDirHelper.copy(lastDir)
      const quat = wallDirectionToQuaternion(wallSyncLocalDirHelper, 'z')
      wallSyncLocalOffsetHelper.set(0, 0, minAlongAxis)
      wallSyncLocalOffsetHelper.applyQuaternion(quat)
      wallSyncPosHelper.set(lastSeg.end.x, lastSeg.end.y, lastSeg.end.z)
      wallSyncPosHelper.sub(wallSyncLocalOffsetHelper)
      wallSyncScaleHelper.set(1, 1, 1)
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
      matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
    }

    return matrices
  }

  function scheduleWallAssetLoad(assetId: string, nodeId: string, signatureKey: string) {
    // Track all wall nodes waiting on this asset so we can resync them once.
    resyncSignatureKeyByNodeId.set(nodeId, signatureKey)
    const waiters = wallAssetWaiters.get(assetId) ?? new Set<string>()
    waiters.add(nodeId)
    wallAssetWaiters.set(assetId, waiters)

    if (wallModelRequestCache.has(assetId)) {
      return
    }

    const promise = (async () => {
      try {
        let group = getCachedModelObject(assetId)
        if (!group) {
          let file = options.assetCacheStore.createFileFromCache(assetId)
          if (!file) {
            await options.assetCacheStore.loadFromIndexedDb(assetId)
            file = options.assetCacheStore.createFileFromCache(assetId)
          }
          if (!file) {
            return
          }
          group = await getOrLoadModelObject(assetId, () => loadObjectFromFile(file))
          options.assetCacheStore.releaseInMemoryBlob(assetId)
        }

        // Resync all nodes that were waiting on this asset in a single frame.
        const waitingIds = wallAssetWaiters.get(assetId)
        if (waitingIds && waitingIds.size) {
          waitingIds.forEach((id) => scheduleWallResync(id))
          wallAssetWaiters.delete(assetId)
        } else {
          scheduleWallResync(nodeId)
        }
      } catch (error) {
        console.warn('Failed to load wall model asset', assetId, error)
      } finally {
        wallModelRequestCache.delete(assetId)
      }
    })()

    wallModelRequestCache.set(assetId, promise)
  }

  function ensureWallGroup(container: THREE.Object3D, node: SceneNode, signatureKey: string): THREE.Group {
    const userData = container.userData ?? (container.userData = {})
    let wallGroup = userData.wallGroup as THREE.Group | undefined
    if (wallGroup) {
      return wallGroup
    }

    const wallDefinition = node.dynamicMesh as WallDynamicMesh
    const smoothing = resolveWallSmoothingFromNode(node)
    wallGroup = createWallGroup(wallDefinition, { smoothing })
    wallGroup.userData.nodeId = node.id
    wallGroup.userData[signatureKey] = computeWallDynamicMeshSignature(wallDefinition, { smoothing })
    container.add(wallGroup)
    userData.wallGroup = wallGroup
    userData.dynamicMeshType = 'Wall'
    return wallGroup
  }

  function updateWallGroupIfNeeded(
    wallGroup: THREE.Group,
    definition: WallDynamicMesh,
    signatureKey: string,
    options: WallRenderOptions = {},
  ): void {
    const groupData = wallGroup.userData ?? (wallGroup.userData = {})
      const nextSignature = computeWallDynamicMeshSignature(definition, { smoothing: options.smoothing })
    if (groupData[signatureKey] !== nextSignature) {
      updateWallGroup(wallGroup, definition, options)
      groupData[signatureKey] = nextSignature
    }
  }

  function removeWallGroup(container: THREE.Object3D): void {
    const userData = container.userData ?? (container.userData = {})
    const wallGroup = userData.wallGroup as THREE.Group | undefined
    if (!wallGroup) {
      return
    }
    disposeWallGroupResources(wallGroup)
    wallGroup.removeFromParent()
    delete userData.wallGroup
  }

  function syncWallContainer(container: THREE.Object3D, node: SceneNode, signatureKey: string): void {
    if (node.dynamicMesh?.type !== 'Wall') {
      return
    }

    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined

    const isAirWall = Boolean((wallComponent?.props as any)?.isAirWall)

    const bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
    const jointAssetId = wallComponent?.props?.jointAssetId ?? null
    const endCapAssetId = (wallComponent?.props as any)?.endCapAssetId ?? null
    const wantsInstancing = Boolean(bodyAssetId || jointAssetId || endCapAssetId)

    const userData = container.userData ?? (container.userData = {})

    // Air walls should not render instanced assets. Keep procedural wall visible for editor feedback.
    if (isAirWall) {
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      options.removeInstancedPickProxy(container)

      const wallGroup = ensureWallGroup(container, node, signatureKey)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        node.dynamicMesh as WallDynamicMesh,
        signatureKey,
        { smoothing: resolveWallSmoothingFromNode(node) },
      )
      applyAirWallVisualToWallGroup(wallGroup, true)
      return
    }

    if (!wantsInstancing) {
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      options.removeInstancedPickProxy(container)

      const wallGroup = ensureWallGroup(container, node, signatureKey)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        node.dynamicMesh as WallDynamicMesh,
        signatureKey,
        { smoothing: resolveWallSmoothingFromNode(node) },
      )

      // Editor-only visual: air walls are semi-transparent so they can be distinguished.
      applyAirWallVisualToWallGroup(wallGroup, isAirWall)
      return
    }

    container.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
        return
      }
      if (child.name === 'WallMesh') {
        mesh.visible = false
      }
    })



    // Instanced rendering is enabled, but we may need to fall back to the procedural wall while assets load.
    const needsBodyLoad = bodyAssetId 
    const needsJointLoad = jointAssetId && !getCachedModelObject(jointAssetId)
    const needsCapLoad = endCapAssetId && !getCachedModelObject(endCapAssetId)
    if (bodyAssetId && needsBodyLoad) {
      scheduleWallAssetLoad(bodyAssetId, node.id, signatureKey)
    }
    if (jointAssetId && needsJointLoad) {
      scheduleWallAssetLoad(jointAssetId, node.id, signatureKey)
    }
    if (endCapAssetId && needsCapLoad) {
      scheduleWallAssetLoad(endCapAssetId, node.id, signatureKey)
    }

    // Assets are ready: switch to instanced rendering and remove the procedural wall group.
    removeWallGroup(container)

    const definition = node.dynamicMesh as WallDynamicMesh
    const primaryAssetId = bodyAssetId ?? jointAssetId ?? endCapAssetId
    userData.instancedAssetId = primaryAssetId

    let hasBindings = false

    if (bodyAssetId) {
      const group = getCachedModelObject(bodyAssetId)
      if (group) {
        const localMatrices = computeWallBodyLocalMatrices(definition, group.boundingBox)
        if (localMatrices.length > 0) {
          syncInstancedModelCommittedLocalMatrices({
            nodeId: node.id,
            assetId: bodyAssetId,
            object: container,
            localMatrices,
            bindingIdPrefix: `wall-body:${node.id}:`,
            useNodeIdForIndex0: true,
          })
          hasBindings = true
        }
      }
    }

    if (jointAssetId) {
      // If there is no body asset, map index 0 to nodeId so pick-proxy and transform behavior stays consistent.
      const useNodeIdForIndex0 = !bodyAssetId
      const localMatrices = computeWallJointLocalMatrices(definition)
      if (localMatrices.length > 0) {
        syncInstancedModelCommittedLocalMatrices({
          nodeId: node.id,
          assetId: jointAssetId,
          object: container,
          localMatrices,
          bindingIdPrefix: `wall-joint:${node.id}:`,
          useNodeIdForIndex0,
        })
        hasBindings = hasBindings || localMatrices.length > 0
      }
    }

    if (endCapAssetId) {
      const useNodeIdForIndex0 = !bodyAssetId && !jointAssetId
      const group = getCachedModelObject(endCapAssetId)
      if (group) {
        const localMatrices = computeWallEndCapLocalMatrices(definition, group.boundingBox)
        if (localMatrices.length > 0) {
          syncInstancedModelCommittedLocalMatrices({
            nodeId: node.id,
            assetId: endCapAssetId,
            object: container,
            localMatrices,
            bindingIdPrefix: `wall-cap:${node.id}:`,
            useNodeIdForIndex0,
          })
          hasBindings = hasBindings || localMatrices.length > 0
        }
      }
    }

    if (hasBindings) {
      options.ensureInstancedPickProxy(container, node)
    } else {
      options.removeInstancedPickProxy(container)
    }
  }

  return {
    syncWallContainer,
  }
}
