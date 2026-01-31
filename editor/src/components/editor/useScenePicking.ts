import * as THREE from 'three'
import { type Ref } from 'vue'
import { useSceneStore } from '@/stores/sceneStore'
import type { NodeHitResult } from '@/types/scene-viewport-node-hit-result'
import { findNodeIdForInstance } from '@schema/modelObjectCache'
import { flush as flushInstancedBounds, hasPending as instancedBoundsHasPending } from '@schema/instancedBoundsTracker'

export function useScenePicking(
  canvasRef: Ref<HTMLCanvasElement | null>,
  camera: Ref<THREE.Camera | null>,
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
  rootGroup: THREE.Group,
  instancedMeshGroup: THREE.Group,
  objectMap: Map<string, THREE.Object3D>,
  options?: {
    getInstancedPickTargets?: () => THREE.Object3D[]
  }
) {
  const sceneStore = useSceneStore()

  const DEFAULT_MAX_PICK_DISTANCE = 100
  function getMaxPickDistance(): number {
    const raw = (globalThis as any).__HARMONY_PICK_MAX_DISTANCE__
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PICK_DISTANCE
  }

  function isPickProxyObject(object: THREE.Object3D | null): boolean {
    let current: THREE.Object3D | null = object
    while (current) {
      const userData = current.userData as Record<string, unknown> | undefined
      if (userData?.instancedPickProxy === true) {
        return true
      }
      current = current.parent ?? null
    }
    return false
  }

  function isEditorOnlyObject(object: THREE.Object3D | null): boolean {
    let current: THREE.Object3D | null = object
    while (current) {
      const userData = current.userData as Record<string, unknown> | undefined
      if (userData?.editorOnly === true) {
        return true
      }
      current = current.parent ?? null
    }
    return false
  }

  function resolveRoadSegmentIndexFromObject(object: THREE.Object3D | null): number | null {
    let current: THREE.Object3D | null = object
    while (current) {
      const raw = current.userData?.roadSegmentIndex
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
        return raw
      }
      current = current.parent ?? null
    }
    return null
  }

  function resolveRoadSegmentIndexFromIntersection(intersection: THREE.Intersection): number | null {
    const instanceId = typeof intersection.instanceId === 'number' ? intersection.instanceId : null
    const object = intersection.object as THREE.Object3D

    // Road instanced bodies use the instanceId as the segment index.
    if (
      instanceId !== null &&
      instanceId >= 0 &&
      object &&
      object.userData?.roadSegmentIndexMode === 'instanceId'
    ) {
      return instanceId
    }

    return resolveRoadSegmentIndexFromObject(object)
  }

  function resolveNodeIdFromObject(object: THREE.Object3D | null): string | null {
    let current: THREE.Object3D | null = object
    while (current) {
      const nodeId = current.userData?.nodeId as string | undefined
      if (nodeId) {
        return nodeId
      }
      current = current.parent ?? null
    }
    return null
  }

  function resolveNodeIdFromIntersection(intersection: THREE.Intersection): string | null {
    if (typeof intersection.instanceId === 'number' && intersection.instanceId >= 0) {
      const mesh = intersection.object as THREE.InstancedMesh
      const instancedNodeId = findNodeIdForInstance(mesh, intersection.instanceId)
      if (instancedNodeId) {
        return instancedNodeId
      }
    }
    return resolveNodeIdFromObject(intersection.object)
  }

  function collectSceneIntersections(recursive = true): THREE.Intersection[] {
    if (instancedBoundsHasPending()) {
      flushInstancedBounds()
    }

    rootGroup.updateWorldMatrix(true, true)
    instancedMeshGroup.updateWorldMatrix(true, true)

    const pickTargets: THREE.Object3D[] = []
    const seenTargets = new Set<THREE.Object3D>()

    const addTarget = (candidate: THREE.Object3D | null | undefined) => {
      if (!candidate || seenTargets.has(candidate)) {
        return
      }
      pickTargets.push(candidate)
      seenTargets.add(candidate)
    }

    rootGroup.children.forEach((child) => addTarget(child))

    const addInstancedPickTarget = (candidate: THREE.Object3D) => {
      const mesh = candidate as THREE.InstancedMesh
      if (!(mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
        return
      }
      if (!mesh.visible || mesh.count === 0) {
        return
      }
      mesh.updateWorldMatrix(true, false)
      addTarget(mesh)
    }

    instancedMeshGroup.children.forEach((child) => {
      if (child) {
        addInstancedPickTarget(child)
      }
    })

    const extraInstancedTargets = options?.getInstancedPickTargets?.() ?? []
    for (const candidate of extraInstancedTargets) {
      if (!candidate) {
        continue
      }
      addInstancedPickTarget(candidate)
    }

    let intersections = raycaster.intersectObjects(pickTargets, recursive)
    intersections.sort((a, b) => a.distance - b.distance)
    // filter by configured max pick distance (distance is from the ray origin)
    const maxD = getMaxPickDistance()
    intersections = intersections.filter((it) => typeof it.distance === 'number' ? it.distance <= maxD : true)
    return intersections
  }

  function isObjectWorldVisible(object: THREE.Object3D | null): boolean {
    let current: THREE.Object3D | null = object
    while (current) {
      if (!current.visible) {
        return false
      }
      current = current.parent ?? null
    }
    return true
  }

  function pickNodeAtPointer(event: { clientX: number; clientY: number }): NodeHitResult | null {
    if (!canvasRef.value || !camera.value) {
      return null
    }

    const rect = canvasRef.value.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera.value)
    const intersections = collectSceneIntersections()

    let fallbackProxyHit: NodeHitResult | null = null

    for (const intersection of intersections) {
      if (!intersection?.point) {
        continue
      }
      const nodeId = resolveNodeIdFromIntersection(intersection)
      if (!nodeId) {
        continue
      }
      if (sceneStore.isNodeSelectionLocked(nodeId)) {
        continue
      }
      const baseObject = objectMap.get(nodeId)
      if (!baseObject) {
        continue
      }
      if (!sceneStore.isNodeVisible(nodeId)) {
        continue
      }
      if (!isObjectWorldVisible(baseObject)) {
        continue
      }

      if (isEditorOnlyObject(intersection.object as THREE.Object3D)) {
        continue
      }

      const roadSegmentIndex = resolveRoadSegmentIndexFromIntersection(intersection)

      const hit: NodeHitResult = {
        nodeId,
        object: baseObject,
        point: intersection.point.clone(),
        roadSegmentIndex,
      }

      if (isPickProxyObject(intersection.object as THREE.Object3D)) {
        if (!fallbackProxyHit) {
          fallbackProxyHit = hit
        }
        continue
      }

      return hit
    }

    return fallbackProxyHit
  }

  function projectPointerToPlane(event: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null {
    if (!camera.value || !canvasRef.value) {
      return null
    }

    const rect = canvasRef.value.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera.value)
    const intersectionPoint = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
      return intersectionPoint
    }
    return null
  }

  return {
    resolveNodeIdFromObject,
    resolveNodeIdFromIntersection,
    collectSceneIntersections,
    isObjectWorldVisible,
    pickNodeAtPointer,
    projectPointerToPlane
  }
}
