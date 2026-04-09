import * as THREE from 'three'
import type { RegionDynamicMesh } from '@schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'

export type RegionVertexHandlePickResult = {
  nodeId: string
  vertexIndex: number
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type RegionVertexRenderer = {
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
    resolveRegionDefinition: (nodeId: string) => RegionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRegionDefinition: (nodeId: string) => RegionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): RegionVertexHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
}

const REGION_VERTEX_HANDLE_GROUP_NAME = '__RegionVertexHandles'
const REGION_VERTEX_HANDLE_RENDER_ORDER = 1001
const REGION_VERTEX_HANDLE_SCREEN_DIAMETER_PX = 48
const REGION_VERTEX_HANDLE_Y_OFFSET = 0.04
const REGION_VERTEX_HANDLE_COLOR = 0x26a69a

function computeRegionVertexHandleSignature(points: Array<[number, number]>): string {
  return hashString(stableSerialize(points))
}

function disposeGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

function sanitizePreviewPoints(points: Array<[number, number]> | undefined | null): Array<[number, number]> {
  if (!Array.isArray(points)) {
    return []
  }
  return points
    .map(([x, z]) => [Number(x), Number(z)] as [number, number])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
}

export function createRegionVertexRenderer(): RegionVertexRenderer {
  let state: { nodeId: string; group: THREE.Group; signature: string } | null = null
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

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

  function clearHover() {
    if (!hovered) {
      return
    }
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
    active = {
      handleKey: `${next.nodeId}:${next.vertexIndex}`,
      gizmoPart: next.gizmoPart,
    }
    refreshHighlight()
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRegionDefinition: (nodeId: string) => RegionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
    force?: boolean
  }) {
    const selectedNodeId = options.selectedNodeId
    if (!options.active || !selectedNodeId) {
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
    const previewPoints = sanitizePreviewPoints(options.previewPoints)
    const usePreviewPoints = previewPoints.length >= 3
    const mesh = options.resolveRegionDefinition(selectedNodeId)
    if (!usePreviewPoints && (!mesh || mesh.type !== 'Region')) {
      clear()
      return
    }
    const sourcePoints = usePreviewPoints
      ? previewPoints
      : (Array.isArray(mesh?.vertices)
        ? mesh.vertices
          .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
          .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
        : [])
    if (sourcePoints.length < 3) {
      clear()
      return
    }
    const signature = computeRegionVertexHandleSignature(sourcePoints)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }
    clear()

    const group = new THREE.Group()
    group.name = REGION_VERTEX_HANDLE_GROUP_NAME
    group.userData.isRegionVertexHandles = true

    sourcePoints.forEach(([x, z], index) => {
      const gizmo = createEndpointGizmoObject({
        axes: { x: true, y: false, z: true },
        showNegativeAxes: true,
        renderOrder: REGION_VERTEX_HANDLE_RENDER_ORDER,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        centerColor: REGION_VERTEX_HANDLE_COLOR,
      })
      const handle = gizmo.root
      handle.name = `RegionVertexHandle_${index + 1}`
      handle.position.set(x, REGION_VERTEX_HANDLE_Y_OFFSET, z)
      handle.layers.enableAll()
      handle.userData.isRegionVertexHandle = true
      handle.userData.nodeId = selectedNodeId
      handle.userData.regionVertexIndex = index
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.userData.endpointGizmo = gizmo
      handle.userData.handleKey = `${selectedNodeId}:${index}`
      handle.userData.yOffset = REGION_VERTEX_HANDLE_Y_OFFSET
      handle.traverse((child) => {
        const meshChild = child as THREE.Mesh
        if (!meshChild?.isMesh) {
          return
        }
        meshChild.userData.isRegionVertexHandle = true
        meshChild.userData.nodeId = selectedNodeId
        meshChild.userData.regionVertexIndex = index
        meshChild.userData.handleKey = `${selectedNodeId}:${index}`
      })
      group.add(handle)
    })
    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
    refreshHighlight()
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): RegionVertexHandlePickResult | null {
    if (!state || !options.camera || !options.canvas) {
      return null
    }
    options.raycaster.setFromCamera(options.pointer, options.camera)
    const hits = options.raycaster.intersectObjects(state.group.children, true)
    for (const hit of hits) {
      const object = hit.object as THREE.Object3D | null
      const handleKey = typeof object?.userData?.handleKey === 'string' ? object.userData.handleKey : null
      const vertexIndex = Number(object?.userData?.regionVertexIndex)
      if (!handleKey || !Number.isFinite(vertexIndex)) {
        continue
      }
      const partInfo = getEndpointGizmoPartInfoFromObject(object)
      return {
        nodeId: state.nodeId,
        vertexIndex,
        gizmoPart: partInfo?.part ?? 'center',
        gizmoKind: partInfo?.kind === 'axis' ? 'axis' : 'center',
        gizmoAxis: partInfo?.axis?.clone(),
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
    const handleKey = `${hit.nodeId}:${hit.vertexIndex}`
    if (hovered?.handleKey === handleKey && hovered.gizmoPart === hit.gizmoPart) {
      return
    }
    hovered = { handleKey, gizmoPart: hit.gizmoPart }
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
    const diameterPx = options.diameterPx ?? REGION_VERTEX_HANDLE_SCREEN_DIAMETER_PX
    state.group.children.forEach((handle) => {
      handle.getWorldPosition(tmpWorldPos)
      options.camera?.getWorldPosition(tmpCameraWorldPos)
      const distance = tmpWorldPos.distanceTo(tmpCameraWorldPos)
      const unitsPerPixel = computeWorldUnitsPerPixel(options.camera!, distance, options.canvas!)
      const desiredWorldDiameter = Math.max(unitsPerPixel * diameterPx, 1e-4)
      handle.parent?.getWorldScale(tmpParentWorldScale)
      const scaleX = tmpParentWorldScale.x !== 0 ? desiredWorldDiameter / tmpParentWorldScale.x : desiredWorldDiameter
      const scaleZ = tmpParentWorldScale.z !== 0 ? desiredWorldDiameter / tmpParentWorldScale.z : desiredWorldDiameter
      handle.scale.set(scaleX, 1, scaleZ)
    })
  }

  return {
    clear,
    clearHover,
    setActiveHandle,
    updateHover,
    ensure: (options) => attachOrRebuild(options),
    forceRebuild: (options) => attachOrRebuild({ ...options, force: true }),
    pick,
    updateScreenSize,
  }
}import * as THREE from 'three'
import type { RegionDynamicMesh } from '@schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'

export type RegionVertexHandlePickResult = {
  nodeId: string
  vertexIndex: number
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type RegionVertexRenderer = {
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
    resolveRegionDefinition: (nodeId: string) => RegionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRegionDefinition: (nodeId: string) => RegionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): RegionVertexHandlePickResult | null
  updateScreenSize(options: { camera: THREE.Camera | null; canvas: HTMLCanvasElement | null; diameterPx?: number }): void
}

const GROUP_NAME = '__RegionVertexHandles'
const HANDLE_RENDER_ORDER = 1001
const HANDLE_SCREEN_DIAMETER_PX = 48
const HANDLE_Y_OFFSET = 0.05
const HANDLE_COLOR = 0x26a69a

function computeSignature(points: Array<[number, number]>): string {
  return hashString(stableSerialize(points))
}

function sanitizePoints(points: Array<[number, number]> | undefined | null): Array<[number, number]> {
  if (!Array.isArray(points)) {
    return []
  }
  return points
    .map(([x, z]) => [Number(x), Number(z)] as [number, number])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
}

function disposeGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

export function createRegionVertexRenderer(): RegionVertexRenderer {
  let state: { nodeId: string; group: THREE.Group; signature: string } | null = null
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

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
      } else if (hovered && key === hovered.handleKey) {
        gizmo.setState(hovered.gizmoPart, 'hover')
      }
    }
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRegionDefinition: (nodeId: string) => RegionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
    force?: boolean
  }) {
    const selectedNodeId = options.selectedNodeId
    if (!options.active || !selectedNodeId || options.isSelectionLocked(selectedNodeId)) {
      clear()
      return
    }
    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }
    const previewPoints = sanitizePoints(options.previewPoints)
    const usePreview = previewPoints.length >= 3
    const mesh = options.resolveRegionDefinition(selectedNodeId)
    if (!usePreview && (!mesh || mesh.type !== 'Region')) {
      clear()
      return
    }
    const sourcePoints = usePreview ? previewPoints : sanitizePoints(mesh?.vertices as Array<[number, number]> | undefined)
    if (sourcePoints.length < 3) {
      clear()
      return
    }
    const signature = computeSignature(sourcePoints)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }
    clear()
    const group = new THREE.Group()
    group.name = GROUP_NAME
    group.userData.isRegionVertexHandles = true
    sourcePoints.forEach(([x, z], index) => {
      const gizmo = createEndpointGizmoObject({
        axes: { x: true, y: false, z: true },
        showNegativeAxes: true,
        renderOrder: HANDLE_RENDER_ORDER,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        centerColor: HANDLE_COLOR,
      })
      const handle = gizmo.root
      handle.name = `RegionVertexHandle_${index + 1}`
      handle.position.set(x, HANDLE_Y_OFFSET, z)
      handle.layers.enableAll()
      handle.userData.isRegionVertexHandle = true
      handle.userData.nodeId = selectedNodeId
      handle.userData.regionVertexIndex = index
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.userData.endpointGizmo = gizmo
      handle.userData.handleKey = `${selectedNodeId}:${index}`
      handle.userData.yOffset = HANDLE_Y_OFFSET
      handle.traverse((child) => {
        const meshChild = child as THREE.Mesh
        if (!meshChild?.isMesh) {
          return
        }
        meshChild.userData.isRegionVertexHandle = true
        meshChild.userData.nodeId = selectedNodeId
        meshChild.userData.regionVertexIndex = index
        meshChild.userData.handleKey = `${selectedNodeId}:${index}`
      })
      group.add(handle)
    })
    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
    refreshHighlight()
  }

  return {
    clear,
    clearHover() {
      if (!hovered) {
        return
      }
      hovered = null
      refreshHighlight()
    },
    setActiveHandle(next) {
      if (!state) {
        active = null
        return
      }
      active = next ? { handleKey: `${next.nodeId}:${next.vertexIndex}`, gizmoPart: next.gizmoPart } : null
      refreshHighlight()
    },
    updateHover(options) {
      const hit = this.pick(options)
      hovered = hit ? { handleKey: `${hit.nodeId}:${hit.vertexIndex}`, gizmoPart: hit.gizmoPart } : null
      refreshHighlight()
    },
    ensure(options) {
      attachOrRebuild(options)
    },
    forceRebuild(options) {
      attachOrRebuild({ ...options, force: true })
    },
    pick({ camera, canvas, event, pointer, raycaster }) {
      if (!camera || !canvas || !state) {
        return null
      }
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const intersections = raycaster.intersectObjects(state.group.children, true)
      for (const intersection of intersections) {
        const info = getEndpointGizmoPartInfoFromObject(intersection.object)
        const nodeId = typeof intersection.object.userData?.nodeId === 'string'
          ? intersection.object.userData.nodeId
          : typeof intersection.object.parent?.userData?.nodeId === 'string'
          ? intersection.object.parent.userData.nodeId
          : null
        const vertexIndexRaw = intersection.object.userData?.regionVertexIndex ?? intersection.object.parent?.userData?.regionVertexIndex
        const vertexIndex = Number(vertexIndexRaw)
        if (!info || !nodeId || !Number.isFinite(vertexIndex)) {
          continue
        }
        return {
          nodeId,
          vertexIndex,
          gizmoPart: info.part,
          gizmoKind: info.kind === 'axis' ? 'axis' : 'center',
          gizmoAxis: info.axis,
          point: intersection.point.clone(),
        }
      }
      return null
    },
    updateScreenSize({ camera, canvas, diameterPx }) {
      if (!state || !camera || !canvas) {
        return
      }
      const nextDiameter = Number.isFinite(diameterPx) ? Number(diameterPx) : HANDLE_SCREEN_DIAMETER_PX
      const tmpWorld = new THREE.Vector3()
      const tmpCameraWorld = new THREE.Vector3()
      state.group.children.forEach((handle) => {
        handle.getWorldPosition(tmpWorld)
        camera.getWorldPosition(tmpCameraWorld)
        const distance = tmpWorld.distanceTo(tmpCameraWorld)
        const unitsPerPixel = computeWorldUnitsPerPixel(camera, distance, canvas)
        const scale = Math.max(1e-4, unitsPerPixel * nextDiameter / Math.max(Number(handle.userData?.baseDiameter) || 1, 1e-6))
        handle.scale.setScalar(scale)
      })
    },
  }
}