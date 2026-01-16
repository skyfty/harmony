import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { ROAD_VERTEX_HANDLE_GROUP_NAME, ROAD_VERTEX_HANDLE_Y } from '../RoadVertexRenderer'
import type { RoadVertexDragState, PointerMoveResult } from './types'

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

    raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
    groundPointerHelper: THREE.Vector3

    resolveRoadRenderOptionsForNodeId: (nodeId: string) => unknown | null
    updateRoadGroup: (roadGroup: THREE.Object3D, definition: RoadDynamicMesh, options?: any) => any
  },
): PointerMoveResult | null {
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
    if (!ctx.raycastGroundPoint(event, ctx.groundPointerHelper)) {
      return { handled: true }
    }
    const snapped = ctx.groundPointerHelper.clone()
    snapped.y = 0

    const local = state.containerObject.worldToLocal(new THREE.Vector3(snapped.x, 0, snapped.z))
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
        child.position.set(x, ROAD_VERTEX_HANDLE_Y, z)
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
