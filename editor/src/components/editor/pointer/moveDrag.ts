import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import { ROAD_VERTEX_HANDLE_GROUP_NAME, ROAD_VERTEX_HANDLE_Y } from '../RoadVertexRenderer'
import { FLOOR_VERTEX_HANDLE_GROUP_NAME, FLOOR_VERTEX_HANDLE_Y } from '../FloorVertexRenderer'
import { WALL_ENDPOINT_HANDLE_GROUP_NAME, WALL_ENDPOINT_HANDLE_Y_OFFSET } from '../WallEndpointRenderer'
import { createWallGroup, updateWallGroup } from '@schema/wallMesh'
import { constrainWallEndPointSoftSnap } from '../wallEndpointSnap'
import { GRID_MAJOR_SPACING } from '../constants'
import { distanceSqXZ, splitWallSegmentsIntoChains } from '../wallSegmentUtils'
import { FLOOR_MAX_THICKNESS, FLOOR_MIN_THICKNESS } from '@schema/components'
import {
  applyWallPreviewStyling,
  buildWallPreviewDynamicMeshFromWorldSegments,
  computeWallPreviewSignature,
  mergeWallPreviewSegmentChainsByEndpoint,
} from '../wallPreviewGroupUtils'
import type {
  FloorVertexDragState,
  FloorThicknessDragState,
  RoadVertexDragState,
  WallEndpointDragState,
  WallJointDragState,
  WallHeightDragState,
  WallCircleCenterDragState,
  WallCircleRadiusDragState,
  PointerMoveResult,
} from './types'

function computeChainCenterAndRadiusWorldFromSegments(options: {
  segmentsWorld: Array<{ start: THREE.Vector3; end: THREE.Vector3 }>
  chainStartIndex: number
  chainEndIndex: number
}): { centerWorld: THREE.Vector3; radius: number } | null {
  const { segmentsWorld, chainStartIndex, chainEndIndex } = options
  const startSeg = segmentsWorld[chainStartIndex]
  const endSeg = segmentsWorld[chainEndIndex]
  if (!startSeg || !endSeg) {
    return null
  }

  const points: THREE.Vector3[] = []
  points.push(startSeg.start)
  for (let i = chainStartIndex; i <= chainEndIndex; i += 1) {
    const seg = segmentsWorld[i]
    if (!seg) continue
    points.push(seg.end)
  }
  if (points.length < 2) {
    return null
  }

  let sumX = 0
  let sumY = 0
  let sumZ = 0
  for (const p of points) {
    sumX += p.x
    sumY += p.y
    sumZ += p.z
  }
  const inv = 1 / Math.max(1, points.length)
  const centerWorld = new THREE.Vector3(sumX * inv, sumY * inv, sumZ * inv)

  let radius = 0
  for (const p of points) {
    radius += Math.hypot(p.x - centerWorld.x, p.z - centerWorld.z)
  }
  radius /= Math.max(1, points.length)

  if (!Number.isFinite(radius) || radius < 1e-4) {
    return null
  }

  return { centerWorld, radius }
}

function buildCircleSegmentsFixedCount(options: {
  centerWorld: THREE.Vector3
  radius: number
  segmentCount: number
}): Array<{ start: THREE.Vector3; end: THREE.Vector3 }> {
  const { centerWorld, radius } = options
  const segmentCount = Math.max(3, Math.trunc(options.segmentCount))
  const y = centerWorld.y

  const points: THREE.Vector3[] = []
  for (let i = 0; i < segmentCount; i += 1) {
    const t = (i / segmentCount) * Math.PI * 2
    points.push(new THREE.Vector3(centerWorld.x + Math.cos(t) * radius, y, centerWorld.z + Math.sin(t) * radius))
  }

  const result: Array<{ start: THREE.Vector3; end: THREE.Vector3 }> = []
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    result.push({ start: a, end: b })
  }
  return result
}

function updateWallCircleHandleMeshesForChain(options: {
  handles: THREE.Group
  containerObject: THREE.Object3D
  workingSegmentsWorld: Array<{ start: THREE.Vector3; end: THREE.Vector3 }>
  chainStartIndex: number
  chainEndIndex: number
  camera: THREE.Camera | null
}): void {
  const CENTER_EXTRA_Y = 0.15
  const FRONT_OFFSET_MIN = 0.1
  const FRONT_OFFSET_MAX = 0.5
  const FRONT_OFFSET_RATIO = 0.15

  const computed = computeChainCenterAndRadiusWorldFromSegments({
    segmentsWorld: options.workingSegmentsWorld,
    chainStartIndex: options.chainStartIndex,
    chainEndIndex: options.chainEndIndex,
  })
  if (!computed) {
    return
  }

  const centerWorld = computed.centerWorld
  const radiusWorld = computed.radius
  // Place radius handle at nearest-to-camera point on circle (XZ).
  const cameraWorld = options.camera ? options.camera.getWorldPosition(new THREE.Vector3()) : null
  const toCamera = cameraWorld ? cameraWorld.clone().sub(centerWorld) : new THREE.Vector3(1, 0, 0)
  toCamera.y = 0
  if (toCamera.lengthSq() < 1e-10) {
    toCamera.set(1, 0, 0)
  } else {
    toCamera.normalize()
  }
  const centerFrontOffset = THREE.MathUtils.clamp(
    radiusWorld * FRONT_OFFSET_RATIO,
    FRONT_OFFSET_MIN,
    FRONT_OFFSET_MAX,
  )
  const centerHandleWorld = centerWorld.clone().add(toCamera.clone().multiplyScalar(centerFrontOffset))
  const radiusPointWorld = centerWorld.clone().add(toCamera.multiplyScalar(radiusWorld))

  const centerLocal = options.containerObject.worldToLocal(centerWorld.clone())

  for (const child of options.handles.children) {
    const startIndex = Math.trunc(Number(child?.userData?.chainStartIndex))
    const endIndex = Math.trunc(Number(child?.userData?.chainEndIndex))
    if (startIndex !== options.chainStartIndex || endIndex !== options.chainEndIndex) {
      continue
    }

    if (child?.userData?.handleKind !== 'circle') {
      continue
    }

    const circleKind = child?.userData?.circleKind === 'radius' ? 'radius' : 'center'
    const pointWorld = circleKind === 'radius' ? radiusPointWorld : centerHandleWorld
    const local = options.containerObject.worldToLocal(pointWorld.clone())
    const yOffset = Number(child.userData?.yOffset)

    // Keep metadata in sync so per-frame camera-facing updates don't jump.
    child.userData.circleCenterLocal = { x: centerLocal.x, y: centerLocal.y, z: centerLocal.z }
    child.userData.circleRadius = radiusWorld

    child.position.set(
      local.x,
      local.y + (Number.isFinite(yOffset) ? yOffset : WALL_ENDPOINT_HANDLE_Y_OFFSET) + (circleKind === 'center' ? CENTER_EXTRA_Y : 0),
      local.z,
    )
  }
}

const rectDragCornersTmp = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
] as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]

const rectDraggedCornerTmp = new THREE.Vector3()
const wallHandleWorldTmp = new THREE.Vector3()

function snapToMajorGridXZ(point: THREE.Vector3, y: number): THREE.Vector3 {
  point.x = Math.round(point.x / GRID_MAJOR_SPACING) * GRID_MAJOR_SPACING
  point.z = Math.round(point.z / GRID_MAJOR_SPACING) * GRID_MAJOR_SPACING
  point.y = y
  return point
}

function applySameNodeEndpointMagnet(options: {
  constrained: THREE.Vector3
  y: number
  workingSegmentsWorld: Array<{ start: THREE.Vector3; end: THREE.Vector3 }>
  chainStartIndex: number
  chainEndIndex: number
}): void {
  const { constrained, y, workingSegmentsWorld, chainStartIndex, chainEndIndex } = options

  const snapDistance = GRID_MAJOR_SPACING * 0.35
  const snapDistanceSq = snapDistance * snapDistance
  const chains = splitWallSegmentsIntoChains(workingSegmentsWorld as any[])

  let best: THREE.Vector3 | null = null
  let bestDistSq = Number.POSITIVE_INFINITY
  for (const chain of chains) {
    if (chain.startIndex === chainStartIndex && chain.endIndex === chainEndIndex) {
      continue
    }
    const startSeg = workingSegmentsWorld[chain.startIndex]
    const endSeg = workingSegmentsWorld[chain.endIndex]
    if (!startSeg || !endSeg) {
      continue
    }
    const candidates = [startSeg.start, endSeg.end]
    for (const candidate of candidates) {
      const distSq = distanceSqXZ(constrained.x, constrained.z, candidate.x, candidate.z)
      if (distSq <= snapDistanceSq && distSq < bestDistSq) {
        bestDistSq = distSq
        best = candidate
      }
    }
  }
  if (best) {
    constrained.copy(best)
    constrained.y = y
  }
}

function applyRectangleConstraintToChain(options: {
  workingSegmentsWorld: Array<{ start: THREE.Vector3; end: THREE.Vector3 }>
  chainStartIndex: number
  chainEndIndex: number
  constraint: {
    cornerSides: Array<{ x: 'min' | 'max'; z: 'min' | 'max' }>
    draggedCornerIndex: 0 | 1 | 2 | 3
    oppositeCornerWorld: THREE.Vector3
  }
  desiredCornerWorld: THREE.Vector3
  y: number
  outDraggedCornerWorld: THREE.Vector3
}): boolean {
  const { workingSegmentsWorld, chainStartIndex, chainEndIndex, constraint, desiredCornerWorld, y, outDraggedCornerWorld } = options
  if (chainEndIndex - chainStartIndex !== 3) {
    return false
  }

  const seg0 = workingSegmentsWorld[chainStartIndex]
  const seg1 = workingSegmentsWorld[chainStartIndex + 1]
  const seg2 = workingSegmentsWorld[chainStartIndex + 2]
  const seg3 = workingSegmentsWorld[chainStartIndex + 3]
  if (!seg0 || !seg1 || !seg2 || !seg3) {
    return false
  }

  const moved = desiredCornerWorld
  const opposite = constraint.oppositeCornerWorld

  const minX = Math.min(moved.x, opposite.x)
  const maxX = Math.max(moved.x, opposite.x)
  const minZ = Math.min(moved.z, opposite.z)
  const maxZ = Math.max(moved.z, opposite.z)

  for (let i = 0; i < 4; i += 1) {
    const side = constraint.cornerSides[i]!
    const corner = rectDragCornersTmp[i]!
    corner.set(side.x === 'min' ? minX : maxX, y, side.z === 'min' ? minZ : maxZ)
  }

  // Rebuild only the currently dragged chain (keeps other chains intact).
  seg0.start.copy(rectDragCornersTmp[0])
  seg0.end.copy(rectDragCornersTmp[1])
  seg1.start.copy(rectDragCornersTmp[1])
  seg1.end.copy(rectDragCornersTmp[2])
  seg2.start.copy(rectDragCornersTmp[2])
  seg2.end.copy(rectDragCornersTmp[3])
  seg3.start.copy(rectDragCornersTmp[3])
  seg3.end.copy(rectDragCornersTmp[0])

  outDraggedCornerWorld.copy(rectDragCornersTmp[constraint.draggedCornerIndex])
  return true
}

function updateWallHandleMeshesForChain(options: {
  handles: THREE.Group
  containerObject: THREE.Object3D
  workingSegmentsWorld: Array<{ start: THREE.Vector3; end: THREE.Vector3 }>
  chainStartIndex: number
  chainEndIndex: number
}): void {
  const { handles, containerObject, workingSegmentsWorld, chainStartIndex, chainEndIndex } = options
  const startSeg = workingSegmentsWorld[chainStartIndex]
  const endSeg = workingSegmentsWorld[chainEndIndex]
  if (!startSeg || !endSeg) {
    return
  }

  for (const child of handles.children) {
    const startIndex = Math.trunc(Number(child?.userData?.chainStartIndex))
    const endIndex = Math.trunc(Number(child?.userData?.chainEndIndex))
    if (startIndex !== chainStartIndex || endIndex !== chainEndIndex) {
      continue
    }

    const handleKind = child?.userData?.handleKind === 'joint' ? 'joint' : 'endpoint'
    let pointWorld: THREE.Vector3 | null = null
    if (handleKind === 'joint') {
      const jointIndex = Math.trunc(Number(child?.userData?.jointIndex))
      const seg = workingSegmentsWorld[jointIndex]
      if (seg) {
        pointWorld = seg.end
      }
    } else {
      const endpointKind = child?.userData?.endpointKind === 'end' ? 'end' : 'start'
      pointWorld = endpointKind === 'start' ? startSeg.start : endSeg.end
    }

    if (!pointWorld) {
      continue
    }

    wallHandleWorldTmp.copy(pointWorld)
    const local = containerObject.worldToLocal(wallHandleWorldTmp)
    const yOffset = Number(child.userData?.yOffset)
    child.position.set(
      local.x,
      local.y + (Number.isFinite(yOffset) ? yOffset : WALL_ENDPOINT_HANDLE_Y_OFFSET),
      local.z,
    )
  }
}

type FloorEdgeDragStateLike = {
  pointerId: number
  nodeId: string
  edgeIndex: number
  startX: number
  startY: number
  moved: boolean
  runtimeObject: THREE.Object3D
  workingDefinition: any
  startVertices: Array<[number, number]>
  perp: THREE.Vector2
  referencePoint: THREE.Vector2
  initialProjection: number
}

function sanitizeFloorVertices(vertices: unknown): Array<[number, number]> {
  if (!Array.isArray(vertices)) {
    return []
  }

  return vertices
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null
      }
      const x = Number(entry[0])
      const z = Number(entry[1])
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return null
      }
      return [x, z] as [number, number]
    })
    .filter((v): v is [number, number] => Array.isArray(v))
}

function computeBoundsXZ(vertices: Array<[number, number]>): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (!vertices.length) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [x, z] of vertices) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return null
  }

  return { minX, maxX, minZ, maxZ }
}

function buildRectangleVertices(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): Array<[number, number]> {
  return [
    [bounds.minX, bounds.minZ],
    [bounds.minX, bounds.maxZ],
    [bounds.maxX, bounds.maxZ],
    [bounds.maxX, bounds.minZ],
  ]
}

function computeMeanCenter(vertices: Array<[number, number]>): { x: number; z: number } | null {
  if (!vertices.length) {
    return null
  }
  let sumX = 0
  let sumZ = 0
  let count = 0
  for (const [x, z] of vertices) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    sumX += x
    sumZ += z
    count += 1
  }
  if (count <= 0) {
    return null
  }
  return { x: sumX / count, z: sumZ / count }
}

function buildCircleVertices(options: { centerX: number; centerZ: number; radius: number; segments: number }): Array<[number, number]> {
  const segments = Math.max(8, Math.min(256, Math.floor(options.segments)))
  const radius = Math.max(1e-4, options.radius)
  const out: Array<[number, number]> = []
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2
    out.push([options.centerX + Math.cos(t) * radius, options.centerZ + Math.sin(t) * radius])
  }
  return out
}
export function handlePointerMoveDrag(
  event: PointerEvent,
  ctx: {
    clickDragThresholdPx: number

    roadVertexDragState: RoadVertexDragState | null
    floorVertexDragState: FloorVertexDragState | null
    floorThicknessDragState: FloorThicknessDragState | null
    wallEndpointDragState: WallEndpointDragState | null
    wallJointDragState: WallJointDragState | null
    wallHeightDragState: WallHeightDragState | null
    wallCircleCenterDragState: WallCircleCenterDragState | null
    wallCircleRadiusDragState: WallCircleRadiusDragState | null

    raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
    raycastPlanePoint: (event: PointerEvent, plane: THREE.Plane, result: THREE.Vector3) => boolean
    groundPointerHelper: THREE.Vector3

    camera: THREE.Camera | null

    floorBuildShape?: FloorBuildShape

    rootGroup: THREE.Group

    resolveRoadRenderOptionsForNodeId: (nodeId: string) => unknown | null
    updateRoadGroup: (roadGroup: THREE.Object3D, definition: RoadDynamicMesh, options?: any) => any

    updateFloorGroup: (runtimeObject: THREE.Object3D, definition: any) => void
    forceRebuildFloorVertexHandles?: () => void
  },
): PointerMoveResult | null {
  const tmpIntersection = new THREE.Vector3()

  if (ctx.floorThicknessDragState && event.pointerId === ctx.floorThicknessDragState.pointerId) {
    const state = ctx.floorThicknessDragState

    // Only transition to actual dragging once the pointer has moved beyond the drag threshold.
    const dxStart = event.clientX - state.startX
    const dyStart = event.clientY - state.startY
    if (!state.moved && Math.hypot(dxStart, dyStart) < ctx.clickDragThresholdPx) {
      return { handled: true }
    }

    state.moved = true

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }

    if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
      return { handled: true }
    }

    const isFirstDragSample = !state.startHitWorld
    // Capture the initial plane hit when drag begins (if not already captured).
    if (isFirstDragSample) {
      state.startHitWorld = tmpIntersection.clone()
      state.startThickness = state.thickness
    }

    const startHit = state.startHitWorld ?? state.startPointWorld
    const worldUp = new THREE.Vector3(0, 1, 0)
    const delta = tmpIntersection.clone().sub(startHit)
    const dh = delta.dot(worldUp) * state.axisSign

    // Match FloorPanel's input step.
    const rawNextThickness = state.startThickness + dh
    const clamped = THREE.MathUtils.clamp(rawNextThickness, FLOOR_MIN_THICKNESS, FLOOR_MAX_THICKNESS)
    const quantized = Math.round(clamped / 0.05) * 0.05
    state.thickness = Number.isFinite(quantized) ? quantized : state.thickness

    // Best-effort: update floor thickness in real-time so inspector reflects changes immediately.
    try {
      const setter = (ctx as any).setFloorNodeThickness
      if (typeof setter === 'function') {
        setter(state.nodeId, state.thickness, { captureHistory: isFirstDragSample })
      }
    } catch {
      /* noop */
    }

    // Update handle positions so the gizmo stays at mid-thickness while dragging.
    const handles = state.containerObject.getObjectByName(FLOOR_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      const yOffset = FLOOR_VERTEX_HANDLE_Y + Math.max(0, state.thickness) * 0.5
      for (const child of handles.children) {
        child.userData.yOffset = yOffset
        child.position.y = yOffset
      }
    }

    return { handled: true }
  }

  if (ctx.wallHeightDragState && event.pointerId === ctx.wallHeightDragState.pointerId) {
    const state = ctx.wallHeightDragState

    // Only transition to actual dragging once the pointer has moved beyond the drag threshold.
    const dxStart = event.clientX - state.startX
    const dyStart = event.clientY - state.startY
    if (!state.moved && Math.hypot(dxStart, dyStart) < ctx.clickDragThresholdPx) {
      return { handled: true }
    }

    state.moved = true

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }

    if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
      return { handled: true }
    }

    // Capture the initial plane hit when drag begins (if not already captured).
    if (!state.startHitWorld) {
      state.startHitWorld = tmpIntersection.clone()
      state.startHeight = state.dimensions.height
    }

    const startHit = state.startHitWorld ?? state.startPointWorld
    const worldUp = new THREE.Vector3(0, 1, 0)
    const delta = tmpIntersection.clone().sub(startHit)
    const dh = delta.dot(worldUp) * state.axisSign

    const minHeight = 0.1
    const maxHeight = 100
    const rawNextHeight = state.startHeight + dh
    const clamped = THREE.MathUtils.clamp(rawNextHeight, minHeight, maxHeight)
    // Quantize to 0.1m and keep one decimal for display.
    const quantized = Math.round(clamped * 10) / 10
    state.dimensions.height = quantized

    // Best-effort: update wall component props in real-time so inspector reflects changes immediately.
    try {
      const setter = (ctx as any).setWallNodeDimensions
      if (typeof setter === 'function') {
        setter(state.nodeId, { height: quantized })
      }
    } catch {
      /* noop */
    }

    const mergedForPreview = mergeWallPreviewSegmentChainsByEndpoint(state.workingSegmentsWorld)
    const nextSignature = computeWallPreviewSignature(mergedForPreview, state.dimensions)
    if (nextSignature !== state.previewSignature) {
      state.previewSignature = nextSignature
      const build = buildWallPreviewDynamicMeshFromWorldSegments(mergedForPreview, state.dimensions)
      if (build) {
        if (!state.previewGroup) {
          const preview = createWallGroup(build.definition)
          applyWallPreviewStyling(preview)
          preview.userData.isWallEndpointDragPreview = true
          state.previewGroup = preview
          ctx.rootGroup.add(preview)
        } else {
          updateWallGroup(state.previewGroup, build.definition)
          applyWallPreviewStyling(state.previewGroup)
          if (!ctx.rootGroup.children.includes(state.previewGroup)) {
            ctx.rootGroup.add(state.previewGroup)
          }
        }
        state.previewGroup!.position.copy(build.center)
      }
    }

    // Update handle positions so the gizmo stays at mid-height while dragging.
    const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      const yOffset = Math.max(0.05, quantized * 0.5)
      for (const child of handles.children) {
        const handleKind = child?.userData?.handleKind === 'joint' ? 'joint' : 'endpoint'
        const chainStartIndex = Math.max(0, Math.trunc(Number(child?.userData?.chainStartIndex)))
        const chainEndIndex = Math.max(chainStartIndex, Math.trunc(Number(child?.userData?.chainEndIndex)))
        const startSeg = state.workingSegmentsWorld[chainStartIndex]
        const endSeg = state.workingSegmentsWorld[chainEndIndex]

        let pointWorld: THREE.Vector3 | null = null
        if (handleKind === 'joint') {
          const jointIndex = Math.trunc(Number(child?.userData?.jointIndex))
          const seg = state.workingSegmentsWorld[jointIndex]
          if (seg) {
            pointWorld = seg.end.clone()
          }
        } else {
          const endpointKind = child?.userData?.endpointKind === 'end' ? 'end' : 'start'
          if (startSeg && endSeg) {
            pointWorld = endpointKind === 'start' ? startSeg.start.clone() : endSeg.end.clone()
          }
        }
        if (!pointWorld) continue

        const local = state.containerObject.worldToLocal(pointWorld)

        child.userData.yOffset = yOffset
        child.position.set(local.x, local.y + yOffset, local.z)
      }
    }

    return { handled: true }
  }

  if (ctx.wallEndpointDragState && event.pointerId === ctx.wallEndpointDragState.pointerId) {
    const state = ctx.wallEndpointDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) >= ctx.clickDragThresholdPx) {
      state.moved = true
    }

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }

    let constrained: THREE.Vector3 | null = null
    const rectangleConstraint = state.wallBuildShape === 'rectangle' ? state.rectangleConstraint : null

    if (state.dragMode === 'axis' && state.axisWorld) {
      if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
        return { handled: true }
      }
      const axis = state.axisWorld.clone().normalize()
      const delta = tmpIntersection.clone().sub(state.startEndpointWorld)
      const t = axis.dot(delta)
      constrained = state.startEndpointWorld.clone().add(axis.multiplyScalar(t))
      if (rectangleConstraint) {
        snapToMajorGridXZ(constrained, state.startEndpointWorld.y)
      }
    } else {
      if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
        return { handled: true }
      }

      const rawPointer = ctx.groundPointerHelper.clone()

      if (rectangleConstraint) {
        constrained = snapToMajorGridXZ(rawPointer.clone(), state.startEndpointWorld.y)
      } else {
        const target = rawPointer.clone()
        target.y = state.startEndpointWorld.y

        const anchor = state.anchorPointWorld.clone()
        anchor.y = state.startEndpointWorld.y

        constrained = constrainWallEndPointSoftSnap(anchor, target, rawPointer)
        constrained.y = state.startEndpointWorld.y
      }
    }

    if (constrained) {
      // Same-node endpoint magnet: help connect different chains by snapping the dragged endpoint
      // to the nearest endpoint of other chains within the same wall node.
      applySameNodeEndpointMagnet({
        constrained,
        y: state.startEndpointWorld.y,
        workingSegmentsWorld: state.workingSegmentsWorld,
        chainStartIndex: state.chainStartIndex,
        chainEndIndex: state.chainEndIndex,
      })
    }

    const working = state.workingSegmentsWorld
    const startSeg = working[state.chainStartIndex]
    const endSeg = working[state.chainEndIndex]
    if (!startSeg || !endSeg) {
      return { handled: true }
    }

    let rectangleApplied = false
    if (constrained && rectangleConstraint) {
      rectangleApplied = applyRectangleConstraintToChain({
        workingSegmentsWorld: state.workingSegmentsWorld,
        chainStartIndex: state.chainStartIndex,
        chainEndIndex: state.chainEndIndex,
        constraint: rectangleConstraint,
        desiredCornerWorld: constrained,
        y: state.startEndpointWorld.y,
        outDraggedCornerWorld: rectDraggedCornerTmp,
      })
      if (rectangleApplied) {
        constrained.copy(rectDraggedCornerTmp)
      }
    }

    if (constrained && !rectangleApplied) {
      if (state.endpointKind === 'start') {
        startSeg.start.copy(constrained)
      } else {
        endSeg.end.copy(constrained)
      }
    }

    if (constrained && !state.moved) {
      const dd = constrained.clone().sub(state.startEndpointWorld)
      if (dd.lengthSq() > 1e-8) {
        state.moved = true
      }
    }

    const mergedForPreview = mergeWallPreviewSegmentChainsByEndpoint(state.workingSegmentsWorld)
    const nextSignature = computeWallPreviewSignature(mergedForPreview, state.dimensions)
    if (nextSignature !== state.previewSignature) {
      state.previewSignature = nextSignature
      const build = buildWallPreviewDynamicMeshFromWorldSegments(mergedForPreview, state.dimensions)
      if (build) {
        if (!state.previewGroup) {
          const preview = createWallGroup(build.definition)
          applyWallPreviewStyling(preview)
          preview.userData.isWallEndpointDragPreview = true
          state.previewGroup = preview
          ctx.rootGroup.add(preview)
        } else {
          updateWallGroup(state.previewGroup, build.definition)
          applyWallPreviewStyling(state.previewGroup)
          if (!ctx.rootGroup.children.includes(state.previewGroup)) {
            ctx.rootGroup.add(state.previewGroup)
          }
        }
        state.previewGroup!.position.copy(build.center)
      }
    }

    // Update handle position(s) in local space for immediate feedback.
    const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      if (rectangleApplied) {
        updateWallHandleMeshesForChain({
          handles,
          containerObject: state.containerObject,
          workingSegmentsWorld: state.workingSegmentsWorld,
          chainStartIndex: state.chainStartIndex,
          chainEndIndex: state.chainEndIndex,
        })
      } else {
        const local = state.containerObject.worldToLocal(constrained.clone())
        const handleMesh = handles.children.find((child) => {
          const kind = child?.userData?.endpointKind
          const startIndex = Math.trunc(Number(child?.userData?.chainStartIndex))
          const endIndex = Math.trunc(Number(child?.userData?.chainEndIndex))
          return (
            (kind === state.endpointKind) &&
            startIndex === state.chainStartIndex &&
            endIndex === state.chainEndIndex
          )
        }) as THREE.Object3D | undefined
        if (handleMesh) {
          const yOffset = Number(handleMesh.userData?.yOffset)
          handleMesh.position.set(local.x, local.y + (Number.isFinite(yOffset) ? yOffset : WALL_ENDPOINT_HANDLE_Y_OFFSET), local.z)
        }
      }
    }

    return { handled: true }
  }

  if (ctx.wallCircleCenterDragState && event.pointerId === ctx.wallCircleCenterDragState.pointerId) {
    const state = ctx.wallCircleCenterDragState

    const dxStart = event.clientX - state.startX
    const dyStart = event.clientY - state.startY
    if (!state.moved && Math.hypot(dxStart, dyStart) < ctx.clickDragThresholdPx) {
      return { handled: true }
    }
    state.moved = true

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }

    if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
      return { handled: true }
    }

    const isFirstDragSample = !state.startHitWorld
    if (isFirstDragSample) {
      state.startHitWorld = tmpIntersection.clone()
      const computed = computeChainCenterAndRadiusWorldFromSegments({
        segmentsWorld: state.workingSegmentsWorld,
        chainStartIndex: state.chainStartIndex,
        chainEndIndex: state.chainEndIndex,
      })
      if (computed) {
        state.startCenterWorld.copy(computed.centerWorld)
      }
    }

    const startHit = state.startHitWorld ?? state.startPointWorld
    const delta = tmpIntersection.clone().sub(startHit)
    delta.y = 0

    // Reset working to base, then translate only the circle chain.
    for (let i = 0; i < state.workingSegmentsWorld.length; i += 1) {
      const base = state.baseSegmentsWorld[i]
      const working = state.workingSegmentsWorld[i]
      if (!base || !working) continue
      working.start.copy(base.start)
      working.end.copy(base.end)
    }
    for (let i = state.chainStartIndex; i <= state.chainEndIndex; i += 1) {
      const seg = state.workingSegmentsWorld[i]
      if (!seg) continue
      seg.start.add(delta)
      seg.end.add(delta)
    }

    const mergedForPreview = mergeWallPreviewSegmentChainsByEndpoint(state.workingSegmentsWorld)
    const nextSignature = computeWallPreviewSignature(mergedForPreview, state.dimensions)
    if (nextSignature !== state.previewSignature) {
      state.previewSignature = nextSignature
      const build = buildWallPreviewDynamicMeshFromWorldSegments(mergedForPreview, state.dimensions)
      if (build) {
        if (!state.previewGroup) {
          const preview = createWallGroup(build.definition)
          applyWallPreviewStyling(preview)
          preview.userData.isWallEndpointDragPreview = true
          state.previewGroup = preview
          ctx.rootGroup.add(preview)
        } else {
          updateWallGroup(state.previewGroup, build.definition)
          applyWallPreviewStyling(state.previewGroup)
          if (!ctx.rootGroup.children.includes(state.previewGroup)) {
            ctx.rootGroup.add(state.previewGroup)
          }
        }
        state.previewGroup!.position.copy(build.center)
      }
    }

    const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      updateWallCircleHandleMeshesForChain({
        handles,
        containerObject: state.containerObject,
        workingSegmentsWorld: state.workingSegmentsWorld,
        chainStartIndex: state.chainStartIndex,
        chainEndIndex: state.chainEndIndex,
        camera: ctx.camera,
      })
    }

    return { handled: true }
  }

  if (ctx.wallCircleRadiusDragState && event.pointerId === ctx.wallCircleRadiusDragState.pointerId) {
    const state = ctx.wallCircleRadiusDragState

    const dxStart = event.clientX - state.startX
    const dyStart = event.clientY - state.startY
    if (!state.moved && Math.hypot(dxStart, dyStart) < ctx.clickDragThresholdPx) {
      return { handled: true }
    }
    state.moved = true

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }

    if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
      return { handled: true }
    }

    if (!state.startHitWorld) {
      state.startHitWorld = tmpIntersection.clone()
    }

    const newRadius = Math.max(1e-3, Math.hypot(tmpIntersection.x - state.centerWorld.x, tmpIntersection.z - state.centerWorld.z))
    const segmentCount = Math.max(3, state.chainEndIndex - state.chainStartIndex + 1)
    const circleSegments = buildCircleSegmentsFixedCount({
      centerWorld: state.centerWorld,
      radius: newRadius,
      segmentCount,
    })

    // Reset working to base, then overwrite only the circle chain with rebuilt segments.
    for (let i = 0; i < state.workingSegmentsWorld.length; i += 1) {
      const base = state.baseSegmentsWorld[i]
      const working = state.workingSegmentsWorld[i]
      if (!base || !working) continue
      working.start.copy(base.start)
      working.end.copy(base.end)
    }
    for (let i = 0; i < circleSegments.length; i += 1) {
      const segIndex = state.chainStartIndex + i
      const working = state.workingSegmentsWorld[segIndex]
      const next = circleSegments[i]
      if (!working || !next) continue
      working.start.copy(next.start)
      working.end.copy(next.end)
    }

    const mergedForPreview = mergeWallPreviewSegmentChainsByEndpoint(state.workingSegmentsWorld)
    const nextSignature = computeWallPreviewSignature(mergedForPreview, state.dimensions)
    if (nextSignature !== state.previewSignature) {
      state.previewSignature = nextSignature
      const build = buildWallPreviewDynamicMeshFromWorldSegments(mergedForPreview, state.dimensions)
      if (build) {
        if (!state.previewGroup) {
          const preview = createWallGroup(build.definition)
          applyWallPreviewStyling(preview)
          preview.userData.isWallEndpointDragPreview = true
          state.previewGroup = preview
          ctx.rootGroup.add(preview)
        } else {
          updateWallGroup(state.previewGroup, build.definition)
          applyWallPreviewStyling(state.previewGroup)
          if (!ctx.rootGroup.children.includes(state.previewGroup)) {
            ctx.rootGroup.add(state.previewGroup)
          }
        }
        state.previewGroup!.position.copy(build.center)
      }
    }

    const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      updateWallCircleHandleMeshesForChain({
        handles,
        containerObject: state.containerObject,
        workingSegmentsWorld: state.workingSegmentsWorld,
        chainStartIndex: state.chainStartIndex,
        chainEndIndex: state.chainEndIndex,
        camera: ctx.camera,
      })
    }

    return { handled: true }
  }

  if (ctx.wallJointDragState && event.pointerId === ctx.wallJointDragState.pointerId) {
    const state = ctx.wallJointDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) >= ctx.clickDragThresholdPx) {
      state.moved = true
    }

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }

    let constrained: THREE.Vector3 | null = null
    const rectangleConstraint = state.wallBuildShape === 'rectangle' ? state.rectangleConstraint : null

    if (state.dragMode === 'axis' && state.axisWorld) {
      if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
        return { handled: true }
      }
      const axis = state.axisWorld.clone().normalize()
      const delta = tmpIntersection.clone().sub(state.startJointWorld)
      const t = axis.dot(delta)
      constrained = state.startJointWorld.clone().add(axis.multiplyScalar(t))
      if (rectangleConstraint) {
        snapToMajorGridXZ(constrained, state.startJointWorld.y)
      }
    } else {
      if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
        return { handled: true }
      }

      const rawPointer = ctx.groundPointerHelper.clone()
      const target = rawPointer.clone()
      target.y = state.startJointWorld.y

      if (rectangleConstraint) {
        constrained = snapToMajorGridXZ(target, state.startJointWorld.y)
      } else {

        const working = state.workingSegmentsWorld
        const i = state.jointIndex
        const prevSeg = working[i]
        const nextSeg = working[i + 1]

        const prevAnchor = prevSeg?.start?.clone?.() ?? null
        const nextAnchor = nextSeg?.end?.clone?.() ?? null

        const candidates: Array<{ point: THREE.Vector3; distSq: number }> = []
        if (prevAnchor) {
          prevAnchor.y = state.startJointWorld.y
          const snapped = constrainWallEndPointSoftSnap(prevAnchor, target, rawPointer)
          snapped.y = state.startJointWorld.y
          const dSq = distanceSqXZ(snapped.x, snapped.z, rawPointer.x, rawPointer.z)
          candidates.push({ point: snapped, distSq: dSq })
        }
        if (nextAnchor) {
          nextAnchor.y = state.startJointWorld.y
          const snapped = constrainWallEndPointSoftSnap(nextAnchor, target, rawPointer)
          snapped.y = state.startJointWorld.y
          const dSq = distanceSqXZ(snapped.x, snapped.z, rawPointer.x, rawPointer.z)
          candidates.push({ point: snapped, distSq: dSq })
        }

        if (candidates.length) {
          candidates.sort((a, b) => a.distSq - b.distSq)
          // Stability: if very close, prefer the first candidate (prev anchor if present).
          constrained = candidates[0]!.point
        } else {
          constrained = target.clone()
          constrained.y = state.startJointWorld.y
        }
      }
    }

    if (constrained && rectangleConstraint) {
      applySameNodeEndpointMagnet({
        constrained,
        y: state.startJointWorld.y,
        workingSegmentsWorld: state.workingSegmentsWorld,
        chainStartIndex: state.chainStartIndex,
        chainEndIndex: state.chainEndIndex,
      })
    }

    const working = state.workingSegmentsWorld
    const i = state.jointIndex
    const segA = working[i]
    const segB = working[i + 1]
    if (!segA || !segB || !constrained) {
      return { handled: true }
    }

    let rectangleApplied = false
    if (rectangleConstraint) {
      rectangleApplied = applyRectangleConstraintToChain({
        workingSegmentsWorld: state.workingSegmentsWorld,
        chainStartIndex: state.chainStartIndex,
        chainEndIndex: state.chainEndIndex,
        constraint: rectangleConstraint,
        desiredCornerWorld: constrained,
        y: state.startJointWorld.y,
        outDraggedCornerWorld: rectDraggedCornerTmp,
      })
      if (rectangleApplied) {
        constrained.copy(rectDraggedCornerTmp)
      }
    }

    if (!rectangleApplied) {
      segA.end.copy(constrained)
      segB.start.copy(constrained)
    }

    if (constrained && !state.moved) {
      const dd = constrained.clone().sub(state.startJointWorld)
      if (dd.lengthSq() > 1e-8) {
        state.moved = true
      }
    }

    const mergedForPreview = mergeWallPreviewSegmentChainsByEndpoint(state.workingSegmentsWorld)
    const nextSignature = computeWallPreviewSignature(mergedForPreview, state.dimensions)
    if (nextSignature !== state.previewSignature) {
      state.previewSignature = nextSignature
      const build = buildWallPreviewDynamicMeshFromWorldSegments(mergedForPreview, state.dimensions)
      if (build) {
        if (!state.previewGroup) {
          const preview = createWallGroup(build.definition)
          applyWallPreviewStyling(preview)
          preview.userData.isWallJointDragPreview = true
          state.previewGroup = preview
          ctx.rootGroup.add(preview)
        } else {
          updateWallGroup(state.previewGroup, build.definition)
          applyWallPreviewStyling(state.previewGroup)
          if (!ctx.rootGroup.children.includes(state.previewGroup)) {
            ctx.rootGroup.add(state.previewGroup)
          }
        }
        state.previewGroup!.position.copy(build.center)
      }
    }

    // Update handle position(s) in local space for immediate feedback.
    const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      if (rectangleApplied) {
        updateWallHandleMeshesForChain({
          handles,
          containerObject: state.containerObject,
          workingSegmentsWorld: state.workingSegmentsWorld,
          chainStartIndex: state.chainStartIndex,
          chainEndIndex: state.chainEndIndex,
        })
      } else {
        const local = state.containerObject.worldToLocal(constrained.clone())
        const handleMesh = handles.children.find((child) => {
          const kind = child?.userData?.handleKind
          const startIndex = Math.trunc(Number(child?.userData?.chainStartIndex))
          const endIndex = Math.trunc(Number(child?.userData?.chainEndIndex))
          const j = Math.trunc(Number(child?.userData?.jointIndex))
          return (
            kind === 'joint' &&
            startIndex === state.chainStartIndex &&
            endIndex === state.chainEndIndex &&
            j === state.jointIndex
          )
        }) as THREE.Object3D | undefined
        if (handleMesh) {
          const yOffset = Number(handleMesh.userData?.yOffset)
          handleMesh.position.set(local.x, local.y + (Number.isFinite(yOffset) ? yOffset : WALL_ENDPOINT_HANDLE_Y_OFFSET), local.z)
        }
      }
    }

    return { handled: true }
  }

  if (ctx.roadVertexDragState && event.pointerId === ctx.roadVertexDragState.pointerId) {
    const state = ctx.roadVertexDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) >= ctx.clickDragThresholdPx) {
      state.moved = true
    }

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }
    let local: THREE.Vector3 | null = null
    if (state.dragMode === 'axis' && state.axisWorld) {
      if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
        return { handled: true }
      }
      const axis = state.axisWorld.clone().normalize()
      const delta = tmpIntersection.clone().sub(state.startPointWorld)
      const t = axis.dot(delta)
      // Quantize to 0.1m steps (like wall height drag) and keep one decimal to reduce float noise.
      const tQuantized = Number((Math.round(t * 10) / 10).toFixed(1))
      const world = state.startPointWorld.clone().add(axis.multiplyScalar(tQuantized))
      local = state.containerObject.worldToLocal(new THREE.Vector3(world.x, 0, world.z))
    } else {
      if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
        return { handled: true }
      }
      const snapped = ctx.groundPointerHelper.clone()
      snapped.y = 0
      local = state.containerObject.worldToLocal(new THREE.Vector3(snapped.x, 0, snapped.z))
    }

    if (!local) {
      return { handled: true }
    }
    const working = state.workingDefinition
    const vertices = Array.isArray(working.vertices) ? working.vertices : []
    if (!vertices[state.vertexIndex]) {
      return { handled: true }
    }
    vertices[state.vertexIndex] = [local.x, local.z]
    working.vertices = vertices

    // Treat any actual geometry change as a drag (prevents tiny mouse movement from being interpreted as a click -> branch).
    const [startVX, startVZ] = state.startVertex
    if (!state.moved) {
      const ddx = local.x - startVX
      const ddz = local.z - startVZ
      if (ddx * ddx + ddz * ddz > 1e-8) {
        state.moved = true
      }
    }

    const roadOptions = ctx.resolveRoadRenderOptionsForNodeId(state.nodeId) ?? undefined
    ctx.updateRoadGroup(state.roadGroup, state.workingDefinition, roadOptions)

    // Update all handle mesh positions if present (smoothing adjusts the whole path).
    const handles = state.containerObject.getObjectByName(ROAD_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      const nextVertices = Array.isArray(state.workingDefinition.vertices) ? state.workingDefinition.vertices : []
      for (const child of handles.children) {
        const index = Math.trunc(Number(child?.userData?.roadVertexIndex))
        const v = nextVertices[index]
        if (!Array.isArray(v) || v.length < 2) {
          continue
        }
        const x = Number(v[0])
        const z = Number(v[1])
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          continue
        }
        const y = Number(child?.userData?.yOffset)
        child.position.set(x, Number.isFinite(y) ? y : ROAD_VERTEX_HANDLE_Y, z)
      }
    }

    return { handled: true }
  }

  if (ctx.floorVertexDragState && event.pointerId === ctx.floorVertexDragState.pointerId) {
    const state = ctx.floorVertexDragState

    // Only start processing once user has moved beyond the click-drag threshold.
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < ctx.clickDragThresholdPx) {
      return { handled: true }
    }
    state.moved = true

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }

    let local: THREE.Vector3 | null = null
    if (state.dragMode === 'axis' && state.axisWorld) {
      // For axis drags, capture the plane hit at drag start if not already captured,
      // then compute the constrained point relative to that hit to avoid a jump.
      if (!state.startHitWorld) {
        if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
          return { handled: true }
        }
        state.startHitWorld = tmpIntersection.clone()
      }
      if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
        return { handled: true }
      }
      const axis = state.axisWorld.clone().normalize()
      const delta = tmpIntersection.clone().sub(state.startHitWorld)
      const t = axis.dot(delta)
      const world = state.startHitWorld.clone().add(axis.multiplyScalar(t))
      local = state.containerObject.worldToLocal(new THREE.Vector3(world.x, 0, world.z))
    } else {
      // Free dragging uses ground projection. Capture ground hit at drag start to
      // avoid the initial jump.
      if (!state.startHitWorld) {
        if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
          return { handled: true }
        }
        state.startHitWorld = ctx.groundPointerHelper.clone()
      }
      if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
        return { handled: true }
      }
      const snapped = ctx.groundPointerHelper.clone()
      snapped.y = 0
      local = state.containerObject.worldToLocal(new THREE.Vector3(snapped.x, 0, snapped.z))
    }

    if (!local) return { handled: true }

    const shape = (state.floorBuildShape ?? ctx.floorBuildShape ?? 'polygon') as FloorBuildShape
    const working = state.workingDefinition

    // Capture shape-specific constraint baseline when drag begins.
    if ((shape === 'rectangle' || shape === 'circle') && !state.editConstraint) {
      const baseVerts = sanitizeFloorVertices((state.baseDefinition as any)?.vertices)
      if (shape === 'rectangle') {
        if (baseVerts.length !== 4) {
          // Only constrain to rectangle when the geometry is actually a rectangle (4 corners).
          // This avoids leaving stale extra handles during drag.
          state.editConstraint = null
        } else {
        const bounds = computeBoundsXZ(baseVerts)
        if (bounds) {
          const midX = (bounds.minX + bounds.maxX) * 0.5
          const midZ = (bounds.minZ + bounds.maxZ) * 0.5
          const [startVX, startVZ] = state.startVertex
          state.editConstraint = {
            kind: 'rectangle',
            boundsStart: bounds,
            draggedSide: {
              x: startVX <= midX ? 'min' : 'max',
              z: startVZ <= midZ ? 'min' : 'max',
            },
          }
        }
        }
      }

      if (shape === 'circle') {
        if (baseVerts.length < 8) {
          state.editConstraint = null
        } else {
        const center = computeMeanCenter(baseVerts) ?? null
        const segments = Math.max(8, baseVerts.length || 32)
        if (center) {
          state.editConstraint = {
            kind: 'circle',
            centerLocal: center,
            segments,
          }
        }
        }
      }
    }

    const constraint = state.editConstraint

    if (shape === 'rectangle' && constraint?.kind === 'rectangle') {
      const eps = 1e-4
      const b = constraint.boundsStart
      let minX = b.minX
      let maxX = b.maxX
      let minZ = b.minZ
      let maxZ = b.maxZ

      if (constraint.draggedSide.x === 'min') {
        minX = Math.min(local.x, maxX - eps)
      } else {
        maxX = Math.max(local.x, minX + eps)
      }

      if (constraint.draggedSide.z === 'min') {
        minZ = Math.min(local.z, maxZ - eps)
      } else {
        maxZ = Math.max(local.z, minZ + eps)
      }

      working.vertices = buildRectangleVertices({ minX, maxX, minZ, maxZ })
      ctx.forceRebuildFloorVertexHandles?.()
    } else if (shape === 'circle' && constraint?.kind === 'circle') {
      const cx = constraint.centerLocal.x
      const cz = constraint.centerLocal.z
      const radius = Math.hypot(local.x - cx, local.z - cz)
      working.vertices = buildCircleVertices({ centerX: cx, centerZ: cz, radius, segments: constraint.segments })
      ctx.forceRebuildFloorVertexHandles?.()
    } else {
      const vertices = Array.isArray(working.vertices) ? working.vertices : []
      if (!vertices[state.vertexIndex]) {
        return { handled: true }
      }
      vertices[state.vertexIndex] = [local.x, local.z]
      working.vertices = vertices
    }

    ctx.updateFloorGroup(state.runtimeObject, state.workingDefinition)

    const handles = state.containerObject.getObjectByName(FLOOR_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
      const nextVertices = Array.isArray(state.workingDefinition.vertices) ? state.workingDefinition.vertices : []
      for (const child of handles.children) {
        const index = Math.trunc(Number(child?.userData?.floorVertexIndex))
        const v = nextVertices[index]
        if (!Array.isArray(v) || v.length < 2) continue
        const x = Number(v[0])
        const z = Number(v[1])
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue
        const y = Number(child?.userData?.yOffset)
        child.position.set(x, Number.isFinite(y) ? y : FLOOR_VERTEX_HANDLE_Y, z)
      }
    }

    return { handled: true }
  }
  return null
}

export function handlePointerMoveFloorEdgeDrag(
  event: PointerEvent,
  ctx: {
    clickDragThresholdPx: number
    floorEdgeDragState: FloorEdgeDragStateLike | null
    raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
    groundPointerHelper: THREE.Vector3
    updateFloorGroup: (runtimeObject: THREE.Object3D, definition: any) => void
  },
): PointerMoveResult | null {
  if (ctx.floorEdgeDragState && event.pointerId === ctx.floorEdgeDragState.pointerId) {
    const state = ctx.floorEdgeDragState
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }
    if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
      return { handled: true }
    }

    // Avoid a first-frame "jump": do not mutate geometry until this is clearly a drag.
    // When drag begins, capture the current projection as baseline so delta starts at 0.
    if (!state.moved) {
      if (Math.hypot(dx, dy) < ctx.clickDragThresholdPx) {
        return { handled: true }
      }
      state.moved = true
      const startPointerVec = new THREE.Vector2(ctx.groundPointerHelper.x, ctx.groundPointerHelper.z)
      state.initialProjection = state.perp.dot(startPointerVec.clone().sub(state.referencePoint))
    }

    const pointerVec = new THREE.Vector2(ctx.groundPointerHelper.x, ctx.groundPointerHelper.z)
    const projection = state.perp.dot(pointerVec.clone().sub(state.referencePoint))
    const delta = projection - state.initialProjection
    const vertexCount = state.startVertices.length
    if (vertexCount < 2) {
      return { handled: true }
    }
    const localPerp = new THREE.Vector2(state.perp.x, -state.perp.y)
    const offset = localPerp.multiplyScalar(delta)
    const nextIndex = (state.edgeIndex + 1) % vertexCount
    const updatedVertices = state.startVertices.map((vertex, index) => {
      const [startX, startZ] = vertex
      if (index === state.edgeIndex || index === nextIndex) {
        return [startX + offset.x, startZ + offset.y] as [number, number]
      }
      return [startX, startZ] as [number, number]
    })

    const working = state.workingDefinition
    working.vertices = updatedVertices
    ctx.updateFloorGroup(state.runtimeObject, working)

    return { handled: true }
  }

  return null
}
