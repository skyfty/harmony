import * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import { ROAD_VERTEX_HANDLE_GROUP_NAME, ROAD_VERTEX_HANDLE_Y } from '../RoadVertexRenderer'
import { FLOOR_VERTEX_HANDLE_GROUP_NAME, FLOOR_VERTEX_HANDLE_Y } from '../FloorVertexRenderer'
import { WALL_ENDPOINT_HANDLE_GROUP_NAME, WALL_ENDPOINT_HANDLE_Y_OFFSET } from '../WallEndpointRenderer'
import { disposeWallPreviewGroup } from '../wallPreviewGroupUtils'
import type {
  FloorThicknessDragState,
  FloorVertexDragState,
  RoadVertexDragState,
  WallEndpointDragState,
  WallHeightDragState,
  PointerUpResult,
} from './types'

type FloorEdgeDragStateLike = {
  pointerId: number
  nodeId: string
  moved: boolean
  runtimeObject: THREE.Object3D
  workingDefinition: any
  startVertices: Array<[number, number]>
}

export function handlePointerUpDrag(
  event: PointerEvent,
  ctx: {
    roadDefaultWidth: number
    roadVertexDragState: RoadVertexDragState | null
    floorVertexDragState: FloorVertexDragState | null
    floorThicknessDragState: FloorThicknessDragState | null
    wallEndpointDragState: WallEndpointDragState | null
    wallHeightDragState: WallHeightDragState | null
    floorEdgeDragState: FloorEdgeDragStateLike | null

    findSceneNode: (nodes: SceneNode[], nodeId: string) => SceneNode | null
    nodes: SceneNode[]
    objectMap: Map<string, THREE.Object3D>

    sceneStoreUpdateNodeDynamicMesh: (nodeId: string, dynamicMesh: any) => void
    sceneStoreUpdateWallNodeGeometry: (nodeId: string, payload: {
      segments: Array<{ start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>
      dimensions: { height: number; width: number; thickness: number }
    }) => boolean

    pointerInteractionReleaseIfCaptured: (pointerId: number) => void

    ensureRoadVertexHandlesForSelectedNode: () => void
    ensureFloorVertexHandlesForSelectedNode: () => void
    ensureWallEndpointHandlesForSelectedNode: (options?: { force?: boolean }) => void

    setActiveRoadVertexHandle: (active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) => void
    setActiveFloorVertexHandle: (active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) => void
    setActiveWallEndpointHandle: (active: {
      nodeId: string
      chainStartIndex: number
      chainEndIndex: number
      endpointKind: 'start' | 'end'
      gizmoPart: any
    } | null) => void
    nextTick: (cb?: () => void) => Promise<void>

    resolveRoadRenderOptionsForNodeId: (nodeId: string) => unknown | null
    updateRoadGroup: (roadGroup: THREE.Object3D, definition: any, options?: any) => any
    updateFloorGroup: (runtimeObject: THREE.Object3D, definition: any) => void

    roadBuildToolBeginBranchFromVertex: (options: {
      nodeId: string
      vertexIndex: number
      worldPoint: THREE.Vector3
      width: number
    }) => void

    wallBuildToolBeginBranchFromEndpoint: (options: {
      nodeId: string
      chainStartIndex: number
      chainEndIndex: number
      endpointKind: 'start' | 'end'
      worldPoint: THREE.Vector3
    }) => void
  },
): PointerUpResult | null {
  if (ctx.floorThicknessDragState && event.pointerId === ctx.floorThicknessDragState.pointerId && event.button === 0) {
    const state = ctx.floorThicknessDragState
    ctx.pointerInteractionReleaseIfCaptured(event.pointerId)
    ctx.setActiveFloorVertexHandle(null)

    if (state.moved) {
      ctx.ensureFloorVertexHandlesForSelectedNode()
      void ctx.nextTick(() => {
        ctx.ensureFloorVertexHandlesForSelectedNode()
      })
      return {
        handled: true,
        nextFloorThicknessDragState: null,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    // Click (no drag): revert handle y offsets.
    try {
      const handles = state.containerObject.getObjectByName(FLOOR_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const yOffset = FLOOR_VERTEX_HANDLE_Y + Math.max(0, state.startThickness) * 0.5
        for (const child of handles.children) {
          child.userData.yOffset = yOffset
          child.position.y = yOffset
        }
      }
    } catch {
      /* noop */
    }

    return {
      handled: true,
      nextFloorThicknessDragState: null,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  if (ctx.wallHeightDragState && event.pointerId === ctx.wallHeightDragState.pointerId && event.button === 0) {
    const state = ctx.wallHeightDragState
    ctx.pointerInteractionReleaseIfCaptured(event.pointerId)
    // Height drag uses the same gizmo highlight API as endpoint drag.
    ctx.setActiveWallEndpointHandle(null)

    // Always remove preview.
    if (state.previewGroup) {
      const preview = state.previewGroup
      state.previewGroup = null
      preview.removeFromParent()
      disposeWallPreviewGroup(preview)
    }

    if (state.moved) {
      const segmentsPayload = state.workingSegmentsWorld.map((s) => ({
        start: { x: s.start.x, y: s.start.y, z: s.start.z },
        end: { x: s.end.x, y: s.end.y, z: s.end.z },
      }))

      ctx.sceneStoreUpdateWallNodeGeometry(state.nodeId, {
        segments: segmentsPayload,
        dimensions: state.dimensions,
      })

      ctx.ensureWallEndpointHandlesForSelectedNode({ force: true })
      void ctx.nextTick(() => {
        ctx.ensureWallEndpointHandlesForSelectedNode({ force: true })
      })

      return {
        handled: true,
        nextWallHeightDragState: null,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    // Click/no-drag: revert handle y offsets.
    try {
      const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const yOffset = Math.max(0.05, state.startHeight * 0.5)
        for (const child of handles.children) {
          const endpointKind = child?.userData?.endpointKind === 'end' ? 'end' : 'start'
          const chainStartIndex = Math.max(0, Math.trunc(Number(child?.userData?.chainStartIndex)))
          const chainEndIndex = Math.max(chainStartIndex, Math.trunc(Number(child?.userData?.chainEndIndex)))
          const startSeg = state.baseSegmentsWorld[chainStartIndex]
          const endSeg = state.baseSegmentsWorld[chainEndIndex]
          if (!startSeg || !endSeg) continue

          const endpointWorld = endpointKind === 'start' ? startSeg.start.clone() : endSeg.end.clone()
          const local = state.containerObject.worldToLocal(endpointWorld)
          child.userData.yOffset = yOffset
          child.position.set(local.x, local.y + yOffset, local.z)
        }
      }
    } catch {
      /* noop */
    }

    return {
      handled: true,
      nextWallHeightDragState: null,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  if (ctx.floorVertexDragState && event.pointerId === ctx.floorVertexDragState.pointerId && event.button === 0) {
    const state = ctx.floorVertexDragState
    ctx.pointerInteractionReleaseIfCaptured(event.pointerId)
    ctx.setActiveFloorVertexHandle(null)

    if (state.moved) {
      ctx.sceneStoreUpdateNodeDynamicMesh(state.nodeId, state.workingDefinition)
      ctx.ensureFloorVertexHandlesForSelectedNode()
      void ctx.nextTick(() => {
        ctx.ensureFloorVertexHandlesForSelectedNode()
      })
      return {
        handled: true,
        nextFloorVertexDragState: null,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    // Click (no drag): revert any preview mutations and handle position.
    try {
      ctx.updateFloorGroup(state.runtimeObject, state.baseDefinition)
      const handles = state.containerObject.getObjectByName(FLOOR_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const mesh = handles.children.find((child) => child?.userData?.floorVertexIndex === state.vertexIndex) as
          | THREE.Object3D
          | undefined
        if (mesh) {
          const [vx, vz] = state.startVertex
          const y = Number(mesh.userData?.yOffset)
          mesh.position.set(vx, Number.isFinite(y) ? y : FLOOR_VERTEX_HANDLE_Y, vz)
        }
      }
    } catch {
      /* noop */
    }

    return {
      handled: true,
      nextFloorVertexDragState: null,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  if (ctx.wallEndpointDragState && event.pointerId === ctx.wallEndpointDragState.pointerId && event.button === 0) {
    const state = ctx.wallEndpointDragState
    ctx.pointerInteractionReleaseIfCaptured(event.pointerId)
    ctx.setActiveWallEndpointHandle(null)

    // Always remove preview.
    if (state.previewGroup) {
      const preview = state.previewGroup
      state.previewGroup = null
      preview.removeFromParent()
      disposeWallPreviewGroup(preview)
    }

    if (state.moved) {
      const segmentsPayload = state.workingSegmentsWorld.map((s) => ({
        start: { x: s.start.x, y: s.start.y, z: s.start.z },
        end: { x: s.end.x, y: s.end.y, z: s.end.z },
      }))
      ctx.sceneStoreUpdateWallNodeGeometry(state.nodeId, {
        segments: segmentsPayload,
        dimensions: state.dimensions,
      })

      // Runtime sync happens via scene reconciliation; rebuild handles after that.
      ctx.ensureWallEndpointHandlesForSelectedNode({ force: true })
      void ctx.nextTick(() => {
        ctx.ensureWallEndpointHandlesForSelectedNode({ force: true })
      })

      return {
        handled: true,
        nextWallEndpointDragState: null,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    // Click (no drag): revert handle position.
    try {
      const handles = state.containerObject.getObjectByName(WALL_ENDPOINT_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const mesh = handles.children.find((child) => {
          const kind = child?.userData?.endpointKind
          const startIndex = Math.trunc(Number(child?.userData?.chainStartIndex))
          const endIndex = Math.trunc(Number(child?.userData?.chainEndIndex))
          return (
            (kind === state.endpointKind) &&
            startIndex === state.chainStartIndex &&
            endIndex === state.chainEndIndex
          )
        }) as THREE.Object3D | undefined
        if (mesh) {
          const local = state.containerObject.worldToLocal(state.startEndpointWorld.clone())
          const yOffset = Number(mesh.userData?.yOffset)
          mesh.position.set(local.x, local.y + (Number.isFinite(yOffset) ? yOffset : WALL_ENDPOINT_HANDLE_Y_OFFSET), local.z)
        }
      }
    } catch {
      /* noop */
    }

    // Click (no drag): start a wall build session from this endpoint.
    const node = ctx.findSceneNode(ctx.nodes, state.nodeId)
    if (node?.dynamicMesh?.type === 'Wall') {
      ctx.wallBuildToolBeginBranchFromEndpoint({
        nodeId: state.nodeId,
        chainStartIndex: state.chainStartIndex,
        chainEndIndex: state.chainEndIndex,
        endpointKind: state.endpointKind,
        worldPoint: state.startEndpointWorld.clone(),
      })
      return {
        handled: true,
        nextWallEndpointDragState: null,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    return {
      handled: true,
      nextWallEndpointDragState: null,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  // (handled above) wall endpoint drag state

  if (ctx.roadVertexDragState && event.pointerId === ctx.roadVertexDragState.pointerId && event.button === 0) {
    const state = ctx.roadVertexDragState

    ctx.pointerInteractionReleaseIfCaptured(event.pointerId)
    ctx.setActiveRoadVertexHandle(null)

    if (state.moved) {
      ctx.sceneStoreUpdateNodeDynamicMesh(state.nodeId, state.workingDefinition)
      // Runtime road group sync happens via reactive scene graph reconciliation; rebuild handles after that.
      ctx.ensureRoadVertexHandlesForSelectedNode()
      void ctx.nextTick(() => {
        ctx.ensureRoadVertexHandlesForSelectedNode()
      })
      return {
        handled: true,
        nextRoadVertexDragState: null,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    // No drag: ensure any preview mutations are reverted before treating this as a click.
    try {
      const roadOptions = ctx.resolveRoadRenderOptionsForNodeId(state.nodeId) ?? undefined
      ctx.updateRoadGroup(state.roadGroup, state.baseDefinition, roadOptions)
      const handles = state.containerObject.getObjectByName(ROAD_VERTEX_HANDLE_GROUP_NAME) as THREE.Group | null
      if (handles?.isGroup) {
        const mesh = handles.children.find(
          (child) => child?.userData?.roadVertexIndex === state.vertexIndex,
        ) as THREE.Object3D | undefined
        if (mesh) {
          const [vx, vz] = state.startVertex
          const y = Number(mesh.userData?.yOffset)
          mesh.position.set(vx, Number.isFinite(y) ? y : ROAD_VERTEX_HANDLE_Y, vz)
        }
      }
    } catch {
      /* noop */
    }

    // Click (no drag): start a branch build session from this vertex.
    const node = ctx.findSceneNode(ctx.nodes, state.nodeId)
    if (node?.dynamicMesh?.type === 'Road') {
      const v = Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices[state.vertexIndex] : null
      if (v && Array.isArray(v) && v.length >= 2) {
        const runtime = ctx.objectMap.get(state.nodeId) ?? null
        if (runtime) {
          const world = runtime.localToWorld(new THREE.Vector3(Number(v[0]) || 0, 0, Number(v[1]) || 0))
          ctx.roadBuildToolBeginBranchFromVertex({
            nodeId: state.nodeId,
            vertexIndex: state.vertexIndex,
            worldPoint: world,
            width: Number.isFinite(node.dynamicMesh.width) ? node.dynamicMesh.width : ctx.roadDefaultWidth,
          })
          return {
            handled: true,
            nextRoadVertexDragState: null,
            preventDefault: true,
            stopPropagation: true,
            stopImmediatePropagation: true,
          }
        }
      }
    }

    return {
      handled: true,
      nextRoadVertexDragState: null,
    }
  }

  if (ctx.floorEdgeDragState && event.pointerId === ctx.floorEdgeDragState.pointerId && event.button === 0) {
    const state = ctx.floorEdgeDragState
    ctx.pointerInteractionReleaseIfCaptured(event.pointerId)

    if (state.moved) {
      ctx.sceneStoreUpdateNodeDynamicMesh(state.nodeId, state.workingDefinition)
    } else {
      const resetVertices = state.startVertices.map(([x, z]) => [x, z] as [number, number])
      state.workingDefinition.vertices = resetVertices
      ctx.updateFloorGroup(state.runtimeObject, state.workingDefinition)
    }

    return {
      handled: true,
      clearFloorEdgeDragState: true,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  return null
}
