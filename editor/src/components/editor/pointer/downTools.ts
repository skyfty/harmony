import type * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import type { PointerDownResult, RoadVertexDragState } from './types'

export function handlePointerDownTools(
  event: PointerEvent,
  ctx: {
    activeBuildTool: string | null
    isAltOverrideActive: boolean

    // Node picker
    nodePickerActive: boolean
    nodePickerCompletePick: (nodeId: string) => void
    hideNodePickerHighlight: () => void
    pickNodeAtPointer: (event: PointerEvent) => { nodeId: string } | null

    // Build tools
    wallBuildToolHandlePointerDown: (event: PointerEvent) => boolean
    floorBuildToolHandlePointerDown: (event: PointerEvent) => void
    roadBuildToolGetSession: () => unknown | null

    beginBuildToolRightClick: (event: PointerEvent, options: { roadCancelEligible: boolean }) => void

    // Floor edge drag
    tryBeginFloorEdgeDrag: (event: PointerEvent) => boolean

    // Road vertex drag
    ensureRoadVertexHandlesForSelectedNode: () => void
    pickRoadVertexHandleAtPointer: (event: PointerEvent) => { nodeId: string; vertexIndex: number } | null

    nodes: SceneNode[]
    findSceneNode: (nodes: SceneNode[], nodeId: string) => SceneNode | null
    objectMap: Map<string, THREE.Object3D>
  },
): PointerDownResult | null {
  const button = event.button

  if (ctx.nodePickerActive) {
    if (button === 0) {
      const hit = ctx.pickNodeAtPointer(event)
      if (hit) {
        ctx.nodePickerCompletePick(hit.nodeId)
      }
    }

    ctx.hideNodePickerHighlight()

    return {
      handled: true,
      clearPointerTrackingState: true,
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    }
  }

  if (ctx.activeBuildTool === 'wall') {
    if (ctx.wallBuildToolHandlePointerDown(event)) {
      return { handled: true, clearPointerTrackingState: true }
    }

    // Wall build uses left click for placement; block camera controls unless Alt override is active.
    if (button === 0 && !ctx.isAltOverrideActive) {
      return {
        handled: true,
        clearPointerTrackingState: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    if (button === 2) {
      ctx.beginBuildToolRightClick(event, { roadCancelEligible: false })
      return { handled: true, clearPointerTrackingState: true }
    }
  }

  if (ctx.activeBuildTool === 'floor') {
    if (button === 0 && !ctx.isAltOverrideActive) {
      if (ctx.tryBeginFloorEdgeDrag(event)) {
        // `tryBeginFloorEdgeDrag` owns its own state/capture; preserve original behavior.
        return { handled: true }
      }
    }

    ctx.floorBuildToolHandlePointerDown(event)

    if (button === 0 && !ctx.isAltOverrideActive) {
      return {
        handled: true,
        clearPointerTrackingState: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    if (button === 2) {
      ctx.beginBuildToolRightClick(event, { roadCancelEligible: false })
      return { handled: true, clearPointerTrackingState: true }
    }
  }

  if (ctx.activeBuildTool === 'road') {
    if (button === 0 && !ctx.isAltOverrideActive) {
      // If a road vertex handle is under the cursor, begin vertex interaction (click to branch / drag to move).
      ctx.ensureRoadVertexHandlesForSelectedNode()
      const handleHit = ctx.pickRoadVertexHandleAtPointer(event)

      if (handleHit) {
        const node = ctx.findSceneNode(ctx.nodes, handleHit.nodeId)
        const runtime = ctx.objectMap.get(handleHit.nodeId) ?? null

        if (node?.dynamicMesh?.type === 'Road' && runtime) {
          const roadGroupCandidate =
            (runtime.userData?.roadGroup as THREE.Object3D | undefined) ?? runtime.getObjectByName('RoadGroup') ?? null

          if (!roadGroupCandidate) {
            return {
              handled: true,
              clearPointerTrackingState: true,
              preventDefault: true,
              stopPropagation: true,
              stopImmediatePropagation: true,
            }
          }

          const baseVertices = Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []
          const baseVertex = baseVertices[handleHit.vertexIndex]
          const startVertex: [number, number] =
            Array.isArray(baseVertex) && baseVertex.length >= 2
              ? [Number(baseVertex[0]) || 0, Number(baseVertex[1]) || 0]
              : [0, 0]

          const roadVertexDragState: RoadVertexDragState = {
            pointerId: event.pointerId,
            nodeId: handleHit.nodeId,
            vertexIndex: handleHit.vertexIndex,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            startVertex,
            containerObject: runtime,
            roadGroup: roadGroupCandidate,
            baseDefinition: node.dynamicMesh,
            workingDefinition: {
              ...node.dynamicMesh,
              vertices: (Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []).map(
                ([x, z]) => [Number(x) || 0, Number(z) || 0] as [number, number],
              ),
              segments: (Array.isArray(node.dynamicMesh.segments) ? node.dynamicMesh.segments : []).map((seg) => ({
                a: Number((seg as any).a) || 0,
                b: Number((seg as any).b) || 0,
              })),
            },
          }

          return {
            handled: true,
            clearPointerTrackingState: true,
            nextRoadVertexDragState: roadVertexDragState,
            capturePointerId: event.pointerId,
            preventDefault: true,
            stopPropagation: true,
            stopImmediatePropagation: true,
          }
        }
      }

      return {
        handled: true,
        clearPointerTrackingState: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }
    const roadCancelEligible = button === 2 && Boolean(ctx.roadBuildToolGetSession())

    // Road build uses left click for placement; block camera controls unless Alt override is active.
    if (button === 0 && !ctx.isAltOverrideActive) {
      return {
        handled: true,
        clearPointerTrackingState: true,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }

    if (button === 2) {
      ctx.beginBuildToolRightClick(event, { roadCancelEligible })
      return { handled: true, clearPointerTrackingState: true }
    }
  }

  return null
}
