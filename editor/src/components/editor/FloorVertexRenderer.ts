import * as THREE from 'three'
import type { FloorDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'

export type FloorVertexHandleState = {
  nodeId: string
  group: THREE.Group
  signature: string
}

export type FloorVertexHandlePickResult = {
  nodeId: string
  vertexIndex: number
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type FloorVertexRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: { nodeId: string; vertexIndex: number; gizmoPart: EndpointGizmoPart } | null): void
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
    isSelectionLocked: (nodeId: string) => boolean
    resolveFloorDefinition: (nodeId: string) => FloorDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveFloorDefinition: (nodeId: string) => FloorDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): FloorVertexHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
  getState(): FloorVertexHandleState | null
}

const FLOOR_VERTEX_HANDLE_Y_OFFSET = 0.03
const FLOOR_VERTEX_HANDLE_RENDER_ORDER = 1001
const FLOOR_VERTEX_HANDLE_GROUP_NAME = '__FloorVertexHandles'
const FLOOR_VERTEX_HANDLE_SCREEN_DIAMETER_PX = 32
const FLOOR_VERTEX_HANDLE_COLOR = 0xff4081

function computeFloorVertexHandleSignature(definition: FloorDynamicMesh): string {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  const serialized = stableSerialize([
    vertices,
    Number.isFinite(definition.smooth) ? definition.smooth : null,
    Number.isFinite(definition.thickness) ? definition.thickness : null,
  ])
  return hashString(serialized)
}

function disposeFloorVertexHandleGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

function computeWorldUnitsPerPixel(options: {
  camera: THREE.Camera
  distance: number
  viewportHeightPx: number
}): number {
  const { camera, distance, viewportHeightPx } = options
  const safeHeight = Math.max(1, viewportHeightPx)

  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera
    const vFovRad = THREE.MathUtils.degToRad(perspective.fov)
    const worldHeight = 2 * Math.max(1e-6, distance) * Math.tan(vFovRad / 2)
    return worldHeight / safeHeight
  }

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as THREE.OrthographicCamera
    const worldHeight = Math.abs((ortho.top - ortho.bottom) / Math.max(1e-6, ortho.zoom))
    return worldHeight / safeHeight
  }

  return Math.max(1e-6, distance) / safeHeight
}

export function createFloorVertexRenderer(): FloorVertexRenderer {
  let state: FloorVertexHandleState | null = null
  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const tmpParentWorldScale = new THREE.Vector3(1, 1, 1)
  const NEAR_SCALE_DISTANCE = 2.5
  const NEAR_SCALE_MAX_MULT = 2.0
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeFloorVertexHandleGroup(existing.group)
    hovered = null
    active = null
  }

  function clearHover() {
    if (!hovered) return
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: { nodeId: string; vertexIndex: number; gizmoPart: EndpointGizmoPart } | null) {
    if (!state) {
      active = null
      return
    }
    if (!next) {
      active = null
      refreshHighlight()
      return
    }
    const handleKey = `${next.nodeId}:${next.vertexIndex}`
    active = { handleKey, gizmoPart: next.gizmoPart }
    refreshHighlight()
  }

  function refreshHighlight() {
    if (!state) return
    for (const handle of state.group.children) {
      const gizmo = handle?.userData?.endpointGizmo as { clearStates?: () => void; setState?: (p: EndpointGizmoPart, s: any) => void } | undefined
      if (!gizmo?.clearStates || !gizmo?.setState) continue
      gizmo.clearStates()
      const key = typeof handle.userData?.handleKey === 'string' ? handle.userData.handleKey : ''
      if (active && key === active.handleKey) {
        gizmo.setState(active.gizmoPart, 'active')
      } else if (hovered && key === hovered.handleKey) {
        gizmo.setState(hovered.gizmoPart, 'hover')
      }
    }
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveFloorDefinition: (nodeId: string) => FloorDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    force?: boolean
  }) {
    const { active: isActive, selectedNodeId } = options

    if (!isActive || !selectedNodeId) {
      clear()
      return
    }

    if (options.isSelectionLocked(selectedNodeId)) {
      clear()
      return
    }

    const definition = options.resolveFloorDefinition(selectedNodeId)
    if (!definition || definition.type !== 'Floor') {
      clear()
      return
    }

    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }

    const signature = computeFloorVertexHandleSignature(definition)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = FLOOR_VERTEX_HANDLE_GROUP_NAME
    group.userData.isFloorVertexHandles = true

    const thickness = Number.isFinite(definition.thickness)
      ? Math.min(10, Math.max(0, Number(definition.thickness)))
      : 0

    const yOffset = FLOOR_VERTEX_HANDLE_Y_OFFSET + thickness * 0.5

    const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
    vertices.forEach((v, index) => {
      if (!Array.isArray(v) || v.length < 2) {
        return
      }
      const x = Number(v[0])
      const z = Number(v[1])
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return
      }
        const gizmo = createEndpointGizmoObject({
          axes: { x: true, y: true, z: true },
          showNegativeAxes: true,
          renderOrder: FLOOR_VERTEX_HANDLE_RENDER_ORDER,
          depthTest: false,
          depthWrite: false,
          opacity: 0.9,
          centerColor: FLOOR_VERTEX_HANDLE_COLOR,
        })

        const handle = gizmo.root
        handle.name = `FloorVertexHandle_${index + 1}`
        handle.position.set(x, yOffset, z)
        handle.layers.enableAll()
        handle.userData.isFloorVertexHandle = true
        handle.userData.nodeId = selectedNodeId
        handle.userData.floorVertexIndex = index
        handle.userData.baseDiameter = gizmo.baseDiameter
        handle.userData.endpointGizmo = gizmo
        handle.userData.handleKey = `${selectedNodeId}:${index}`
        handle.userData.yOffset = yOffset

        // Copy metadata to meshes for picking.
        handle.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh?.isMesh) return
          mesh.userData.isFloorVertexHandle = true
          mesh.userData.nodeId = selectedNodeId
          mesh.userData.floorVertexIndex = index
        })

        group.add(handle)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
      hovered = null
      active = null
  }

  function ensure(options: Parameters<FloorVertexRenderer['ensure']>[0]) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: Parameters<FloorVertexRenderer['ensure']>[0]) {
    attachOrRebuild({ ...options, force: true })
  }

  function pick(options: Parameters<FloorVertexRenderer['pick']>[0]): FloorVertexHandlePickResult | null {
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

    const target = first.object as THREE.Object3D
    const nodeId = typeof target.userData?.nodeId === 'string' ? target.userData.nodeId : ''
    const vertexIndexRaw = target.userData?.floorVertexIndex
    const vertexIndex =
      typeof vertexIndexRaw === 'number' && Number.isFinite(vertexIndexRaw)
        ? Math.max(0, Math.floor(vertexIndexRaw))
        : -1

    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
    const partInfo = getEndpointGizmoPartInfoFromObject(target)

    if (!nodeId || vertexIndex < 0 || !gizmoPart || !partInfo) {
      return null
    }

    return {
      nodeId,
      vertexIndex,
      gizmoPart,
      gizmoKind: partInfo.kind,
      gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
      point: first.point.clone(),
    }
  }

  function updateHover(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }) {
    if (!state || !options.camera || !options.canvas) {
      clearHover()
      return
    }

    const rect = options.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      clearHover()
      return
    }

    options.pointer.x = ((options.event.clientX - rect.left) / rect.width) * 2 - 1
    options.pointer.y = -((options.event.clientY - rect.top) / rect.height) * 2 + 1
    options.raycaster.setFromCamera(options.pointer, options.camera)

    state.group.updateWorldMatrix(true, true)
    const intersections = options.raycaster.intersectObjects(state.group.children, true)
    intersections.sort((a, b) => a.distance - b.distance)

    const first = intersections[0]
    if (!first) {
      clearHover()
      return
    }

    const target = first.object as THREE.Object3D
    const nodeId = typeof target.userData?.nodeId === 'string' ? target.userData.nodeId : ''
    const vertexIndexRaw = target.userData?.floorVertexIndex
    const vertexIndex =
      typeof vertexIndexRaw === 'number' && Number.isFinite(vertexIndexRaw)
        ? Math.max(0, Math.floor(vertexIndexRaw))
        : -1
    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null

    if (!nodeId || vertexIndex < 0 || !gizmoPart) {
      clearHover()
      return
    }

    const handleKey = `${nodeId}:${vertexIndex}`
    if (hovered && hovered.handleKey === handleKey && hovered.gizmoPart === gizmoPart) {
      return
    }

    hovered = { handleKey, gizmoPart }
    refreshHighlight()
  }

  function updateScreenSize(options: Parameters<FloorVertexRenderer['updateScreenSize']>[0]) {
    if (!state || !options.camera || !options.canvas) {
      return
    }

    const diameterPx =
      typeof options.diameterPx === 'number' && Number.isFinite(options.diameterPx) && options.diameterPx > 0
        ? options.diameterPx
        : FLOOR_VERTEX_HANDLE_SCREEN_DIAMETER_PX

    const viewportHeightPx = Math.max(1, options.canvas.getBoundingClientRect().height)

    options.camera.getWorldPosition(tmpCameraWorldPos)

    state.group.updateWorldMatrix(true, false)
    for (const child of state.group.children) {
      const handle = child as THREE.Object3D
      const baseDiameterRaw = handle.userData?.baseDiameter
      const baseDiameter =
        typeof baseDiameterRaw === 'number' && Number.isFinite(baseDiameterRaw) && baseDiameterRaw > 1e-6
          ? baseDiameterRaw
          : 1

      handle.getWorldPosition(tmpWorldPos)
      const distance = Math.max(1e-6, tmpWorldPos.distanceTo(tmpCameraWorldPos))
      const unitsPerPx = computeWorldUnitsPerPixel({ camera: options.camera, distance, viewportHeightPx })
      let desiredWorldDiameter = Math.max(1e-6, diameterPx * unitsPerPx)
      if (distance < NEAR_SCALE_DISTANCE) {
        const t = THREE.MathUtils.clamp(1 - distance / NEAR_SCALE_DISTANCE, 0, 1)
        const nearMult = 1 + t * (NEAR_SCALE_MAX_MULT - 1)
        desiredWorldDiameter *= nearMult
      }

      const parent = handle.parent as THREE.Object3D | null
      if (parent) {
        parent.getWorldScale(tmpParentWorldScale)
      } else {
        tmpParentWorldScale.set(1, 1, 1)
      }
      const parentScale = Math.max(1e-6, Math.max(tmpParentWorldScale.x, tmpParentWorldScale.y, tmpParentWorldScale.z))
      const scale = THREE.MathUtils.clamp(desiredWorldDiameter / (baseDiameter * parentScale), 1e-4, 1e6)
      handle.scale.setScalar(scale)
    }
  }

  function getState() {
    return state
  }

  return { clear, clearHover, setActiveHandle, updateHover, ensure, forceRebuild, pick, updateScreenSize, getState }
}

export { FLOOR_VERTEX_HANDLE_GROUP_NAME, FLOOR_VERTEX_HANDLE_Y_OFFSET as FLOOR_VERTEX_HANDLE_Y }
