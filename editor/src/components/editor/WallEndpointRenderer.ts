import * as THREE from 'three'
import type { WallDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { splitWallSegmentsIntoChains } from './wallSegmentUtils'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'

export type WallEndpointHandleState = {
  nodeId: string
  group: THREE.Group
  signature: string
}

export type WallEndpointHandlePickResult = {
  nodeId: string
  chainStartIndex: number
  chainEndIndex: number
  endpointKind: 'start' | 'end'
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type WallEndpointRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: {
    nodeId: string
    chainStartIndex: number
    chainEndIndex: number
    endpointKind: 'start' | 'end'
    gizmoPart: EndpointGizmoPart
  } | null): void
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
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
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
  }): WallEndpointHandlePickResult | null
  getState(): WallEndpointHandleState | null
}

export const WALL_ENDPOINT_HANDLE_GROUP_NAME = '__WallEndpointHandles'
export const WALL_ENDPOINT_HANDLE_Y_OFFSET = 0.03

const WALL_ENDPOINT_HANDLE_RENDER_ORDER = 1001
const WALL_ENDPOINT_HANDLE_SCREEN_DIAMETER_PX = 36

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

// If the camera is very close to the handle, apply an extra on-screen multiplier
// so the gizmo becomes proportionally larger at near distances. This helps
// clicking when the camera is almost on top of a node.
const NEAR_SCALE_DISTANCE = 2.5
const NEAR_SCALE_MAX_MULT = 2.0

function disposeWallEndpointHandleGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

function computeWallEndpointHandleSignature(definition: WallDynamicMesh): string {
  const segments = Array.isArray(definition.segments) ? definition.segments : []
  const serialized = stableSerialize(
    segments.map((s) => ({
      start: { x: Number((s as any).start?.x) || 0, y: Number((s as any).start?.y) || 0, z: Number((s as any).start?.z) || 0 },
      end: { x: Number((s as any).end?.x) || 0, y: Number((s as any).end?.y) || 0, z: Number((s as any).end?.z) || 0 },
    })),
  )
  return hashString(serialized)
}

export function createWallEndpointRenderer(): WallEndpointRenderer {
  let state: WallEndpointHandleState | null = null
  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const tmpParentWorldScale = new THREE.Vector3(1, 1, 1)
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeWallEndpointHandleGroup(existing.group)
    hovered = null
    active = null
  }

  function clearHover() {
    if (!hovered) return
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: {
    nodeId: string
    chainStartIndex: number
    chainEndIndex: number
    endpointKind: 'start' | 'end'
    gizmoPart: EndpointGizmoPart
  } | null) {
    if (!state) {
      active = null
      return
    }
    if (!next) {
      active = null
      refreshHighlight()
      return
    }
    const handleKey = `${next.nodeId}:${next.chainStartIndex}:${next.chainEndIndex}:${next.endpointKind}`
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
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
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

    const definition = options.resolveWallDefinition(selectedNodeId)
    if (!definition || definition.type !== 'Wall') {
      clear()
      return
    }

    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }

    const signature = computeWallEndpointHandleSignature(definition)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = WALL_ENDPOINT_HANDLE_GROUP_NAME
    group.userData.isWallEndpointHandles = true
    group.userData.editorOnly = true

    const segments = Array.isArray(definition.segments) ? definition.segments : []
    if (!segments.length) {
      state = { nodeId: selectedNodeId, group, signature }
      runtimeObject.add(group)
      return
    }

    const sample = segments[0] as any
    const height = Number.isFinite(Number(sample?.height)) ? Math.max(0.1, Number(sample.height)) : 3
    // Place the gizmo at the middle of the wall height for better intuition.
    const yOffset = height * 0.5

    const chainRanges = splitWallSegmentsIntoChains(segments as any[])
    chainRanges.forEach((range, chainIndex) => {
      const startSeg = segments[range.startIndex] as any
      const endSeg = segments[range.endIndex] as any
      if (!startSeg || !endSeg) {
        return
      }

      const start = startSeg.start
      const end = endSeg.end
      if (!start || !end) {
        return
      }

      const addHandle = (kind: 'start' | 'end', point: any) => {
        const x = Number(point?.x)
        const y = Number(point?.y)
        const z = Number(point?.z)
        if (!Number.isFinite(x + z)) {
          return
        }

        const gizmo = createEndpointGizmoObject({
          axes: { x: true, y: true, z: true },
          showNegativeAxes: true,
          renderOrder: WALL_ENDPOINT_HANDLE_RENDER_ORDER,
          depthTest: false,
          depthWrite: false,
          opacity: 0.9,
        })
        const handle = gizmo.root
        handle.name = `WallEndpointHandle_${chainIndex + 1}_${kind}`
        handle.position.set(x, (Number.isFinite(y) ? y : 0) + yOffset, z)
        handle.layers.enableAll()
        handle.userData.editorOnly = true
        handle.userData.isWallEndpointHandle = true
        handle.userData.nodeId = selectedNodeId
        handle.userData.chainStartIndex = range.startIndex
        handle.userData.chainEndIndex = range.endIndex
        handle.userData.endpointKind = kind
        handle.userData.baseDiameter = gizmo.baseDiameter
        handle.userData.endpointGizmo = gizmo
        handle.userData.handleKey = `${selectedNodeId}:${range.startIndex}:${range.endIndex}:${kind}`
        handle.userData.yOffset = yOffset

        handle.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh?.isMesh) return
          mesh.userData.editorOnly = true
          mesh.userData.isWallEndpointHandle = true
          mesh.userData.nodeId = selectedNodeId
          mesh.userData.chainStartIndex = range.startIndex
          mesh.userData.chainEndIndex = range.endIndex
          mesh.userData.endpointKind = kind
        })

        group.add(handle)
      }

      addHandle('start', start)
      addHandle('end', end)
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
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: true })
  }

  function updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }) {
    if (!state || !options.camera || !options.canvas) {
      return
    }

    const diameterPx = Number.isFinite(options.diameterPx)
      ? Math.max(1, Number(options.diameterPx))
      : WALL_ENDPOINT_HANDLE_SCREEN_DIAMETER_PX

    const rect = options.canvas.getBoundingClientRect()
    if (rect.height <= 0) {
      return
    }

    state.group.updateWorldMatrix(true, true)

    options.camera.getWorldPosition(tmpCameraWorldPos)

    for (const child of state.group.children) {
      const handle = child as THREE.Object3D
      const baseDiameter = Number(handle.userData?.baseDiameter)
      if (!Number.isFinite(baseDiameter) || baseDiameter <= 1e-6) {
        continue
      }

      handle.getWorldPosition(tmpWorldPos)
      const distance = Math.max(1e-6, tmpWorldPos.distanceTo(tmpCameraWorldPos))
      const unitsPerPixel = computeWorldUnitsPerPixel({
        camera: options.camera,
        distance,
        viewportHeightPx: rect.height,
      })
      let desiredDiameterWorld = unitsPerPixel * diameterPx
      // Apply near-distance extra multiplier (linear from NEAR_SCALE_MAX_MULT at 0m to 1 at NEAR_SCALE_DISTANCE).
      if (distance < NEAR_SCALE_DISTANCE) {
        const t = THREE.MathUtils.clamp(1 - distance / NEAR_SCALE_DISTANCE, 0, 1)
        const nearMult = 1 + t * (NEAR_SCALE_MAX_MULT - 1)
        desiredDiameterWorld *= nearMult
      }

      // Keep on-screen size stable even if the node (parent) is scaled.
      const parent = handle.parent as THREE.Object3D | null
      if (parent) {
        parent.getWorldScale(tmpParentWorldScale)
      } else {
        tmpParentWorldScale.set(1, 1, 1)
      }
      const parentScale = Math.max(1e-6, Math.max(tmpParentWorldScale.x, tmpParentWorldScale.y, tmpParentWorldScale.z))
      const scale = desiredDiameterWorld / (baseDiameter * parentScale)
      if (!Number.isFinite(scale) || scale <= 0) {
        continue
      }
      handle.scale.setScalar(scale)
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
    const chainStartIndex = Math.trunc(Number(target.userData?.chainStartIndex))
    const chainEndIndex = Math.trunc(Number(target.userData?.chainEndIndex))
    const endpointKind = target.userData?.endpointKind === 'end' ? 'end' : 'start'
    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
    if (!nodeId || chainStartIndex < 0 || chainEndIndex < chainStartIndex || !gizmoPart) {
      clearHover()
      return
    }

    const handleKey = `${nodeId}:${chainStartIndex}:${chainEndIndex}:${endpointKind}`
    if (hovered && hovered.handleKey === handleKey && hovered.gizmoPart === gizmoPart) {
      return
    }
    hovered = { handleKey, gizmoPart }
    refreshHighlight()
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): WallEndpointHandlePickResult | null {
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
    const chainStartIndex = Math.trunc(Number(target.userData?.chainStartIndex))
    const chainEndIndex = Math.trunc(Number(target.userData?.chainEndIndex))
    const endpointKind = target.userData?.endpointKind === 'end' ? 'end' : 'start'
    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
    const partInfo = getEndpointGizmoPartInfoFromObject(target)

    if (!nodeId || chainStartIndex < 0 || chainEndIndex < chainStartIndex || !gizmoPart || !partInfo) {
      return null
    }

    return {
      nodeId,
      chainStartIndex,
      chainEndIndex,
      endpointKind,
      gizmoPart,
      gizmoKind: partInfo.kind,
      gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
      point: first.point.clone(),
    }
  }

  return {
    clear,
    clearHover,
    setActiveHandle,
    updateHover,
    ensure,
    forceRebuild,
    updateScreenSize,
    pick,
    getState: () => state,
  }
}
