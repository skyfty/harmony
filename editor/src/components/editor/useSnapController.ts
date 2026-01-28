import * as THREE from 'three'
import type { Ref } from 'vue'
import { findNodeIdForInstance } from '@schema/modelObjectCache'

export type VertexSnapResult = {
  sourceWorld: THREE.Vector3
  targetWorld: THREE.Vector3
  delta: THREE.Vector3
  targetNodeId: string

  // Debug/overlay support
  sourceMesh?: THREE.Mesh | THREE.InstancedMesh
  sourceInstanceId?: number | null
  targetMesh?: THREE.Mesh | THREE.InstancedMesh
  targetInstanceId?: number | null
}

export type ViewportPixelProjection = {
  x: number
  y: number
  ndcZ: number
}

type SnapSourceState = {
  nodeId: string
  mesh: THREE.Mesh | THREE.InstancedMesh
  instanceId: number | null
  localPosition: THREE.Vector3
}

type SnapTargetCandidate = {
  nodeId: string
  worldPosition: THREE.Vector3
  screenDistance: number
}

type LockedTargetState = {
  nodeId: string
  mesh: THREE.Mesh | THREE.InstancedMesh
  instanceId: number | null
  vertexIndex: number
  localPosition: THREE.Vector3
}

type SnapSourceCandidate = {
  mesh: THREE.Mesh | THREE.InstancedMesh
  instanceId: number | null
  localPosition: THREE.Vector3
  worldPosition: THREE.Vector3
  screenDistance: number
  vertexIndex: number
}

export type UseSnapControllerOptions = {
  canvasRef: Ref<HTMLCanvasElement | null>
  camera: Ref<THREE.Camera | null>
  objectMap: Map<string, THREE.Object3D>
  instancedMeshes?: THREE.InstancedMesh[]
  // Prefer providing instanced pick targets via a callback so callers can keep
  // matrices/bounds in sync with their existing picking architecture.
  getInstancedPickTargets?: () => THREE.InstancedMesh[]
  isNodeVisible: (nodeId: string) => boolean
  isObjectWorldVisible: (object: THREE.Object3D | null) => boolean
  isNodeLocked?: (nodeId: string) => boolean
  pixelThreshold?: number
}

export type SnapQuery = {
  event: MouseEvent
  selectedNodeId: string | null
  selectedObject: THREE.Object3D | null
  active: boolean
  excludeNodeIds?: Set<string>
  pixelThresholdPx?: number
}

export type PlacementSideSnapQuery = {
  event: MouseEvent
  previewObject: THREE.Object3D | null
  active: boolean
  excludeNodeIds?: Set<string>
  pixelThresholdPx?: number
}

export function useSnapController(options: UseSnapControllerOptions) {
  const pixelThreshold = (typeof options.pixelThreshold === 'number' && Number.isFinite(options.pixelThreshold))
    ? options.pixelThreshold
    : 12
  const releaseMultiplier = 1.5
  // Source vertex acquisition should be easier than target snapping.
  // Users expect to "grab" a corner vertex even when the pointer is near it,
  // without needing pixel-perfect placement.
  const sourceAcquireMultiplier = 2.5
  const sourceAcquireMinPx = 20
  const sourceAcquireMaxPx = 64
  const switchImprovementRatio = 0.7
  const switchMinImprovementPx = 2
  const switchScanGateRatio = 0.6
  let activeSource: SnapSourceState | null = null
  let lockedTarget: LockedTargetState | null = null

  let placementLockedTarget: LockedTargetState | null = null
  let placementSideSnapResult: VertexSnapResult | null = null

  const sourceWorldHelper = new THREE.Vector3()
  const targetWorldHelper = new THREE.Vector3()
  const vertexLocalHelper = new THREE.Vector3()
  const vertexWorldHelper = new THREE.Vector3()
  const projectedHelper = new THREE.Vector3()

  const instancedRaycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  const instancedMatrixHelper = new THREE.Matrix4()
  const instancedWorldHelper = new THREE.Matrix4()
  const instancedVertexWorldHelper = new THREE.Vector3()

  const MAX_VERTEX_SCAN = 20000

  function isInternalHelperMesh(object: THREE.Object3D): boolean {
    const name = String(object.name ?? '')
    if (name.includes('PickProxy') || name.includes('Outline') || name.includes('InstancedOutline')) {
      return true
    }
    const userData = (object as any).userData
    if (userData?.instancedPickProxy === true || userData?.excludeFromOutline === true) {
      return true
    }
    return false
  }

  const reset = () => {
    activeSource = null
    lockedTarget = null
  }

  const resetPlacementSideSnap = () => {
    placementLockedTarget = null
    placementSideSnapResult = null
  }

  function isObjectGeometryReady(object: THREE.Object3D | null): boolean {
    if (!object) {
      return false
    }
    let hasVertexData = false
    object.traverse((child) => {
      if (hasVertexData) {
        return
      }
      const mesh = child as THREE.Mesh
      if (!(mesh as any)?.isMesh) {
        return
      }
      if (isInternalHelperMesh(mesh)) {
        return
      }
      const geometry = (mesh as any).geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!position || position.itemSize < 3 || position.count <= 0) {
        return
      }
      hasVertexData = true
    })
    return hasVertexData
  }

  function isNodeGeometryReady(nodeId: string | null | undefined): boolean {
    if (!nodeId) {
      return false
    }
    const object = options.objectMap.get(nodeId) ?? null
    return isObjectGeometryReady(object)
  }

  function computeWorldYToleranceFromPixelThreshold(targetWorld: THREE.Vector3, thresholdPx: number): number | null {
    if (!Number.isFinite(thresholdPx) || thresholdPx <= 0) {
      return null
    }
    const projected = projectWorldToViewportPixels(targetWorld)
    if (!projected) {
      return null
    }

    // Convert pixels to world-Y tolerance at this depth by measuring how many pixels
    // a +1 world-Y offset maps to. If the mapping is tiny (top-down-ish view), treat
    // tolerance as effectively unbounded.
    const up = new THREE.Vector3(0, 1, 0)
    const projectedUp = projectWorldToViewportPixels(targetWorld.clone().add(up))
    if (!projectedUp) {
      return null
    }
    const pixelsPerWorldY = Math.hypot(projectedUp.x - projected.x, projectedUp.y - projected.y)
    if (!Number.isFinite(pixelsPerWorldY) || pixelsPerWorldY <= 1e-6) {
      return Number.POSITIVE_INFINITY
    }
    return thresholdPx / pixelsPerWorldY
  }

  const projectWorldToViewportPixels = (worldPosition: THREE.Vector3, out?: THREE.Vector3): ViewportPixelProjection | null => {
    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      return null
    }
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    const projected = out ?? projectedHelper
    projected.copy(worldPosition).project(camera)
    if (projected.z < -1 || projected.z > 1) {
      return null
    }

    const x = (projected.x + 1) * 0.5 * rect.width
    const y = (1 - (projected.y + 1) * 0.5) * rect.height
    return { x, y, ndcZ: projected.z }
  }

  const unprojectViewportPixelsAtNdcZ = (x: number, y: number, ndcZ: number, out?: THREE.Vector3): THREE.Vector3 | null => {
    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      return null
    }
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    const ndcX = (x / rect.width) * 2 - 1
    const ndcY = -((y / rect.height) * 2 - 1)
    const target = out ?? new THREE.Vector3()
    target.set(ndcX, ndcY, ndcZ)
    target.unproject(camera)
    return target
  }

  const update = (query: SnapQuery): VertexSnapResult | null => {
        const threshold = typeof query.pixelThresholdPx === 'number' && Number.isFinite(query.pixelThresholdPx)
          ? query.pixelThresholdPx
          : pixelThreshold

    const sourceThreshold = Math.min(
      Math.max(Math.round(threshold * sourceAcquireMultiplier), sourceAcquireMinPx),
      sourceAcquireMaxPx,
    )

    if (!query.active) {
      reset()
      return null
    }

    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      reset()
      return null
    }

    const selectedNodeId = query.selectedNodeId
    const selectedObject = query.selectedObject
    if (!selectedNodeId || !selectedObject) {
      reset()
      return null
    }

    if (!options.isNodeVisible(selectedNodeId)) {
      reset()
      return null
    }

    if (!options.isObjectWorldVisible(selectedObject)) {
      reset()
      return null
    }

    selectedObject.updateMatrixWorld(true)

    const excludeNodeIds = query.excludeNodeIds

    if (!activeSource || activeSource.nodeId !== selectedNodeId) {
      const sourceCandidate = findNearestVertexOnObject(
        selectedObject,
        query.event,
        canvas,
        camera,
        sourceThreshold,
      )

      // If selected object has no direct mesh vertices (common for instanced-only rendering),
      // fall back to picking an instanced vertex belonging to this node.
      // NOTE: callers typically pass `excludeNodeIds` that include the currently-selected node
      // to prevent snapping *targets* to itself. Source acquisition is different: we must allow
      // selecting a source vertex on the selected node.
      const sourceExcludeNodeIds = excludeNodeIds && excludeNodeIds.has(selectedNodeId)
        ? new Set(Array.from(excludeNodeIds).filter((id) => id !== selectedNodeId))
        : excludeNodeIds
      const instancedSourceCandidate = !sourceCandidate
        ? findNearestVertexOnInstancedMeshes(query.event, canvas, camera, sourceThreshold, {
            includeNodeIds: new Set([selectedNodeId]),
            excludeNodeIds: sourceExcludeNodeIds,
          })
        : null

      const chosen = sourceCandidate ?? instancedSourceCandidate
      if (!chosen) {
        activeSource = null
        return null
      }

      activeSource = {
        nodeId: selectedNodeId,
        mesh: chosen.mesh,
        instanceId: chosen.instanceId,
        localPosition: chosen.localPosition.clone(),
      }
    }

    const sourceWorld = computeSourceWorld(activeSource)
    if (!sourceWorld) {
      reset()
      return null
    }

    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    let lockedTargetWorld = lockedTarget ? computeLockedTargetWorld(lockedTarget, camera, rect, sourceWorld, threshold) : null
    if (!lockedTargetWorld) {
      const best = findNearestVertexInScene(query.event, canvas, camera, threshold, {
        excludeNodeIds: excludeNodeIds ?? new Set([selectedNodeId]),
      })
      if (!best) {
        lockedTarget = null
        return null
      }

      if (options.isNodeLocked?.(best.nodeId)) {
        lockedTarget = null
        return null
      }
      lockedTarget = {
        nodeId: best.nodeId,
        mesh: best.mesh,
        instanceId: best.instanceId,
        vertexIndex: best.vertexIndex,
        localPosition: best.localPosition.clone(),
      }
      lockedTargetWorld = best.worldPosition.clone()
    } else {
      // Sticky switching (hysteresis): avoid jumping between near-equal candidates.
      // Only scan for alternatives when the pointer is relatively far from the current locked target.
      const currentPointerDistance = computePointerDistanceToWorld(lockedTargetWorld, camera, rect, query.event)
      if (typeof currentPointerDistance === 'number' && Number.isFinite(currentPointerDistance)) {
        if (currentPointerDistance >= threshold * switchScanGateRatio) {
          const best = findNearestVertexInScene(query.event, canvas, camera, threshold, {
            excludeNodeIds: excludeNodeIds ?? new Set([selectedNodeId]),
          })
          if (best) {
            const sameAsLocked =
              lockedTarget &&
              best.mesh === lockedTarget.mesh &&
              best.instanceId === lockedTarget.instanceId &&
              best.vertexIndex === lockedTarget.vertexIndex

            if (!sameAsLocked) {
              const improvementPx = currentPointerDistance - best.screenDistance
              const ratioOk = best.screenDistance < currentPointerDistance * switchImprovementRatio
              const deltaOk = improvementPx >= switchMinImprovementPx
              if (ratioOk && deltaOk) {
                lockedTarget = {
                  nodeId: best.nodeId,
                  mesh: best.mesh,
                  instanceId: best.instanceId,
                  vertexIndex: best.vertexIndex,
                  localPosition: best.localPosition.clone(),
                }
                lockedTargetWorld = best.worldPosition.clone()
              }
            }
          }
        }
      }
    }

    if (!lockedTarget) {
      return null
    }

    const targetWorld = computeTargetWorld(lockedTarget)
    if (!targetWorld) {
      lockedTarget = null
      return null
    }

    const delta = targetWorld.clone().sub(sourceWorld)

    return {
      sourceWorld: sourceWorld.clone(),
      targetWorld: targetWorld.clone(),
      delta,
      targetNodeId: lockedTarget.nodeId,
      sourceMesh: activeSource.mesh,
      sourceInstanceId: activeSource.instanceId,
      targetMesh: lockedTarget.mesh,
      targetInstanceId: lockedTarget.instanceId,
    }
  }

  const updatePlacementSideSnap = (query: PlacementSideSnapQuery): VertexSnapResult | null => {
    const threshold = typeof query.pixelThresholdPx === 'number' && Number.isFinite(query.pixelThresholdPx)
      ? query.pixelThresholdPx
      : pixelThreshold

    if (!query.active) {
      resetPlacementSideSnap()
      return null
    }

    const previewObject = query.previewObject
    if (!previewObject) {
      resetPlacementSideSnap()
      return null
    }

    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      resetPlacementSideSnap()
      return null
    }

    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      resetPlacementSideSnap()
      return null
    }

    const sourceThreshold = Math.min(
      Math.max(Math.round(threshold * sourceAcquireMultiplier), sourceAcquireMinPx),
      sourceAcquireMaxPx,
    )

    previewObject.updateMatrixWorld(true)
    const sourceCandidate = findNearestVertexOnObject(previewObject, query.event, canvas, camera, sourceThreshold)
    if (!sourceCandidate) {
      resetPlacementSideSnap()
      return null
    }

    const sourceWorld = sourceCandidate.worldPosition.clone()

    // Keep the placement target sticky (hysteresis) based on source↔target proximity.
    let lockedTargetWorld = placementLockedTarget
      ? computeLockedTargetWorld(placementLockedTarget, camera, rect, sourceWorld, threshold)
      : null
    if (!lockedTargetWorld) {
      const best = findNearestVertexInScene(query.event, canvas, camera, threshold, {
        excludeNodeIds: query.excludeNodeIds ?? new Set<string>(),
      })
      if (!best) {
        resetPlacementSideSnap()
        return null
      }

      if (options.isNodeLocked?.(best.nodeId)) {
        resetPlacementSideSnap()
        return null
      }

      placementLockedTarget = {
        nodeId: best.nodeId,
        mesh: best.mesh,
        instanceId: best.instanceId,
        vertexIndex: best.vertexIndex,
        localPosition: best.localPosition.clone(),
      }
      lockedTargetWorld = best.worldPosition.clone()
    }

    if (!placementLockedTarget) {
      placementSideSnapResult = null
      return null
    }

    const targetWorld = computeTargetWorld(placementLockedTarget)
    if (!targetWorld) {
      resetPlacementSideSnap()
      return null
    }

    // Ensure source and target vertices are actually near each other on-screen.
    if (!projectToScreen(sourceWorld, camera, rect, vertexWorldHelper) || !projectToScreen(targetWorld, camera, rect, projectedHelper)) {
      resetPlacementSideSnap()
      return null
    }
    {
      const dx = projectedHelper.x - vertexWorldHelper.x
      const dy = projectedHelper.y - vertexWorldHelper.y
      const distance = Math.hypot(dx, dy)
      if (!Number.isFinite(distance) || distance > threshold) {
        placementSideSnapResult = null
        return null
      }
    }

    const delta = targetWorld.clone().sub(sourceWorld)

    // Side-only: require movement to be predominantly horizontal (XZ).
    const horizontal = Math.hypot(delta.x, delta.z)
    if (!Number.isFinite(horizontal) || horizontal <= 1e-6) {
      placementSideSnapResult = null
      return null
    }

    const yTolWorld = computeWorldYToleranceFromPixelThreshold(targetWorld, threshold)
    if (yTolWorld == null) {
      placementSideSnapResult = null
      return null
    }
    if (Math.abs(delta.y) > yTolWorld) {
      placementSideSnapResult = null
      return null
    }
    if (horizontal < Math.abs(delta.y) * 2) {
      placementSideSnapResult = null
      return null
    }

    placementSideSnapResult = {
      sourceWorld: sourceWorld.clone(),
      targetWorld: targetWorld.clone(),
      delta,
      targetNodeId: placementLockedTarget.nodeId,
      sourceMesh: sourceCandidate.mesh,
      sourceInstanceId: sourceCandidate.instanceId,
      targetMesh: placementLockedTarget.mesh,
      targetInstanceId: placementLockedTarget.instanceId,
    }
    return placementSideSnapResult
  }

  const consumePlacementSideSnapResult = (): VertexSnapResult | null => {
    const result = placementSideSnapResult
    resetPlacementSideSnap()
    return result
  }

  function computeSourceWorld(source: SnapSourceState): THREE.Vector3 | null {
    if (!source.mesh) {
      return null
    }
    source.mesh.updateMatrixWorld(true)

    if ((source.mesh as THREE.InstancedMesh).isInstancedMesh && source.instanceId != null) {
      const instanced = source.mesh as THREE.InstancedMesh
      instanced.getMatrixAt(source.instanceId, instancedMatrixHelper)
      instancedWorldHelper.multiplyMatrices(instanced.matrixWorld, instancedMatrixHelper)
      sourceWorldHelper.copy(source.localPosition).applyMatrix4(instancedWorldHelper)
      return sourceWorldHelper
    }

    sourceWorldHelper.copy(source.localPosition).applyMatrix4((source.mesh as THREE.Mesh).matrixWorld)
    return sourceWorldHelper
  }

  function computeTargetWorld(target: LockedTargetState): THREE.Vector3 | null {
    if (!target.mesh) {
      return null
    }
    target.mesh.updateMatrixWorld(true)

    if ((target.mesh as THREE.InstancedMesh).isInstancedMesh && target.instanceId != null) {
      const instanced = target.mesh as THREE.InstancedMesh
      instanced.getMatrixAt(target.instanceId, instancedMatrixHelper)
      instancedWorldHelper.multiplyMatrices(instanced.matrixWorld, instancedMatrixHelper)
      return target.localPosition.clone().applyMatrix4(instancedWorldHelper)
    }

    return target.localPosition.clone().applyMatrix4((target.mesh as THREE.Mesh).matrixWorld)
  }

  function findNearestVertexInScene(
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    threshold: number,
    filters: { excludeNodeIds: Set<string> },
  ): (SnapTargetCandidate & { mesh: THREE.Mesh | THREE.InstancedMesh; instanceId: number | null; vertexIndex: number; localPosition: THREE.Vector3 }) | null {
    let best: (SnapTargetCandidate & { mesh: THREE.Mesh | THREE.InstancedMesh; instanceId: number | null; vertexIndex: number; localPosition: THREE.Vector3 }) | null = null

    const instancedBest = findNearestVertexOnInstancedMeshes(event, canvas, camera, threshold, { excludeNodeIds: filters.excludeNodeIds })
    if (instancedBest) {
      best = {
        nodeId: instancedBest.nodeId,
        worldPosition: instancedBest.worldPosition.clone(),
        screenDistance: instancedBest.screenDistance,
        mesh: instancedBest.mesh,
        instanceId: instancedBest.instanceId,
        vertexIndex: instancedBest.vertexIndex,
        localPosition: instancedBest.localPosition.clone(),
      }
    }

    for (const [nodeId, object] of options.objectMap.entries()) {
      if (!object || filters.excludeNodeIds.has(nodeId)) {
        continue
      }
      if (!options.isNodeVisible(nodeId)) {
        continue
      }
      if (options.isNodeLocked?.(nodeId)) {
        continue
      }
      if (!options.isObjectWorldVisible(object)) {
        continue
      }

      object.updateMatrixWorld(true)
      const candidate = findNearestVertexOnObject(object, event, canvas, camera, threshold)
      if (!candidate) {
        continue
      }

      if (!best || candidate.screenDistance < best.screenDistance) {
        best = {
          nodeId,
          worldPosition: candidate.worldPosition.clone(),
          screenDistance: candidate.screenDistance,
          mesh: candidate.mesh,
          instanceId: candidate.instanceId,
          vertexIndex: candidate.vertexIndex,
          localPosition: candidate.localPosition.clone(),
        }
      }
    }

    return best
  }

  function findNearestVertexOnObject(
    object: THREE.Object3D,
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    threshold: number,
  ): SnapSourceCandidate | null {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    let best: SnapSourceCandidate | null = null

    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
        return
      }
      if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
        return
      }
      if (isInternalHelperMesh(mesh)) {
        return
      }
      if (!mesh.visible) {
        return
      }

      const geometry = mesh.geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!position || position.itemSize < 3) {
        return
      }

      mesh.updateMatrixWorld(true)

      const stride = position.count > MAX_VERTEX_SCAN ? Math.ceil(position.count / MAX_VERTEX_SCAN) : 1
      for (let i = 0; i < position.count; i += stride) {
        vertexLocalHelper.fromBufferAttribute(position, i)
        vertexWorldHelper.copy(vertexLocalHelper).applyMatrix4(mesh.matrixWorld)
        if (!projectToScreen(vertexWorldHelper, camera, rect, projectedHelper)) {
          continue
        }

        const dx = projectedHelper.x - event.clientX
        const dy = projectedHelper.y - event.clientY
        const distance = Math.hypot(dx, dy)
        if (distance > threshold) {
          continue
        }

        if (!best || distance < best.screenDistance) {
          best = {
            mesh,
            instanceId: null,
            localPosition: vertexLocalHelper.clone(),
            worldPosition: vertexWorldHelper.clone(),
            screenDistance: distance,
            vertexIndex: i,
          }
        }
      }
    })

    return best
  }

  function projectToScreen(
    worldPosition: THREE.Vector3,
    camera: THREE.Camera,
    rect: DOMRect,
    out: THREE.Vector3,
  ): boolean {
    out.copy(worldPosition).project(camera)
    if (out.z < -1 || out.z > 1) {
      return false
    }

    out.x = rect.left + (out.x + 1) * 0.5 * rect.width
    out.y = rect.top + (1 - (out.y + 1) * 0.5) * rect.height
    return true
  }

  function computePointerDistanceToWorld(
    worldPosition: THREE.Vector3,
    camera: THREE.Camera,
    rect: DOMRect,
    event: MouseEvent,
  ): number | null {
    if (!projectToScreen(worldPosition, camera, rect, projectedHelper)) {
      return null
    }
    const dx = projectedHelper.x - event.clientX
    const dy = projectedHelper.y - event.clientY
    return Math.hypot(dx, dy)
  }

  function computeLockedTargetWorld(
    target: LockedTargetState,
    camera: THREE.Camera,
    rect: DOMRect,
    sourceWorld: THREE.Vector3,
    threshold: number,
  ): THREE.Vector3 | null {
    if (!target.mesh) {
      return null
    }
    if (!target.mesh.visible) {
      return null
    }
    if (!options.isObjectWorldVisible(target.mesh)) {
      return null
    }
    target.mesh.updateMatrixWorld(true)
    const computed = computeTargetWorld(target)
    if (!computed) {
      return null
    }
    targetWorldHelper.copy(computed)
    if (!projectToScreen(targetWorldHelper, camera, rect, projectedHelper)) {
      return null
    }

    if (!projectToScreen(sourceWorld, camera, rect, vertexWorldHelper)) {
      return null
    }

    const dx = projectedHelper.x - vertexWorldHelper.x
    const dy = projectedHelper.y - vertexWorldHelper.y
    const distance = Math.hypot(dx, dy)
    if (distance > threshold * releaseMultiplier) {
      return null
    }
    return targetWorldHelper
  }

  function findNearestVertexOnInstancedMeshes(
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    threshold: number,
    filters: {
      excludeNodeIds?: Set<string>
      includeNodeIds?: Set<string>
    },
  ): (SnapTargetCandidate & { mesh: THREE.InstancedMesh; instanceId: number; vertexIndex: number; localPosition: THREE.Vector3 }) | null {
    const meshes = options.getInstancedPickTargets?.() ?? options.instancedMeshes
    if (!meshes || meshes.length === 0) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    pointerNdc.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1))
    instancedRaycaster.setFromCamera(pointerNdc, camera)
    const intersections = instancedRaycaster.intersectObjects(meshes, false)
    if (!intersections.length) {
      return null
    }

    let picked: { mesh: THREE.InstancedMesh; instanceId: number; nodeId: string } | null = null
    for (const hit of intersections) {
      const mesh = hit.object as THREE.InstancedMesh
      const instanceId = (hit as any).instanceId as number | undefined
      if (typeof instanceId !== 'number' || instanceId < 0) {
        continue
      }
      const nodeId = findNodeIdForInstance(mesh, instanceId)
      if (!nodeId) {
        continue
      }
      if (filters.excludeNodeIds?.has(nodeId)) {
        continue
      }
      if (filters.includeNodeIds && !filters.includeNodeIds.has(nodeId)) {
        continue
      }
      if (!options.isNodeVisible(nodeId)) {
        continue
      }
      if (options.isNodeLocked?.(nodeId)) {
        continue
      }
      if (!options.isObjectWorldVisible(mesh)) {
        continue
      }

      picked = { mesh, instanceId, nodeId }
      break
    }

    if (!picked) {
      return null
    }

    const instancedMesh = picked.mesh
    instancedMesh.updateMatrixWorld(true)
    instancedMesh.getMatrixAt(picked.instanceId, instancedMatrixHelper)
    instancedWorldHelper.multiplyMatrices(instancedMesh.matrixWorld, instancedMatrixHelper)

    const geometry = instancedMesh.geometry as THREE.BufferGeometry | undefined
    const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position || position.itemSize < 3) {
      return null
    }

    let best: (SnapTargetCandidate & { mesh: THREE.InstancedMesh; instanceId: number; vertexIndex: number; localPosition: THREE.Vector3 }) | null = null
    const stride = position.count > MAX_VERTEX_SCAN ? Math.ceil(position.count / MAX_VERTEX_SCAN) : 1
    for (let i = 0; i < position.count; i += stride) {
      vertexLocalHelper.fromBufferAttribute(position, i)
      instancedVertexWorldHelper.copy(vertexLocalHelper).applyMatrix4(instancedWorldHelper)
      if (!projectToScreen(instancedVertexWorldHelper, camera, rect, projectedHelper)) {
        continue
      }

      const dx = projectedHelper.x - event.clientX
      const dy = projectedHelper.y - event.clientY
      const distance = Math.hypot(dx, dy)
      if (distance > threshold) {
        continue
      }

      if (!best || distance < best.screenDistance) {
        best = {
          nodeId: picked.nodeId,
          worldPosition: instancedVertexWorldHelper.clone(),
          screenDistance: distance,
          mesh: instancedMesh,
          instanceId: picked.instanceId,
          vertexIndex: i,
          localPosition: vertexLocalHelper.clone(),
        }
      }
    }

    return best
  }

  const findHoverCandidate = (query: { event: MouseEvent; excludeNodeIds?: Set<string>; pixelThresholdPx?: number }): {
    nodeId: string
    mesh: THREE.Mesh | THREE.InstancedMesh
    instanceId: number | null
    localPosition: THREE.Vector3
    worldPosition: THREE.Vector3
  } | null => {
    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      return null
    }
    const threshold = typeof query.pixelThresholdPx === 'number' && Number.isFinite(query.pixelThresholdPx)
      ? query.pixelThresholdPx
      : pixelThreshold
    const exclude = query.excludeNodeIds ?? new Set<string>()
    const best = findNearestVertexInScene(query.event, canvas, camera, threshold, { excludeNodeIds: exclude })
    if (!best) {
      return null
    }
    return {
      nodeId: best.nodeId,
      mesh: best.mesh,
      instanceId: best.instanceId,
      localPosition: best.localPosition.clone(),
      worldPosition: best.worldPosition.clone(),
    }
  }

  return {
    update,
    reset,
    updatePlacementSideSnap,
    consumePlacementSideSnapResult,
    resetPlacementSideSnap,
    isNodeGeometryReady,
    findHoverCandidate,
    projectWorldToViewportPixels,
    unprojectViewportPixelsAtNdcZ,
  }
}
