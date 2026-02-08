import * as THREE from 'three'
import { useSceneStore } from '@/stores/sceneStore'
import type { GroundDynamicMesh, SceneNode } from '@harmony/schema'
import { sampleGroundHeight } from '@schema/groundMesh'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import type { SelectionDragState, SelectionDragCompanion } from '@/types/scene-viewport-selection-drag'
import { ALIGN_MODE_AXIS, type AlignMode } from '@/types/scene-viewport-align-mode'
import { DROP_TO_GROUND_EPSILON, ALIGN_DELTA_EPSILON, GROUND_NODE_ID } from './constants'
import {
  buildParentIndex,
  filterTopLevelSelection,
  setBoundingBoxFromObject,
  toEulerLike,
  cloneVectorCoordinates,
  type VectorCoordinates,
  snapValueToGrid
} from './sceneUtils'

export function useSelectionDrag(
  sceneNodes: SceneNode[],
  objectMap: Map<string, THREE.Object3D>,
  projectPointerToPlane: (event: PointerEvent, plane: THREE.Plane) => THREE.Vector3 | null,
  emit: (event: 'updateNodeTransform', payload: TransformUpdatePayload | TransformUpdatePayload[]) => void,
  callbacks: {
    syncInstancedTransform: (object: THREE.Object3D | null, includeChildren?: boolean) => void
    primeInstancedTransform?: (object: THREE.Object3D | null) => void
    updateGridHighlightFromObject: (object: THREE.Object3D | null) => void
    updateSelectionHighlights: () => void
    updatePlaceholderOverlayPositions: () => void
    gizmoControlsUpdate: () => void
    getVertexSnapDelta?: (options: { drag: SelectionDragState; event: PointerEvent }) => THREE.Vector3 | null
    computeTransformPivotWorld?: (object: THREE.Object3D, out: THREE.Vector3) => void
    beforeEmitTransformUpdates?: (nodeIds: string[]) => void
  }
) {
  const sceneStore = useSceneStore()
  
  const selectDragWorldPosition = new THREE.Vector3()
  const selectDragWorldQuaternion = new THREE.Quaternion()
  const selectDragDelta = new THREE.Vector3()
  const dropBoundingBoxHelper = new THREE.Box3()
  const dropWorldPositionHelper = new THREE.Vector3()
  const dropLocalPositionHelper = new THREE.Vector3()
  const alignReferenceWorldPositionHelper = new THREE.Vector3()
  const alignWorldPositionHelper = new THREE.Vector3()
  const alignDeltaHelper = new THREE.Vector3()
  const alignLocalPositionHelper = new THREE.Vector3()

  function findGroundNodeInTree(nodes: SceneNode[]): SceneNode | null {
    for (const node of nodes) {
      if (node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'Ground') {
        return node
      }
      if (node.children && node.children.length > 0) {
        const nested = findGroundNodeInTree(node.children)
        if (nested) {
          return nested
        }
      }
    }
    return null
  }

  function resolveGroundHeightAtWorldXZ(worldX: number, worldZ: number): number {
    const groundNode = findGroundNodeInTree(sceneStore.nodes)
      ?? findGroundNodeInTree(sceneNodes)
    const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
      ? (groundNode.dynamicMesh as GroundDynamicMesh)
      : null
    if (!groundDefinition) {
      return 0
    }

    const groundOriginX = typeof groundNode?.position?.x === 'number' && Number.isFinite(groundNode.position.x)
      ? groundNode.position.x
      : Number(groundNode?.position?.x ?? 0)
    const groundOriginY = typeof groundNode?.position?.y === 'number' && Number.isFinite(groundNode.position.y)
      ? groundNode.position.y
      : Number(groundNode?.position?.y ?? 0)
    const groundOriginZ = typeof groundNode?.position?.z === 'number' && Number.isFinite(groundNode.position.z)
      ? groundNode.position.z
      : Number(groundNode?.position?.z ?? 0)

    const groundLocalX = worldX - (Number.isFinite(groundOriginX) ? groundOriginX : 0)
    const groundLocalZ = worldZ - (Number.isFinite(groundOriginZ) ? groundOriginZ : 0)
    const groundWorldY = (Number.isFinite(groundOriginY) ? groundOriginY : 0) + sampleGroundHeight(groundDefinition, groundLocalX, groundLocalZ)
    return Number.isFinite(groundWorldY) ? groundWorldY : 0
  }

  function createSelectionDragState(nodeId: string, object: THREE.Object3D, hitPoint: THREE.Vector3, event: PointerEvent): SelectionDragState {
    callbacks.primeInstancedTransform?.(object)

    const worldPosition = new THREE.Vector3()
    object.getWorldPosition(worldPosition)
    const planeAnchor = worldPosition.clone()
    planeAnchor.y = hitPoint.y
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), planeAnchor)
    const pointerPlanePoint = projectPointerToPlane(event, plane)
    const pointerOffset = (pointerPlanePoint ?? hitPoint.clone().setY(planeAnchor.y))
      .sub(worldPosition)
      .projectOnPlane(plane.normal)
    const companions: SelectionDragCompanion[] = []
    const selectedIds = sceneStore.selectedNodeIds.filter((id) => id !== nodeId && !sceneStore.isNodeSelectionLocked(id))
    selectedIds.forEach((id) => {
      const companionObject = objectMap.get(id)
      if (!companionObject) {
        return
      }
      callbacks.primeInstancedTransform?.(companionObject)
      companionObject.updateMatrixWorld(true)
      const companionWorldPosition = new THREE.Vector3()
      companionObject.getWorldPosition(companionWorldPosition)
      companions.push({
        nodeId: id,
        object: companionObject,
        parent: companionObject.parent ?? null,
        initialLocalPosition: companionObject.position.clone(),
        initialWorldPosition: companionWorldPosition,
      })
    })
    return {
      nodeId,
      object,
      plane,
      pointerOffset,
      initialLocalPosition: object.position.clone(),
      initialWorldPosition: worldPosition.clone(),
      initialRotation: object.rotation.clone(),
      parent: object.parent ?? null,
      companions,
      hasDragged: false,
    }
  }

  function updateSelectDragPosition(drag: SelectionDragState, event: PointerEvent): boolean {
    const planePoint = projectPointerToPlane(event, drag.plane)
    if (!planePoint) {
      return false
    }

    const worldPosition = planePoint.sub(drag.pointerOffset)
    const snapDelta = callbacks.getVertexSnapDelta?.({ drag, event })
    if (snapDelta) {
      worldPosition.add(snapDelta)
    }

    const newLocalPosition = worldPosition.clone()
    if (drag.parent) {
      drag.parent.worldToLocal(newLocalPosition)
    }
    newLocalPosition.y = drag.initialLocalPosition.y

    drag.object.position.copy(newLocalPosition)
    drag.object.updateMatrixWorld(true)
    callbacks.syncInstancedTransform(drag.object, true)
    drag.object.getWorldPosition(selectDragWorldPosition)
    drag.object.getWorldQuaternion(selectDragWorldQuaternion)
    selectDragDelta.copy(selectDragWorldPosition).sub(drag.initialWorldPosition)

    const updates: TransformUpdatePayload[] = [
      {
        id: drag.nodeId,
        position: drag.object.position,
        rotation: toEulerLike(drag.object.rotation),
        scale: drag.object.scale,
      },
    ]

    drag.companions.forEach((companion) => {
      const companionWorldPosition = companion.initialWorldPosition.clone().add(selectDragDelta)
      const localPosition = companionWorldPosition.clone()
      if (companion.parent) {
        companion.parent.worldToLocal(localPosition)
      }
      localPosition.y = companion.initialLocalPosition.y
      companion.object.position.copy(localPosition)
      companion.object.updateMatrixWorld(true)
      callbacks.syncInstancedTransform(companion.object, true)
      updates.push({
        id: companion.nodeId,
        position: companion.object.position,
      })
    })

    callbacks.updateGridHighlightFromObject(drag.object)
    callbacks.updateSelectionHighlights()

    return true
  }

  function commitSelectionDragTransforms(drag: SelectionDragState) {
    const updates: TransformUpdatePayload[] = [
      {
        id: drag.nodeId,
        position: drag.object.position.clone(),
        rotation: toEulerLike(drag.object.rotation),
        scale: drag.object.scale.clone(),
      },
    ]

    drag.companions.forEach((companion) => {
      updates.push({
        id: companion.nodeId,
        position: companion.object.position.clone(),
      })
    })

    callbacks.beforeEmitTransformUpdates?.(updates.map((update) => update.id))

    const normalized = updates.map((update) => {
      const entry: TransformUpdatePayload = { id: update.id }
      if (update.position) {
        entry.position = cloneVectorCoordinates(update.position as VectorCoordinates)
      }
      if (update.rotation) {
        entry.rotation = cloneVectorCoordinates(update.rotation as VectorCoordinates)
      }
      if (update.scale) {
        entry.scale = cloneVectorCoordinates(update.scale as VectorCoordinates)
      }
      return entry
    })

    emit('updateNodeTransform', normalized.length === 1 ? normalized[0]! : normalized)
  }

  function applyWorldDeltaToSelectionDrag(
    drag: SelectionDragState,
    deltaWorld: THREE.Vector3,
    options?: { allowVertical?: boolean },
  ) {
    if (!deltaWorld || deltaWorld.lengthSq() < 1e-12) {
      return
    }

    const allowVertical = options?.allowVertical === true

    // Selection drag is typically constrained to the original Y plane.
    // For vertex snapping we must also align Y so the snapped endpoints meet.
    selectDragDelta.copy(deltaWorld)
    if (!allowVertical) {
      selectDragDelta.y = 0
    }

    drag.object.updateMatrixWorld(true)
    drag.object.getWorldPosition(selectDragWorldPosition)
    selectDragWorldPosition.add(selectDragDelta)

    const newLocalPosition = selectDragWorldPosition.clone()
    if (drag.parent) {
      drag.parent.worldToLocal(newLocalPosition)
    }
    if (!allowVertical) {
      newLocalPosition.y = drag.initialLocalPosition.y
    }
    drag.object.position.copy(newLocalPosition)
    drag.object.updateMatrixWorld(true)
    callbacks.syncInstancedTransform(drag.object, true)

    drag.companions.forEach((companion) => {
      companion.object.updateMatrixWorld(true)
      companion.object.getWorldPosition(dropWorldPositionHelper)
      dropWorldPositionHelper.add(selectDragDelta)

      const localPosition = dropWorldPositionHelper.clone()
      if (companion.parent) {
        companion.parent.worldToLocal(localPosition)
      }
      if (!allowVertical) {
        localPosition.y = companion.initialLocalPosition.y
      }
      companion.object.position.copy(localPosition)
      companion.object.updateMatrixWorld(true)
      callbacks.syncInstancedTransform(companion.object, true)
    })
  }

  function dropSelectionToGround() {
    const unlockedSelection = sceneStore.selectedNodeIds.filter((id) => !sceneStore.isNodeSelectionLocked(id))
    if (!unlockedSelection.length) {
      return
    }

    const parentMap = buildParentIndex(sceneNodes, null, new Map<string, string | null>())
    const topLevelIds = filterTopLevelSelection(unlockedSelection, parentMap)
    if (!topLevelIds.length) {
      return
    }

    const updates: TransformUpdatePayload[] = []

    for (const nodeId of topLevelIds) {
      const object = objectMap.get(nodeId)
      if (!object) {
        continue
      }

      object.updateMatrixWorld(true)
      setBoundingBoxFromObject(object, dropBoundingBoxHelper)
      if (dropBoundingBoxHelper.isEmpty()) {
        continue
      }

      object.getWorldPosition(dropWorldPositionHelper)
      const groundY = resolveGroundHeightAtWorldXZ(dropWorldPositionHelper.x, dropWorldPositionHelper.z)
      const deltaY = groundY - dropBoundingBoxHelper.min.y
      if (Math.abs(deltaY) <= DROP_TO_GROUND_EPSILON) {
        continue
      }

      dropWorldPositionHelper.y += deltaY

      dropLocalPositionHelper.copy(dropWorldPositionHelper)
      if (object.parent) {
        object.parent.worldToLocal(dropLocalPositionHelper)
      }

      object.position.set(dropLocalPositionHelper.x, dropLocalPositionHelper.y, dropLocalPositionHelper.z)
      object.updateMatrixWorld(true)

      updates.push({
        id: nodeId,
        position: dropLocalPositionHelper,
      })
    }

    if (!updates.length) {
      return
    }

    if (typeof sceneStore.updateNodePropertiesBatch === 'function') {
      sceneStore.updateNodePropertiesBatch(updates)
    } else {
      updates.forEach((update) => sceneStore.updateNodeProperties(update))
    }

    const primaryId = sceneStore.selectedNodeId
    const primaryObject = primaryId ? objectMap.get(primaryId) ?? null : null
    callbacks.updateGridHighlightFromObject(primaryObject)
    callbacks.updatePlaceholderOverlayPositions()
    callbacks.updateSelectionHighlights()
  }

  function alignSelection(mode: AlignMode, options?: { snapToGrid?: boolean }) {
    const axis = ALIGN_MODE_AXIS[mode]
    const snapToGridEnabled = options?.snapToGrid ?? true

    const primaryId = sceneStore.selectedNodeId
    if (!primaryId) {
      return
    }

    const referenceObject = objectMap.get(primaryId)
    if (!referenceObject) {
      return
    }

    const unlockedSelection = sceneStore.selectedNodeIds.filter((id) => id !== primaryId && !sceneStore.isNodeSelectionLocked(id))
    if (!unlockedSelection.length) {
      return
    }

    const parentMap = buildParentIndex(sceneNodes, null, new Map<string, string | null>())
    const topLevelIds = filterTopLevelSelection(unlockedSelection, parentMap)
    if (!topLevelIds.length) {
      return
    }

    referenceObject.updateMatrixWorld(true)
    referenceObject.getWorldPosition(alignReferenceWorldPositionHelper)
    const targetAxisValue = snapToGridEnabled
      ? snapValueToGrid(alignReferenceWorldPositionHelper[axis])
      : alignReferenceWorldPositionHelper[axis]

    const updates: TransformUpdatePayload[] = []

    for (const nodeId of topLevelIds) {
      const targetObject = objectMap.get(nodeId)
      if (!targetObject) {
        continue
      }

      targetObject.updateMatrixWorld(true)
      targetObject.getWorldPosition(alignWorldPositionHelper)

      const deltaValue = targetAxisValue - alignWorldPositionHelper[axis]
      if (Math.abs(deltaValue) <= ALIGN_DELTA_EPSILON) {
        continue
      }

      alignDeltaHelper.set(0, 0, 0)
      alignDeltaHelper[axis] = deltaValue
      alignWorldPositionHelper.add(alignDeltaHelper)
      alignLocalPositionHelper.copy(alignWorldPositionHelper)
      if (targetObject.parent) {
        targetObject.parent.worldToLocal(alignLocalPositionHelper)
      }

      targetObject.position.copy(alignLocalPositionHelper)
      targetObject.updateMatrixWorld(true)

      updates.push({
        id: nodeId,
        position: alignLocalPositionHelper,
      })
    }

    if (!updates.length) {
      return
    }

    if (typeof sceneStore.updateNodePropertiesBatch === 'function') {
      sceneStore.updateNodePropertiesBatch(updates)
    } else {
      updates.forEach((update) => sceneStore.updateNodeProperties(update))
    }

    const primaryObject = objectMap.get(primaryId) ?? null
    callbacks.updateGridHighlightFromObject(primaryObject)
    callbacks.updatePlaceholderOverlayPositions()
    callbacks.updateSelectionHighlights()
  }

  function rotateSelection({ axis, degrees }: { axis: 'x' | 'y'; degrees: number }) {
    if (!Number.isFinite(degrees) || degrees === 0) {
      return
    }

    const unlockedSelection = sceneStore.selectedNodeIds.filter(
      (id) => id !== GROUND_NODE_ID && !sceneStore.isNodeSelectionLocked(id)
    )
    if (!unlockedSelection.length) {
      return
    }

    const parentMap = buildParentIndex(sceneNodes, null, new Map<string, string | null>())
    const topLevelIds = filterTopLevelSelection(unlockedSelection, parentMap)
    if (!topLevelIds.length) {
      return
    }

    const delta = THREE.MathUtils.degToRad(degrees)
    if (!Number.isFinite(delta) || delta === 0) {
      return
    }

    const axisVector = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, 0)
    const rotateDeltaQuaternion = new THREE.Quaternion().setFromAxisAngle(axisVector, delta)

    // Compute centroid in world space using per-object pivot when available.
    const centroidWorld = new THREE.Vector3()
    const pivotWorld = new THREE.Vector3()
    let count = 0
    for (const nodeId of topLevelIds) {
      const targetObject = objectMap.get(nodeId)
      if (!targetObject) {
        continue
      }
      if (callbacks.computeTransformPivotWorld) {
        callbacks.computeTransformPivotWorld(targetObject, pivotWorld)
      } else {
        targetObject.getWorldPosition(pivotWorld)
      }
      centroidWorld.add(pivotWorld)
      count += 1
    }
    if (count <= 0) {
      return
    }
    centroidWorld.multiplyScalar(1 / count)

    const updates: TransformUpdatePayload[] = []
    const worldPosition = new THREE.Vector3()
    const pivotPosition = new THREE.Vector3()
    const originToPivotOffset = new THREE.Vector3()
    const worldOffset = new THREE.Vector3()
    const pivotAfter = new THREE.Vector3()
    const originAfter = new THREE.Vector3()
    const localPosition = new THREE.Vector3()

    for (const nodeId of topLevelIds) {
      const targetObject = objectMap.get(nodeId)
      if (!targetObject) {
        continue
      }

      targetObject.updateMatrixWorld(true)
      targetObject.getWorldPosition(worldPosition)

      // Use the object's transform pivot (PickProxy-aware) when available.
      if (callbacks.computeTransformPivotWorld) {
        callbacks.computeTransformPivotWorld(targetObject, pivotPosition)
      } else {
        pivotPosition.copy(worldPosition)
      }

      // Desired pivot position after rotating around the selection centroid.
      worldOffset.copy(pivotPosition).sub(centroidWorld).applyQuaternion(rotateDeltaQuaternion)
      pivotAfter.copy(centroidWorld).add(worldOffset)

      // Keep the origin-to-pivot offset consistent under the same rotation, so instanced PickProxy pivots behave.
      originToPivotOffset.copy(worldPosition).sub(pivotPosition)
      originToPivotOffset.applyQuaternion(rotateDeltaQuaternion)
      originAfter.copy(pivotAfter).add(originToPivotOffset)

      localPosition.copy(originAfter)
      if (targetObject.parent) {
        targetObject.parent.worldToLocal(localPosition)
      }
      targetObject.position.copy(localPosition)
      targetObject.quaternion.premultiply(rotateDeltaQuaternion)
      targetObject.rotation.setFromQuaternion(targetObject.quaternion)
      targetObject.updateMatrixWorld(true)
      callbacks.syncInstancedTransform(targetObject, true)

      updates.push({
        id: nodeId,
        // Clone the vector so each update has its own immutable snapshot.
        // (Reusing a single Vector3 instance will make every node end up with the same final position.)
        position: localPosition.clone(),
        rotation: toEulerLike(targetObject.rotation),
      })
    }

    if (!updates.length) {
      return
    }

    if (typeof sceneStore.updateNodePropertiesBatch === 'function') {
      sceneStore.updateNodePropertiesBatch(updates)
    } else {
      updates.forEach((update) => sceneStore.updateNodeProperties(update))
    }

    const primaryId = sceneStore.selectedNodeId
    const primaryObject = primaryId ? objectMap.get(primaryId) ?? null : null
    callbacks.updateGridHighlightFromObject(primaryObject)
    callbacks.updatePlaceholderOverlayPositions()
    callbacks.updateSelectionHighlights()
    callbacks.gizmoControlsUpdate()
  }

  return {
    createSelectionDragState,
    updateSelectDragPosition,
    commitSelectionDragTransforms,
    applyWorldDeltaToSelectionDrag,
    dropSelectionToGround,
    alignSelection,
    rotateSelection
  }
}
