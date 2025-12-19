import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState, WallDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import {
  getCachedModelObject,
  getOrLoadModelObject,
  ensureInstancedMeshesRegistered,
  allocateModelInstanceBinding,
  releaseModelInstancesForNode,
  updateModelInstanceBindingMatrix,
  getModelInstanceBindingsForNode,
} from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'
import { createWallGroup, updateWallGroup } from '@schema/wallMesh'
import { WALL_COMPONENT_TYPE, type WallComponentProps } from '@schema/components'

export function computeWallDynamicMeshSignature(definition: WallDynamicMesh): string {
  const serialized = stableSerialize(definition.segments ?? [])
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

const wallSyncNodeMatrixHelper = new THREE.Matrix4()
const wallSyncInstanceMatrixHelper = new THREE.Matrix4()
const wallSyncPosHelper = new THREE.Vector3()
const wallSyncQuatHelper = new THREE.Quaternion()
const wallSyncScaleHelper = new THREE.Vector3(1, 1, 1)
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
const wallSyncNodePos = new THREE.Vector3()
const wallSyncNodeEuler = new THREE.Euler()
const wallSyncNodeScale = new THREE.Vector3()

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

function resolveWallBodyLengthAxis(
  baseSize: THREE.Vector3,
  wallWidth: number,
): 'x' | 'z' {
  const width = Math.max(1e-6, Math.abs(wallWidth))
  const dx = Math.abs(Math.abs(baseSize.x) - width)
  const dz = Math.abs(Math.abs(baseSize.z) - width)

  // If one horizontal axis closely matches the wall width, treat that as thickness.
  // The remaining horizontal axis becomes the length axis.
  if (dx < dz) {
    return 'z'
  }
  if (dz < dx) {
    return 'x'
  }
  return 'x'
}

export function createWallRenderer(options: WallRendererOptions) {
  const wallModelRequestCache = new Map<string, Promise<void>>()

  function scheduleWallAssetLoad(assetId: string, nodeId: string) {
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
        ensureInstancedMeshesRegistered(assetId)

        const node = options.getNodeById(nodeId)
        const object = options.getObjectById(nodeId)
        if (node && object) {
          syncWallContainer(object, node, '__harmonyDynamicMeshSignature')
        }
      } catch (error) {
        console.warn('Failed to load wall model asset', assetId, error)
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
    wallGroup = createWallGroup(wallDefinition)
    wallGroup.userData.nodeId = node.id
    wallGroup.userData[signatureKey] = computeWallDynamicMeshSignature(wallDefinition)
    container.add(wallGroup)
    userData.wallGroup = wallGroup
    userData.dynamicMeshType = 'Wall'
    return wallGroup
  }

  function updateWallGroupIfNeeded(wallGroup: THREE.Group, definition: WallDynamicMesh, signatureKey: string): void {
    const groupData = wallGroup.userData ?? (wallGroup.userData = {})
    const nextSignature = computeWallDynamicMeshSignature(definition)
    if (groupData[signatureKey] !== nextSignature) {
      updateWallGroup(wallGroup, definition)
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

    const bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
    const jointAssetId = wallComponent?.props?.jointAssetId ?? null
    const wantsInstancing = Boolean(bodyAssetId || jointAssetId)

    const userData = container.userData ?? (container.userData = {})

    if (!wantsInstancing) {
      if (userData.wallInstancingActive) {
        releaseModelInstancesForNode(node.id)
        delete userData.wallInstancingActive
        delete userData.wallInstancingSignature
        delete userData.instancedAssetId
        options.removeInstancedPickProxy(container)
      }

      const wallGroup = ensureWallGroup(container, node, signatureKey)
      wallGroup.visible = true
      updateWallGroupIfNeeded(wallGroup, node.dynamicMesh as WallDynamicMesh, signatureKey)
      return
    }

    // Instanced rendering is enabled: ensure dynamic wall mesh group is not present.
    removeWallGroup(container)

    // Ensure assets are loaded; when asset rendering is enabled we do NOT fall back to WallDynamicMesh.
    const needsBodyLoad = bodyAssetId && !getCachedModelObject(bodyAssetId)
    const needsJointLoad = jointAssetId && !getCachedModelObject(jointAssetId)
    if (bodyAssetId && needsBodyLoad) {
      scheduleWallAssetLoad(bodyAssetId, node.id)
    }
    if (jointAssetId && needsJointLoad) {
      scheduleWallAssetLoad(jointAssetId, node.id)
    }
    if (needsBodyLoad || needsJointLoad) {
      return
    }

    const definition = node.dynamicMesh as WallDynamicMesh
    const meshSignature = computeWallDynamicMeshSignature(definition)
    const nextSignature = `${meshSignature}|body:${bodyAssetId ?? ''}|joint:${jointAssetId ?? ''}`

    const bindings = getModelInstanceBindingsForNode(node.id)
    const shouldRebuild = userData.wallInstancingSignature !== nextSignature || bindings.length === 0
    if (shouldRebuild) {
      releaseModelInstancesForNode(node.id)
    }

    userData.wallInstancingActive = true
    userData.wallInstancingSignature = nextSignature
    userData.instancedAssetId = bodyAssetId ?? jointAssetId

    // Compose node transform.
    wallSyncNodePos.set(node.position.x, node.position.y, node.position.z)
    wallSyncNodeEuler.set(node.rotation.x, node.rotation.y, node.rotation.z)
    wallSyncNodeScale.set(node.scale.x, node.scale.y, node.scale.z)
    wallSyncQuatHelper.setFromEuler(wallSyncNodeEuler)
    wallSyncNodeMatrixHelper.compose(wallSyncNodePos, wallSyncQuatHelper, wallSyncNodeScale)

    // Body instances: one per segment, aligned to segment direction.
    if (bodyAssetId) {
      const group = getCachedModelObject(bodyAssetId)
      if (group) {
        ensureInstancedMeshesRegistered(bodyAssetId)
        const baseBounds = group.boundingBox
        const baseSize = baseBounds.getSize(wallSyncScaleHelper)

        definition.segments.forEach((segment, segmentIndex) => {
          wallSyncLocalStartHelper.set(segment.start.x, segment.start.y, segment.start.z)
          wallSyncLocalEndHelper.set(segment.end.x, segment.end.y, segment.end.z)
          wallSyncLocalDirHelper.subVectors(wallSyncLocalEndHelper, wallSyncLocalStartHelper)
          wallSyncLocalDirHelper.y = 0

          const lengthLocal = wallSyncLocalDirHelper.length()
          if (lengthLocal <= 1e-6) {
            return
          }

          const lengthAxis = resolveWallBodyLengthAxis(baseSize, segment.width)
          const baseAxisForQuaternion: 'x' | 'z' = lengthAxis
          const tileLengthLocal = Math.max(
            1e-4,
            lengthAxis === 'x' ? Math.abs(baseSize.x) : Math.abs(baseSize.z),
          )
          const minAlongAxis = lengthAxis === 'x' ? baseBounds.min.x : baseBounds.min.z

          wallSyncLocalUnitDirHelper.copy(wallSyncLocalDirHelper).normalize()

          const instanceCount = lengthLocal <= tileLengthLocal + 1e-6
            ? 1
            : Math.max(1, Math.ceil(lengthLocal / tileLengthLocal))
          const totalCoveredLocal = instanceCount * tileLengthLocal
          const startOffsetLocal = (lengthLocal - totalCoveredLocal) * 0.5

          const quatLocal = wallDirectionToQuaternion(wallSyncLocalDirHelper, baseAxisForQuaternion)

          for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
            const along = startOffsetLocal + instanceIndex * tileLengthLocal
            wallSyncLocalMinPointHelper.copy(wallSyncLocalStartHelper).addScaledVector(wallSyncLocalUnitDirHelper, along)

            // Place the model so that its local min face along the length axis matches the desired min point.
            wallSyncLocalOffsetHelper.set(
              lengthAxis === 'x' ? minAlongAxis : 0,
              0,
              lengthAxis === 'z' ? minAlongAxis : 0,
            )
            wallSyncLocalOffsetHelper.applyQuaternion(quatLocal)
            wallSyncPosHelper.copy(wallSyncLocalMinPointHelper).sub(wallSyncLocalOffsetHelper)

            wallSyncScaleHelper.set(1, 1, 1)
            wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quatLocal, wallSyncScaleHelper)
            wallSyncInstanceMatrixHelper.copy(wallSyncLocalMatrixHelper).premultiply(wallSyncNodeMatrixHelper)

            const bindingId = `wall:${node.id}:body:${segmentIndex}:${instanceIndex}`
            if (shouldRebuild) {
              allocateModelInstanceBinding(bodyAssetId, bindingId, node.id)
            }
            updateModelInstanceBindingMatrix(bindingId, wallSyncInstanceMatrixHelper)
          }
        })
      }
    }

    // Joint instances: place at turns (between consecutive segments), aligned to the bisector direction.
    if (jointAssetId) {
      const group = getCachedModelObject(jointAssetId)
      if (group) {
        ensureInstancedMeshesRegistered(jointAssetId)
        let jointIndex = 0
        for (let i = 0; i < definition.segments.length - 1; i += 1) {
          const current = definition.segments[i]!
          const next = definition.segments[i + 1]!

          wallSyncStartHelper
            .set(current.start.x, current.start.y, current.start.z)
            .applyMatrix4(wallSyncNodeMatrixHelper)
          wallSyncEndHelper
            .set(current.end.x, current.end.y, current.end.z)
            .applyMatrix4(wallSyncNodeMatrixHelper)
          wallSyncIncomingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
          wallSyncIncomingHelper.y = 0

          const nextStart = wallSyncStartHelper
            .set(next.start.x, next.start.y, next.start.z)
            .applyMatrix4(wallSyncNodeMatrixHelper)
          const nextEnd = wallSyncEndHelper
            .set(next.end.x, next.end.y, next.end.z)
            .applyMatrix4(wallSyncNodeMatrixHelper)
          wallSyncOutgoingHelper.subVectors(nextEnd, nextStart)
          wallSyncOutgoingHelper.y = 0

          if (wallSyncIncomingHelper.lengthSq() < 1e-6 || wallSyncOutgoingHelper.lengthSq() < 1e-6) {
            continue
          }
          wallSyncIncomingHelper.normalize()
          wallSyncOutgoingHelper.normalize()

          const dot = THREE.MathUtils.clamp(wallSyncIncomingHelper.dot(wallSyncOutgoingHelper), -1, 1)
          const angle = Math.acos(dot)
          if (!Number.isFinite(angle) || angle < 1e-3) {
            continue
          }

          wallSyncBisectorHelper.copy(wallSyncIncomingHelper).add(wallSyncOutgoingHelper)
          if (wallSyncBisectorHelper.lengthSq() < 1e-6) {
            wallSyncBisectorHelper.copy(wallSyncOutgoingHelper)
          }

          const quat = wallDirectionToQuaternion(wallSyncBisectorHelper, 'x')
          wallSyncScaleHelper.set(1, 1, 1)
          wallSyncPosHelper.copy(wallSyncEndHelper)
          wallSyncInstanceMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)

          const bindingId = `wall:${node.id}:joint:${jointIndex}`
          if (shouldRebuild) {
            allocateModelInstanceBinding(jointAssetId, bindingId, node.id)
          }
          updateModelInstanceBindingMatrix(bindingId, wallSyncInstanceMatrixHelper)
          jointIndex += 1
        }
      }
    }

    options.ensureInstancedPickProxy(container, node)
  }

  return {
    syncWallContainer,
  }
}
