import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
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
  PointerMoveResult,
} from './types'

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

    raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
    raycastPlanePoint: (event: PointerEvent, plane: THREE.Plane, result: THREE.Vector3) => boolean
    groundPointerHelper: THREE.Vector3

    camera: THREE.Camera | null

    rootGroup: THREE.Group

    resolveRoadRenderOptionsForNodeId: (nodeId: string) => unknown | null
    updateRoadGroup: (roadGroup: THREE.Object3D, definition: RoadDynamicMesh, options?: any) => any

    updateFloorGroup: (runtimeObject: THREE.Object3D, definition: any) => void
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

    if (state.dragMode === 'axis' && state.axisWorld) {
      if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
        return { handled: true }
      }
      const axis = state.axisWorld.clone().normalize()
      const delta = tmpIntersection.clone().sub(state.startEndpointWorld)
      const t = axis.dot(delta)
      constrained = state.startEndpointWorld.clone().add(axis.multiplyScalar(t))
    } else {
      if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
        return { handled: true }
      }

      const rawPointer = ctx.groundPointerHelper.clone()
      const target = rawPointer.clone()
      target.y = state.startEndpointWorld.y

      const anchor = state.anchorPointWorld.clone()
      anchor.y = state.startEndpointWorld.y

      constrained = constrainWallEndPointSoftSnap(anchor, target, rawPointer)
      constrained.y = state.startEndpointWorld.y

      // Same-node endpoint magnet: help connect different chains by snapping the dragged endpoint
      // to the nearest endpoint of other chains within the same wall node.
      const snapDistance = GRID_MAJOR_SPACING * 0.35
      const snapDistanceSq = snapDistance * snapDistance
      const chains = splitWallSegmentsIntoChains(state.workingSegmentsWorld as any[])

      let best: THREE.Vector3 | null = null
      let bestDistSq = Number.POSITIVE_INFINITY
      for (const chain of chains) {
        if (chain.startIndex === state.chainStartIndex && chain.endIndex === state.chainEndIndex) {
          continue
        }
        const startSeg = state.workingSegmentsWorld[chain.startIndex]
        const endSeg = state.workingSegmentsWorld[chain.endIndex]
        if (!startSeg || !endSeg) {
          continue
        }
        const candidates = [startSeg.start, endSeg.end]
        for (const candidate of candidates) {
          const distSq = distanceSqXZ(constrained.x, constrained.z, candidate.x, candidate.z)
          if (distSq <= snapDistanceSq && distSq < bestDistSq) {
            bestDistSq = distSq
            best = candidate.clone()
          }
        }
      }
      if (best) {
        constrained.copy(best)
        constrained.y = state.startEndpointWorld.y
      }
    }

    const working = state.workingSegmentsWorld
    const startSeg = working[state.chainStartIndex]
    const endSeg = working[state.chainEndIndex]
    if (!startSeg || !endSeg) {
      return { handled: true }
    }

    if (constrained) {
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

    // Update handle position in local space for immediate feedback.
    const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
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

    if (state.dragMode === 'axis' && state.axisWorld) {
      if (!ctx.raycastPlanePoint(event, state.dragPlane, tmpIntersection)) {
        return { handled: true }
      }
      const axis = state.axisWorld.clone().normalize()
      const delta = tmpIntersection.clone().sub(state.startJointWorld)
      const t = axis.dot(delta)
      constrained = state.startJointWorld.clone().add(axis.multiplyScalar(t))
    } else {
      if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
        return { handled: true }
      }

      const rawPointer = ctx.groundPointerHelper.clone()
      const target = rawPointer.clone()
      target.y = state.startJointWorld.y

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

    const working = state.workingSegmentsWorld
    const i = state.jointIndex
    const segA = working[i]
    const segB = working[i + 1]
    if (!segA || !segB || !constrained) {
      return { handled: true }
    }

    segA.end.copy(constrained)
    segB.start.copy(constrained)

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

    // Update joint handle position in local space for immediate feedback.
    const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
    if (handles?.isGroup) {
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

    const working = state.workingDefinition
    const vertices = Array.isArray(working.vertices) ? working.vertices : []
    if (!vertices[state.vertexIndex]) {
      return { handled: true }
    }
    vertices[state.vertexIndex] = [local.x, local.z]
    working.vertices = vertices

    if (!state.moved) {
      const [startVX, startVZ] = state.startVertex
      const ddx = local.x - startVX
      const ddz = local.z - startVZ
      if (ddx * ddx + ddz * ddz > 1e-8) {
        state.moved = true
      }
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
