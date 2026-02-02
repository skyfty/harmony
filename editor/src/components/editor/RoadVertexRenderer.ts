import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'

export type RoadVertexHandleState = {
  nodeId: string
  group: THREE.Group
  signature: string
}

export type RoadVertexHandlePickResult = {
  nodeId: string
  vertexIndex: number
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type RoadVertexRenderer = {
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
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): RoadVertexHandlePickResult | null
  // Useful when external code wants to refresh even if signatures match.
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  getState(): RoadVertexHandleState | null
}

const ROAD_VERTEX_HANDLE_Y_OFFSET = 0.03
const ROAD_VERTEX_HANDLE_RENDER_ORDER = 1001
const HANDLE_GROUP_NAME = '__RoadVertexHandles'
const ROAD_VERTEX_HANDLE_SCREEN_DIAMETER_PX = 20

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

  // Fallback: approximate with distance.
  return Math.max(1e-6, distance) / safeHeight
}

function disposeRoadVertexHandleGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

function computeRoadVertexHandleSignature(definition: RoadDynamicMesh): string {
  const serialized = stableSerialize([
    Array.isArray(definition.vertices) ? definition.vertices : [],
    Number.isFinite(definition.width) ? definition.width : null,
  ])
  return hashString(serialized)
}

export function createRoadVertexRenderer(): RoadVertexRenderer {
  let state: RoadVertexHandleState | null = null
  const tmpWorldPos = new THREE.Vector3()
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeRoadVertexHandleGroup(existing.group)
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
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
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

    const definition = options.resolveRoadDefinition(selectedNodeId)
    if (!definition || definition.type !== 'Road') {
      clear()
      return
    }

    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }

    const signature = computeRoadVertexHandleSignature(definition)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = HANDLE_GROUP_NAME
    group.userData.isRoadVertexHandles = true

    const width = Number.isFinite(definition.width) ? Math.max(0.2, definition.width) : 2
    const yOffset = ROAD_VERTEX_HANDLE_Y_OFFSET + Math.max(0, width * 0.03)

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
        axes: { x: true, y: false, z: true },
        showNegativeAxes: true,
        renderOrder: ROAD_VERTEX_HANDLE_RENDER_ORDER,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
      })

      const handle = gizmo.root
      handle.name = `RoadVertexHandle_${index + 1}`
      handle.position.set(x, yOffset, z)
      handle.layers.enableAll()
      handle.userData.isRoadVertexHandle = true
      handle.userData.nodeId = selectedNodeId
      handle.userData.roadVertexIndex = index
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.userData.endpointGizmo = gizmo
      handle.userData.handleKey = `${selectedNodeId}:${index}`
      handle.userData.yOffset = yOffset

      handle.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) return
        mesh.userData.isRoadVertexHandle = true
        mesh.userData.nodeId = selectedNodeId
        mesh.userData.roadVertexIndex = index
      })

      group.add(handle)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
    hovered = null
    active = null
  }

  function ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: true })
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): RoadVertexHandlePickResult | null {
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
    const vertexIndexRaw = target.userData?.roadVertexIndex
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
    const vertexIndexRaw = target.userData?.roadVertexIndex
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

  function updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }) {
    if (!state || !options.camera || !options.canvas) {
      return
    }

    const diameterPx =
      typeof options.diameterPx === 'number' && Number.isFinite(options.diameterPx) && options.diameterPx > 0
        ? options.diameterPx
        : ROAD_VERTEX_HANDLE_SCREEN_DIAMETER_PX

    const viewportHeightPx = Math.max(1, options.canvas.getBoundingClientRect().height)

    state.group.updateWorldMatrix(true, false)
    for (const child of state.group.children) {
      const handle = child as THREE.Object3D
      const baseDiameterRaw = handle.userData?.baseDiameter
      const baseDiameter =
        typeof baseDiameterRaw === 'number' && Number.isFinite(baseDiameterRaw) && baseDiameterRaw > 1e-6
          ? baseDiameterRaw
          : 1

      handle.getWorldPosition(tmpWorldPos)
      const distance = Math.max(1e-6, tmpWorldPos.distanceTo(options.camera.position))
      const unitsPerPx = computeWorldUnitsPerPixel({ camera: options.camera, distance, viewportHeightPx })
      const desiredWorldDiameter = Math.max(1e-6, diameterPx * unitsPerPx)
      const scale = THREE.MathUtils.clamp(desiredWorldDiameter / baseDiameter, 1e-4, 1e6)
      handle.scale.setScalar(scale)
    }
  }

  function getState() {
    return state
  }

  return {
    clear,
    clearHover,
    setActiveHandle,
    updateHover,
    ensure,
    updateScreenSize,
    forceRebuild,
    pick,
    getState,
  }
}

export const ROAD_VERTEX_HANDLE_GROUP_NAME = HANDLE_GROUP_NAME
export const ROAD_VERTEX_HANDLE_Y = ROAD_VERTEX_HANDLE_Y_OFFSET
