import * as THREE from 'three'
import { type Ref } from 'vue'
import { useSceneStore } from '@/stores/sceneStore'
import type { NodeHitResult } from '@/types/scene-viewport-node-hit-result'
import { findNodeIdForInstance } from '@schema/modelObjectCache'

export function useScenePicking(
  canvasRef: Ref<HTMLCanvasElement | null>,
  camera: Ref<THREE.Camera | null>,
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
  rootGroup: THREE.Group,
  instancedMeshGroup: THREE.Group,
  instancedMeshes: THREE.InstancedMesh[],
  objectMap: Map<string, THREE.Object3D>
) {
  const sceneStore = useSceneStore()

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
    rootGroup.updateWorldMatrix(true, true)
    instancedMeshGroup.updateWorldMatrix(true, true)

    const pickTargets: THREE.Object3D[] = [...rootGroup.children]

    instancedMeshes.forEach((mesh) => {
      if (!mesh.visible || mesh.count === 0) {
        return
      }
      mesh.updateWorldMatrix(true, false)
      pickTargets.push(mesh)
    })

    const intersections = raycaster.intersectObjects(pickTargets, recursive)
    intersections.sort((a, b) => a.distance - b.distance)
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

    for (const intersection of intersections) {
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
      return {
        nodeId,
        object: baseObject,
        point: intersection.point.clone(),
      }
    }

    return null
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
