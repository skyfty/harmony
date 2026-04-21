import * as THREE from 'three'
import type { ModelCollisionDynamicMesh } from '@schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'

export type ModelCollisionFaceVertexHandlePickResult = {
  nodeId: string
  faceId: string
  vertexIndex: number
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type ModelCollisionFaceVertexRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: { nodeId: string; faceId: string; vertexIndex: number; gizmoPart: EndpointGizmoPart } | null): void
  updateHover(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): void
  ensure(options: {
    active: boolean
    selectedNodeId: string | null
    selectedFaceId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveDefinition: (nodeId: string) => ModelCollisionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    force?: boolean
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    selectedFaceId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveDefinition: (nodeId: string) => ModelCollisionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): ModelCollisionFaceVertexHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
}

const MODEL_COLLISION_FACE_VERTEX_GROUP_NAME = '__ModelCollisionFaceVertexHandles'
const MODEL_COLLISION_FACE_VERTEX_RENDER_ORDER = 1002
const MODEL_COLLISION_FACE_VERTEX_SCREEN_DIAMETER_PX = 34
const MODEL_COLLISION_FACE_VERTEX_COLOR = 0x80deea

function computeFaceSignature(face: ModelCollisionDynamicMesh['faces'][number] | null | undefined): string {
  if (!face) {
    return hashString('null')
  }
  return hashString(stableSerialize({
    id: face.id,
    thickness: Number.isFinite(face.thickness) ? face.thickness : null,
    vertices: Array.isArray(face.vertices)
      ? face.vertices.map((vertex) => [Number(vertex?.x), Number(vertex?.y), Number(vertex?.z)])
      : [],
  }))
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const drawable = child as THREE.Mesh
    drawable.geometry?.dispose?.()
    const material = drawable.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function sanitizeVertices(face: ModelCollisionDynamicMesh['faces'][number] | null | undefined): THREE.Vector3[] {
  if (!face || !Array.isArray(face.vertices)) {
    return []
  }
  return face.vertices
    .map((vertex) => new THREE.Vector3(Number(vertex?.x), Number(vertex?.y), Number(vertex?.z)))
    .filter((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z))
}

export function createModelCollisionFaceVertexRenderer(): ModelCollisionFaceVertexRenderer {
  let state: { nodeId: string; faceId: string; group: THREE.Group; signature: string } | null = null
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const NEAR_SCALE_DISTANCE = 2.5
  const NEAR_SCALE_MAX_MULT = 2.0

  function clear(): void {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeGroup(existing.group)
    hovered = null
    active = null
  }

  function refreshHighlight(): void {
    if (!state) {
      return
    }
    for (const handle of state.group.children) {
      const gizmo = handle?.userData?.endpointGizmo as { clearStates?: () => void; setState?: (part: EndpointGizmoPart, state: 'hover' | 'active') => void } | undefined
      if (!gizmo?.clearStates || !gizmo?.setState) {
        continue
      }
      gizmo.clearStates()
      const key = typeof handle.userData?.handleKey === 'string' ? handle.userData.handleKey : ''
      if (active && key === active.handleKey) {
        gizmo.setState(active.gizmoPart, 'active')
      } else if (hovered && key === hovered.handleKey) {
        gizmo.setState(hovered.gizmoPart, 'hover')
      }
    }
  }

  function clearHover(): void {
    if (!hovered) {
      return
    }
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: { nodeId: string; faceId: string; vertexIndex: number; gizmoPart: EndpointGizmoPart } | null): void {
    if (!state) {
      active = null
      return
    }
    if (!next) {
      active = null
      refreshHighlight()
      return
    }
    active = {
      handleKey: `${next.nodeId}:${next.faceId}:${next.vertexIndex}`,
      gizmoPart: next.gizmoPart,
    }
    refreshHighlight()
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    selectedFaceId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveDefinition: (nodeId: string) => ModelCollisionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    force?: boolean
  }): void {
    const selectedId = options.selectedNodeId
    const selectedFaceId = options.selectedFaceId
    if (!options.active || !selectedId || !selectedFaceId || options.isSelectionLocked(selectedId)) {
      clear()
      return
    }
    const runtimeObject = options.resolveRuntimeObject(selectedId)
    const definition = options.resolveDefinition(selectedId)
    const face = Array.isArray(definition?.faces) ? definition.faces.find((entry) => entry.id === selectedFaceId) ?? null : null
    if (!runtimeObject || !definition || !face) {
      clear()
      return
    }
    const vertices = sanitizeVertices(face)
    if (vertices.length < 3) {
      clear()
      return
    }

    const signature = computeFaceSignature(face)
    if (!options.force && state && state.nodeId === selectedId && state.faceId === selectedFaceId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = MODEL_COLLISION_FACE_VERTEX_GROUP_NAME
    group.userData.isModelCollisionFaceVertexHandles = true

    vertices.forEach((vertex, index) => {
      const gizmo = createEndpointGizmoObject({
        axes: { x: true, y: true, z: true },
        showNegativeAxes: true,
        renderOrder: MODEL_COLLISION_FACE_VERTEX_RENDER_ORDER,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        centerColor: MODEL_COLLISION_FACE_VERTEX_COLOR,
      })

      const handle = gizmo.root
      handle.name = `ModelCollisionFaceVertexHandle_${index + 1}`
      handle.position.copy(vertex)
      handle.layers.enableAll()
      handle.userData.isModelCollisionFaceVertexHandle = true
      handle.userData.nodeId = selectedId
      handle.userData.faceId = selectedFaceId
      handle.userData.modelCollisionFaceVertexIndex = index
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.userData.endpointGizmo = gizmo
      handle.userData.handleKey = `${selectedId}:${selectedFaceId}:${index}`

      handle.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        mesh.userData.isModelCollisionFaceVertexHandle = true
        mesh.userData.nodeId = selectedId
        mesh.userData.faceId = selectedFaceId
        mesh.userData.modelCollisionFaceVertexIndex = index
      })

      group.add(handle)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedId, faceId: selectedFaceId, group, signature }
    hovered = null
    active = null
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): ModelCollisionFaceVertexHandlePickResult | null {
    if (!state || !options.camera || !options.canvas) {
      return null
    }

    const rect = options.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    options.pointer.x = ((options.event.clientX - rect.left) / rect.width) * 2 - 1
    options.pointer.y = -((options.event.clientY - rect.top) / rect.height) * 2 + 1
    options.raycaster.setFromCamera(options.pointer, options.camera)
    state.group.updateWorldMatrix(true, true)
    const intersections = options.raycaster.intersectObjects(state.group.children, true)
    intersections.sort((a, b) => a.distance - b.distance)
    const first = intersections[0]
    if (!first) {
      return null
    }

    let current: THREE.Object3D | null = first.object
    while (current) {
      const nodeId = typeof current.userData?.nodeId === 'string' ? current.userData.nodeId : ''
      const faceId = typeof current.userData?.faceId === 'string' ? current.userData.faceId : ''
      const vertexIndexRaw = current.userData?.modelCollisionFaceVertexIndex
      const vertexIndex = typeof vertexIndexRaw === 'number' && Number.isFinite(vertexIndexRaw)
        ? Math.max(0, Math.floor(vertexIndexRaw))
        : -1
      const gizmoPart = typeof current.userData?.endpointGizmoPart === 'string'
        ? current.userData.endpointGizmoPart as EndpointGizmoPart
        : null
      const partInfo = getEndpointGizmoPartInfoFromObject(current)
      if (nodeId && faceId && vertexIndex >= 0 && gizmoPart && partInfo) {
        return {
          nodeId,
          faceId,
          vertexIndex,
          gizmoPart,
          gizmoKind: partInfo.kind,
          gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
          point: first.point.clone(),
        }
      }
      current = current.parent ?? null
    }

    return null
  }

  function updateHover(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): void {
    if (!state || !options.camera || !options.canvas) {
      clearHover()
      return
    }

    const pickResult = pick(options)
    const nextHovered = pickResult
      ? { handleKey: `${pickResult.nodeId}:${pickResult.faceId}:${pickResult.vertexIndex}`, gizmoPart: pickResult.gizmoPart }
      : null

    if ((hovered?.handleKey ?? null) === (nextHovered?.handleKey ?? null) && (hovered?.gizmoPart ?? null) === (nextHovered?.gizmoPart ?? null)) {
      return
    }
    hovered = nextHovered
    refreshHighlight()
  }

  function updateScreenSize(options: { camera: THREE.Camera | null; canvas: HTMLCanvasElement | null; diameterPx?: number }): void {
    if (!state || !options.camera || !options.canvas) {
      return
    }
    const diameterPx = typeof options.diameterPx === 'number' ? options.diameterPx : MODEL_COLLISION_FACE_VERTEX_SCREEN_DIAMETER_PX
    const rect = options.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }
    options.camera.updateMatrixWorld(true)
    const cameraWorldPosition = tmpCameraWorldPos
    options.camera.getWorldPosition(cameraWorldPosition)
    state.group.traverse((child) => {
      const handle = child as THREE.Object3D
      if (!handle?.userData?.isModelCollisionFaceVertexHandle) {
        return
      }
      handle.getWorldPosition(tmpWorldPos)
      const distance = Math.max(1e-6, cameraWorldPosition.distanceTo(tmpWorldPos))
      const worldUnitsPerPixel = computeWorldUnitsPerPixel({ camera: options.camera!, distance, viewportHeightPx: rect.height })
      const baseDiameter = typeof handle.userData?.baseDiameter === 'number' && Number.isFinite(handle.userData.baseDiameter)
        ? Math.max(1e-6, handle.userData.baseDiameter)
        : 0.7
      const scale = (worldUnitsPerPixel * diameterPx) / baseDiameter
      const nearScale = THREE.MathUtils.clamp(NEAR_SCALE_DISTANCE / distance, 1, NEAR_SCALE_MAX_MULT)
      handle.scale.setScalar(Math.max(0.001, scale * nearScale))
      handle.updateMatrixWorld(true)
    })
  }

  function ensure(options: Parameters<ModelCollisionFaceVertexRenderer['ensure']>[0]): void {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: Parameters<ModelCollisionFaceVertexRenderer['ensure']>[0]): void {
    attachOrRebuild({ ...options, force: true })
  }

  return {
    clear,
    clearHover,
    setActiveHandle,
    updateHover,
    ensure,
    forceRebuild,
    pick,
    updateScreenSize,
  }
}