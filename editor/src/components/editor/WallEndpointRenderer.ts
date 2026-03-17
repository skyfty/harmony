import * as THREE from 'three'
import type { WallDynamicMesh } from '@schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { compileWallSegmentsFromDefinition } from '@schema/wallLayout'
import { splitWallSegmentsIntoChains } from './wallSegmentUtils'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { resolveVisibleLocalHandleY } from './visibleHandleYUtils'
import type { WallBuildShape } from '@/types/wall-build-shape'

export type WallEndpointHandleState = {
  nodeId: string
  group: THREE.Group
  signature: string
}

export type WallEndpointHandlePickResult = {
  nodeId: string
  chainStartIndex: number
  chainEndIndex: number
} & (
  | {
      handleKind: 'endpoint'
      endpointKind: 'start' | 'end'
    }
  | {
      handleKind: 'joint'
      /** Segment index i where the joint is between segments[i].end and segments[i+1].start */
      jointIndex: number
    }
  | {
      handleKind: 'circle'
      circleKind: 'center' | 'radius'
    }
) & {
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
  } & (
    | { handleKind: 'endpoint'; endpointKind: 'start' | 'end' }
    | { handleKind: 'joint'; jointIndex: number }
    | { handleKind: 'circle'; circleKind: 'center' | 'radius' }
  ) & {
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
    resolveWallBuildShape: (nodeId: string) => WallBuildShape | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveWallBuildShape: (nodeId: string) => WallBuildShape | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
    freezeCircleFacing?: boolean
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

// Circle edit mode heuristics (lenient by default).
const WALL_CIRCLE_EDIT_MIN_SEGMENTS = 10
const WALL_CIRCLE_EDIT_CLOSURE_EPS = 0.05 // meters (XZ)
const WALL_CIRCLE_EDIT_RADIUS_CV_MAX = 0.1

// Circle handle visibility tweaks.
const WALL_CIRCLE_CENTER_HANDLE_EXTRA_Y = 0.15
const WALL_CIRCLE_CENTER_HANDLE_FRONT_OFFSET_MIN = 0.1
const WALL_CIRCLE_CENTER_HANDLE_FRONT_OFFSET_MAX = 0.5
const WALL_CIRCLE_CENTER_HANDLE_FRONT_OFFSET_RATIO = 0.15
const WALL_ENDPOINT_HANDLE_TOP_MARGIN_PX = 72
const WALL_ENDPOINT_HANDLE_BOTTOM_MARGIN_PX = 56
const WALL_ENDPOINT_HANDLE_PROXIMITY_PX = 44

function distanceSqXZPoints(a: any, b: any): number {
  const ax = Number(a?.x) || 0
  const az = Number(a?.z) || 0
  const bx = Number(b?.x) || 0
  const bz = Number(b?.z) || 0
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

function isClosedChainRange(segments: any[], range: { startIndex: number; endIndex: number }, eps = 1e-6): boolean {
  const startSeg = segments[range.startIndex] as any
  const endSeg = segments[range.endIndex] as any
  const first = startSeg?.start
  const last = endSeg?.end
  if (!first || !last) {
    return false
  }
  return distanceSqXZPoints(first, last) <= eps
}

function tryGetCircleEditInfoForChainLocal(
  segments: any[],
  range: { startIndex: number; endIndex: number },
  options?: {
    minSegments?: number
    enforceRadiusCv?: boolean
  },
): {
  centerLocal: { x: number; y: number; z: number }
  radius: number
} | null {
  const minSegments = Math.max(3, Math.trunc(Number(options?.minSegments ?? WALL_CIRCLE_EDIT_MIN_SEGMENTS)))
  const enforceRadiusCv = options?.enforceRadiusCv ?? true
  const count = Math.max(0, Math.trunc(range.endIndex) - Math.trunc(range.startIndex) + 1)
  if (count < minSegments) {
    return null
  }

  const startSeg = segments[range.startIndex] as any
  const endSeg = segments[range.endIndex] as any
  const first = startSeg?.start
  const last = endSeg?.end
  if (!first || !last) {
    return null
  }

  // Closed loop (XZ) with lenient threshold.
  const closureEpsSq = WALL_CIRCLE_EDIT_CLOSURE_EPS * WALL_CIRCLE_EDIT_CLOSURE_EPS
  if (distanceSqXZPoints(first, last) > closureEpsSq) {
    return null
  }

  // Collect vertices: first start + each segment end.
  const points: Array<{ x: number; y: number; z: number }> = []
  const pushPoint = (p: any) => {
    const x = Number(p?.x)
    const y = Number(p?.y)
    const z = Number(p?.z)
    if (!Number.isFinite(x + y + z)) return
    points.push({ x, y, z })
  }

  pushPoint(first)
  for (let i = range.startIndex; i <= range.endIndex; i += 1) {
    const seg = segments[i] as any
    pushPoint(seg?.end)
  }

  if (points.length < minSegments) {
    return null
  }

  // Drop the duplicated last vertex if it coincides with the first.
  if (points.length >= 2) {
    const a = points[0]!
    const b = points[points.length - 1]!
    const dx = a.x - b.x
    const dz = a.z - b.z
    if (dx * dx + dz * dz <= closureEpsSq) {
      points.pop()
    }
  }

  if (points.length < minSegments) {
    return null
  }

  // Estimate center as average of vertices (works well for evenly-sampled circles).
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  for (const p of points) {
    sumX += p.x
    sumY += p.y
    sumZ += p.z
  }
  const inv = 1 / Math.max(1, points.length)
  const centerLocal = { x: sumX * inv, y: sumY * inv, z: sumZ * inv }

  // Radius consistency: coefficient of variation of radii around the estimated center.
  const radii: number[] = []
  let mean = 0
  for (const p of points) {
    const r = Math.hypot(p.x - centerLocal.x, p.z - centerLocal.z)
    if (!Number.isFinite(r)) continue
    radii.push(r)
    mean += r
  }
  if (!radii.length) {
    return null
  }
  mean /= radii.length
  if (!Number.isFinite(mean) || mean < 1e-3) {
    return null
  }

  let variance = 0
  for (const r of radii) {
    const d = r - mean
    variance += d * d
  }
  variance /= Math.max(1, radii.length)
  const std = Math.sqrt(Math.max(0, variance))
  const cv = std / Math.max(1e-6, mean)
  if (enforceRadiusCv) {
    if (!Number.isFinite(cv) || cv > WALL_CIRCLE_EDIT_RADIUS_CV_MAX) {
      return null
    }
  }

  return { centerLocal, radius: mean }
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

function isEditorOnlyIntersectionObject(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    const userData = current.userData as Record<string, unknown> | undefined
    if (userData?.editorOnly === true) {
      return true
    }
    current = current.parent ?? null
  }
  return false
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
  const segments = compileWallSegmentsFromDefinition(definition)
  const serialized = stableSerialize(
    segments.map((s) => ({
      start: { x: s.start.x, y: s.start.y, z: s.start.z },
      end: { x: s.end.x, y: s.end.y, z: s.end.z },
    })),
  )
  return hashString(serialized)
}

export function createWallEndpointRenderer(): WallEndpointRenderer {
  let state: WallEndpointHandleState | null = null
  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const tmpCameraLocalPos = new THREE.Vector3()
  const tmpLocalPos = new THREE.Vector3()
  const tmpLocalPos2 = new THREE.Vector3()
  const tmpProjectedPos = new THREE.Vector3()
  const tmpParentWorldScale = new THREE.Vector3(1, 1, 1)
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

  function clearHoverPlacement() {
    if (!state) {
      return
    }
    for (const child of state.group.children) {
      delete child.userData?.hoverPreferredLocalY
    }
  }

  function updateLinearHandlePosition(options: {
    handle: THREE.Object3D
    runtimeObject: THREE.Object3D
    camera: THREE.Camera
    canvas: HTMLCanvasElement
  }): void {
    const { handle, runtimeObject, camera, canvas } = options
    const anchorX = Number(handle.userData?.anchorLocalX)
    const anchorY = Number(handle.userData?.anchorLocalY)
    const anchorZ = Number(handle.userData?.anchorLocalZ)
    const wallHeight = Number(handle.userData?.wallHeight)
    const hoverPreferredLocalY = Number(handle.userData?.hoverPreferredLocalY)
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY) || !Number.isFinite(anchorZ)) {
      return
    }

    tmpLocalPos.set(anchorX, anchorY, anchorZ)
    const resolvedLocalY = resolveVisibleLocalHandleY({
      camera,
      canvas,
      runtimeObject,
      localAnchor: tmpLocalPos,
      preferredLocalY: Number.isFinite(hoverPreferredLocalY)
        ? hoverPreferredLocalY
        : anchorY + Math.max(0.1, Number.isFinite(wallHeight) ? wallHeight : 0.1),
      minLocalY: anchorY + WALL_ENDPOINT_HANDLE_Y_OFFSET,
      topMarginPx: WALL_ENDPOINT_HANDLE_TOP_MARGIN_PX,
      bottomMarginPx: WALL_ENDPOINT_HANDLE_BOTTOM_MARGIN_PX,
    })
    handle.userData.yOffset = resolvedLocalY - anchorY
    handle.position.set(anchorX, resolvedLocalY, anchorZ)
  }

  function raycastRuntimeSurfaceLocalPoint(runtimeObject: THREE.Object3D, raycaster: THREE.Raycaster): THREE.Vector3 | null {
    runtimeObject.updateWorldMatrix(true, true)
    const intersections = raycaster.intersectObject(runtimeObject, true)
    for (const intersection of intersections) {
      if (!intersection?.point) {
        continue
      }
      if (isEditorOnlyIntersectionObject(intersection.object as THREE.Object3D)) {
        continue
      }
      tmpLocalPos2.copy(intersection.point)
      runtimeObject.worldToLocal(tmpLocalPos2)
      return tmpLocalPos2.clone()
    }
    return null
  }

  function findNearbyLinearHandle(options: {
    runtimeObject: THREE.Object3D
    camera: THREE.Camera
    canvas: HTMLCanvasElement
    pointerClientX: number
    pointerClientY: number
  }): THREE.Object3D | null {
    if (!state) {
      return null
    }

    const rect = options.canvas.getBoundingClientRect()
    const pointerX = options.pointerClientX - rect.left
    const pointerY = options.pointerClientY - rect.top
    const maxDistSq = WALL_ENDPOINT_HANDLE_PROXIMITY_PX * WALL_ENDPOINT_HANDLE_PROXIMITY_PX
    let bestHandle: THREE.Object3D | null = null
    let bestDistSq = Number.POSITIVE_INFINITY

    for (const child of state.group.children) {
      if (child?.userData?.handleKind === 'circle') {
        continue
      }

      const anchorX = Number(child.userData?.anchorLocalX)
      const anchorY = Number(child.userData?.anchorLocalY)
      const anchorZ = Number(child.userData?.anchorLocalZ)
      if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY) || !Number.isFinite(anchorZ)) {
        continue
      }

      tmpWorldPos.set(anchorX, anchorY, anchorZ)
      options.runtimeObject.localToWorld(tmpWorldPos)
      tmpProjectedPos.copy(tmpWorldPos).project(options.camera)
      if (tmpProjectedPos.z < -1 || tmpProjectedPos.z > 1) {
        continue
      }

      const screenX = (tmpProjectedPos.x * 0.5 + 0.5) * rect.width
      const screenY = (-tmpProjectedPos.y * 0.5 + 0.5) * rect.height
      const dx = screenX - pointerX
      const dy = screenY - pointerY
      const distSq = dx * dx + dy * dy
      if (distSq <= maxDistSq && distSq < bestDistSq) {
        bestDistSq = distSq
        bestHandle = child
      }
    }

    return bestHandle
  }

  function resolveHandleRoot(object: THREE.Object3D | null): THREE.Object3D | null {
    if (!state || !object) {
      return null
    }
    let current: THREE.Object3D | null = object
    while (current && current.parent) {
      if (current.parent === state.group) {
        return current
      }
      current = current.parent
    }
    return null
  }

  function applyHoverPlacement(options: {
    handle: THREE.Object3D | null
    runtimeObject: THREE.Object3D
    camera: THREE.Camera
    canvas: HTMLCanvasElement
    raycaster: THREE.Raycaster
  }): void {
    clearHoverPlacement()
    const handle = options.handle
    if (!handle) {
      return
    }

    const anchorY = Number(handle.userData?.anchorLocalY)
    const wallHeight = Number(handle.userData?.wallHeight)
    if (!Number.isFinite(anchorY)) {
      return
    }

    const surfaceLocalPoint = raycastRuntimeSurfaceLocalPoint(options.runtimeObject, options.raycaster)
    const hoverLocalYRaw = surfaceLocalPoint?.y
    handle.userData.hoverPreferredLocalY = Number.isFinite(hoverLocalYRaw)
      ? THREE.MathUtils.clamp(
          Number(hoverLocalYRaw) + WALL_ENDPOINT_HANDLE_Y_OFFSET,
          anchorY + WALL_ENDPOINT_HANDLE_Y_OFFSET,
          anchorY + Math.max(0.1, Number.isFinite(wallHeight) ? wallHeight : 0.1),
        )
      : anchorY + Math.max(0.1, Number.isFinite(wallHeight) ? wallHeight : 0.1)

    updateLinearHandlePosition({
      handle,
      runtimeObject: options.runtimeObject,
      camera: options.camera,
      canvas: options.canvas,
    })
  }

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    clearHoverPlacement()
    state = null
    existing.group.removeFromParent()
    disposeWallEndpointHandleGroup(existing.group)
    hovered = null
    active = null
  }

  function clearHover() {
    if (!hovered) return
    clearHoverPlacement()
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: {
    nodeId: string
    chainStartIndex: number
    chainEndIndex: number
  } & (
    | { handleKind: 'endpoint'; endpointKind: 'start' | 'end' }
    | { handleKind: 'joint'; jointIndex: number }
    | { handleKind: 'circle'; circleKind: 'center' | 'radius' }
  ) & {
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
    const handleKey =
      next.handleKind === 'joint'
        ? `${next.nodeId}:${next.chainStartIndex}:${next.chainEndIndex}:joint:${next.jointIndex}`
        : next.handleKind === 'circle'
          ? `${next.nodeId}:${next.chainStartIndex}:${next.chainEndIndex}:circle:${next.circleKind}`
          : `${next.nodeId}:${next.chainStartIndex}:${next.chainEndIndex}:endpoint:${next.endpointKind}`
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

      const allParts: EndpointGizmoPart[] = ['center', 'px', 'nx', 'py', 'ny', 'pz', 'nz']

      if (active && key === active.handleKey) {
        // Ensure the full gizmo is visible (important for joint handles where normal is hidden),
        // while still emphasizing the active part.
        for (const part of allParts) {
          gizmo.setState(part, 'hover')
        }
        gizmo.setState(active.gizmoPart, 'active')
      } else if (hovered && key === hovered.handleKey) {
        for (const part of allParts) {
          gizmo.setState(part, 'hover')
        }
      }
    }
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveWallBuildShape: (nodeId: string) => WallBuildShape | null
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
    const wallBuildShape = options.resolveWallBuildShape(selectedNodeId)
    const forceCircleLikeEdit = wallBuildShape === 'circle'

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

    const segments = compileWallSegmentsFromDefinition(definition)
    if (!segments.length) {
      state = { nodeId: selectedNodeId, group, signature }
      runtimeObject.add(group)
      return
    }

    const height = Math.max(0.1, definition.dimensions?.height ?? 3)
    const preferredYOffset = height

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

      const circleInfo = forceCircleLikeEdit
        ? tryGetCircleEditInfoForChainLocal(segments as any[], range, {
          minSegments: 3,
          enforceRadiusCv: false,
        })
        : tryGetCircleEditInfoForChainLocal(segments as any[], range)
      const closedChain = isClosedChainRange(segments as any[], range)

      const addHandle = (options:
        | {
            handleKind: 'endpoint'
            endpointKind: 'start' | 'end'
            point: any
            hideNormalState?: boolean
          }
        | {
            handleKind: 'joint'
            jointIndex: number
            point: any
            hideNormalState?: boolean
          }
        | {
            handleKind: 'circle'
            circleKind: 'center' | 'radius'
            point: any
            hideNormalState?: boolean
          }
      ) => {
        const point = options.point
        const x = Number(point?.x)
        const y = Number(point?.y)
        const z = Number(point?.z)
        if (!Number.isFinite(x + z)) {
          return
        }

        const gizmo = createEndpointGizmoObject({
          axes: options.handleKind === 'circle'
            ? (options.circleKind === 'center' ? { x: false, y: true, z: false } : { x: true, y: false, z: false })
            : { x: true, y: true, z: true },
          showNegativeAxes: options.handleKind === 'circle' ? options.circleKind === 'center' : true,
          renderOrder: WALL_ENDPOINT_HANDLE_RENDER_ORDER,
          depthTest: false,
          depthWrite: false,
          opacity: 0.9,
          hideNormalState: options.hideNormalState ?? false,
        })
        const handle = gizmo.root
        if (options.handleKind === 'endpoint') {
          handle.name = `WallEndpointHandle_${chainIndex + 1}_${options.endpointKind}`
        } else {
          handle.name = options.handleKind === 'joint'
            ? `WallJointHandle_${chainIndex + 1}_${options.jointIndex}`
            : `WallCircleHandle_${chainIndex + 1}_${options.circleKind}`
        }
        handle.position.set(x, (Number.isFinite(y) ? y : 0) + preferredYOffset, z)
        handle.layers.enableAll()
        handle.userData.editorOnly = true
        handle.userData.isWallEndpointHandle = true
        handle.userData.nodeId = selectedNodeId
        handle.userData.anchorLocalX = x
        handle.userData.anchorLocalY = Number.isFinite(y) ? y : 0
        handle.userData.anchorLocalZ = z
        handle.userData.chainStartIndex = range.startIndex
        handle.userData.chainEndIndex = range.endIndex
        handle.userData.handleKind = options.handleKind
        if (options.handleKind === 'endpoint') {
          handle.userData.endpointKind = options.endpointKind
        } else if (options.handleKind === 'circle') {
          handle.userData.circleKind = options.circleKind
          if (circleInfo) {
            handle.userData.circleCenterLocal = { ...circleInfo.centerLocal }
            handle.userData.circleRadius = circleInfo.radius
          }
        } else {
          handle.userData.jointIndex = options.jointIndex
        }
        handle.userData.baseDiameter = gizmo.baseDiameter
        handle.userData.endpointGizmo = gizmo
        handle.userData.wallHeight = height
        handle.userData.handleKey =
          options.handleKind === 'joint'
            ? `${selectedNodeId}:${range.startIndex}:${range.endIndex}:joint:${options.jointIndex}`
            : options.handleKind === 'circle'
              ? `${selectedNodeId}:${range.startIndex}:${range.endIndex}:circle:${options.circleKind}`
            : `${selectedNodeId}:${range.startIndex}:${range.endIndex}:endpoint:${options.endpointKind}`
        handle.userData.yOffset = preferredYOffset

        handle.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh?.isMesh) return
          mesh.userData.editorOnly = true
          mesh.userData.isWallEndpointHandle = true
          mesh.userData.nodeId = selectedNodeId
          mesh.userData.chainStartIndex = range.startIndex
          mesh.userData.chainEndIndex = range.endIndex
          mesh.userData.handleKind = options.handleKind
          if (options.handleKind === 'endpoint') {
            mesh.userData.endpointKind = options.endpointKind
          } else if (options.handleKind === 'circle') {
            mesh.userData.circleKind = options.circleKind
            if (circleInfo) {
              mesh.userData.circleCenterLocal = { ...circleInfo.centerLocal }
              mesh.userData.circleRadius = circleInfo.radius
            }
          } else {
            mesh.userData.jointIndex = options.jointIndex
          }
        })

        group.add(handle)
      }

      // Circle edit mode: hide all segment handles, show only center + radius.
      if (circleInfo) {
        const centerPoint = circleInfo.centerLocal
        const radiusPoint = {
          x: circleInfo.centerLocal.x + circleInfo.radius,
          y: circleInfo.centerLocal.y,
          z: circleInfo.centerLocal.z,
        }
        addHandle({ handleKind: 'circle', circleKind: 'center', point: centerPoint })
        addHandle({ handleKind: 'circle', circleKind: 'radius', point: radiusPoint })
        return
      }

      addHandle({ handleKind: 'endpoint', endpointKind: 'start', point: start })
      if (!closedChain) {
        addHandle({ handleKind: 'endpoint', endpointKind: 'end', point: end })
      }

      // Joint handles: one per internal vertex between contiguous segments.
      // Hide in normal state; show only on hover/active.
      for (let i = range.startIndex; i < range.endIndex; i += 1) {
        const seg = segments[i] as any
        const joint = seg?.end
        if (!joint) continue
        addHandle({ handleKind: 'joint', jointIndex: i, point: joint, hideNormalState: true })
      }
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
    resolveWallBuildShape: (nodeId: string) => WallBuildShape | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveWallBuildShape: (nodeId: string) => WallBuildShape | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: true })
  }

  function updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
    freezeCircleFacing?: boolean
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
    const runtimeObject = (state.group.parent as THREE.Object3D | null) ?? state.group

    for (const child of state.group.children) {
      if (child?.userData?.handleKind === 'circle') {
        continue
      }
      updateLinearHandlePosition({
        handle: child,
        runtimeObject,
        camera: options.camera,
        canvas: options.canvas,
      })
    }

    // Circle radius handle: place at the nearest-to-camera point on the circle (XZ)
    // to reduce occlusion. Skip while a circle drag is active so moveDrag can own
    // the handle placement without fighting this per-frame update.
    if (!options.freezeCircleFacing) {
      if (runtimeObject) {
        tmpCameraLocalPos.copy(tmpCameraWorldPos)
        runtimeObject.worldToLocal(tmpCameraLocalPos)

        for (const child of state.group.children) {
          const handleKind = child?.userData?.handleKind
          if (handleKind !== 'circle') continue
          const circleKind = child?.userData?.circleKind
          if (circleKind !== 'radius' && circleKind !== 'center') continue
          const centerLocalRaw = child?.userData?.circleCenterLocal as { x: number; y: number; z: number } | undefined
          const radiusRaw = Number(child?.userData?.circleRadius)
          if (!centerLocalRaw || !Number.isFinite(radiusRaw) || radiusRaw <= 1e-6) continue

          const centerLocal = tmpLocalPos.set(centerLocalRaw.x, centerLocalRaw.y, centerLocalRaw.z)
          const wallHeight = Math.max(0.1, Number(child?.userData?.wallHeight) || 0.1)

          if (circleKind === 'center') {
            const dir = tmpCameraLocalPos.clone().sub(centerLocal)
            dir.y = 0
            if (dir.lengthSq() < 1e-10) {
              dir.set(1, 0, 0)
            } else {
              dir.normalize()
            }
            const frontOffset = THREE.MathUtils.clamp(
              radiusRaw * WALL_CIRCLE_CENTER_HANDLE_FRONT_OFFSET_RATIO,
              WALL_CIRCLE_CENTER_HANDLE_FRONT_OFFSET_MIN,
              WALL_CIRCLE_CENTER_HANDLE_FRONT_OFFSET_MAX,
            )
            const frontPosLocal = centerLocal.clone().add(dir.multiplyScalar(frontOffset))
            const resolvedLocalY = resolveVisibleLocalHandleY({
              camera: options.camera,
              canvas: options.canvas,
              runtimeObject,
              localAnchor: frontPosLocal,
              preferredLocalY: centerLocal.y + wallHeight + WALL_CIRCLE_CENTER_HANDLE_EXTRA_Y,
              minLocalY: centerLocal.y + WALL_ENDPOINT_HANDLE_Y_OFFSET + WALL_CIRCLE_CENTER_HANDLE_EXTRA_Y,
              topMarginPx: WALL_ENDPOINT_HANDLE_TOP_MARGIN_PX,
              bottomMarginPx: WALL_ENDPOINT_HANDLE_BOTTOM_MARGIN_PX,
            })
            child.userData.anchorLocalX = frontPosLocal.x
            child.userData.anchorLocalY = centerLocal.y
            child.userData.anchorLocalZ = frontPosLocal.z
            child.userData.yOffset = resolvedLocalY - centerLocal.y - WALL_CIRCLE_CENTER_HANDLE_EXTRA_Y
            child.position.set(
              frontPosLocal.x,
              resolvedLocalY,
              frontPosLocal.z,
            )
            continue
          }

          const dir = tmpCameraLocalPos.clone().sub(centerLocal)
          dir.y = 0
          if (dir.lengthSq() < 1e-10) {
            dir.set(1, 0, 0)
          } else {
            dir.normalize()
          }
          const radiusPosLocal = centerLocal.clone().add(dir.multiplyScalar(radiusRaw))
          const resolvedLocalY = resolveVisibleLocalHandleY({
            camera: options.camera,
            canvas: options.canvas,
            runtimeObject,
            localAnchor: radiusPosLocal,
            preferredLocalY: centerLocal.y + wallHeight,
            minLocalY: centerLocal.y + WALL_ENDPOINT_HANDLE_Y_OFFSET,
            topMarginPx: WALL_ENDPOINT_HANDLE_TOP_MARGIN_PX,
            bottomMarginPx: WALL_ENDPOINT_HANDLE_BOTTOM_MARGIN_PX,
          })
          child.userData.anchorLocalX = radiusPosLocal.x
          child.userData.anchorLocalY = centerLocal.y
          child.userData.anchorLocalZ = radiusPosLocal.z
          child.userData.yOffset = resolvedLocalY - centerLocal.y
          child.position.set(
            radiusPosLocal.x,
            resolvedLocalY,
            radiusPosLocal.z,
          )
        }
      }
    }

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

    const runtimeObject = (state.group.parent as THREE.Object3D | null) ?? null

    const directTarget = intersections[0]?.object as THREE.Object3D | undefined
    let target = resolveHandleRoot(directTarget ?? null) ?? directTarget ?? null
    let gizmoPart = (directTarget?.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null

    if ((!target || !gizmoPart) && runtimeObject) {
      const nearbyHandle = findNearbyLinearHandle({
        runtimeObject,
        camera: options.camera,
        canvas: options.canvas,
        pointerClientX: options.event.clientX,
        pointerClientY: options.event.clientY,
      })
      if (nearbyHandle) {
        target = nearbyHandle
        gizmoPart = 'center'
      }
    }

    if (!target || !gizmoPart) {
      clearHover()
      return
    }

    const nodeId = typeof target.userData?.nodeId === 'string' ? target.userData.nodeId : ''
    const chainStartIndex = Math.trunc(Number(target.userData?.chainStartIndex))
    const chainEndIndex = Math.trunc(Number(target.userData?.chainEndIndex))
    const handleKind =
      target.userData?.handleKind === 'joint'
        ? 'joint'
        : target.userData?.handleKind === 'circle'
          ? 'circle'
          : 'endpoint'
    const endpointKind = target.userData?.endpointKind === 'end' ? 'end' : 'start'
    const jointIndex = Math.trunc(Number(target.userData?.jointIndex))
    const circleKind = target.userData?.circleKind === 'radius' ? 'radius' : 'center'
    if (!nodeId || chainStartIndex < 0 || chainEndIndex < chainStartIndex) {
      clearHover()
      return
    }

    if (handleKind === 'joint') {
      if (!Number.isFinite(jointIndex) || jointIndex < chainStartIndex || jointIndex >= chainEndIndex) {
        clearHover()
        return
      }
    }

    const handleKey =
      handleKind === 'joint'
        ? `${nodeId}:${chainStartIndex}:${chainEndIndex}:joint:${jointIndex}`
        : handleKind === 'circle'
          ? `${nodeId}:${chainStartIndex}:${chainEndIndex}:circle:${circleKind}`
          : `${nodeId}:${chainStartIndex}:${chainEndIndex}:endpoint:${endpointKind}`
    if (hovered && hovered.handleKey === handleKey && hovered.gizmoPart === gizmoPart) {
      return
    }

    if (runtimeObject && handleKind !== 'circle') {
      applyHoverPlacement({
        handle: target,
        runtimeObject,
        camera: options.camera,
        canvas: options.canvas,
        raycaster: options.raycaster,
      })
    } else {
      clearHoverPlacement()
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
    const handleKind =
      target.userData?.handleKind === 'joint'
        ? 'joint'
        : target.userData?.handleKind === 'circle'
          ? 'circle'
          : 'endpoint'
    const endpointKind = target.userData?.endpointKind === 'end' ? 'end' : 'start'
    const jointIndex = Math.trunc(Number(target.userData?.jointIndex))
    const circleKind = target.userData?.circleKind === 'radius' ? 'radius' : 'center'
    const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
    const partInfo = getEndpointGizmoPartInfoFromObject(target)

    if (!nodeId || chainStartIndex < 0 || chainEndIndex < chainStartIndex || !gizmoPart || !partInfo) {
      return null
    }

    if (handleKind === 'joint') {
      if (!Number.isFinite(jointIndex) || jointIndex < chainStartIndex || jointIndex >= chainEndIndex) {
        return null
      }
      return {
        nodeId,
        chainStartIndex,
        chainEndIndex,
        handleKind: 'joint',
        jointIndex,
        gizmoPart,
        gizmoKind: partInfo.kind,
        gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
        point: first.point.clone(),
      }
    }

    if (handleKind === 'circle') {
      return {
        nodeId,
        chainStartIndex,
        chainEndIndex,
        handleKind: 'circle',
        circleKind,
        gizmoPart,
        gizmoKind: partInfo.kind,
        gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
        point: first.point.clone(),
      }
    }

    return {
      nodeId,
      chainStartIndex,
      chainEndIndex,
      handleKind: 'endpoint',
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
