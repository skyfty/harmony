import * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import { ROAD_VERTEX_HANDLE_GROUP_NAME, ROAD_VERTEX_HANDLE_Y } from './RoadVertexRenderer'
import type { RoadVertexDragState, PointerUpResult } from './SceneViewportPointerDownTypes'

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
    floorEdgeDragState: FloorEdgeDragStateLike | null

    findSceneNode: (nodes: SceneNode[], nodeId: string) => SceneNode | null
    nodes: SceneNode[]
    objectMap: Map<string, THREE.Object3D>

    sceneStoreUpdateNodeDynamicMesh: (nodeId: string, dynamicMesh: any) => void

    pointerInteractionReleaseIfCaptured: (pointerId: number) => void

    ensureRoadVertexHandlesForSelectedNode: () => void
    nextTick: (cb?: () => void) => Promise<void>

    resolveRoadRenderOptionsForNodeId: (nodeId: string) => unknown | null
    updateRoadGroup: (roadGroup: THREE.Object3D, definition: any, options?: unknown) => void
    updateFloorGroup: (runtimeObject: THREE.Object3D, definition: any) => void

    roadBuildToolBeginBranchFromVertex: (options: {
      nodeId: string
      vertexIndex: number
      worldPoint: THREE.Vector3
      width: number
    }) => void
  },
): PointerUpResult | null {
  if (ctx.roadVertexDragState && event.pointerId === ctx.roadVertexDragState.pointerId && event.button === 1) {
    const state = ctx.roadVertexDragState

    ctx.pointerInteractionReleaseIfCaptured(event.pointerId)

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
          mesh.position.set(vx, ROAD_VERTEX_HANDLE_Y, vz)
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
          const world = runtime.localToWorld(
            new THREE.Vector3(Number(v[0]) || 0, 0, Number(v[1]) || 0),
          )
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

  if (ctx.floorEdgeDragState && event.pointerId === ctx.floorEdgeDragState.pointerId && event.button === 1) {
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
