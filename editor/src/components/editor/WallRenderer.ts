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

function resolveWallEffectiveDefinition(
  definition: WallDynamicMesh,
  props: WallComponentProps | null,
): WallDynamicMesh {
  if (!props || !Array.isArray(definition.segments) || definition.segments.length === 0) {
    return definition
  }

  const height = props.height
  const width = props.width
  const thickness = props.thickness

  let changed = false
  const nextSegments = definition.segments.map((segment) => {
    const segAny = segment as any
    if (segAny.height !== height || segAny.width !== width || segAny.thickness !== thickness) {
      changed = true
    }
    return {
      ...segment,
      height,
      width,
      thickness,
    } as any
  })

  return changed ? ({ ...(definition as any), type: 'Wall', segments: nextSegments } as WallDynamicMesh) : definition
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

function splitWallSegmentsIntoChains(segments: WallDynamicMesh['segments']): WallDynamicMesh['segments'][] {
  const chains: WallDynamicMesh['segments'][] = []
  let current: WallDynamicMesh['segments'] = []

  for (const seg of segments) {
    const prev = current[current.length - 1]
    if (prev) {
      wallSyncStartHelper.set(prev.end.x, prev.end.y, prev.end.z)
      wallSyncEndHelper.set(seg.start.x, seg.start.y, seg.start.z)
      if (distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) > 1e-8) {
        if (current.length) {
          chains.push(current)
        }
        current = []
      }
    }
    current.push(seg)
  }

  if (current.length) {
    chains.push(current)
  }

  return chains
}

type WallModelOrientation = NonNullable<WallComponentProps['bodyOrientation']>
type WallForwardAxis = WallModelOrientation['forwardAxis']

type WallForwardAxisInfo = { axis: 'x' | 'z'; sign: 1 | -1 }

function wallForwardAxisInfo(forwardAxis: WallForwardAxis): WallForwardAxisInfo {
  switch (forwardAxis) {
    case '+x':
      return { axis: 'x', sign: 1 }
    case '-x':
      return { axis: 'x', sign: -1 }
    case '+z':
      return { axis: 'z', sign: 1 }
    case '-z':
      return { axis: 'z', sign: -1 }
    default:
      throw new Error(`Wall: invalid forwardAxis ${String(forwardAxis)}`)
  }
}

function writeWallLocalForward(out: THREE.Vector3, forwardAxis: WallForwardAxis): THREE.Vector3 {
  switch (forwardAxis) {
    case '+x':
      return out.set(1, 0, 0)
    case '-x':
      return out.set(-1, 0, 0)
    case '+z':
      return out.set(0, 0, 1)
    case '-z':
      return out.set(0, 0, -1)
    default:
      return out.set(0, 0, 1)
  }
}

function resolveWallBoundsAlongAxis(
  bounds: THREE.Box3,
  forwardAxis: WallForwardAxis,
): { tileLengthLocal: number; minAlongAxis: number; maxAlongAxis: number } {
  const info = wallForwardAxisInfo(forwardAxis)
  const axis = info.axis
  const minRaw = bounds.min[axis]
  const maxRaw = bounds.max[axis]

  const lengthAbs = Math.abs(maxRaw - minRaw)
  const tileLengthLocal = Math.max(WALL_SYNC_MIN_TILE_LENGTH, lengthAbs)

  // Along coordinate is dot(localForward, localPos). With axis-aligned forward,
  // this becomes either +axis or -axis.
  const minAlongAxis = info.sign === 1 ? minRaw : -maxRaw
  const maxAlongAxis = info.sign === 1 ? maxRaw : -minRaw
  return { tileLengthLocal, minAlongAxis, maxAlongAxis }
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

    const wallProps = wallComponent
      ? clampWallProps(wallComponent.props as Partial<WallComponentProps> | null | undefined)
      : null

    const bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
    const headAssetId = wallComponent?.props?.headAssetId ?? null
    const bodyEndCapAssetId = wallComponent?.props?.bodyEndCapAssetId ?? null
    const headEndCapAssetId = wallComponent?.props?.headEndCapAssetId ?? null
    const cornerModels = wallProps?.cornerModels ?? []
    const hasBodyCornerAssets = cornerModels.some((entry) => typeof (entry as any)?.bodyAssetId === 'string' && (entry as any).bodyAssetId.trim().length)
    const hasHeadCornerAssets = cornerModels.some((entry) => typeof (entry as any)?.headAssetId === 'string' && (entry as any).headAssetId.trim().length)
    const definition = node.dynamicMesh as WallDynamicMesh
    const canHaveCornerJoints = (hasBodyCornerAssets || hasHeadCornerAssets) && definition.segments.length >= 2
    const wantsInstancing = Boolean(bodyAssetId || headAssetId || bodyEndCapAssetId || headEndCapAssetId || canHaveCornerJoints)
    if (!wantsInstancing) {
      return null
    }
    const bindings: WallDragBindingEntry[] = []

    if (bodyAssetId) {
      const group = getCachedModelObject(bodyAssetId)
      if (group) {
        const localMatrices = wallProps
          ? computeWallBodyLocalMatrices(definition, group.boundingBox, 'body', wallProps.bodyOrientation)
          : []
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

    if (headAssetId) {
      const group = getCachedModelObject(headAssetId)
      if (group) {
        const localMatrices = wallProps
          ? computeWallBodyLocalMatrices(definition, group.boundingBox, 'head', wallProps.headOrientation)
          : []
        if (localMatrices.length > 0) {
          bindings.push({
            assetId: headAssetId,
            localMatrices,
            bindingIdPrefix: `wall-head:${nodeId}:`,
            useNodeIdForIndex0: false,
          })
        }
      }
    }

    const getBoundsFromCache = (assetId: string): THREE.Box3 | null => {
      const group = getCachedModelObject(assetId)
      return group?.boundingBox ?? null
    }

    const bodyJointBuckets = computeWallJointLocalMatricesByAsset(definition, {
      cornerModels,
      mode: 'body',
      getAssetBounds: getBoundsFromCache,
    })
    const headJointBuckets = computeWallJointLocalMatricesByAsset(definition, {
      cornerModels,
      mode: 'head',
      getAssetBounds: getBoundsFromCache,
    })
    const primaryCornerAssetId = bodyJointBuckets.primaryAssetId ?? headJointBuckets.primaryAssetId

    for (const jointBuckets of [bodyJointBuckets, headJointBuckets] as const) {
      if (!jointBuckets.matricesByAssetId.size) {
        continue
      }
      const sortedAssetIds = Array.from(jointBuckets.matricesByAssetId.keys()).sort()
      for (const assetId of sortedAssetIds) {
        const localMatrices = jointBuckets.matricesByAssetId.get(assetId) ?? []
        if (!localMatrices.length) {
          continue
        }
        bindings.push({
          assetId,
          localMatrices,
          bindingIdPrefix: `wall-joint-${jointBuckets.mode}:${nodeId}:${assetId}:`,
          useNodeIdForIndex0: !bodyAssetId && assetId === primaryCornerAssetId,
        })
      }
    }

    if (bodyEndCapAssetId) {
      const group = getCachedModelObject(bodyEndCapAssetId)
      if (group) {
        const localMatrices = wallProps
          ? computeWallEndCapLocalMatrices(definition, group.boundingBox, 'body', wallProps.bodyEndCapOrientation)
          : []
        if (localMatrices.length > 0) {
          bindings.push({
            assetId: bodyEndCapAssetId,
            localMatrices,
            bindingIdPrefix: `wall-cap-body:${nodeId}:`,
            useNodeIdForIndex0: !bodyAssetId && !primaryCornerAssetId,
          })
        }
      }
    }

    if (headEndCapAssetId) {
      const group = getCachedModelObject(headEndCapAssetId)
      if (group) {
        const localMatrices = wallProps
          ? computeWallEndCapLocalMatrices(definition, group.boundingBox, 'head', wallProps.headEndCapOrientation)
          : []
        if (localMatrices.length > 0) {
          bindings.push({
            assetId: headEndCapAssetId,
            localMatrices,
            bindingIdPrefix: `wall-cap-head:${nodeId}:`,
            useNodeIdForIndex0: false,
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

  function computeWallBodyLocalMatrices(
    definition: WallDynamicMesh,
    bounds: THREE.Box3,
    mode: 'body' | 'head',
    orientation: WallModelOrientation,
  ): THREE.Matrix4[] {
    const matrices: THREE.Matrix4[] = []
    if (!definition.segments.length) {
      return matrices
    }

    const localForward = new THREE.Vector3()
    writeWallLocalForward(localForward, orientation.forwardAxis)
    const { tileLengthLocal, minAlongAxis, maxAlongAxis } = resolveWallBoundsAlongAxis(bounds, orientation.forwardAxis)

    const templateHeight = resolveWallModelHeight(bounds)
    const minY = bounds.min.y

    definition.segments.forEach((segment) => {
      wallSyncLocalStartHelper.set(segment.start.x, segment.start.y, segment.start.z)
      wallSyncLocalEndHelper.set(segment.end.x, segment.end.y, segment.end.z)
      wallSyncLocalDirHelper.subVectors(wallSyncLocalEndHelper, wallSyncLocalStartHelper)
      wallSyncLocalDirHelper.y = 0
      const lengthLocal = wallSyncLocalDirHelper.length()
      if (lengthLocal <= WALL_SYNC_EPSILON) {
        return
      }

      wallSyncLocalUnitDirHelper.copy(wallSyncLocalDirHelper).normalize()

      const instanceCount = Math.max(1, Math.ceil(lengthLocal / tileLengthLocal - 1e-9))
      const quatLocal = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncLocalUnitDirHelper)
      if (orientation.yawDeg) {
        wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(orientation.yawDeg))
        quatLocal.multiply(wallSyncYawQuatHelper)
      }

      const bodyHeight = resolveWallBodyHeightForSegment(segment)
      const scaleY = mode === 'body' ? (bodyHeight / templateHeight) : 1

      for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
        if (instanceIndex === instanceCount - 1) {
          // Last tile: align max face to segment end.
          wallSyncLocalOffsetHelper.copy(localForward).multiplyScalar(maxAlongAxis)
          wallSyncLocalOffsetHelper.applyQuaternion(quatLocal)
          wallSyncPosHelper.copy(wallSyncLocalEndHelper).sub(wallSyncLocalOffsetHelper)
        } else {
          const along = instanceIndex * tileLengthLocal
          wallSyncLocalMinPointHelper.copy(wallSyncLocalStartHelper).addScaledVector(wallSyncLocalUnitDirHelper, along)

          // Place the model so that its local min face along the length axis matches the desired min point.
          wallSyncLocalOffsetHelper.copy(localForward).multiplyScalar(minAlongAxis)
          wallSyncLocalOffsetHelper.applyQuaternion(quatLocal)
          wallSyncPosHelper.copy(wallSyncLocalMinPointHelper).sub(wallSyncLocalOffsetHelper)
        }

        const baselineY = wallSyncPosHelper.y
        const posY = mode === 'body'
          ? (baselineY - scaleY * minY)
          : (baselineY + bodyHeight - minY)
        wallSyncPosHelper.y = posY

        wallSyncScaleHelper.set(1, scaleY, 1)
        wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quatLocal, wallSyncScaleHelper)
        matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
      }
    })

    return matrices
  }

  type WallCornerModelRule = NonNullable<WallComponentProps['cornerModels']>[number]

  function resolveWallBodyHeightForSegment(segment: WallDynamicMesh['segments'][number]): number {
    const raw = typeof (segment as any)?.height === 'number' ? (segment as any).height : Number((segment as any)?.height)
    if (!Number.isFinite(raw)) {
      return 1
    }
    return Math.max(0.001, raw)
  }

  function resolveWallModelHeight(bounds: THREE.Box3): number {
    return Math.max(1e-6, bounds.max.y - bounds.min.y)
  }


  function pickWallCornerRule(
    angleRadians: number,
    rules: WallCornerModelRule[],
    mode: 'body' | 'head',
  ): WallCornerModelRule | null {
    if (!Number.isFinite(angleRadians)) {
      return null
    }

    const angleDeg = Math.max(0, Math.min(180, THREE.MathUtils.radToDeg(angleRadians)))

    // Special-case straight joints (interior angle ≈ 180°): if a 180° rule exists,
    // always use it and ignore tolerance. Use a small radian epsilon.
    const RAD_STRAIGHT_EPS = 1e-3
    if (Math.abs(angleRadians - Math.PI) < RAD_STRAIGHT_EPS) {
      for (const rule of rules) {
        const rawAsset = mode === 'body' ? (rule as any)?.bodyAssetId : (rule as any)?.headAssetId
        const assetId = typeof rawAsset === 'string' && rawAsset.trim().length ? rawAsset.trim() : null
        if (!assetId) {
          continue
        }
        const rawAngle = typeof (rule as any).angle === 'number' ? (rule as any).angle : Number((rule as any).angle)
        const ruleAngle = Number.isFinite(rawAngle) ? Math.max(0, Math.min(180, rawAngle)) : 90
        if (ruleAngle >= 180 - 1e-6) {
          return rule
        }
      }
    }

    let best: { rule: WallCornerModelRule; diff: number; ruleAngle: number } | null = null

    for (const rule of rules) {
      const rawAsset = mode === 'body' ? (rule as any)?.bodyAssetId : (rule as any)?.headAssetId
      const assetId = typeof rawAsset === 'string' && rawAsset.trim().length ? rawAsset.trim() : null
      if (!assetId) {
        continue
      }

      const rawAngle = typeof (rule as any).angle === 'number' ? (rule as any).angle : Number((rule as any).angle)
      const ruleAngle = Number.isFinite(rawAngle) ? Math.max(0, Math.min(180, rawAngle)) : 90
      const rawTolerance = typeof (rule as any).tolerance === 'number' ? (rule as any).tolerance : Number((rule as any).tolerance)
      const tolerance = Number.isFinite(rawTolerance) ? Math.max(0, Math.min(90, rawTolerance)) : 5

      const diff = Math.abs(angleDeg - ruleAngle)
      if (diff > tolerance + 1e-6) {
        continue
      }

      if (!best) {
        best = { rule, diff, ruleAngle }
        continue
      }
      if (diff + 1e-6 < best.diff) {
        best = { rule, diff, ruleAngle }
        continue
      }
      if (Math.abs(diff - best.diff) <= 1e-6 && ruleAngle + 1e-6 < best.ruleAngle) {
        best = { rule, diff, ruleAngle }
      }
    }

    return best ? best.rule : null
  }

  function computeWallJointLocalMatricesByAsset(
    definition: WallDynamicMesh,
    options: { cornerModels?: WallCornerModelRule[]; mode: 'body' | 'head'; getAssetBounds: (assetId: string) => THREE.Box3 | null },
  ): { matricesByAssetId: Map<string, THREE.Matrix4[]>; primaryAssetId: string | null; mode: 'body' | 'head' } {
    const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
    let primaryAssetId: string | null = null

    if (definition.segments.length < 2) {
      return { matricesByAssetId, primaryAssetId, mode: options.mode }
    }

    const rulesSource = Array.isArray(options.cornerModels) ? options.cornerModels : []

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
      // 1) 计算当前段的入射向量（incoming）
      //    - 将当前段的 start/end 写入临时向量（只取 XZ 平面）
      wallSyncStartHelper.set(current.start.x, current.start.y, current.start.z)
      wallSyncEndHelper.set(current.end.x, current.end.y, current.end.z)
      wallSyncIncomingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
      // 忽略 Y 分量，使计算仅在 XZ 平面进行
      wallSyncIncomingHelper.y = 0

      // 2) 计算下一段的出射向量（outgoing）
      //    - 将下一段的 start/end 写入临时向量（只取 XZ 平面）
      wallSyncStartHelper.set(next.start.x, next.start.y, next.start.z)
      wallSyncEndHelper.set(next.end.x, next.end.y, next.end.z)
      wallSyncOutgoingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
      wallSyncOutgoingHelper.y = 0

      // 3) 如果任一向量长度非常小（退化段）则放弃该拐角
      if (wallSyncIncomingHelper.lengthSq() < WALL_SYNC_EPSILON || wallSyncOutgoingHelper.lengthSq() < WALL_SYNC_EPSILON) {
        return
      }

      // 4) 归一化向量以便计算角度与方向
      wallSyncIncomingHelper.normalize()
      wallSyncOutgoingHelper.normalize()

      // 5) 通过点积计算“内角”（straight = 180°）
      //    - 转角: acos(incoming·outgoing)
      //    - 内角: acos((-incoming)·outgoing) = π - 转角
      const dotInterior = THREE.MathUtils.clamp(-wallSyncIncomingHelper.dot(wallSyncOutgoingHelper), -1, 1)
      const angle = Math.acos(dotInterior)
      // 如果角度不是有效数值，则不放置拐角模型
      if (!Number.isFinite(angle)) {
        return
      }

      // 6) 根据角度与用户定义的规则选择一个拐角模型
      const rule = pickWallCornerRule(angle, rulesSource, options.mode)
      if (!rule) {
        // 未匹配到任何规则时，跳过该拐角
        return
      }

      const rawAsset = options.mode === 'body' ? (rule as any)?.bodyAssetId : (rule as any)?.headAssetId
      const assetId = typeof rawAsset === 'string' ? rawAsset.trim() : ''
      if (!assetId) {
        return
      }

      const bounds = options.getAssetBounds(assetId)
      const bodyHeight = resolveWallBodyHeightForSegment(current)
      const templateHeight = bounds ? resolveWallModelHeight(bounds) : 1
      const minY = bounds ? bounds.min.y : 0
      const scaleY = options.mode === 'body' ? (bodyHeight / templateHeight) : 1
      const baselineY = corner.y
      const posY = options.mode === 'body'
        ? (baselineY - scaleY * minY)
        : (baselineY + bodyHeight - minY)

      // 7) 计算“内角”的角平分线（bisector）作为模型朝向的基准
      //    - 如果两向量几乎反向（相加后接近 0），使用出射向量作为退化情况下的朝向
      wallSyncBisectorHelper.copy(wallSyncIncomingHelper).multiplyScalar(-1).add(wallSyncOutgoingHelper)
      if (wallSyncBisectorHelper.lengthSq() < WALL_SYNC_EPSILON) {
        wallSyncBisectorHelper.copy(wallSyncOutgoingHelper)
      }

      const localForward = new THREE.Vector3()
      const forwardAxis = options.mode === 'body' ? (rule as any)?.bodyForwardAxis : (rule as any)?.headForwardAxis
      const yawDeg = options.mode === 'body' ? (rule as any)?.bodyYawDeg : (rule as any)?.headYawDeg
      writeWallLocalForward(localForward, forwardAxis as WallForwardAxis)

      // 8) 将平分线转换为四元数（模型局部 forwardAxis 对准平分线）
      const quat = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncBisectorHelper.normalize())
      // 9) 额外 yaw（绕 Y 旋转）
      if (typeof yawDeg === 'number' && Number.isFinite(yawDeg) && Math.abs(yawDeg) > 1e-9) {
        wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(yawDeg))
        quat.multiply(wallSyncYawQuatHelper)
      }

      // 10) 组成最终的局部变换矩阵：位置 = 拐角点，旋转 = 计算出的四元数，缩放 = 单位缩放
      wallSyncScaleHelper.set(1, scaleY, 1)
      wallSyncPosHelper.set(corner.x, posY, corner.z)
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)

      // 11) 将计算出的矩阵打包并推入对应 assetId 的矩阵数组中
      pushMatrix(assetId, new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
    }

    const chains = splitWallSegmentsIntoChains(definition.segments)
    for (const chain of chains) {
      for (let i = 0; i < chain.length - 1; i += 1) {
        const current = chain[i]!
        const next = chain[i + 1]!

        wallSyncPosHelper.set(current.end.x, current.end.y, current.end.z)
        buildCorner(current, next, wallSyncPosHelper)
      }

      // Closed loop (within this chain): add corner for last -> first.
      const first = chain[0]
      const last = chain[chain.length - 1]
      if (!first || !last) {
        continue
      }
      wallSyncStartHelper.set(first.start.x, first.start.y, first.start.z)
      wallSyncEndHelper.set(last.end.x, last.end.y, last.end.z)
      if (distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) <= 1e-8) {
        wallSyncPosHelper.copy(wallSyncEndHelper)
        buildCorner(last, first, wallSyncPosHelper)
      }
    }

    return { matricesByAssetId, primaryAssetId, mode: options.mode }
  }

  function computeWallEndCapLocalMatrices(
    definition: WallDynamicMesh,
    bounds: THREE.Box3,
    mode: 'body' | 'head',
    orientation: WallModelOrientation,
  ): THREE.Matrix4[] {
    const matrices: THREE.Matrix4[] = []
    if (!definition.segments.length) {
      return matrices
    }

    const chains = splitWallSegmentsIntoChains(definition.segments)

    const localForward = new THREE.Vector3()
    writeWallLocalForward(localForward, orientation.forwardAxis)
    const { minAlongAxis } = resolveWallBoundsAlongAxis(bounds, orientation.forwardAxis)
    const templateHeight = resolveWallModelHeight(bounds)
    const minY = bounds.min.y

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

    for (const chain of chains) {
      if (!chain.length) {
        continue
      }

      // Determine if this chain is closed: first.start == last.end (XZ plane).
      const firstSeg = chain[0]!
      const lastSeg = chain[chain.length - 1]!
      wallSyncStartHelper.set(firstSeg.start.x, firstSeg.start.y, firstSeg.start.z)
      wallSyncEndHelper.set(lastSeg.end.x, lastSeg.end.y, lastSeg.end.z)
      const closed = distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) <= 1e-8
      if (closed) {
        continue
      }

      // Start cap points outward: opposite of the first segment direction.
      const firstDir = findDirectionForSegment(firstSeg, wallSyncLocalUnitDirHelper)
      if (firstDir.lengthSq() > WALL_SYNC_EPSILON) {
        const bodyHeight = resolveWallBodyHeightForSegment(firstSeg)
        const scaleY = mode === 'body' ? (bodyHeight / templateHeight) : 1
        wallSyncLocalDirHelper.copy(firstDir).multiplyScalar(-1)
        const quat = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncLocalDirHelper)
        if (orientation.yawDeg) {
          wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(orientation.yawDeg))
          quat.multiply(wallSyncYawQuatHelper)
        }
        wallSyncLocalOffsetHelper.copy(localForward).multiplyScalar(minAlongAxis)
        wallSyncLocalOffsetHelper.applyQuaternion(quat)
        const baselineY = firstSeg.start.y
        const posY = mode === 'body'
          ? (baselineY - scaleY * minY)
          : (baselineY + bodyHeight - minY)
        wallSyncPosHelper.set(firstSeg.start.x, posY, firstSeg.start.z)
        wallSyncPosHelper.sub(wallSyncLocalOffsetHelper)
        wallSyncScaleHelper.set(1, scaleY, 1)
        wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
        matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
      }

      // End cap points outward: along the last segment direction.
      const lastDir = findDirectionForSegment(lastSeg, wallSyncLocalUnitDirHelper)
      if (lastDir.lengthSq() > WALL_SYNC_EPSILON) {
        const bodyHeight = resolveWallBodyHeightForSegment(lastSeg)
        const scaleY = mode === 'body' ? (bodyHeight / templateHeight) : 1
        wallSyncLocalDirHelper.copy(lastDir)
        const quat = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncLocalDirHelper)
        if (orientation.yawDeg) {
          wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(orientation.yawDeg))
          quat.multiply(wallSyncYawQuatHelper)
        }
        wallSyncLocalOffsetHelper.copy(localForward).multiplyScalar(minAlongAxis)
        wallSyncLocalOffsetHelper.applyQuaternion(quat)
        const baselineY = lastSeg.end.y
        const posY = mode === 'body'
          ? (baselineY - scaleY * minY)
          : (baselineY + bodyHeight - minY)
        wallSyncPosHelper.set(lastSeg.end.x, posY, lastSeg.end.z)
        wallSyncPosHelper.sub(wallSyncLocalOffsetHelper)
        wallSyncScaleHelper.set(1, scaleY, 1)
        wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
        matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
      }
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

  function ensureWallGroup(
    container: THREE.Object3D,
    node: SceneNode,
    signatureKey: string,
    wallDefinition: WallDynamicMesh,
    smoothing: number,
  ): THREE.Group {
    const userData = container.userData ?? (container.userData = {})
    let wallGroup = userData.wallGroup as THREE.Group | undefined
    if (wallGroup) {
      return wallGroup
    }

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

    // Be defensive: remove any procedural wall groups that might have been left behind.
    // (e.g. after switching to instanced wall models)
    const candidates = container.children.filter((child) => {
      const group = child as THREE.Group
      return Boolean(group?.isGroup && group.name === 'WallGroup' && (group.userData as any)?.dynamicMeshType === 'Wall')
    }) as THREE.Group[]

    const wallGroup = userData.wallGroup as THREE.Group | undefined
    if (wallGroup && !candidates.includes(wallGroup)) {
      candidates.push(wallGroup)
    }

    if (!candidates.length) {
      return
    }

    for (const group of candidates) {
      disposeWallGroupResources(group)
      group.removeFromParent()
    }

    delete userData.wallGroup
  }

  function syncWallContainer(container: THREE.Object3D, node: SceneNode, signatureKey: string): void {
    // ============================
    // 该函数职责（重要）：
    // - 根据 SceneNode 上的 wall 组件配置、动态网格数据、以及模型资源是否已就绪，
    //   决定当前 wall 的渲染方式：
    //   1) 纯程序生成的墙体（procedural wallGroup）
    //   2) 基于模型资源的实例化渲染（instanced models: body/head/corner/caps）
    // - 在资源未加载完成时，使用程序墙体作为“可视回退”，避免编辑器里出现空白。
    // - 维护与拾取（pick）相关的代理对象：实例化模式下启用 pick proxy；否则移除。
    // - 同步 / 清理 instanced 实例与 bounds 缓存（用于拾取/框选等）。
    // ============================
    if (node.dynamicMesh?.type !== 'Wall') {
      return
    }

    if (isWallDragActive(node.id)) {
      // 拖拽过程中会走一套“临时实例矩阵”的实时更新逻辑（见 syncWallDragInstancedMatrices）。
      // 为避免拖拽手感抖动/覆盖临时状态，这里直接跳过常规同步。
      return
    }

    // 实例化矩阵提交依赖 container.matrixWorld；确保其在本次同步前已更新。
    // 这对“首次进入场景 / 刚挂载到父节点”的场景尤其关键。
    container.updateMatrixWorld(true)

    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined

    // 空气墙（AirWall）：编辑器里通常需要“可区分、半透明”的视觉提示。
    // 同时它不应该实例化加载/渲染各种模型资源（否则会变成实心墙体的模型）。
    const isAirWall = Boolean(wallComponent?.props?.isAirWall)

    // 统一规整 wall props（clampWallProps 会负责缺省值/范围约束）。
    // smoothing 同时用于：
    // - 程序墙体的几何平滑（createWallGroup/updateWallGroup）
    // - 动态网格签名（signature）用于判断是否需要重建/更新几何。
    const wallProps = wallComponent
      ? clampWallProps(wallComponent.props as Partial<WallComponentProps> | null | undefined)
      : null
    const smoothing = wallProps?.smoothing ?? resolveWallSmoothingFromNode(node)

    // 各类实例化模型资源：
    // - body/head：沿墙段平铺的主体模型（可以按段高度进行 Y 方向缩放）。
    // - endCaps：首尾端盖（仅非闭合路径时才会放置）。
    const bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
    const headAssetId = wallComponent?.props?.headAssetId ?? null
    const bodyEndCapAssetId = wallComponent?.props?.bodyEndCapAssetId ?? null
    const headEndCapAssetId = wallComponent?.props?.headEndCapAssetId ?? null
    // 拐角模型规则：根据相邻墙段形成的“内角”在规则表中匹配对应模型。
    // 规则既可以配置 body 的拐角模型，也可以配置 head 的拐角模型。
    const cornerModels = Array.isArray(wallComponent?.props?.cornerModels)
      ? wallComponent!.props!.cornerModels!
      : []
    const bodyCornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof (entry as any)?.bodyAssetId === 'string' ? (entry as any).bodyAssetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()
    const headCornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof (entry as any)?.headAssetId === 'string' ? (entry as any).headAssetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()
    // definition：节点当前的 wall 动态网格（由用户编辑/运行时生成）。
    // effectiveDefinition：在渲染前，将 wall props（width/height/thickness）覆盖到每段 segment 上，
    // 以保证程序墙体与实例化计算使用一致的尺寸数据。
    const definition = node.dynamicMesh as WallDynamicMesh
    const effectiveDefinition = resolveWallEffectiveDefinition(definition, wallProps)

    // 拐角 joint 需要至少两段才可能存在。
    const canHaveCornerJoints =
      (bodyCornerAssetIds.length > 0 || headCornerAssetIds.length > 0) && definition.segments.length >= 2

    // wantsInstancing：只要配置了任何一种实例化相关资源（body/head/caps/corners），
    // 就尝试走实例化渲染（资源未就绪时会回退到程序墙体）。
    const wantsInstancing = Boolean(
      bodyAssetId || headAssetId || bodyEndCapAssetId || headEndCapAssetId || canHaveCornerJoints,
    )

    const userData = container.userData ?? (container.userData = {})

    // ============================
    // 1) 空气墙：强制使用程序墙体（并应用半透明材质覆盖）
    // ============================
    // 设计意图：空气墙用于“碰撞/导航/逻辑”而非真实墙体外观。
    // 因此：
    // - 不渲染任何实例化模型
    // - 始终保留程序墙体，且以半透明方式显示
    if (isAirWall) {
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, smoothing)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        effectiveDefinition,
        signatureKey,
        { smoothing },
      )
      applyAirWallVisualToWallGroup(wallGroup, true)
      return
    }

    // ============================
    // 2) 完全不需要实例化：使用程序墙体
    // ============================
    if (!wantsInstancing) {
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, smoothing)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        effectiveDefinition,
        signatureKey,
        { smoothing },
      )

      // Editor-only visual: air walls are semi-transparent so they can be distinguished.
      applyAirWallVisualToWallGroup(wallGroup, isAirWall)
      return
    }

    // ============================
    // 3) 需要实例化：先检查资源是否就绪
    // ============================
    // Instanced rendering is enabled, but we may need to fall back to the procedural wall while assets load.
    const needsBodyLoad = Boolean(bodyAssetId && !getCachedModelObject(bodyAssetId))
    const needsHeadLoad = Boolean(headAssetId && !getCachedModelObject(headAssetId))
    const needsBodyCornerLoad = bodyCornerAssetIds.some((id) => !getCachedModelObject(id))
    const needsHeadCornerLoad = headCornerAssetIds.some((id) => !getCachedModelObject(id))
    const needsBodyCapLoad = Boolean(bodyEndCapAssetId && !getCachedModelObject(bodyEndCapAssetId))
    const needsHeadCapLoad = Boolean(headEndCapAssetId && !getCachedModelObject(headEndCapAssetId))

    if (needsBodyLoad && bodyAssetId) {
      scheduleWallAssetLoad(bodyAssetId, node.id, signatureKey)
    }
    if (needsHeadLoad && headAssetId) {
      scheduleWallAssetLoad(headAssetId, node.id, signatureKey)
    }
    if (needsBodyCornerLoad) {
      bodyCornerAssetIds.forEach((assetId) => {
        if (!getCachedModelObject(assetId)) {
          scheduleWallAssetLoad(assetId, node.id, signatureKey)
        }
      })
    }
    if (needsHeadCornerLoad) {
      headCornerAssetIds.forEach((assetId) => {
        if (!getCachedModelObject(assetId)) {
          scheduleWallAssetLoad(assetId, node.id, signatureKey)
        }
      })
    }
    if (needsBodyCapLoad && bodyEndCapAssetId) {
      scheduleWallAssetLoad(bodyEndCapAssetId, node.id, signatureKey)
    }
    if (needsHeadCapLoad && headEndCapAssetId) {
      scheduleWallAssetLoad(headEndCapAssetId, node.id, signatureKey)
    }

    // 任何一种资源还没进入缓存（getCachedModelObject 为空）就认为“未就绪”。
    // 这里的策略是：
    // - 触发对应资源的异步加载（scheduleWallAssetLoad）
    // - 立即回退到程序墙体，让用户可见并可继续编辑
    // - 等加载完成后由 scheduleWallResync 在同一帧批量刷新等待的 node
    if (needsBodyLoad || needsHeadLoad || needsBodyCornerLoad || needsHeadCornerLoad || needsBodyCapLoad || needsHeadCapLoad) {
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, smoothing)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        effectiveDefinition,
        signatureKey,
        { smoothing },
      )
      applyAirWallVisualToWallGroup(wallGroup, false)
      return
    }

    // ============================
    // 4) 资源已就绪：进入实例化渲染
    // ============================
    // primaryAssetId 用于标记“本节点当前的实例化主资源”，便于调试/拾取代理/缓存。
    const primaryAssetId = bodyAssetId
      ?? headAssetId
      ?? (bodyCornerAssetIds[0] ?? null)
      ?? (headCornerAssetIds[0] ?? null)
      ?? bodyEndCapAssetId
      ?? headEndCapAssetId
    userData.instancedAssetId = primaryAssetId
    userData.dynamicMeshType = 'Wall'

    // 计算实例化整体 bounds（用于编辑器拾取/框选等）。
    // 这里会将每个实例的局部包围盒（模型 boundingBox）通过 localMatrix 变换后并入大 bbox。
    wallInstancedBoundsBox.makeEmpty()
    let hasWallBounds = false

    // hasBindings：只要至少生成了一组实例化绑定（body/head/corner/caps 任意一种），
    // 就认为实例化渲染“有效”。如果没有任何绑定，说明实例化并不适用（例如：
    // 只有 cornerModels 但墙段不足/规则未命中等），需要回退显示程序墙体。
    let hasBindings = false

    if (bodyAssetId) {
      const group = getCachedModelObject(bodyAssetId)
      if (group) {
        // body：沿每段墙铺 tile；localMatrices 为每个 tile 的局部变换矩阵。
        const localMatrices = wallProps
          ? computeWallBodyLocalMatrices(definition, group.boundingBox, 'body', wallProps.bodyOrientation)
          : []
        if (localMatrices.length > 0) {
          // bounds 合并：将每个实例的变换 bbox 并入整体 bbox。
          for (const localMatrix of localMatrices) {
            expandBoxByTransformedBoundingBox(wallInstancedBoundsBox, group.boundingBox, localMatrix)
            hasWallBounds = true
          }
          // 将局部矩阵提交给 continuousInstancedModel（底层会生成/更新实例化绑定）。
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

    if (headAssetId) {
      const group = getCachedModelObject(headAssetId)
      if (group) {
        // head：通常用于墙顶装饰/压顶，沿墙段铺设。
        const localMatrices = wallProps
          ? computeWallBodyLocalMatrices(definition, group.boundingBox, 'head', wallProps.headOrientation)
          : []
        if (localMatrices.length > 0) {
          for (const localMatrix of localMatrices) {
            expandBoxByTransformedBoundingBox(wallInstancedBoundsBox, group.boundingBox, localMatrix)
            hasWallBounds = true
          }
          syncInstancedModelCommittedLocalMatrices({
            nodeId: node.id,
            assetId: headAssetId,
            object: container,
            localMatrices,
            bindingIdPrefix: `wall-head:${node.id}:`,
            useNodeIdForIndex0: false,
          })
          hasBindings = true
        }
      }
    }

    {
      // corner joints（拐角件）与端盖：
      // - 按 assetId 分桶生成 localMatrices（同一种拐角模型可能出现多次）。
      // - primaryCornerAssetId 主要用于“没有 bodyAssetId 时，选哪一个实例使用 nodeId 作为 index0”。
      const getBoundsFromCache = (assetId: string): THREE.Box3 | null => {
        const group = getCachedModelObject(assetId)
        return group?.boundingBox ?? null
      }

      const bodyJointBuckets = computeWallJointLocalMatricesByAsset(definition, {
        cornerModels,
        mode: 'body',
        getAssetBounds: getBoundsFromCache,
      })
      const headJointBuckets = computeWallJointLocalMatricesByAsset(definition, {
        cornerModels,
        mode: 'head',
        getAssetBounds: getBoundsFromCache,
      })
      const primaryCornerAssetId = bodyJointBuckets.primaryAssetId ?? headJointBuckets.primaryAssetId

      for (const jointBuckets of [bodyJointBuckets, headJointBuckets] as const) {
        if (!jointBuckets.matricesByAssetId.size) {
          continue
        }
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

          const useNodeIdForIndex0 = !bodyAssetId && assetId === primaryCornerAssetId
          // 对每一种拐角模型分别提交实例化矩阵。
          syncInstancedModelCommittedLocalMatrices({
            nodeId: node.id,
            assetId,
            object: container,
            localMatrices,
            bindingIdPrefix: `wall-joint-${jointBuckets.mode}:${node.id}:${assetId}:`,
            useNodeIdForIndex0,
          })
          hasBindings = true
        }
      }

      if (bodyEndCapAssetId) {
        // body 端盖：仅在非闭合路径时才会生成矩阵（computeWallEndCapLocalMatrices 内部判断）。
        const useNodeIdForIndex0 = !bodyAssetId && !primaryCornerAssetId
        const group = getCachedModelObject(bodyEndCapAssetId)
        if (group) {
          const localMatrices = wallProps
            ? computeWallEndCapLocalMatrices(definition, group.boundingBox, 'body', wallProps.bodyEndCapOrientation)
            : []
          if (localMatrices.length > 0) {
            for (const localMatrix of localMatrices) {
              expandBoxByTransformedBoundingBox(wallInstancedBoundsBox, group.boundingBox, localMatrix)
              hasWallBounds = true
            }
            syncInstancedModelCommittedLocalMatrices({
              nodeId: node.id,
              assetId: bodyEndCapAssetId,
              object: container,
              localMatrices,
              bindingIdPrefix: `wall-cap-body:${node.id}:`,
              useNodeIdForIndex0,
            })
            hasBindings = hasBindings || localMatrices.length > 0
          }
        }
      }

      if (headEndCapAssetId) {
        // head 端盖：同上。
        const group = getCachedModelObject(headEndCapAssetId)
        if (group) {
          const localMatrices = wallProps
            ? computeWallEndCapLocalMatrices(definition, group.boundingBox, 'head', wallProps.headEndCapOrientation)
            : []
          if (localMatrices.length > 0) {
            for (const localMatrix of localMatrices) {
              expandBoxByTransformedBoundingBox(wallInstancedBoundsBox, group.boundingBox, localMatrix)
              hasWallBounds = true
            }
            syncInstancedModelCommittedLocalMatrices({
              nodeId: node.id,
              assetId: headEndCapAssetId,
              object: container,
              localMatrices,
              bindingIdPrefix: `wall-cap-head:${node.id}:`,
              useNodeIdForIndex0: false,
            })
            hasBindings = hasBindings || localMatrices.length > 0
          }
        }
      }
    }

    // ============================
    // 5) 没有任何绑定：实例化不适用 → 回退程序墙体
    // ============================
    // 例如：
    // - 只有 cornerModels 但规则未命中/段数不足
    // - 动态网格退化（段长度≈0 导致矩阵为空）
    if (!hasBindings) {
      // No instanced geometry applicable (e.g. single segment w/ only corner models): keep procedural wall visible.
      releaseModelInstancesForNode(node.id)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, smoothing)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        effectiveDefinition,
        signatureKey,
        { smoothing },
      )
      applyAirWallVisualToWallGroup(wallGroup, false)
      return
    }

    // ============================
    // 6) 实例化生效：移除程序墙体，更新 bounds 与 pick proxy
    // ============================
    // 注意：这里移除的是“程序生成的 wallGroup”，不是模型资源实例。
    removeWallGroup(container)

    // 将 bounds 写入 userData，供外部（拾取、框选、Gizmo 等）快速读取。
    if (hasWallBounds && !wallInstancedBoundsBox.isEmpty()) {
      userData.instancedBounds = {
        min: [wallInstancedBoundsBox.min.x, wallInstancedBoundsBox.min.y, wallInstancedBoundsBox.min.z],
        max: [wallInstancedBoundsBox.max.x, wallInstancedBoundsBox.max.y, wallInstancedBoundsBox.max.z],
      }
    } else {
      delete userData.instancedBounds
    }

    if (hasBindings) {
      // 有实例化绑定时，确保 pick proxy 存在（用于命中测试/选中）。
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
