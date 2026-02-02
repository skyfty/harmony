import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { ROAD_VERTEX_HANDLE_GROUP_NAME, ROAD_VERTEX_HANDLE_Y } from '../RoadVertexRenderer'
import { FLOOR_VERTEX_HANDLE_GROUP_NAME, FLOOR_VERTEX_HANDLE_Y } from '../FloorVertexRenderer'
import { WALL_ENDPOINT_HANDLE_GROUP_NAME, WALL_ENDPOINT_HANDLE_Y_OFFSET } from '../WallEndpointRenderer'
import { createWallGroup, updateWallGroup } from '@schema/wallMesh'
import { constrainWallEndPointSoftSnap } from '../wallEndpointSnap'
import {
  applyWallPreviewStyling,
  buildWallPreviewDynamicMeshFromWorldSegments,
  computeWallPreviewSignature,
  mergeWallPreviewSegmentChainsByEndpoint,
} from '../wallPreviewGroupUtils'
import type {
  FloorVertexDragState,
  RoadVertexDragState,
  WallEndpointDragState,
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
    wallEndpointDragState: WallEndpointDragState | null
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
        const endpointKind = child?.userData?.endpointKind === 'end' ? 'end' : 'start'
        const chainStartIndex = Math.max(0, Math.trunc(Number(child?.userData?.chainStartIndex)))
        const chainEndIndex = Math.max(chainStartIndex, Math.trunc(Number(child?.userData?.chainEndIndex)))
        const startSeg = state.workingSegmentsWorld[chainStartIndex]
        const endSeg = state.workingSegmentsWorld[chainEndIndex]
        if (!startSeg || !endSeg) continue

        const endpointWorld = endpointKind === 'start' ? startSeg.start.clone() : endSeg.end.clone()
        const local = state.containerObject.worldToLocal(endpointWorld)

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
      const world = state.startPointWorld.clone().add(axis.multiplyScalar(t))
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
      const world = state.startPointWorld.clone().add(axis.multiplyScalar(t))
      local = state.containerObject.worldToLocal(new THREE.Vector3(world.x, 0, world.z))
    } else {
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
    if (!state.moved && Math.hypot(dx, dy) >= ctx.clickDragThresholdPx) {
      state.moved = true
    }

    const isLeftDown = (event.buttons & 1) !== 0
    if (!isLeftDown) {
      return { handled: true }
    }
    if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
      return { handled: true }
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
