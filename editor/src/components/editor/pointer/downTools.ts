import * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import type { FloorVertexDragState, PointerDownResult, RoadVertexDragState, WallEndpointDragState } from './types'

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

    // Floor vertex drag
    ensureFloorVertexHandlesForSelectedNode: () => void
    pickFloorVertexHandleAtPointer: (event: PointerEvent) => { nodeId: string; vertexIndex: number; gizmoKind: 'center' | 'axis'; gizmoAxis?: THREE.Vector3; gizmoPart: any } | null
    setActiveFloorVertexHandle: (active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) => void

    // Road vertex drag
    ensureRoadVertexHandlesForSelectedNode: () => void
    pickRoadVertexHandleAtPointer: (event: PointerEvent) => { nodeId: string; vertexIndex: number; gizmoKind: 'center' | 'axis'; gizmoAxis?: THREE.Vector3; gizmoPart: any } | null
    setActiveRoadVertexHandle: (active: { nodeId: string; vertexIndex: number; gizmoPart: any } | null) => void

    // Wall endpoint drag
    ensureWallEndpointHandlesForSelectedNode: () => void
    pickWallEndpointHandleAtPointer: (event: PointerEvent) => {
      nodeId: string
      chainStartIndex: number
      chainEndIndex: number
      endpointKind: 'start' | 'end'
      gizmoKind: 'center' | 'axis'
      gizmoAxis?: THREE.Vector3
      gizmoPart: any
    } | null
    setActiveWallEndpointHandle: (active: {
      nodeId: string
      chainStartIndex: number
      chainEndIndex: number
      endpointKind: 'start' | 'end'
      gizmoPart: any
    } | null) => void

    createEndpointDragPlane: (options: {
      mode: 'free' | 'axis'
      axisWorld: THREE.Vector3 | null
      startPointWorld: THREE.Vector3
      freePlaneNormal?: THREE.Vector3
    }) => THREE.Plane

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
    if (button === 0 && !ctx.isAltOverrideActive) {
      // If a wall endpoint handle is under the cursor, begin endpoint interaction (drag to reshape).
      ctx.ensureWallEndpointHandlesForSelectedNode()
      const handleHit = ctx.pickWallEndpointHandleAtPointer(event)
      if (handleHit) {
        const node = ctx.findSceneNode(ctx.nodes, handleHit.nodeId)
        const runtime = ctx.objectMap.get(handleHit.nodeId) ?? null

        if (node?.dynamicMesh?.type === 'Wall' && runtime) {
          const origin = new THREE.Vector3(
            Number(node.position?.x) || 0,
            Number(node.position?.y) || 0,
            Number(node.position?.z) || 0,
          )
          const segments = Array.isArray(node.dynamicMesh.segments) ? node.dynamicMesh.segments : []

          const baseSegmentsWorld = segments.map((seg) => {
            const sx = Number((seg as any).start?.x) || 0
            const sy = Number((seg as any).start?.y) || 0
            const sz = Number((seg as any).start?.z) || 0
            const ex = Number((seg as any).end?.x) || 0
            const ey = Number((seg as any).end?.y) || 0
            const ez = Number((seg as any).end?.z) || 0
            return {
              start: new THREE.Vector3(sx + origin.x, sy + origin.y, sz + origin.z),
              end: new THREE.Vector3(ex + origin.x, ey + origin.y, ez + origin.z),
            }
          })

          const workingSegmentsWorld = baseSegmentsWorld.map((s) => ({ start: s.start.clone(), end: s.end.clone() }))

          const sample = segments[0] as any
          const dimensions = {
            height: Number.isFinite(Number(sample?.height)) ? Number(sample.height) : 3,
            width: Number.isFinite(Number(sample?.width)) ? Number(sample.width) : 0.2,
            thickness: Number.isFinite(Number(sample?.thickness)) ? Number(sample.thickness) : 0.1,
          }

          const chainStartIndex = Math.max(0, Math.trunc(handleHit.chainStartIndex))
          const chainEndIndex = Math.max(chainStartIndex, Math.trunc(handleHit.chainEndIndex))
          const endpointKind = handleHit.endpointKind === 'end' ? 'end' : 'start'

          const startSeg = workingSegmentsWorld[chainStartIndex]
          const endSeg = workingSegmentsWorld[chainEndIndex]
          if (startSeg && endSeg) {
            const startEndpointWorld = endpointKind === 'start' ? startSeg.start.clone() : endSeg.end.clone()
            const anchorPointWorld = endpointKind === 'start' ? startSeg.end.clone() : endSeg.start.clone()

            const dragMode = handleHit.gizmoKind === 'axis' ? 'axis' : 'free'
            const axisWorld =
              dragMode === 'axis' && handleHit.gizmoAxis && (handleHit.gizmoAxis as any).isVector3
                ? (handleHit.gizmoAxis as THREE.Vector3).clone().normalize()
                : null
            const effectiveDragMode = axisWorld && axisWorld.lengthSq() > 1e-10 ? dragMode : 'free'
            const effectiveAxisWorld = effectiveDragMode === 'axis' ? axisWorld : null

            const wallEndpointDragState: WallEndpointDragState = {
              pointerId: event.pointerId,
              nodeId: handleHit.nodeId,
              chainStartIndex,
              chainEndIndex,
              endpointKind,
              startX: event.clientX,
              startY: event.clientY,
              moved: false,
              dragMode: effectiveDragMode,
              axisWorld: effectiveAxisWorld,
              dragPlane: ctx.createEndpointDragPlane({
                mode: effectiveDragMode,
                axisWorld: effectiveAxisWorld,
                startPointWorld: startEndpointWorld,
                freePlaneNormal: new THREE.Vector3(0, 1, 0),
              }),
              containerObject: runtime,
              dimensions,
              baseSegmentsWorld,
              workingSegmentsWorld,
              anchorPointWorld,
              startEndpointWorld,
              previewGroup: null,
              previewSignature: null,
            }

            ctx.setActiveWallEndpointHandle({
              nodeId: handleHit.nodeId,
              chainStartIndex,
              chainEndIndex,
              endpointKind,
              gizmoPart: handleHit.gizmoPart,
            })

            return {
              handled: true,
              clearPointerTrackingState: true,
              nextWallEndpointDragState: wallEndpointDragState,
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
    }

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
      // If a floor vertex handle is under the cursor, begin vertex interaction (drag to move).
      ctx.ensureFloorVertexHandlesForSelectedNode()
      const handleHit = ctx.pickFloorVertexHandleAtPointer(event)
      if (handleHit) {
        const node = ctx.findSceneNode(ctx.nodes, handleHit.nodeId)
        const runtime = ctx.objectMap.get(handleHit.nodeId) ?? null

        if (node?.dynamicMesh?.type === 'Floor' && runtime) {
          const baseVertices = Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []
          const baseVertex = baseVertices[handleHit.vertexIndex]
          const startVertex: [number, number] =
            Array.isArray(baseVertex) && baseVertex.length >= 2
              ? [Number(baseVertex[0]) || 0, Number(baseVertex[1]) || 0]
              : [0, 0]

          const startPointWorld = runtime.localToWorld(new THREE.Vector3(startVertex[0], 0, startVertex[1]))
          const dragMode = handleHit.gizmoKind === 'axis' ? 'axis' : 'free'
          const axisWorld =
            dragMode === 'axis' && handleHit.gizmoAxis && (handleHit.gizmoAxis as any).isVector3
              ? new THREE.Vector3(handleHit.gizmoAxis.x, 0, handleHit.gizmoAxis.z).normalize()
              : null
          const effectiveDragMode = axisWorld && axisWorld.lengthSq() > 1e-10 ? dragMode : 'free'
          const effectiveAxisWorld = effectiveDragMode === 'axis' ? axisWorld : null

          const floorVertexDragState: FloorVertexDragState = {
            pointerId: event.pointerId,
            nodeId: handleHit.nodeId,
            vertexIndex: handleHit.vertexIndex,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,

            dragMode: effectiveDragMode,
            axisWorld: effectiveAxisWorld,
            dragPlane: ctx.createEndpointDragPlane({
              mode: effectiveDragMode,
              axisWorld: effectiveAxisWorld,
              startPointWorld,
              freePlaneNormal: new THREE.Vector3(0, 1, 0),
            }),
            startPointWorld: startPointWorld.clone(),

            startVertex,
            containerObject: runtime,
            runtimeObject: runtime,
            baseDefinition: node.dynamicMesh,
            workingDefinition: {
              ...node.dynamicMesh,
              vertices: (Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []).map(
                ([x, z]) => [Number(x) || 0, Number(z) || 0] as [number, number],
              ),
            },
          }

          ctx.setActiveFloorVertexHandle({ nodeId: handleHit.nodeId, vertexIndex: handleHit.vertexIndex, gizmoPart: handleHit.gizmoPart })

          return {
            handled: true,
            clearPointerTrackingState: true,
            nextFloorVertexDragState: floorVertexDragState,
            capturePointerId: event.pointerId,
            preventDefault: true,
            stopPropagation: true,
            stopImmediatePropagation: true,
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

          const startPointWorld = runtime.localToWorld(new THREE.Vector3(startVertex[0], 0, startVertex[1]))
          const dragMode = handleHit.gizmoKind === 'axis' ? 'axis' : 'free'
          const axisWorld =
            dragMode === 'axis' && handleHit.gizmoAxis && (handleHit.gizmoAxis as any).isVector3
              ? new THREE.Vector3(handleHit.gizmoAxis.x, 0, handleHit.gizmoAxis.z).normalize()
              : null
          const effectiveDragMode = axisWorld && axisWorld.lengthSq() > 1e-10 ? dragMode : 'free'
          const effectiveAxisWorld = effectiveDragMode === 'axis' ? axisWorld : null

          const roadVertexDragState: RoadVertexDragState = {
            pointerId: event.pointerId,
            nodeId: handleHit.nodeId,
            vertexIndex: handleHit.vertexIndex,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,

            dragMode: effectiveDragMode,
            axisWorld: effectiveAxisWorld,
            dragPlane: ctx.createEndpointDragPlane({
              mode: effectiveDragMode,
              axisWorld: effectiveAxisWorld,
              startPointWorld,
              freePlaneNormal: new THREE.Vector3(0, 1, 0),
            }),
            startPointWorld: startPointWorld.clone(),

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

          ctx.setActiveRoadVertexHandle({ nodeId: handleHit.nodeId, vertexIndex: handleHit.vertexIndex, gizmoPart: handleHit.gizmoPart })

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
