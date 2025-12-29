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

function applyAirWallVisualToWallGroup(group: THREE.Group, isAirWall: boolean): void {
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

  function computeWallBodyLocalMatrices(definition: WallDynamicMesh, bounds: THREE.Box3): THREE.Matrix4[] {
    const matrices: THREE.Matrix4[] = []
    const baseSize = bounds.getSize(wallSyncScaleHelper)

    definition.segments.forEach((segment) => {
      wallSyncLocalStartHelper.set(segment.start.x, segment.start.y, segment.start.z)
      wallSyncLocalEndHelper.set(segment.end.x, segment.end.y, segment.end.z)
      wallSyncLocalDirHelper.subVectors(wallSyncLocalEndHelper, wallSyncLocalStartHelper)
      wallSyncLocalDirHelper.y = 0

      const lengthLocal = wallSyncLocalDirHelper.length()
      if (lengthLocal <= 1e-6) {
        return
      }

      // Convention: model local +X is the "along-wall" axis.
      // Keep editor behavior aligned with schema-side wall instancing.
      const baseAxisForQuaternion: 'x' = 'x'
      const tileLengthLocal = Math.max(1e-4, Math.abs(baseSize.x))
      const minAlongAxis = bounds.min.x

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
          minAlongAxis,
          0,
          0,
        )
        wallSyncLocalOffsetHelper.applyQuaternion(quatLocal)
        wallSyncPosHelper.copy(wallSyncLocalMinPointHelper).sub(wallSyncLocalOffsetHelper)

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

    for (let i = 0; i < definition.segments.length - 1; i += 1) {
      const current = definition.segments[i]!
      const next = definition.segments[i + 1]!

      wallSyncStartHelper.set(current.start.x, current.start.y, current.start.z)
      wallSyncEndHelper.set(current.end.x, current.end.y, current.end.z)
      wallSyncIncomingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
      wallSyncIncomingHelper.y = 0

      wallSyncStartHelper.set(next.start.x, next.start.y, next.start.z)
      wallSyncEndHelper.set(next.end.x, next.end.y, next.end.z)
      wallSyncOutgoingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
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
      wallSyncPosHelper.set(current.end.x, current.end.y, current.end.z)
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
      matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
    }

    return matrices
  }

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
    const wantsInstancing = Boolean(bodyAssetId || jointAssetId)

    const userData = container.userData ?? (container.userData = {})

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

    // Instanced rendering is enabled, but we may need to fall back to the procedural wall while assets load.
    const needsBodyLoad = bodyAssetId && !getCachedModelObject(bodyAssetId)
    const needsJointLoad = jointAssetId && !getCachedModelObject(jointAssetId)
    if (bodyAssetId && needsBodyLoad) {
      scheduleWallAssetLoad(bodyAssetId, node.id)
    }
    if (jointAssetId && needsJointLoad) {
      scheduleWallAssetLoad(jointAssetId, node.id)
    }
    if (needsBodyLoad || needsJointLoad) {
      // While loading, keep the default wall mesh visible (avoid disappearing walls).
      // Also release any stale instanced bindings from previous assets.
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
      applyAirWallVisualToWallGroup(wallGroup, isAirWall)
      return
    }

    // Assets are ready: switch to instanced rendering and remove the procedural wall group.
    removeWallGroup(container)

    const definition = node.dynamicMesh as WallDynamicMesh
    const primaryAssetId = bodyAssetId ?? jointAssetId
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
            bindingIdPrefix: `inst:${node.id}:`,
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
