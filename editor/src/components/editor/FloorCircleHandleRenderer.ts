import * as THREE from 'three'
import type { FloorDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import {
  createEndpointGizmoObject,
  getEndpointGizmoPartInfoFromObject,
  type EndpointGizmoPart,
} from './EndpointGizmo'

export type FloorCircleHandleState = {
  nodeId: string
  group: THREE.Group
  signature: string
}

export type FloorCircleHandlePickResult = {
  nodeId: string
  handleKind: 'circle'
  circleKind: 'center' | 'radius'
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type FloorCircleHandleRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: { nodeId: string; circleKind: 'center' | 'radius'; gizmoPart: EndpointGizmoPart } | null): void
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
  }): FloorCircleHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
    freezeCircleFacing?: boolean
  }): void
  getState(): FloorCircleHandleState | null
}

const FLOOR_CIRCLE_HANDLE_Y_OFFSET = 0.03
export const FLOOR_CIRCLE_HANDLE_GROUP_NAME = '__FloorCircleHandles'

const FLOOR_CIRCLE_HANDLE_RENDER_ORDER = 1001
const FLOOR_CIRCLE_HANDLE_SCREEN_DIAMETER_PX = 36
const FLOOR_CIRCLE_HANDLE_COLOR = 0xff4081

function computeFloorCircleHandleSignature(definition: FloorDynamicMesh): string {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  const serialized = stableSerialize([
    vertices,
    Number.isFinite(definition.smooth) ? definition.smooth : null,
    Number.isFinite(definition.thickness) ? definition.thickness : null,
  ])
  return hashString(serialized)
}

function disposeFloorCircleHandleGroup(group: THREE.Group) {
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

function computeCircleFromVertices(vertices: any[]): { centerX: number; centerZ: number; radius: number; segments: number } | null {
  const points: Array<{ x: number; z: number }> = []
  for (const entry of vertices) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    const x = Number(entry[0])
    const z = Number(entry[1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    points.push({ x, z })
  }

  if (points.length < 3) {
    return null
  }

  let sumX = 0
  let sumZ = 0
  for (const p of points) {
    sumX += p.x
    sumZ += p.z
  }

  const inv = 1 / Math.max(1, points.length)
  const centerX = sumX * inv
  const centerZ = sumZ * inv

  let meanRadius = 0
  for (const p of points) {
    meanRadius += Math.hypot(p.x - centerX, p.z - centerZ)
  }
  meanRadius /= Math.max(1, points.length)

  if (!Number.isFinite(centerX + centerZ + meanRadius) || meanRadius <= 1e-4) {
    return null
  }

  return { centerX, centerZ, radius: meanRadius, segments: points.length }
}

export function createFloorCircleHandleRenderer(): FloorCircleHandleRenderer {
  let state: FloorCircleHandleState | null = null
  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const tmpCameraLocalPos = new THREE.Vector3()
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
    disposeFloorCircleHandleGroup(existing.group)
    hovered = null
    active = null
  }

  function clearHover() {
    if (!hovered) return
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: { nodeId: string; circleKind: 'center' | 'radius'; gizmoPart: EndpointGizmoPart } | null) {
    if (!state) {
      active = null
      return
    }
    if (!next) {
      active = null
      refreshHighlight()
      return
    }
    const handleKey = `${next.nodeId}:circle:${next.circleKind}`
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

    const circle = computeCircleFromVertices(definition.vertices as any[])
    if (!circle) {
      clear()
      return
    }

    const signature = computeFloorCircleHandleSignature(definition)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = FLOOR_CIRCLE_HANDLE_GROUP_NAME
    group.userData.isFloorCircleHandles = true

    const thickness = Number.isFinite(definition.thickness)
      ? Math.min(10, Math.max(0, Number(definition.thickness)))
      : 0
    const yOffset = FLOOR_CIRCLE_HANDLE_Y_OFFSET + thickness * 0.5

    group.userData.centerX = circle.centerX
    group.userData.centerZ = circle.centerZ
    group.userData.radius = circle.radius
    group.userData.yOffset = yOffset

    const centerGizmo = createEndpointGizmoObject({
      axes: { x: false, y: true, z: false },
      showNegativeAxes: true,
      renderOrder: FLOOR_CIRCLE_HANDLE_RENDER_ORDER,
      depthTest: false,
      depthWrite: false,
      opacity: 0.9,
      centerColor: FLOOR_CIRCLE_HANDLE_COLOR,
    })

    const centerHandle = centerGizmo.root
    centerHandle.name = 'FloorCircleCenterHandle'
    centerHandle.position.set(circle.centerX, yOffset, circle.centerZ)
    centerHandle.layers.enableAll()
    centerHandle.userData.isFloorCircleHandle = true
    centerHandle.userData.nodeId = selectedNodeId
    centerHandle.userData.handleKind = 'circle'
    centerHandle.userData.circleKind = 'center'
    centerHandle.userData.baseDiameter = centerGizmo.baseDiameter
    centerHandle.userData.endpointGizmo = centerGizmo
    centerHandle.userData.handleKey = `${selectedNodeId}:circle:center`
    centerHandle.userData.yOffset = yOffset

    centerHandle.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh) return
      mesh.userData.isFloorCircleHandle = true
      mesh.userData.nodeId = selectedNodeId
      mesh.userData.handleKind = 'circle'
      mesh.userData.circleKind = 'center'
    })

    const radiusGizmo = createEndpointGizmoObject({
      axes: { x: false, y: false, z: false },
      showNegativeAxes: false,
      renderOrder: FLOOR_CIRCLE_HANDLE_RENDER_ORDER,
      depthTest: false,
      depthWrite: false,
      opacity: 0.9,
      centerColor: FLOOR_CIRCLE_HANDLE_COLOR,
    })

    const radiusHandle = radiusGizmo.root
    radiusHandle.name = 'FloorCircleRadiusHandle'
    radiusHandle.position.set(circle.centerX + circle.radius, yOffset, circle.centerZ)
    radiusHandle.layers.enableAll()
    radiusHandle.userData.isFloorCircleHandle = true
    radiusHandle.userData.nodeId = selectedNodeId
    radiusHandle.userData.handleKind = 'circle'
    radiusHandle.userData.circleKind = 'radius'
    radiusHandle.userData.baseDiameter = radiusGizmo.baseDiameter
    radiusHandle.userData.endpointGizmo = radiusGizmo
    radiusHandle.userData.handleKey = `${selectedNodeId}:circle:radius`
    radiusHandle.userData.yOffset = yOffset

    radiusHandle.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh) return
      mesh.userData.isFloorCircleHandle = true
      mesh.userData.nodeId = selectedNodeId
      mesh.userData.handleKind = 'circle'
      mesh.userData.circleKind = 'radius'
    })

    group.add(centerHandle)
    group.add(radiusHandle)

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
    hovered = null
    active = null
  }

  function ensure(options: Parameters<FloorCircleHandleRenderer['ensure']>[0]) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: Parameters<FloorCircleHandleRenderer['ensure']>[0]) {
    attachOrRebuild({ ...options, force: true })
  }

  function pick(options: Parameters<FloorCircleHandleRenderer['pick']>[0]): FloorCircleHandlePickResult | null {
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
    const circleKind = target.userData?.circleKind === 'radius' ? 'radius' : 'center'

    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
    const partInfo = getEndpointGizmoPartInfoFromObject(target)

    if (!nodeId || !gizmoPart || !partInfo) {
      return null
    }

    return {
      nodeId,
      handleKind: 'circle',
      circleKind,
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
    const circleKind = target.userData?.circleKind === 'radius' ? 'radius' : 'center'
    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null

    if (!nodeId || !gizmoPart) {
      clearHover()
      return
    }

    const handleKey = `${nodeId}:circle:${circleKind}`
    if (hovered && hovered.handleKey === handleKey && hovered.gizmoPart === gizmoPart) {
      return
    }

    hovered = { handleKey, gizmoPart }
    refreshHighlight()
  }

  function updateScreenSize(options: Parameters<FloorCircleHandleRenderer['updateScreenSize']>[0]) {
    if (!state || !options.camera || !options.canvas) {
      return
    }

    const diameterPx =
      typeof options.diameterPx === 'number' && Number.isFinite(options.diameterPx) && options.diameterPx > 0
        ? options.diameterPx
        : FLOOR_CIRCLE_HANDLE_SCREEN_DIAMETER_PX

    const viewportHeightPx = Math.max(1, options.canvas.getBoundingClientRect().height)

    // Update radius handle position to face the camera (unless frozen during drag).
    const freezeFacing = !!options.freezeCircleFacing
    if (!freezeFacing) {
      const centerX = Number(state.group.userData?.centerX)
      const centerZ = Number(state.group.userData?.centerZ)
      const radius = Number(state.group.userData?.radius)
      if (Number.isFinite(centerX + centerZ + radius) && radius > 1e-4) {
        options.camera.getWorldPosition(tmpCameraWorldPos)
        tmpCameraLocalPos.copy(tmpCameraWorldPos)
        state.group.parent?.worldToLocal?.(tmpCameraLocalPos)

        const dirX = tmpCameraLocalPos.x - centerX
        const dirZ = tmpCameraLocalPos.z - centerZ
        let len = Math.hypot(dirX, dirZ)
        let nx = 1
        let nz = 0
        if (len > 1e-6) {
          nx = dirX / len
          nz = dirZ / len
        }

        const rx = centerX + nx * radius
        const rz = centerZ + nz * radius

        const radiusHandle = state.group.children.find((c) => c?.userData?.circleKind === 'radius') as THREE.Object3D | undefined
        if (radiusHandle) {
          const y = Number(radiusHandle.userData?.yOffset)
          radiusHandle.position.set(rx, Number.isFinite(y) ? y : FLOOR_CIRCLE_HANDLE_Y_OFFSET, rz)
        }

        const centerHandle = state.group.children.find((c) => c?.userData?.circleKind === 'center') as THREE.Object3D | undefined
        if (centerHandle) {
          const y = Number(centerHandle.userData?.yOffset)
          centerHandle.position.set(centerX, Number.isFinite(y) ? y : FLOOR_CIRCLE_HANDLE_Y_OFFSET, centerZ)
        }
      }
    }

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

export { FLOOR_CIRCLE_HANDLE_Y_OFFSET as FLOOR_CIRCLE_HANDLE_Y }
