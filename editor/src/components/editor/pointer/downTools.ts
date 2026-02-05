import * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import { FLOOR_VERTEX_HANDLE_Y } from '../FloorVertexRenderer'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'
import type {
  FloorVertexDragState,
  FloorThicknessDragState,
  PointerDownResult,
  RoadVertexDragState,
  WallEndpointDragState,
  WallJointDragState,
  WallHeightDragState,
  WallCircleCenterDragState,
  WallCircleRadiusDragState,
  RectangleEditConstraint,
} from './types'

import {
  FLOOR_COMPONENT_TYPE,
  FLOOR_DEFAULT_THICKNESS,
  FLOOR_MAX_THICKNESS,
  FLOOR_MIN_THICKNESS,
  type FloorComponentProps,
} from '@schema/components'
import type { SceneNodeComponentState } from '@harmony/schema'

type WallWorldSegmentLike = { start: THREE.Vector3; end: THREE.Vector3 }

const RECTANGLE_CHAIN_EPS = 1e-3

function distSqXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

function isAxisAlignedEdge(a: THREE.Vector3, b: THREE.Vector3, eps = RECTANGLE_CHAIN_EPS): boolean {
  return Math.abs(a.x - b.x) <= eps || Math.abs(a.z - b.z) <= eps
}

function sideOf(value: number, min: number, max: number, eps = RECTANGLE_CHAIN_EPS): 'min' | 'max' {
  const dMin = Math.abs(value - min)
  const dMax = Math.abs(value - max)
  if (dMin <= eps && dMax <= eps) {
    // Degenerate rectangle; choose deterministically.
    return 'min'
  }
  if (dMin <= eps) return 'min'
  if (dMax <= eps) return 'max'
  return dMin <= dMax ? 'min' : 'max'
}

function tryCreateRectangleEditConstraint(options: {
  segmentsWorld: WallWorldSegmentLike[]
  chainStartIndex: number
  chainEndIndex: number
  draggedCornerIndex: 0 | 1 | 2 | 3
}): RectangleEditConstraint | null {
  const { segmentsWorld, chainStartIndex, chainEndIndex, draggedCornerIndex } = options
  if (chainEndIndex - chainStartIndex !== 3) {
    return null
  }

  const seg0 = segmentsWorld[chainStartIndex]
  const seg1 = segmentsWorld[chainStartIndex + 1]
  const seg2 = segmentsWorld[chainStartIndex + 2]
  const seg3 = segmentsWorld[chainStartIndex + 3]
  if (!seg0 || !seg1 || !seg2 || !seg3) {
    return null
  }

  const v0 = seg0.start
  const v1 = seg0.end
  const v2 = seg1.end
  const v3 = seg2.end

  // Continuity + closure (XZ only; Y can vary slightly due to floating point).
  if (distSqXZ(seg1.start, v1) > RECTANGLE_CHAIN_EPS * RECTANGLE_CHAIN_EPS) return null
  if (distSqXZ(seg2.start, v2) > RECTANGLE_CHAIN_EPS * RECTANGLE_CHAIN_EPS) return null
  if (distSqXZ(seg3.start, v3) > RECTANGLE_CHAIN_EPS * RECTANGLE_CHAIN_EPS) return null
  if (distSqXZ(seg3.end, v0) > RECTANGLE_CHAIN_EPS * RECTANGLE_CHAIN_EPS) return null

  // Axis-aligned rectangle perimeter.
  if (!isAxisAlignedEdge(v0, v1)) return null
  if (!isAxisAlignedEdge(v1, v2)) return null
  if (!isAxisAlignedEdge(v2, v3)) return null
  if (!isAxisAlignedEdge(v3, v0)) return null

  const corners = [v0, v1, v2, v3] as const
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const c of corners) {
    minX = Math.min(minX, c.x)
    maxX = Math.max(maxX, c.x)
    minZ = Math.min(minZ, c.z)
    maxZ = Math.max(maxZ, c.z)
  }

  const cornerSides = corners.map((c) => ({
    x: sideOf(c.x, minX, maxX),
    z: sideOf(c.z, minZ, maxZ),
  })) as unknown as RectangleEditConstraint['cornerSides']

  const oppositeCornerWorld = corners[(draggedCornerIndex ^ 2) as 0 | 1 | 2 | 3].clone()

  return {
    cornerSides,
    draggedCornerIndex,
    oppositeCornerWorld,
  }
}

function computeChainCenterAndRadiusWorld(options: {
  segmentsWorld: WallWorldSegmentLike[]
  chainStartIndex: number
  chainEndIndex: number
}): { centerWorld: THREE.Vector3; radius: number } | null {
  const { segmentsWorld, chainStartIndex, chainEndIndex } = options
  const startSeg = segmentsWorld[chainStartIndex]
  const endSeg = segmentsWorld[chainEndIndex]
  if (!startSeg || !endSeg) {
    return null
  }

  // Vertices: first start + each end.
  const points: THREE.Vector3[] = []
  points.push(startSeg.start.clone())
  for (let i = chainStartIndex; i <= chainEndIndex; i += 1) {
    const seg = segmentsWorld[i]
    if (!seg) continue
    points.push(seg.end.clone())
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

export function handlePointerDownTools(
  event: PointerEvent,
  ctx: {
    activeBuildTool: string | null
    wallBuildShape: WallBuildShape
    floorBuildShape: FloorBuildShape
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
    } & (
      | { handleKind: 'endpoint'; endpointKind: 'start' | 'end' }
      | { handleKind: 'joint'; jointIndex: number }
      | { handleKind: 'circle'; circleKind: 'center' | 'radius' }
    ) & {
      gizmoKind: 'center' | 'axis'
      gizmoAxis?: THREE.Vector3
      gizmoPart: any
    } | null
    setActiveWallEndpointHandle: (active: {
      nodeId: string
      chainStartIndex: number
      chainEndIndex: number
    } & (
      | { handleKind: 'endpoint'; endpointKind: 'start' | 'end' }
      | { handleKind: 'joint'; jointIndex: number }
      | { handleKind: 'circle'; circleKind: 'center' | 'radius' }
    ) & {
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

          const wallBuildShape = ctx.wallBuildShape ?? 'polygon'

          const handleKind = handleHit.handleKind
          let endpointKind: 'start' | 'end' = 'start'
          let jointIndex = -1
          let circleKind: 'center' | 'radius' = 'center'

          if (handleKind === 'endpoint') {
            endpointKind = handleHit.endpointKind === 'end' ? 'end' : 'start'
          } else if (handleKind === 'circle') {
            circleKind = handleHit.circleKind === 'radius' ? 'radius' : 'center'
          } else {
            jointIndex = Math.max(chainStartIndex, Math.trunc(Number(handleHit.jointIndex)))
          }

          const startSeg = workingSegmentsWorld[chainStartIndex]
          const endSeg = workingSegmentsWorld[chainEndIndex]
          if (startSeg && endSeg) {
            // Circle edit mode: center + radius handles only (hide all segment handles).
            if (handleKind === 'circle') {
              const computed = computeChainCenterAndRadiusWorld({
                segmentsWorld: baseSegmentsWorld,
                chainStartIndex,
                chainEndIndex,
              })
              if (computed) {
                const centerWorld = computed.centerWorld
                const radius = computed.radius

                const radiusPointWorld = centerWorld.clone().add(new THREE.Vector3(radius, 0, 0))
                const startPointWorld = (circleKind === 'radius' ? radiusPointWorld : centerWorld).clone()
                const dragPlane = ctx.createEndpointDragPlane({
                  mode: 'free',
                  axisWorld: null,
                  startPointWorld,
                  freePlaneNormal: new THREE.Vector3(0, 1, 0),
                })

                ctx.setActiveWallEndpointHandle({
                  nodeId: handleHit.nodeId,
                  chainStartIndex,
                  chainEndIndex,
                  handleKind: 'circle',
                  circleKind,
                  gizmoPart: handleHit.gizmoPart,
                })

                if (circleKind === 'center') {
                  const wallCircleCenterDragState: WallCircleCenterDragState = {
                    pointerId: event.pointerId,
                    nodeId: handleHit.nodeId,
                    chainStartIndex,
                    chainEndIndex,

                    startX: event.clientX,
                    startY: event.clientY,
                    moved: false,

                    dragPlane,
                    startPointWorld,
                    startHitWorld: null,

                    containerObject: runtime,

                    dimensions,
                    baseSegmentsWorld,
                    workingSegmentsWorld,

                    startCenterWorld: centerWorld.clone(),

                    previewGroup: null,
                    previewSignature: null,
                  }

                  return {
                    handled: true,
                    clearPointerTrackingState: true,
                    nextWallEndpointDragState: null,
                    nextWallJointDragState: null,
                    nextWallHeightDragState: null,
                    nextWallCircleCenterDragState: wallCircleCenterDragState,
                    nextWallCircleRadiusDragState: null,
                    capturePointerId: event.pointerId,
                    preventDefault: true,
                    stopPropagation: true,
                    stopImmediatePropagation: true,
                  }
                }

                const wallCircleRadiusDragState: WallCircleRadiusDragState = {
                  pointerId: event.pointerId,
                  nodeId: handleHit.nodeId,
                  chainStartIndex,
                  chainEndIndex,

                  startX: event.clientX,
                  startY: event.clientY,
                  moved: false,

                  dragPlane,
                  startPointWorld,
                  startHitWorld: null,

                  containerObject: runtime,

                  dimensions,
                  baseSegmentsWorld,
                  workingSegmentsWorld,

                  centerWorld: centerWorld.clone(),
                  startRadius: radius,

                  previewGroup: null,
                  previewSignature: null,
                }

                return {
                  handled: true,
                  clearPointerTrackingState: true,
                  nextWallEndpointDragState: null,
                  nextWallJointDragState: null,
                  nextWallHeightDragState: null,
                  nextWallCircleCenterDragState: null,
                  nextWallCircleRadiusDragState: wallCircleRadiusDragState,
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

            const startEndpointWorld = endpointKind === 'start' ? startSeg.start.clone() : endSeg.end.clone()
            const anchorPointWorld = endpointKind === 'start' ? startSeg.end.clone() : endSeg.start.clone()

            const startJointWorld =
              handleKind === 'joint' && workingSegmentsWorld[jointIndex]
                ? workingSegmentsWorld[jointIndex]!.end.clone()
                : null

            const dragMode = handleHit.gizmoKind === 'axis' ? 'axis' : 'free'
            const axisWorld =
              dragMode === 'axis' && handleHit.gizmoAxis && (handleHit.gizmoAxis as any).isVector3
                ? (handleHit.gizmoAxis as THREE.Vector3).clone().normalize()
                : null
            const effectiveDragMode = axisWorld && axisWorld.lengthSq() > 1e-10 ? dragMode : 'free'
            const effectiveAxisWorld = effectiveDragMode === 'axis' ? axisWorld : null

            // Special case: dragging the Y axis arrow adjusts wall height (whole wall), not endpoint position.
            const isYAxisDrag =
              effectiveDragMode === 'axis' &&
              effectiveAxisWorld &&
              Math.abs(effectiveAxisWorld.y) > 0.9 &&
              Math.abs(effectiveAxisWorld.x) < 0.2 &&
              Math.abs(effectiveAxisWorld.z) < 0.2

            if (isYAxisDrag) {
              const axisSign: 1 | -1 = effectiveAxisWorld.y >= 0 ? 1 : -1
              const startPointWorld = (startJointWorld ?? startEndpointWorld).clone()
              startPointWorld.y += Math.max(0.05, dimensions.height * 0.5)

              const wallHeightDragState: WallHeightDragState = {
                pointerId: event.pointerId,
                nodeId: handleHit.nodeId,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,

                axisSign,
                dragPlane: ctx.createEndpointDragPlane({
                  mode: 'axis',
                  axisWorld: new THREE.Vector3(0, axisSign, 0),
                  startPointWorld,
                }),
                startPointWorld: startPointWorld.clone(),
                startHitWorld: null,

                startHeight: dimensions.height,

                containerObject: runtime,
                dimensions: { ...dimensions },
                baseSegmentsWorld,
                workingSegmentsWorld,
                previewGroup: null,
                previewSignature: null,
              }

              ctx.setActiveWallEndpointHandle({
                nodeId: handleHit.nodeId,
                chainStartIndex,
                chainEndIndex,
                ...(handleKind === 'joint'
                  ? { handleKind: 'joint' as const, jointIndex }
                  : { handleKind: 'endpoint' as const, endpointKind }),
                gizmoPart: handleHit.gizmoPart,
              })

              return {
                handled: true,
                clearPointerTrackingState: true,
                nextWallEndpointDragState: null,
                nextWallJointDragState: null,
                nextWallHeightDragState: wallHeightDragState,
                nextWallCircleCenterDragState: null,
                nextWallCircleRadiusDragState: null,
                capturePointerId: event.pointerId,
                preventDefault: true,
                stopPropagation: true,
                stopImmediatePropagation: true,
              }
            }

            if (handleKind === 'joint') {
              // Joint drag: move the shared vertex between two adjacent segments.
              const clampedJointIndex = Math.min(chainEndIndex - 1, Math.max(chainStartIndex, jointIndex))
              const jointSeg = workingSegmentsWorld[clampedJointIndex]
              const nextSeg = workingSegmentsWorld[clampedJointIndex + 1]
              if (jointSeg && nextSeg) {
                const startJointWorld = jointSeg.end.clone()

                const draggedCornerIndex = Math.max(1, Math.min(3, clampedJointIndex - chainStartIndex + 1)) as 1 | 2 | 3
                const rectangleConstraint = wallBuildShape === 'rectangle'
                  ? tryCreateRectangleEditConstraint({
                    segmentsWorld: baseSegmentsWorld,
                    chainStartIndex,
                    chainEndIndex,
                    draggedCornerIndex: draggedCornerIndex as 0 | 1 | 2 | 3,
                  })
                  : null

                const wallJointDragState: WallJointDragState = {
                  pointerId: event.pointerId,
                  nodeId: handleHit.nodeId,
                  chainStartIndex,
                  chainEndIndex,
                  jointIndex: clampedJointIndex,

                  wallBuildShape,
                  rectangleConstraint,

                  startX: event.clientX,
                  startY: event.clientY,
                  moved: false,
                  dragMode: effectiveDragMode,
                  axisWorld: effectiveAxisWorld,
                  dragPlane: ctx.createEndpointDragPlane({
                    mode: effectiveDragMode,
                    axisWorld: effectiveAxisWorld,
                    startPointWorld: startJointWorld,
                    freePlaneNormal: new THREE.Vector3(0, 1, 0),
                  }),
                  containerObject: runtime,
                  dimensions,
                  baseSegmentsWorld,
                  workingSegmentsWorld,
                  startJointWorld,
                  previewGroup: null,
                  previewSignature: null,
                }

                ctx.setActiveWallEndpointHandle({
                  nodeId: handleHit.nodeId,
                  chainStartIndex,
                  chainEndIndex,
                  handleKind: 'joint',
                  jointIndex: clampedJointIndex,
                  gizmoPart: handleHit.gizmoPart,
                })

                return {
                  handled: true,
                  clearPointerTrackingState: true,
                  nextWallEndpointDragState: null,
                  nextWallJointDragState: wallJointDragState,
                  nextWallCircleCenterDragState: null,
                  nextWallCircleRadiusDragState: null,
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

            const wallEndpointDragState: WallEndpointDragState = {
              pointerId: event.pointerId,
              nodeId: handleHit.nodeId,
              chainStartIndex,
              chainEndIndex,
              endpointKind,

              wallBuildShape,
              rectangleConstraint: wallBuildShape === 'rectangle'
                ? tryCreateRectangleEditConstraint({
                  segmentsWorld: baseSegmentsWorld,
                  chainStartIndex,
                  chainEndIndex,
                  // Closed rectangles have coincident start/end points; treat both endpoint handles as corner 0.
                  draggedCornerIndex: 0,
                })
                : null,

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
              handleKind: 'endpoint',
              endpointKind,
              gizmoPart: handleHit.gizmoPart,
            })

            return {
              handled: true,
              clearPointerTrackingState: true,
              nextWallEndpointDragState: wallEndpointDragState,
              nextWallJointDragState: null,
              nextWallCircleCenterDragState: null,
              nextWallCircleRadiusDragState: null,
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

          // Special case: dragging the Y axis arrow adjusts floor thickness (whole floor), not vertex position.
          const isYAxisArrow = handleHit.gizmoKind === 'axis' && (handleHit.gizmoPart === 'py' || handleHit.gizmoPart === 'ny')
          if (isYAxisArrow) {
            const axisSign: 1 | -1 = handleHit.gizmoPart === 'ny' ? -1 : 1

            const floorComponent = node.components?.[FLOOR_COMPONENT_TYPE] as SceneNodeComponentState<FloorComponentProps> | undefined
            const baseThickness = Number.isFinite(floorComponent?.props?.thickness)
              ? Number(floorComponent!.props.thickness)
              : (Number.isFinite((node.dynamicMesh as any).thickness) ? Number((node.dynamicMesh as any).thickness) : FLOOR_DEFAULT_THICKNESS)

            const clampedBase = Math.min(FLOOR_MAX_THICKNESS, Math.max(FLOOR_MIN_THICKNESS, baseThickness))
            const yOffset = FLOOR_VERTEX_HANDLE_Y + clampedBase * 0.5
            const startPointWorld = runtime.localToWorld(new THREE.Vector3(startVertex[0], yOffset, startVertex[1]))

            const floorThicknessDragState: FloorThicknessDragState = {
              pointerId: event.pointerId,
              nodeId: handleHit.nodeId,
              vertexIndex: handleHit.vertexIndex,
              startX: event.clientX,
              startY: event.clientY,
              moved: false,

              axisSign,
              dragPlane: ctx.createEndpointDragPlane({
                mode: 'axis',
                axisWorld: new THREE.Vector3(0, axisSign, 0),
                startPointWorld,
              }),
              startPointWorld: startPointWorld.clone(),
              startHitWorld: null,

              startThickness: clampedBase,
              thickness: clampedBase,

              containerObject: runtime,
            }

            ctx.setActiveFloorVertexHandle({ nodeId: handleHit.nodeId, vertexIndex: handleHit.vertexIndex, gizmoPart: handleHit.gizmoPart })

            return {
              handled: true,
              clearPointerTrackingState: true,
              nextFloorVertexDragState: null,
              nextFloorThicknessDragState: floorThicknessDragState,
              capturePointerId: event.pointerId,
              preventDefault: true,
              stopPropagation: true,
              stopImmediatePropagation: true,
            }
          }

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

            floorBuildShape: ctx.floorBuildShape,
            editConstraint: null,

            dragMode: effectiveDragMode,
            axisWorld: effectiveAxisWorld,
            dragPlane: ctx.createEndpointDragPlane({
              mode: effectiveDragMode,
              axisWorld: effectiveAxisWorld,
              startPointWorld,
              freePlaneNormal: new THREE.Vector3(0, 1, 0),
            }),
            startPointWorld: startPointWorld.clone(),
            startHitWorld: null,

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
