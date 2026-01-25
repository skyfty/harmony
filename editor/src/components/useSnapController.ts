import * as THREE from 'three'
import type { Ref } from 'vue'

export type VertexSnapResult = {
  sourceWorld: THREE.Vector3
  targetWorld: THREE.Vector3
  delta: THREE.Vector3
  targetNodeId: string
}

export type ViewportPixelProjection = {
  x: number
  y: number
  ndcZ: number
}

type SnapSourceState = {
  nodeId: string
  mesh: THREE.Mesh
  localPosition: THREE.Vector3
}

type SnapTargetCandidate = {
  nodeId: string
  worldPosition: THREE.Vector3
  screenDistance: number
}

type LockedTargetState = {
  nodeId: string
  mesh: THREE.Mesh
  vertexIndex: number
  localPosition: THREE.Vector3
}

type SnapSourceCandidate = {
  mesh: THREE.Mesh
  localPosition: THREE.Vector3
  worldPosition: THREE.Vector3
  screenDistance: number
  vertexIndex: number
}

export type UseSnapControllerOptions = {
  canvasRef: Ref<HTMLCanvasElement | null>
  camera: Ref<THREE.Camera | null>
  objectMap: Map<string, THREE.Object3D>
  isNodeVisible: (nodeId: string) => boolean
  isObjectWorldVisible: (object: THREE.Object3D | null) => boolean
  pixelThreshold?: number
}

export type SnapQuery = {
  event: PointerEvent
  selectedNodeId: string | null
  selectedObject: THREE.Object3D | null
  shiftKey: boolean
}

export function useSnapController(options: UseSnapControllerOptions) {
  const pixelThreshold = (typeof options.pixelThreshold === 'number' && Number.isFinite(options.pixelThreshold))
    ? options.pixelThreshold
    : 12
  const releaseMultiplier = 1.5
  let activeSource: SnapSourceState | null = null
  let lockedTarget: LockedTargetState | null = null

  const sourceWorldHelper = new THREE.Vector3()
  const targetWorldHelper = new THREE.Vector3()
  const vertexLocalHelper = new THREE.Vector3()
  const vertexWorldHelper = new THREE.Vector3()
  const projectedHelper = new THREE.Vector3()

  const reset = () => {
    activeSource = null
    lockedTarget = null
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
    if (!query.shiftKey) {
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

    if (!activeSource || activeSource.nodeId !== selectedNodeId) {
      const sourceCandidate = findNearestVertexOnObject(
        selectedObject,
        query.event,
        canvas,
        camera,
        pixelThreshold,
      )
      if (!sourceCandidate) {
        activeSource = null
        return null
      }

      activeSource = {
        nodeId: selectedNodeId,
        mesh: sourceCandidate.mesh,
        localPosition: sourceCandidate.localPosition.clone(),
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

    const lockedTargetWorld = lockedTarget ? computeLockedTargetWorld(lockedTarget, camera, rect, query.event) : null
    if (!lockedTargetWorld) {
      const best = findNearestVertexInScene(
        selectedNodeId,
        query.event,
        canvas,
        camera,
        pixelThreshold,
      )
      if (!best) {
        lockedTarget = null
        return null
      }
      lockedTarget = {
        nodeId: best.nodeId,
        mesh: best.mesh,
        vertexIndex: best.vertexIndex,
        localPosition: best.localPosition.clone(),
      }
    }

    if (!lockedTarget) {
      return null
    }

    const targetWorld = lockedTarget.mesh
      ? lockedTarget.localPosition.clone().applyMatrix4(lockedTarget.mesh.matrixWorld)
      : null
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
    }
  }

  function computeSourceWorld(source: SnapSourceState): THREE.Vector3 | null {
    if (!source.mesh) {
      return null
    }
    source.mesh.updateMatrixWorld(true)
    sourceWorldHelper.copy(source.localPosition).applyMatrix4(source.mesh.matrixWorld)
    return sourceWorldHelper
  }

  function findNearestVertexInScene(
    excludeNodeId: string,
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    threshold: number,
  ): (SnapTargetCandidate & { mesh: THREE.Mesh; vertexIndex: number; localPosition: THREE.Vector3 }) | null {
    let best: (SnapTargetCandidate & { mesh: THREE.Mesh; vertexIndex: number; localPosition: THREE.Vector3 }) | null = null

    for (const [nodeId, object] of options.objectMap.entries()) {
      if (!object || nodeId === excludeNodeId) {
        continue
      }
      if (!options.isNodeVisible(nodeId)) {
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
          vertexIndex: candidate.vertexIndex,
          localPosition: candidate.localPosition.clone(),
        }
      }
    }

    return best
  }

  function findNearestVertexOnObject(
    object: THREE.Object3D,
    event: PointerEvent,
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
      if (!mesh.visible) {
        return
      }

      const geometry = mesh.geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!position || position.itemSize < 3) {
        return
      }

      mesh.updateMatrixWorld(true)

      for (let i = 0; i < position.count; i += 1) {
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

  function computeLockedTargetWorld(
    target: LockedTargetState,
    camera: THREE.Camera,
    rect: DOMRect,
    event: PointerEvent,
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
    targetWorldHelper.copy(target.localPosition).applyMatrix4(target.mesh.matrixWorld)
    if (!projectToScreen(targetWorldHelper, camera, rect, projectedHelper)) {
      return null
    }
    const dx = projectedHelper.x - event.clientX
    const dy = projectedHelper.y - event.clientY
    const distance = Math.hypot(dx, dy)
    if (distance > pixelThreshold * releaseMultiplier) {
      return null
    }
    return targetWorldHelper
  }

  return {
    update,
    reset,
    projectWorldToViewportPixels,
    unprojectViewportPixelsAtNdcZ,
  }
}
