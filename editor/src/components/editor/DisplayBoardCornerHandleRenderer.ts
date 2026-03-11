import * as THREE from 'three'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'

export type DisplayBoardCornerHandlePickResult = {
  nodeId: string
  cornerIndex: number
  xSide: 'min' | 'max'
  ySide: 'min' | 'max'
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type DisplayBoardCornerHandleRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: { nodeId: string; cornerIndex: number; gizmoPart: EndpointGizmoPart } | null): void
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
    resolveDisplayBoardNode: (nodeId: string) => boolean
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveDisplayBoardNode: (nodeId: string) => boolean
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): DisplayBoardCornerHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
}

const DISPLAY_BOARD_HANDLE_RENDER_ORDER = 1001
export const DISPLAY_BOARD_HANDLE_GROUP_NAME = '__DisplayBoardCornerHandles'
export const DISPLAY_BOARD_HANDLE_Z_OFFSET = 0.02
const DISPLAY_BOARD_HANDLE_SCREEN_DIAMETER_PX = 32
const DISPLAY_BOARD_HANDLE_COLOR = 0xff4081

const RECT_CORNERS: Array<{ x: number; y: number; xSide: 'min' | 'max'; ySide: 'min' | 'max' }> = [
  { x: -0.5, y: -0.5, xSide: 'min', ySide: 'min' },
  { x: 0.5, y: -0.5, xSide: 'max', ySide: 'min' },
  { x: 0.5, y: 0.5, xSide: 'max', ySide: 'max' },
  { x: -0.5, y: 0.5, xSide: 'min', ySide: 'max' },
]

type HandleState = {
  nodeId: string
  group: THREE.Group
}

function disposeGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

export function createDisplayBoardCornerHandleRenderer(): DisplayBoardCornerHandleRenderer {
  let state: HandleState | null = null
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const tmpParentWorldScale = new THREE.Vector3(1, 1, 1)
  const NEAR_SCALE_DISTANCE = 2.5
  const NEAR_SCALE_MAX_MULT = 2.0

  function clear() {
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

  function clearHover() {
    if (!hovered) {
      return
    }
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: { nodeId: string; cornerIndex: number; gizmoPart: EndpointGizmoPart } | null) {
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
      handleKey: `${next.nodeId}:${next.cornerIndex}`,
      gizmoPart: next.gizmoPart,
    }
    refreshHighlight()
  }

  function refreshHighlight() {
    if (!state) {
      return
    }
    for (const handle of state.group.children) {
      const gizmo = handle?.userData?.endpointGizmo as { clearStates?: () => void; setState?: (p: EndpointGizmoPart, s: any) => void } | undefined
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

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveDisplayBoardNode: (nodeId: string) => boolean
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    force?: boolean
  }) {
    const selectedNodeId = options.selectedNodeId
    if (!options.active || !selectedNodeId) {
      clear()
      return
    }
    if (options.isSelectionLocked(selectedNodeId) || !options.resolveDisplayBoardNode(selectedNodeId)) {
      clear()
      return
    }
    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }
    if (!options.force && state && state.nodeId === selectedNodeId) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = DISPLAY_BOARD_HANDLE_GROUP_NAME
    group.userData.isDisplayBoardCornerHandles = true

    RECT_CORNERS.forEach((corner, index) => {
      const gizmo = createEndpointGizmoObject({
        axes: { x: true, y: true, z: false },
        showNegativeAxes: true,
        renderOrder: DISPLAY_BOARD_HANDLE_RENDER_ORDER,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        centerColor: DISPLAY_BOARD_HANDLE_COLOR,
      })
      const handle = gizmo.root
      handle.name = `DisplayBoardCornerHandle_${index + 1}`
      handle.position.set(corner.x, corner.y, DISPLAY_BOARD_HANDLE_Z_OFFSET)
      handle.layers.enableAll()
      handle.userData.isDisplayBoardCornerHandle = true
      handle.userData.nodeId = selectedNodeId
      handle.userData.displayBoardCornerIndex = index
      handle.userData.displayBoardCornerXSide = corner.xSide
      handle.userData.displayBoardCornerYSide = corner.ySide
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.userData.endpointGizmo = gizmo
      handle.userData.handleKey = `${selectedNodeId}:${index}`

      handle.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        mesh.userData.isDisplayBoardCornerHandle = true
        mesh.userData.nodeId = selectedNodeId
        mesh.userData.displayBoardCornerIndex = index
        mesh.userData.displayBoardCornerXSide = corner.xSide
        mesh.userData.displayBoardCornerYSide = corner.ySide
      })

      group.add(handle)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group }
    hovered = null
    active = null
  }

  function ensure(options: Parameters<DisplayBoardCornerHandleRenderer['ensure']>[0]) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: Parameters<DisplayBoardCornerHandleRenderer['forceRebuild']>[0]) {
    attachOrRebuild({ ...options, force: true })
  }

  function pick(options: Parameters<DisplayBoardCornerHandleRenderer['pick']>[0]): DisplayBoardCornerHandlePickResult | null {
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
    const cornerIndexRaw = target.userData?.displayBoardCornerIndex
    const cornerIndex = typeof cornerIndexRaw === 'number' && Number.isFinite(cornerIndexRaw)
      ? Math.max(0, Math.floor(cornerIndexRaw))
      : -1
    const xSide = target.userData?.displayBoardCornerXSide === 'max' ? 'max' : target.userData?.displayBoardCornerXSide === 'min' ? 'min' : null
    const ySide = target.userData?.displayBoardCornerYSide === 'max' ? 'max' : target.userData?.displayBoardCornerYSide === 'min' ? 'min' : null
    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
    const partInfo = getEndpointGizmoPartInfoFromObject(target)
    if (!nodeId || cornerIndex < 0 || !xSide || !ySide || !gizmoPart || !partInfo) {
      return null
    }

    return {
      nodeId,
      cornerIndex,
      xSide,
      ySide,
      gizmoPart,
      gizmoKind: partInfo.kind,
      gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
      point: first.point.clone(),
    }
  }

  function updateHover(options: Parameters<DisplayBoardCornerHandleRenderer['updateHover']>[0]) {
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
    const cornerIndexRaw = target.userData?.displayBoardCornerIndex
    const cornerIndex = typeof cornerIndexRaw === 'number' && Number.isFinite(cornerIndexRaw)
      ? Math.max(0, Math.floor(cornerIndexRaw))
      : -1
    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
    if (!nodeId || cornerIndex < 0 || !gizmoPart) {
      clearHover()
      return
    }

    const handleKey = `${nodeId}:${cornerIndex}`
    if (hovered && hovered.handleKey === handleKey && hovered.gizmoPart === gizmoPart) {
      return
    }

    hovered = { handleKey, gizmoPart }
    refreshHighlight()
  }

  function updateScreenSize(options: Parameters<DisplayBoardCornerHandleRenderer['updateScreenSize']>[0]) {
    if (!state || !options.camera || !options.canvas) {
      return
    }

    const diameterPx =
      typeof options.diameterPx === 'number' && Number.isFinite(options.diameterPx) && options.diameterPx > 0
        ? options.diameterPx
        : DISPLAY_BOARD_HANDLE_SCREEN_DIAMETER_PX

    const viewportHeightPx = Math.max(1, options.canvas.getBoundingClientRect().height)
    options.camera.getWorldPosition(tmpCameraWorldPos)

    state.group.updateWorldMatrix(true, true)
    for (const handle of state.group.children) {
      const baseDiameter = Number(handle.userData?.baseDiameter)
      if (!Number.isFinite(baseDiameter) || baseDiameter <= 0) {
        continue
      }
      handle.getWorldPosition(tmpWorldPos)
      const parent = handle.parent
      if (parent) {
        parent.getWorldScale(tmpParentWorldScale)
      } else {
        tmpParentWorldScale.set(1, 1, 1)
      }
      const maxParentScale = Math.max(
        1e-6,
        Math.abs(tmpParentWorldScale.x),
        Math.abs(tmpParentWorldScale.y),
        Math.abs(tmpParentWorldScale.z),
      )
      const distance = Math.max(1e-6, tmpWorldPos.distanceTo(tmpCameraWorldPos))
      const diameterWorld = computeWorldUnitsPerPixel({
        camera: options.camera,
        distance,
        viewportHeightPx,
      }) * diameterPx
      const nearFactor = distance < NEAR_SCALE_DISTANCE
        ? 1 + (NEAR_SCALE_MAX_MULT - 1) * (1 - distance / NEAR_SCALE_DISTANCE)
        : 1
      const uniformScale = (diameterWorld * nearFactor) / (baseDiameter * maxParentScale)
      handle.scale.setScalar(Math.max(1e-6, uniformScale))
    }
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