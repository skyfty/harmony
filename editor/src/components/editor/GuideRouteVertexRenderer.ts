import * as THREE from 'three'
import type { Vector3Like } from '@schema/core'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'
import type { GuideRouteEndpointKind } from '@/utils/guideRouteEditPolicy'

export type GuideRouteVertexHandleDescriptor = {
  key: string
  vertexIndex: number
  legId: string
  anchorId: string
  point: Vector3Like
  endpoint: GuideRouteEndpointKind | null
  locked: boolean
}

export type GuideRouteVertexHandlePickResult = {
  nodeId: string
  handleKey: string
  vertexIndex: number
  legId: string
  anchorId: string
  endpoint: GuideRouteEndpointKind | null
  locked: boolean
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type GuideRouteVertexRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null): void
  setSelectedHandle(selected: { handleKey: string; gizmoPart?: EndpointGizmoPart } | null): void
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
    handles: GuideRouteVertexHandleDescriptor[]
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    handles: GuideRouteVertexHandleDescriptor[]
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): GuideRouteVertexHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
}

const GUIDE_ROUTE_VERTEX_HANDLE_GROUP_NAME = '__GuideRouteVertexHandles'
const GUIDE_ROUTE_VERTEX_HANDLE_RENDER_ORDER = 1001
const GUIDE_ROUTE_VERTEX_HANDLE_SCREEN_DIAMETER_PX = 42
const GUIDE_ROUTE_VERTEX_HANDLE_Y_OFFSET = 0.04
const GUIDE_ROUTE_VERTEX_HANDLE_COLOR = 0x27ffff
const GUIDE_ROUTE_VERTEX_HANDLE_LOCKED_COLOR = 0xffa64d
const NEAR_SCALE_DISTANCE = 2.5
const NEAR_SCALE_MAX_MULT = 2.0

function sanitizeHandles(
  handles: GuideRouteVertexHandleDescriptor[] | undefined | null,
): GuideRouteVertexHandleDescriptor[] {
  if (!Array.isArray(handles)) {
    return []
  }
  return handles
    .map((entry) => {
      const x = Number(entry?.point?.x)
      const y = Number(entry?.point?.y)
      const z = Number(entry?.point?.z)
      return {
        ...entry,
        point: {
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          z: Number.isFinite(z) ? z : 0,
        },
      }
    })
}

function computeGuideRouteVertexHandleSignature(
  nodeId: string,
  handles: GuideRouteVertexHandleDescriptor[],
): string {
  return hashString(stableSerialize([
    nodeId,
    handles.map((handle) => [
      handle.key,
      handle.vertexIndex,
      handle.point.x,
      handle.point.y,
      handle.point.z,
      handle.endpoint,
      handle.locked,
    ]),
  ]))
}

function disposeGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

export function findGuideRouteVertexHandleOwner(
  object: THREE.Object3D | null,
): THREE.Object3D | null {
  let owner = object
  while (owner && typeof owner.userData?.handleKey !== 'string') {
    owner = owner.parent
  }
  return owner
}

export function createGuideRouteVertexRenderer(): GuideRouteVertexRenderer {
  let state: { nodeId: string; group: THREE.Group; signature: string } | null = null
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let selected: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const tmpParentWorldScale = new THREE.Vector3(1, 1, 1)

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

  function refreshHighlight() {
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
      } else if (selected && key === selected.handleKey) {
        gizmo.setState(selected.gizmoPart, 'active')
      } else if (hovered && key === hovered.handleKey) {
        gizmo.setState(hovered.gizmoPart, 'hover')
      }
    }
  }

  function clearHover() {
    if (!hovered) {
      return
    }
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: { handleKey: string; gizmoPart: EndpointGizmoPart } | null) {
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
      handleKey: next.handleKey,
      gizmoPart: next.gizmoPart,
    }
    refreshHighlight()
  }

  function setSelectedHandle(next: { handleKey: string; gizmoPart?: EndpointGizmoPart } | null) {
    if (!state) {
      selected = null
      return
    }

    if (!next) {
      selected = null
      refreshHighlight()
      return
    }

    selected = {
      handleKey: next.handleKey,
      gizmoPart: next.gizmoPart ?? 'center',
    }
    refreshHighlight()
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    handles: GuideRouteVertexHandleDescriptor[]
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

    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }

    const handles = sanitizeHandles(options.handles)
    if (!handles.length) {
      clear()
      return
    }

    const signature = computeGuideRouteVertexHandleSignature(selectedNodeId, handles)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = GUIDE_ROUTE_VERTEX_HANDLE_GROUP_NAME
    group.userData.isGuideRouteVertexHandles = true

    handles.forEach((descriptor) => {
      const gizmo = createEndpointGizmoObject({
        axes: { x: true, y: false, z: true },
        showNegativeAxes: true,
        renderOrder: GUIDE_ROUTE_VERTEX_HANDLE_RENDER_ORDER,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        centerColor: descriptor.locked
          ? GUIDE_ROUTE_VERTEX_HANDLE_LOCKED_COLOR
          : GUIDE_ROUTE_VERTEX_HANDLE_COLOR,
      })

      const handle = gizmo.root
      handle.name = `GuideRouteVertexHandle_${descriptor.vertexIndex + 1}`
      handle.position.set(
        descriptor.point.x,
        descriptor.point.y + GUIDE_ROUTE_VERTEX_HANDLE_Y_OFFSET,
        descriptor.point.z,
      )
      handle.layers.enableAll()
      handle.userData.isGuideRouteVertexHandle = true
      handle.userData.nodeId = selectedNodeId
      handle.userData.guideRouteVertexIndex = descriptor.vertexIndex
      handle.userData.guideRouteHandleKey = descriptor.key
      handle.userData.guideRouteLegId = descriptor.legId
      handle.userData.guideRouteAnchorId = descriptor.anchorId
      handle.userData.guideRouteEndpoint = descriptor.endpoint
      handle.userData.guideRouteLocked = descriptor.locked
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.userData.endpointGizmo = gizmo
      handle.userData.handleKey = descriptor.key
      handle.userData.yOffset = GUIDE_ROUTE_VERTEX_HANDLE_Y_OFFSET

      handle.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        mesh.userData.isGuideRouteVertexHandle = true
        mesh.userData.nodeId = selectedNodeId
        mesh.userData.guideRouteVertexIndex = descriptor.vertexIndex
      })

      group.add(handle)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
    hovered = null
    active = null
    selected = null
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): GuideRouteVertexHandlePickResult | null {
    if (!state?.group || !options.camera || !options.canvas) {
      return null
    }

    options.raycaster.setFromCamera(options.pointer, options.camera)
    const hits = options.raycaster.intersectObjects(state.group.children, true)
    for (const hit of hits) {
      const owner = findGuideRouteVertexHandleOwner(hit.object)
      if (!owner) {
        continue
      }
      const vertexIndex = Number(owner?.userData?.guideRouteVertexIndex)
      const nodeId = owner?.userData?.nodeId
      const handleKey = owner?.userData?.handleKey
      const legId = owner?.userData?.guideRouteLegId
      const anchorId = owner?.userData?.guideRouteAnchorId
      const endpoint = owner?.userData?.guideRouteEndpoint
      const locked = owner?.userData?.guideRouteLocked === true
      const gizmoPart = (hit.object?.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
      if (
        !Number.isInteger(vertexIndex)
        || typeof nodeId !== 'string'
        || !nodeId.length
        || typeof handleKey !== 'string'
        || typeof legId !== 'string'
        || typeof anchorId !== 'string'
      ) {
        continue
      }
      const partInfo = getEndpointGizmoPartInfoFromObject(hit.object)
      if (!gizmoPart || !partInfo) {
        continue
      }
      return {
        nodeId,
        handleKey,
        vertexIndex,
        legId,
        anchorId,
        endpoint: endpoint === 'start' || endpoint === 'end' ? endpoint : null,
        locked,
        gizmoPart,
        gizmoKind: partInfo.kind,
        gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
        point: hit.point.clone(),
      }
    }
    return null
  }

  function updateHover(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }) {
    const hit = pick(options)
    if (!hit) {
      clearHover()
      return
    }
    hovered = {
      handleKey: hit.handleKey,
      gizmoPart: hit.gizmoPart,
    }
    refreshHighlight()
  }

  function updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }) {
    if (!state?.group || !options.camera || !options.canvas) {
      return
    }
    const diameterPx = options.diameterPx ?? GUIDE_ROUTE_VERTEX_HANDLE_SCREEN_DIAMETER_PX
    state.group.updateMatrixWorld(true)
    for (const child of state.group.children) {
      child.getWorldPosition(tmpWorldPos)
      options.camera.getWorldPosition(tmpCameraWorldPos)
      const distance = tmpWorldPos.distanceTo(tmpCameraWorldPos)
      const worldUnitsPerPixel = computeWorldUnitsPerPixel({
        camera: options.camera,
        distance,
        viewportHeightPx: options.canvas.clientHeight || options.canvas.height || 1,
      })
      const nearScaleMultiplier = distance < NEAR_SCALE_DISTANCE
        ? 1 + ((NEAR_SCALE_DISTANCE - distance) / NEAR_SCALE_DISTANCE) * (NEAR_SCALE_MAX_MULT - 1)
        : 1
      const parent = child.parent
      parent?.getWorldScale(tmpParentWorldScale)
      const parentScale = Math.max(1e-6, tmpParentWorldScale.x, tmpParentWorldScale.y, tmpParentWorldScale.z)
      const targetDiameter = Math.max(1e-4, worldUnitsPerPixel * diameterPx * nearScaleMultiplier)
      const gizmo = child.userData?.endpointGizmo as { setBaseDiameter?: (diameter: number) => void } | undefined
      gizmo?.setBaseDiameter?.(targetDiameter / parentScale)
    }
  }

  return {
    clear,
    clearHover,
    setActiveHandle,
    setSelectedHandle,
    updateHover,
    ensure: (options) => attachOrRebuild(options),
    forceRebuild: (options) => attachOrRebuild({ ...options, force: true }),
    pick,
    updateScreenSize,
  }
}

export { GUIDE_ROUTE_VERTEX_HANDLE_GROUP_NAME, GUIDE_ROUTE_VERTEX_HANDLE_Y_OFFSET }
