import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState, WallDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import {
  getCachedModelObject,
  getOrLoadModelObject,
  allocateModelInstance,
  allocateModelInstanceBinding,
  ensureInstancedMeshesRegistered,
  updateModelInstanceBindingMatrix,
  updateModelInstanceMatrix,
  releaseModelInstancesForNode,
} from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'
import { useSceneStore } from '@/stores/sceneStore'
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
const wallSyncYawAxis = new THREE.Vector3(0, 1, 0)
const wallSyncYawQuatHelper = new THREE.Quaternion()

const wallInstancedBoundsBox = new THREE.Box3()
const wallInstancedBoundsTmpPoint = new THREE.Vector3()
const wallInstancedBoundsCorners = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
] as [
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
]

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

function expandBoxByTransformedBoundingBox(target: THREE.Box3, bbox: THREE.Box3, matrix: THREE.Matrix4): void {
  if (!bbox || bbox.isEmpty()) {
    return
  }

  const min = bbox.min
  const max = bbox.max

  wallInstancedBoundsCorners[0].set(min.x, min.y, min.z)
  wallInstancedBoundsCorners[1].set(min.x, min.y, max.z)
  wallInstancedBoundsCorners[2].set(min.x, max.y, min.z)
  wallInstancedBoundsCorners[3].set(min.x, max.y, max.z)
  wallInstancedBoundsCorners[4].set(max.x, min.y, min.z)
  wallInstancedBoundsCorners[5].set(max.x, min.y, max.z)
  wallInstancedBoundsCorners[6].set(max.x, max.y, min.z)
  wallInstancedBoundsCorners[7].set(max.x, max.y, max.z)

  for (const corner of wallInstancedBoundsCorners) {
    wallInstancedBoundsTmpPoint.copy(corner).applyMatrix4(matrix)
    target.expandByPoint(wallInstancedBoundsTmpPoint)
  }
}

export function createWallRenderer(options: WallRendererOptions) {
  const wallModelRequestCache = new Map<string, Promise<void>>()
  const wallAssetWaiters = new Map<string, Set<string>>()
  const resyncSignatureKeyByNodeId = new Map<string, string>()

  type WallDragBindingEntry = {
    assetId: string
    localMatrices: THREE.Matrix4[]
    bindingIdPrefix: string
    useNodeIdForIndex0: boolean
  }

  type WallDragCacheEntry = {
    nodeId: string
    bindings: WallDragBindingEntry[]
  }

  const wallDragCacheByNodeId = new Map<string, WallDragCacheEntry>()
  let activeWallDragNodeId: string | null = null

  const wallDragInstanceHelper = new THREE.Matrix4()

  const pendingResyncNodeIds = new Set<string>()
  let wallResyncRafHandle: number | null = null

  const FALLBACK_SIGNATURE_KEY = '__harmonyDynamicMeshSignature'

  function isWallDragActive(nodeId: string): boolean {
    return activeWallDragNodeId === nodeId && wallDragCacheByNodeId.has(nodeId)
  }

  function buildWallDragCache(nodeId: string): WallDragCacheEntry | null {
    const node = options.getNodeById(nodeId)
    if (!node || node.dynamicMesh?.type !== 'Wall') {
      return null
    }

    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined

    const bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
    const endCapAssetId = wallComponent?.props?.endCapAssetId ?? null
    const cornerModels = Array.isArray(wallComponent?.props?.cornerModels)
      ? wallComponent!.props!.cornerModels!
      : []
    const hasCornerAssets = cornerModels.some((entry) => typeof entry?.assetId === 'string' && entry.assetId.trim().length)
    const definition = node.dynamicMesh as WallDynamicMesh
    const canHaveCornerJoints = hasCornerAssets && definition.segments.length >= 2
    const wantsInstancing = Boolean(bodyAssetId || endCapAssetId || canHaveCornerJoints)
    if (!wantsInstancing) {
      return null
    }
    const bindings: WallDragBindingEntry[] = []

    if (bodyAssetId) {
      const group = getCachedModelObject(bodyAssetId)
      if (group) {
        const localMatrices = computeWallBodyLocalMatrices(definition, group.boundingBox)
        if (localMatrices.length > 0) {
          bindings.push({
            assetId: bodyAssetId,
            localMatrices,
            bindingIdPrefix: `wall-body:${nodeId}:`,
            useNodeIdForIndex0: true,
          })
        }
      }
    }

    const jointBuckets = computeWallJointLocalMatricesByAsset(definition, { cornerModels })
    if (jointBuckets.matricesByAssetId.size) {
      const sortedAssetIds = Array.from(jointBuckets.matricesByAssetId.keys()).sort()
      for (const assetId of sortedAssetIds) {
        const localMatrices = jointBuckets.matricesByAssetId.get(assetId) ?? []
        if (!localMatrices.length) {
          continue
        }
        bindings.push({
          assetId,
          localMatrices,
          bindingIdPrefix: `wall-joint:${nodeId}:${assetId}:`,
          useNodeIdForIndex0: !bodyAssetId && assetId === jointBuckets.primaryAssetId,
        })
      }
    }

    if (endCapAssetId) {
      const group = getCachedModelObject(endCapAssetId)
      if (group) {
        const localMatrices = computeWallEndCapLocalMatrices(definition, group.boundingBox)
        if (localMatrices.length > 0) {
          bindings.push({
            assetId: endCapAssetId,
            localMatrices,
            bindingIdPrefix: `wall-cap:${nodeId}:`,
            useNodeIdForIndex0: !bodyAssetId && !jointBuckets.primaryAssetId,
          })
        }
      }
    }

    if (!bindings.length) {
      return null
    }

    return { nodeId, bindings }
  }

  function beginWallDrag(nodeId: string): boolean {
    const cache = buildWallDragCache(nodeId)
    if (!cache) {
      if (activeWallDragNodeId === nodeId) {
        wallDragCacheByNodeId.delete(nodeId)
        activeWallDragNodeId = null
      }
      return false
    }
    wallDragCacheByNodeId.set(nodeId, cache)
    activeWallDragNodeId = nodeId
    return true
  }

  function endWallDrag(nodeId: string | null | undefined): void {
    if (!nodeId) {
      return
    }
    if (activeWallDragNodeId === nodeId) {
      activeWallDragNodeId = null
    }
    wallDragCacheByNodeId.delete(nodeId)

    const node = options.getNodeById(nodeId)
    const object = options.getObjectById(nodeId)
    if (!node || !object) {
      return
    }
    const signatureKey = resyncSignatureKeyByNodeId.get(nodeId) ?? FALLBACK_SIGNATURE_KEY
    syncWallContainer(object, node, signatureKey)
  }

  function syncWallDragInstancedMatrices(nodeId: string, baseMatrix: THREE.Matrix4): boolean {
    if (!isWallDragActive(nodeId)) {
      return false
    }
    const cache = wallDragCacheByNodeId.get(nodeId)
    if (!cache) {
      return false
    }

    for (const binding of cache.bindings) {
      ensureInstancedMeshesRegistered(binding.assetId)
      const count = binding.localMatrices.length
      for (let i = 0; i < count; i += 1) {
        const local = binding.localMatrices[i]
        if (!local) {
          continue
        }

        if (binding.useNodeIdForIndex0 && i === 0) {
          allocateModelInstance(binding.assetId, nodeId)
          wallDragInstanceHelper.multiplyMatrices(baseMatrix, local)
          updateModelInstanceMatrix(nodeId, wallDragInstanceHelper)
          continue
        }

        const bindingId = `${binding.bindingIdPrefix}${i}`
        allocateModelInstanceBinding(binding.assetId, bindingId, nodeId)
        wallDragInstanceHelper.multiplyMatrices(baseMatrix, local)
        updateModelInstanceBindingMatrix(bindingId, wallDragInstanceHelper)
      }
    }

    return true
  }

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

  type WallCornerModelRule = NonNullable<WallComponentProps['cornerModels']>[number]

  function pickWallCornerModel(
    angleRadians: number,
    rules: WallCornerModelRule[],
  ): { assetId: string | null; extraYawRadians: number } {
    if (!Number.isFinite(angleRadians)) {
      return { assetId: null, extraYawRadians: 0 }
    }

    const angleDeg = Math.max(0, Math.min(180, THREE.MathUtils.radToDeg(angleRadians)))
    const complementDeg = 180 - angleDeg

    let best:
      | { assetId: string; extraYawRadians: number; score: number; rangeWidth: number }
      | null = null

    for (const rule of rules) {
      const assetId = typeof rule?.assetId === 'string' && rule.assetId.trim().length ? rule.assetId : null
      if (!assetId) {
        continue
      }

      const rawMin = typeof rule.minAngle === 'number' ? rule.minAngle : Number((rule as any).minAngle)
      const rawMax = typeof rule.maxAngle === 'number' ? rule.maxAngle : Number((rule as any).maxAngle)
      const min = Number.isFinite(rawMin) ? Math.max(0, Math.min(180, rawMin)) : 0
      const max = Number.isFinite(rawMax) ? Math.max(0, Math.min(180, rawMax)) : 180
      const minAngle = Math.min(min, max)
      const maxAngle = Math.max(min, max)
      const center = (minAngle + maxAngle) * 0.5
      const rangeWidth = Math.max(0, maxAngle - minAngle)

      const inDirect = angleDeg + 1e-6 >= minAngle && angleDeg - 1e-6 <= maxAngle
      const inComplement = complementDeg + 1e-6 >= minAngle && complementDeg - 1e-6 <= maxAngle

      if (!inDirect && !inComplement) {
        continue
      }

      const directScore = inDirect ? Math.abs(angleDeg - center) : Number.POSITIVE_INFINITY
      const complementScore = inComplement ? Math.abs(complementDeg - center) : Number.POSITIVE_INFINITY

      const useComplement = complementScore < directScore
      const score = useComplement ? complementScore : directScore
      const extraYawRadians = useComplement ? Math.PI : 0

      if (!best) {
        best = { assetId, extraYawRadians, score, rangeWidth }
        continue
      }

      if (score + 1e-6 < best.score) {
        best = { assetId, extraYawRadians, score, rangeWidth }
        continue
      }

      // Tie-breaker: prefer narrower ranges if score ties.
      if (Math.abs(score - best.score) <= 1e-6 && rangeWidth + 1e-6 < best.rangeWidth) {
        best = { assetId, extraYawRadians, score, rangeWidth }
      }
    }

    if (best) {
      return { assetId: best.assetId, extraYawRadians: best.extraYawRadians }
    }
    return { assetId: null, extraYawRadians: 0 }
  }

  function computeWallJointLocalMatricesByAsset(
    definition: WallDynamicMesh,
    options: { cornerModels?: WallCornerModelRule[] } = {},
  ): { matricesByAssetId: Map<string, THREE.Matrix4[]>; primaryAssetId: string | null } {
    const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
    let primaryAssetId: string | null = null

    if (definition.segments.length < 2) {
      return { matricesByAssetId, primaryAssetId }
    }

    const rules = Array.isArray(options.cornerModels) ? options.cornerModels : []

    const pushMatrix = (assetId: string, matrix: THREE.Matrix4) => {
      const bucket = matricesByAssetId.get(assetId) ?? []
      if (!matricesByAssetId.has(assetId)) {
        matricesByAssetId.set(assetId, bucket)
      }
      bucket.push(matrix)
      if (!primaryAssetId) {
        primaryAssetId = assetId
      }
    }

    const buildCorner = (
      current: WallDynamicMesh['segments'][number],
      next: WallDynamicMesh['segments'][number],
      corner: THREE.Vector3,
    ) => {
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

      const selection = pickWallCornerModel(angle, rules)
      if (!selection.assetId) {
        return
      }

      wallSyncBisectorHelper.copy(wallSyncIncomingHelper).add(wallSyncOutgoingHelper)
      if (wallSyncBisectorHelper.lengthSq() < WALL_SYNC_EPSILON) {
        wallSyncBisectorHelper.copy(wallSyncOutgoingHelper)
      }

      const quat = wallDirectionToQuaternion(wallSyncBisectorHelper, 'z')
      if (selection.extraYawRadians) {
        wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, selection.extraYawRadians)
        quat.multiply(wallSyncYawQuatHelper)
      }

      wallSyncScaleHelper.set(1, 1, 1)
      wallSyncPosHelper.copy(corner)
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
      pushMatrix(selection.assetId, new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
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

    return { matricesByAssetId, primaryAssetId }
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
          const ext = useSceneStore().getAsset(assetId)?.extension ?? undefined
          group = await getOrLoadModelObject(assetId, () => loadObjectFromFile(file, ext))
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

    if (isWallDragActive(node.id)) {
      return
    }

    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined

    const isAirWall = Boolean(wallComponent?.props?.isAirWall)

    const bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
    const endCapAssetId = wallComponent?.props?.endCapAssetId ?? null
    const cornerModels = Array.isArray(wallComponent?.props?.cornerModels)
      ? wallComponent!.props!.cornerModels!
      : []
    const cornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof entry?.assetId === 'string' ? entry.assetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()
    const definition = node.dynamicMesh as WallDynamicMesh
    const canHaveCornerJoints = cornerAssetIds.length > 0 && definition.segments.length >= 2
    const wantsInstancing = Boolean(bodyAssetId || endCapAssetId || canHaveCornerJoints)

    const userData = container.userData ?? (container.userData = {})

    // Air walls should not render instanced assets. Keep procedural wall visible for editor feedback.
    if (isAirWall) {
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      delete userData.instancedBounds
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
      delete userData.instancedBounds
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
    const needsBodyLoad = Boolean(bodyAssetId && !getCachedModelObject(bodyAssetId))
    const needsCornerLoad = cornerAssetIds.some((id) => !getCachedModelObject(id))
    const needsCapLoad = Boolean(endCapAssetId && !getCachedModelObject(endCapAssetId))

    if (needsBodyLoad && bodyAssetId) {
      scheduleWallAssetLoad(bodyAssetId, node.id, signatureKey)
    }
    if (needsCornerLoad) {
      cornerAssetIds.forEach((assetId) => {
        if (!getCachedModelObject(assetId)) {
          scheduleWallAssetLoad(assetId, node.id, signatureKey)
        }
      })
    }
    if (needsCapLoad && endCapAssetId) {
      scheduleWallAssetLoad(endCapAssetId, node.id, signatureKey)
    }

    if (needsBodyLoad || needsCornerLoad || needsCapLoad) {
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallGroup = ensureWallGroup(container, node, signatureKey)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        node.dynamicMesh as WallDynamicMesh,
        signatureKey,
        { smoothing: resolveWallSmoothingFromNode(node) },
      )
      applyAirWallVisualToWallGroup(wallGroup, false)
      return
    }

    // Assets are ready: attempt instanced rendering.
  const primaryAssetId = bodyAssetId ?? (cornerAssetIds[0] ?? null) ?? endCapAssetId
    userData.instancedAssetId = primaryAssetId
    userData.dynamicMeshType = 'Wall'

    wallInstancedBoundsBox.makeEmpty()
    let hasWallBounds = false

    let hasBindings = false

    if (bodyAssetId) {
      const group = getCachedModelObject(bodyAssetId)
      if (group) {
        const localMatrices = computeWallBodyLocalMatrices(definition, group.boundingBox)
        if (localMatrices.length > 0) {
          for (const localMatrix of localMatrices) {
            expandBoxByTransformedBoundingBox(wallInstancedBoundsBox, group.boundingBox, localMatrix)
            hasWallBounds = true
          }
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

    {
      const jointBuckets = computeWallJointLocalMatricesByAsset(definition, { cornerModels })
      if (jointBuckets.matricesByAssetId.size) {
        const sortedAssetIds = Array.from(jointBuckets.matricesByAssetId.keys()).sort()
        for (const assetId of sortedAssetIds) {
          const localMatrices = jointBuckets.matricesByAssetId.get(assetId) ?? []
          if (!localMatrices.length) {
            continue
          }

          const group = getCachedModelObject(assetId)
          if (group) {
            for (const localMatrix of localMatrices) {
              expandBoxByTransformedBoundingBox(wallInstancedBoundsBox, group.boundingBox, localMatrix)
              hasWallBounds = true
            }
          }

          // If there is no body asset, map index 0 to nodeId so pick-proxy and transform behavior stays consistent.
          const useNodeIdForIndex0 = !bodyAssetId && assetId === jointBuckets.primaryAssetId
          syncInstancedModelCommittedLocalMatrices({
            nodeId: node.id,
            assetId,
            object: container,
            localMatrices,
            bindingIdPrefix: `wall-joint:${node.id}:${assetId}:`,
            useNodeIdForIndex0,
          })
          hasBindings = true
        }
      }

      if (endCapAssetId) {
        const useNodeIdForIndex0 = !bodyAssetId && !jointBuckets.primaryAssetId
        const group = getCachedModelObject(endCapAssetId)
        if (group) {
          const localMatrices = computeWallEndCapLocalMatrices(definition, group.boundingBox)
          if (localMatrices.length > 0) {
            for (const localMatrix of localMatrices) {
              expandBoxByTransformedBoundingBox(wallInstancedBoundsBox, group.boundingBox, localMatrix)
              hasWallBounds = true
            }
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
    }

    if (!hasBindings) {
      // No instanced geometry applicable (e.g. single segment w/ only corner models): keep procedural wall visible.
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallGroup = ensureWallGroup(container, node, signatureKey)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        node.dynamicMesh as WallDynamicMesh,
        signatureKey,
        { smoothing: resolveWallSmoothingFromNode(node) },
      )
      applyAirWallVisualToWallGroup(wallGroup, false)
      return
    }

    // Instanced rendering is active: remove the procedural wall group.
    removeWallGroup(container)

    if (hasWallBounds && !wallInstancedBoundsBox.isEmpty()) {
      userData.instancedBounds = {
        min: [wallInstancedBoundsBox.min.x, wallInstancedBoundsBox.min.y, wallInstancedBoundsBox.min.z],
        max: [wallInstancedBoundsBox.max.x, wallInstancedBoundsBox.max.y, wallInstancedBoundsBox.max.z],
      }
    } else {
      delete userData.instancedBounds
    }

    if (hasBindings) {
      options.ensureInstancedPickProxy(container, node)
    } else {
      options.removeInstancedPickProxy(container)
    }
  }

  return {
    syncWallContainer,
    beginWallDrag,
    endWallDrag,
    syncWallDragInstancedMatrices,
    isWallDragActive,
  }
}
