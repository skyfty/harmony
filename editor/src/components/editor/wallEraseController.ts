import * as THREE from 'three'
import type { Ref } from 'vue'
import type {
  SceneNode,
  SceneNodeComponentState,
  WallDynamicMesh,
  WallOpening,
  WallRepeatErasedSlot,
} from '@schema/index'
import {
  getModelInstanceBindingsForNode,
  findBindingIdForInstance,
  findNodeIdForInstance,
} from '@schema/modelObjectCache'
import {
  WALL_INSTANCED_BINDINGS_USERDATA_KEY,
  type WallInstancedBindingSpec,
} from '@schema/wallInstancing'
import {
  WALL_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_WIDTH,
  clampWallProps,
  type WallComponentProps,
} from '@schema/components'
import { addWallOpeningToDefinition, removeWallOpeningFromDefinition } from '@schema/wallLayout'
import {
  getWallLocalPointAtDefinitionChainDistance,
  computeWallOpeningForLocalHit,
  findContainingWallOpeningIndex,
} from './wallSegmentUtils'
import { findSceneNode } from './sceneUtils'

export type WallRepeatPreviewSlot = {
  mesh: THREE.InstancedMesh
  index: number
}

type ResolvedWallInstancedBindingMeta = {
  chainIndex: number
  arcStart: number | null
  arcEnd: number | null
  repeatSlotIndex: number | null
}

type WallInstancedBindingMeta = {
  chainIndex?: unknown
  chainArcStart?: unknown
  chainArcEnd?: unknown
  repeatSlotIndex?: unknown
}

type WallInstancedPickHit = {
  pointWorld: THREE.Vector3
  hitObject: THREE.Object3D
  bindingId: string
  nodeId: string
  bindingMeta: ResolvedWallInstancedBindingMeta | null
}

type WallRayHit = {
  pointWorld: THREE.Vector3
  object: THREE.Object3D
}

type WallStretchPreviewDescriptor = {
  kind: 'stretch'
  worldA: THREE.Vector3
  worldB: THREE.Vector3
  height: number
  width: number
}

type WallRepeatPreviewDescriptor = {
  kind: 'repeatInstances'
  meshes: THREE.Mesh[]
  instancedSlots: WallRepeatPreviewSlot[]
}

export type SelectedWallEraseTarget =
  | {
    kind: 'stretch-erase'
    nodeId: string
    opening: WallOpening
    preview: WallStretchPreviewDescriptor
    dragKey: string
  }
  | {
    kind: 'stretch-repair'
    nodeId: string
    openingIndex: number
    opening: WallOpening
    preview: WallStretchPreviewDescriptor
    dragKey: string
  }
  | {
    kind: 'repeat-erase'
    nodeId: string
    slots: WallRepeatErasedSlot[]
    preview: WallRepeatPreviewDescriptor
    dragKey: string
  }

export function resolveSelectedWallRenderMode(node: SceneNode): 'stretch' | 'repeatInstances' {
  const component = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
  try {
    const props = clampWallProps(component?.props as Partial<WallComponentProps> | null)
    return props.wallRenderMode === 'repeatInstances' ? 'repeatInstances' : 'stretch'
  } catch {
    return 'stretch'
  }
}

export function extractWallRepeatInstanceMeta(
  mesh: THREE.Mesh | null | undefined,
): { chainIndex: number; slotIndex: number } | null {
  const meta = mesh?.userData?.wallInstanceMeta as { chainIndex?: unknown; repeatSlotIndex?: unknown } | undefined
  if (!meta) {
    return null
  }
  const chainIndex = Math.max(0, Math.trunc(Number(meta.chainIndex ?? 0)))
  const slotIndex = Math.max(0, Math.trunc(Number(meta.repeatSlotIndex ?? -1)))
  if (!Number.isFinite(chainIndex) || !Number.isFinite(slotIndex) || slotIndex < 0) {
    return null
  }
  return { chainIndex, slotIndex }
}

function extractWallHitArcMeta(mesh: THREE.Mesh | null | undefined): { chainIndex: number; arcStart: number; arcEnd: number } | null {
  const meta = mesh?.userData?.wallInstanceMeta as {
    chainIndex?: unknown
    chainArcStart?: unknown
    chainArcEnd?: unknown
  } | undefined
  if (!meta) {
    return null
  }
  const chainIndex = Math.max(0, Math.trunc(Number(meta.chainIndex ?? 0)))
  const arcStart = Number(meta.chainArcStart)
  const arcEnd = Number(meta.chainArcEnd)
  if (!Number.isFinite(chainIndex) || !Number.isFinite(arcStart) || !Number.isFinite(arcEnd) || arcEnd <= arcStart + 1e-6) {
    return null
  }
  return { chainIndex, arcStart, arcEnd }
}

function extractWallRepeatInstanceMetaFromHitObject(
  hitObject: THREE.Object3D,
  wallRoot: THREE.Object3D,
): { chainIndex: number; slotIndex: number } | null {
  let current: THREE.Object3D | null = hitObject
  while (current) {
    const mesh = (current as THREE.Mesh).isMesh ? (current as THREE.Mesh) : null
    const meta = extractWallRepeatInstanceMeta(mesh)
    if (meta) {
      return meta
    }
    if (current === wallRoot) {
      break
    }
    current = current.parent ?? null
  }
  return null
}

function extractWallHitArcMetaFromHitObject(
  hitObject: THREE.Object3D,
  wallRoot: THREE.Object3D,
): { chainIndex: number; arcStart: number; arcEnd: number } | null {
  let current: THREE.Object3D | null = hitObject
  while (current) {
    const mesh = (current as THREE.Mesh).isMesh ? (current as THREE.Mesh) : null
    const meta = extractWallHitArcMeta(mesh)
    if (meta) {
      return meta
    }
    if (current === wallRoot) {
      break
    }
    current = current.parent ?? null
  }
  return null
}

function collectWallMeshesForRepeatSlot(
  wallObject: THREE.Object3D,
  chainIndex: number,
  slotIndex: number,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  wallObject.updateWorldMatrix(true, true)
  wallObject.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const meta = extractWallRepeatInstanceMeta(mesh)
    if (!meta) {
      return
    }
    if (meta.chainIndex !== chainIndex || meta.slotIndex !== slotIndex) {
      return
    }
    meshes.push(mesh)
  })
  return meshes
}

function collectWallInstancedSlotsForRepeatSlot(
  wallObject: THREE.Object3D,
  nodeId: string,
  chainIndex: number,
  slotIndex: number,
): WallRepeatPreviewSlot[] {
  const previewSlots: WallRepeatPreviewSlot[] = []
  const bindings = getModelInstanceBindingsForNode(nodeId)
  bindings.forEach((binding) => {
    const meta = resolveWallInstancedBindingMetaByBindingId(wallObject, binding.bindingId, nodeId)
    if (!meta) {
      return
    }
    if (meta.chainIndex !== chainIndex || meta.repeatSlotIndex !== slotIndex) {
      return
    }
    binding.slots.forEach((slot) => {
      previewSlots.push({ mesh: slot.mesh, index: slot.index })
    })
  })
  return previewSlots
}

function getWallInstancedBindingSpecs(object: THREE.Object3D): WallInstancedBindingSpec[] {
  const raw = (object.userData as Record<string, unknown> | undefined)?.[WALL_INSTANCED_BINDINGS_USERDATA_KEY]
  return Array.isArray(raw) ? raw.filter((entry) => Boolean(entry && typeof entry === 'object')) as WallInstancedBindingSpec[] : []
}

function resolveWallInstancedBindingMetaByBindingId(
  wallObject: THREE.Object3D,
  bindingId: string,
  nodeId: string,
): ResolvedWallInstancedBindingMeta | null {
  const specs = getWallInstancedBindingSpecs(wallObject)
  for (const spec of specs) {
    const metas = Array.isArray(spec.instanceMetas) ? spec.instanceMetas as WallInstancedBindingMeta[] : []
    if (!metas.length) {
      continue
    }
    const resolveMeta = (meta: WallInstancedBindingMeta | undefined): ResolvedWallInstancedBindingMeta | null => {
      const chainIndex = Math.max(0, Math.trunc(Number(meta?.chainIndex ?? 0)))
      const arcStart = Number(meta?.chainArcStart)
      const arcEnd = Number(meta?.chainArcEnd)
      const repeatSlotIndex = Number(meta?.repeatSlotIndex)
      return {
        chainIndex,
        arcStart: Number.isFinite(arcStart) ? arcStart : null,
        arcEnd: Number.isFinite(arcEnd) ? arcEnd : null,
        repeatSlotIndex: Number.isFinite(repeatSlotIndex) && repeatSlotIndex >= 0
          ? Math.max(0, Math.trunc(repeatSlotIndex))
          : null,
      }
    }
    if (spec.useNodeIdForIndex0 && bindingId === nodeId) {
      return resolveMeta(metas[0])
    }
    if (!bindingId.startsWith(spec.bindingIdPrefix)) {
      continue
    }
    const indexRaw = bindingId.slice(spec.bindingIdPrefix.length)
    const index = Number.parseInt(indexRaw, 10)
    if (!Number.isFinite(index) || index < 0 || index >= metas.length) {
      continue
    }
    return resolveMeta(metas[index])
  }
  return null
}

function resolveSelectedWallInstancedPickHitFromCurrentRay(
  selectedWallId: string,
  wallObject: THREE.Object3D,
  raycaster: THREE.Raycaster,
  collectInstancedPickTargets: () => THREE.InstancedMesh[],
): WallInstancedPickHit | null {
  const pickTargets = collectInstancedPickTargets()
  const intersections = raycaster.intersectObjects(pickTargets, false)
  intersections.sort((a, b) => a.distance - b.distance)

  for (const intersection of intersections) {
    if (typeof intersection.instanceId !== 'number' || intersection.instanceId < 0) {
      continue
    }
    const mesh = intersection.object as THREE.InstancedMesh
    const nodeId = findNodeIdForInstance(mesh, intersection.instanceId)
    if (nodeId !== selectedWallId) {
      continue
    }
    const bindingId = findBindingIdForInstance(mesh, intersection.instanceId)
    if (!bindingId) {
      continue
    }
    const bindingMeta = resolveWallInstancedBindingMetaByBindingId(wallObject, bindingId, selectedWallId)
    return {
      pointWorld: (intersection.point as THREE.Vector3).clone(),
      hitObject: mesh,
      bindingId,
      nodeId,
      bindingMeta,
    }
  }
  return null
}

function resolveWallRayHitFromCurrentRay(
  wallObject: THREE.Object3D,
  raycaster: THREE.Raycaster,
  groundPlane: THREE.Plane,
  options?: {
    allowPlaneFallback?: boolean
    preferredHitObject?: (object: THREE.Object3D) => boolean
  },
): WallRayHit | null {
  wallObject.updateWorldMatrix(true, true)
  const wallHits = raycaster.intersectObject(wallObject, true)
  wallHits.sort((a, b) => a.distance - b.distance)
  const first = (
    wallHits.find((hit) => Boolean(hit.point) && (options?.preferredHitObject ? options.preferredHitObject(hit.object) : true))
    ?? wallHits.find((hit) => Boolean(hit.point))
    ?? null
  )
  if (first?.point) {
    return {
      pointWorld: (first.point as THREE.Vector3).clone(),
      object: first.object,
    }
  }

  if (options?.allowPlaneFallback) {
    const planeHit = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
      return {
        pointWorld: planeHit,
        object: wallObject,
      }
    }
  }
  return null
}

function buildWallStretchPreviewDescriptor(
  wallMesh: WallDynamicMesh,
  wallObject: THREE.Object3D,
  opening: WallOpening,
): WallStretchPreviewDescriptor | null {
  const localA = getWallLocalPointAtDefinitionChainDistance(wallMesh, opening.chainIndex, opening.start)
  const localB = getWallLocalPointAtDefinitionChainDistance(wallMesh, opening.chainIndex, opening.end)
  if (!localA || !localB) {
    return null
  }
  const heightRaw = Number(wallMesh?.dimensions?.height)
  const widthRaw = Number(wallMesh?.dimensions?.width)
  const height = Number.isFinite(heightRaw) && heightRaw > 0 ? heightRaw : WALL_DEFAULT_HEIGHT
  const width = Number.isFinite(widthRaw) && widthRaw > 0 ? widthRaw : WALL_DEFAULT_WIDTH
  return {
    kind: 'stretch',
    worldA: new THREE.Vector3(localA.x, localA.y, localA.z).applyMatrix4(wallObject.matrixWorld),
    worldB: new THREE.Vector3(localB.x, localB.y, localB.z).applyMatrix4(wallObject.matrixWorld),
    height,
    width,
  }
}

export function mergeWallRepeatErasedSlots(
  existing: Array<{ chainIndex?: unknown; slotIndex?: unknown }> | undefined,
  additions: WallRepeatErasedSlot[],
): WallRepeatErasedSlot[] {
  const nextSlotSet = new Set<string>()
  ;(Array.isArray(existing) ? existing : []).forEach((slot) => {
    const chainIndex = Math.max(0, Math.trunc(Number(slot?.chainIndex ?? 0)))
    const slotIndex = Math.max(0, Math.trunc(Number(slot?.slotIndex ?? -1)))
    if (Number.isFinite(chainIndex) && Number.isFinite(slotIndex) && slotIndex >= 0) {
      nextSlotSet.add(`${chainIndex}:${slotIndex}`)
    }
  })
  additions.forEach((slot) => {
    const chainIndex = Math.max(0, Math.trunc(Number(slot.chainIndex ?? 0)))
    const slotIndex = Math.max(0, Math.trunc(Number(slot.slotIndex ?? -1)))
    if (Number.isFinite(chainIndex) && Number.isFinite(slotIndex) && slotIndex >= 0) {
      nextSlotSet.add(`${chainIndex}:${slotIndex}`)
    }
  })
  return Array.from(nextSlotSet.values())
    .map((key) => {
      const [chainRaw, slotRaw] = key.split(':')
      return {
        chainIndex: Math.max(0, Math.trunc(Number(chainRaw ?? 0))),
        slotIndex: Math.max(0, Math.trunc(Number(slotRaw ?? -1))),
      }
    })
    .filter((slot) => Number.isFinite(slot.chainIndex) && Number.isFinite(slot.slotIndex) && slot.slotIndex >= 0)
    .sort((a, b) => (a.chainIndex - b.chainIndex) || (a.slotIndex - b.slotIndex))
}

type CreateWallEraseControllerOptions = {
  getSceneNodes: () => SceneNode[]
  getSelectedWallId: () => string | null
  objectMap: Map<string, THREE.Object3D>
  raycaster: THREE.Raycaster
  groundPlane: THREE.Plane
  wallRepairModeActive: Ref<boolean>
  wallEraseUnitLengthM: Ref<number>
  collectInstancedPickTargets: () => THREE.InstancedMesh[]
  applyWallMeshEraseResult: (node: SceneNode, nodeId: string, nextWallMesh: WallDynamicMesh) => void
  onAfterApply: () => void
}

export function createWallEraseController(options: CreateWallEraseControllerOptions) {
  function resolveSelectedWallEraseTargetFromCurrentRay(): SelectedWallEraseTarget | null {
    const selectedWallId = options.getSelectedWallId()
    if (!selectedWallId) {
      return null
    }

    const wallObject = options.objectMap.get(selectedWallId) ?? null
    const wallNode = findSceneNode(options.getSceneNodes(), selectedWallId)
    const wallMesh = wallNode && wallNode.dynamicMesh?.type === 'Wall'
      ? wallNode.dynamicMesh as WallDynamicMesh
      : null
    if (!wallObject || !wallNode || !wallMesh) {
      return null
    }

    const renderMode = resolveSelectedWallRenderMode(wallNode)
    const rayHit = resolveWallRayHitFromCurrentRay(wallObject, options.raycaster, options.groundPlane, {
      allowPlaneFallback: options.wallRepairModeActive.value && renderMode === 'stretch',
      preferredHitObject: renderMode === 'repeatInstances'
        ? (object) => Boolean(extractWallRepeatInstanceMetaFromHitObject(object, wallObject))
        : renderMode === 'stretch' && !options.wallRepairModeActive.value
          ? (object) => Boolean(extractWallHitArcMetaFromHitObject(object, wallObject))
          : undefined,
    })

    if (renderMode === 'repeatInstances') {
      if (options.wallRepairModeActive.value) {
        return null
      }

      const directMeta = rayHit ? extractWallRepeatInstanceMetaFromHitObject(rayHit.object, wallObject) : null
      const instancedHit = directMeta
        ? null
        : resolveSelectedWallInstancedPickHitFromCurrentRay(
            selectedWallId,
            wallObject,
            options.raycaster,
            options.collectInstancedPickTargets,
          )
      const resolvedMeta = directMeta ?? (
        instancedHit?.bindingMeta && instancedHit.bindingMeta.repeatSlotIndex !== null
          ? {
              chainIndex: instancedHit.bindingMeta.chainIndex,
              slotIndex: instancedHit.bindingMeta.repeatSlotIndex,
            }
          : null
      )
      if (!resolvedMeta) {
        return null
      }

      const meshes = collectWallMeshesForRepeatSlot(wallObject, resolvedMeta.chainIndex, resolvedMeta.slotIndex)
      const instancedSlots = collectWallInstancedSlotsForRepeatSlot(
        wallObject,
        selectedWallId,
        resolvedMeta.chainIndex,
        resolvedMeta.slotIndex,
      )
      if (!meshes.length && !instancedSlots.length) {
        return null
      }
      return {
        kind: 'repeat-erase',
        nodeId: selectedWallId,
        slots: [{ chainIndex: resolvedMeta.chainIndex, slotIndex: resolvedMeta.slotIndex }],
        preview: { kind: 'repeatInstances', meshes, instancedSlots },
        dragKey: `${selectedWallId}:wall-repeat:${resolvedMeta.chainIndex}:${resolvedMeta.slotIndex}`,
      }
    }

    if (!rayHit) {
      if (renderMode === 'stretch' && !options.wallRepairModeActive.value) {
        const instancedHit = resolveSelectedWallInstancedPickHitFromCurrentRay(
          selectedWallId,
          wallObject,
          options.raycaster,
          options.collectInstancedPickTargets,
        )
        if (instancedHit) {
          const inv = new THREE.Matrix4().copy(wallObject.matrixWorld).invert()
          const localPoint = instancedHit.pointWorld.clone().applyMatrix4(inv)
          const opening = computeWallOpeningForLocalHit(
            wallMesh,
            localPoint,
            options.wallEraseUnitLengthM.value * 0.5,
            instancedHit.bindingMeta && instancedHit.bindingMeta.arcStart !== null && instancedHit.bindingMeta.arcEnd !== null
              ? {
                  preferredChainIndex: instancedHit.bindingMeta.chainIndex,
                  preferredArcStart: instancedHit.bindingMeta.arcStart,
                  preferredArcEnd: instancedHit.bindingMeta.arcEnd,
                }
              : undefined,
          )
          if (opening) {
            const preview = buildWallStretchPreviewDescriptor(wallMesh, wallObject, opening)
            if (preview) {
              const center = (Number(opening.start) + Number(opening.end)) * 0.5
              const bucket = Math.round(center / Math.max(1e-6, options.wallEraseUnitLengthM.value * 0.5))
              return {
                kind: 'stretch-erase',
                nodeId: selectedWallId,
                opening,
                preview,
                dragKey: `${selectedWallId}:wall:${opening.chainIndex}:${bucket}`,
              }
            }
          }
        }
      }
      return null
    }

    const inv = new THREE.Matrix4().copy(wallObject.matrixWorld).invert()
    const localPoint = rayHit.pointWorld.clone().applyMatrix4(inv)

    if (options.wallRepairModeActive.value) {
      const openingIndex = findContainingWallOpeningIndex(wallMesh, localPoint)
      if (openingIndex < 0) {
        return null
      }
      const opening = wallMesh.openings?.[openingIndex] ?? null
      if (!opening) {
        return null
      }
      const preview = buildWallStretchPreviewDescriptor(wallMesh, wallObject, opening)
      if (!preview) {
        return null
      }
      const center = (Number(opening.start) + Number(opening.end)) * 0.5
      const bucket = Math.round(center / Math.max(1e-6, options.wallEraseUnitLengthM.value * 0.5))
      return {
        kind: 'stretch-repair',
        nodeId: selectedWallId,
        openingIndex,
        opening,
        preview,
        dragKey: `${selectedWallId}:wall-repair:${opening.chainIndex}:${bucket}`,
      }
    }

    const hitArcMeta = extractWallHitArcMetaFromHitObject(rayHit.object, wallObject)
    const opening = computeWallOpeningForLocalHit(
      wallMesh,
      localPoint,
      options.wallEraseUnitLengthM.value * 0.5,
      hitArcMeta
        ? {
            preferredChainIndex: hitArcMeta.chainIndex,
            preferredArcStart: hitArcMeta.arcStart,
            preferredArcEnd: hitArcMeta.arcEnd,
          }
        : undefined,
    )
    if (!opening) {
      return null
    }
    const preview = buildWallStretchPreviewDescriptor(wallMesh, wallObject, opening)
    if (!preview) {
      return null
    }
    const center = (Number(opening.start) + Number(opening.end)) * 0.5
    const bucket = Math.round(center / Math.max(1e-6, options.wallEraseUnitLengthM.value * 0.5))
    return {
      kind: 'stretch-erase',
      nodeId: selectedWallId,
      opening,
      preview,
      dragKey: `${selectedWallId}:wall:${opening.chainIndex}:${bucket}`,
    }
  }

  function applySelectedWallEraseTarget(target: SelectedWallEraseTarget): boolean {
    const node = findSceneNode(options.getSceneNodes(), target.nodeId)
    if (!node || node.dynamicMesh?.type !== 'Wall') {
      return false
    }
    const wallMesh = node.dynamicMesh as WallDynamicMesh

    if (target.kind === 'stretch-repair') {
      const nextOpenings = removeWallOpeningFromDefinition(wallMesh, target.openingIndex)
      options.applyWallMeshEraseResult(node, target.nodeId, { ...wallMesh, openings: nextOpenings })
    } else if (target.kind === 'stretch-erase') {
      const nextOpenings = addWallOpeningToDefinition(wallMesh, target.opening)
      options.applyWallMeshEraseResult(node, target.nodeId, { ...wallMesh, openings: nextOpenings })
    } else {
      const repeatErasedSlots = mergeWallRepeatErasedSlots(
        (wallMesh as unknown as { repeatErasedSlots?: Array<{ chainIndex?: unknown; slotIndex?: unknown }> }).repeatErasedSlots,
        target.slots,
      )
      options.applyWallMeshEraseResult(node, target.nodeId, { ...wallMesh, repeatErasedSlots })
    }

    options.onAfterApply()
    return true
  }

  return {
    resolveSelectedWallEraseTargetFromCurrentRay,
    applySelectedWallEraseTarget,
  }
}
