import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { PointerInteractionSession } from '@/types/pointer-interaction'
import type { SceneNodeComponentState, SceneNode, WallDynamicMesh } from '@schema'
import { WALL_COMPONENT_TYPE, type WallComponentProps } from '@schema/components'
import { compileWallSegmentsFromDefinition } from '@schema/wallLayout'
import { createWallPreviewRenderer, type WallPreviewSession, type WallPreviewSegment } from './WallPreviewRenderer'
import { GRID_MAJOR_SPACING, WALL_ANGLE_STEP_CONSTRAINTS_ENABLED } from './constants'
import { findSceneNode } from './sceneUtils'
import { constrainWallEndPointSoftSnap } from './wallEndpointSnap'
import { distanceSqXZ, splitWallSegmentsIntoChains } from './wallSegmentUtils'
import type { useSceneStore } from '@/stores/sceneStore'
import type { WallPresetData } from '@/utils/wallPreset'
import type { WallBuildShape } from '@/types/wall-build-shape'
import { mergeUserDataWithDynamicMeshBuildShape } from '@/utils/dynamicMeshBuildShapeUserData'
import type { WallPreviewRenderData } from './WallRenderer'

type PointerInteractionApi = {
  get: () => PointerInteractionSession | null
  ensureMoved: (event: PointerEvent) => boolean
}

type VertexSnapResolverOptions = {
  excludeNodeIds?: readonly string[]
  keepSourceY?: boolean
}

export type WallBuildToolHandle = {
  getSession: () => WallBuildToolSession | null
  syncBrushPreset: () => void
  flushPreviewIfNeeded: (scene: THREE.Scene | null) => void
  flushPreview: (scene: THREE.Scene | null) => void
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handlePointerCancel: (event: PointerEvent) => boolean
  cancel: () => boolean
  dispose: () => void
  beginBranchFromEndpoint: (options: {
    nodeId: string
    chainStartIndex: number
    chainEndIndex: number
    endpointKind: 'start' | 'end'
    worldPoint: THREE.Vector3
  }) => boolean
}

export type WallBuildToolSession = WallPreviewSession & {
  bodyAssetId: string | null
  brushPresetAssetId: string | null
  brushPresetData: WallPresetData | null
  lockedSegmentY: number | null
  committedNewSegmentCount: number
  branchFrom: {
    nodeId: string
    chainStartIndex: number
    chainEndIndex: number
    endpointKind: 'start' | 'end'
  } | null
  shapeDraft: {
    kind: Exclude<WallBuildShape, 'polygon' | 'line'>
    pointerId: number
    start: THREE.Vector3
    end: THREE.Vector3
  } | null
  polygonPoints: THREE.Vector3[]
  polygonPreviewEnd: THREE.Vector3 | null
}

export function createWallBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  wallBuildShape: Ref<WallBuildShape>
  wallRegularPolygonSides?: Ref<number>
  sceneStore: ReturnType<typeof useSceneStore>
  getWallEditNodeId: () => string | null
  pointerInteraction: PointerInteractionApi
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  resolveBuildPlacementPoint?: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  resolveVertexSnapPoint?: (event: PointerEvent, point: THREE.Vector3, options?: VertexSnapResolverOptions) => THREE.Vector3 | null
  clearVertexSnap?: () => void
  isAltOverrideActive: () => boolean
  getWallBrush: () => { presetAssetId: string | null; presetData: WallPresetData | null }
  applyWallPreviewMaterials?: (group: THREE.Group, presetData: WallPresetData | null) => void
  normalizeWallDimensionsForViewport: (values: {
    height?: number
    width?: number
    thickness?: number
  }) => { height: number; width: number; thickness: number }
  resolveWallPreviewRenderData?: (params: {
    definition: WallDynamicMesh
    wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined
    nodeId?: string | null
    previewKey: string
  }) => WallPreviewRenderData
  syncExactWallPreview?: (params: {
    container: THREE.Object3D
    definition: WallDynamicMesh
    wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined
    previewKey: string
  }) => void
  disposeExactWallPreview?: (container: THREE.Object3D | null | undefined) => void
}) : WallBuildToolHandle {
  const previewRenderer = createWallPreviewRenderer({
    rootGroup: options.rootGroup,
    normalizeWallDimensionsForViewport: options.normalizeWallDimensionsForViewport,
    getPreviewPresetData: () => options.getWallBrush().presetData,
    applyPreviewMaterials: (group, presetData) => options.applyWallPreviewMaterials?.(group, presetData ?? null),
    resolveWallPreviewRenderData: options.resolveWallPreviewRenderData,
    syncExactWallPreview: options.syncExactWallPreview,
    disposeExactWallPreview: options.disposeExactWallPreview,
  })

  const groundPointerHelper = new THREE.Vector3()

  const raycastPlacementPoint = (event: PointerEvent, result: THREE.Vector3): boolean => {
    if (options.resolveBuildPlacementPoint) {
      return options.resolveBuildPlacementPoint(event, result)
    }
    return options.raycastGroundPoint(event, result)
  }

  let session: WallBuildToolSession | null = null

  const getShape = (): WallBuildShape => options.wallBuildShape.value ?? 'line'

  const getRegularPolygonSides = (): number => {
    const raw = options.wallRegularPolygonSides?.value ?? 0
    if (!Number.isFinite(raw)) {
      return 0
    }
    const rounded = Math.round(raw)
    const clamped = Math.min(256, Math.max(0, rounded))
    return clamped >= 3 ? clamped : 0
  }

  const ensureSession = (): WallBuildToolSession => {
    if (session) {
      return session
    }
    session = {
      dragStart: null,
      dragEnd: null,
      segments: [],
      previewGroup: null,
      nodeId: null,
      dimensions: options.normalizeWallDimensionsForViewport({}),
      bodyAssetId: null,
      brushPresetAssetId: null,
      brushPresetData: null,
      lockedSegmentY: null,
      committedNewSegmentCount: 0,
      branchFrom: null,
      shapeDraft: null,
      polygonPoints: [],
      polygonPreviewEnd: null,
      wallRenderProps: null,
    }
    return session
  }

  const clearSession = (disposePreview = true) => {
    if (disposePreview) {
      previewRenderer.clear(session)
    } else if (session?.previewGroup) {
      session.previewGroup.removeFromParent()
    }
    options.clearVertexSnap?.()
    session = null
    previewRenderer.reset()
  }

  const expandWallSegmentsToWorld = (node: SceneNode): WallPreviewSegment[] => {
    if (node.dynamicMesh?.type !== 'Wall') {
      return []
    }
    const origin = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
    const compiled = compileWallSegmentsFromDefinition(node.dynamicMesh as WallDynamicMesh)
    return compiled.map((segment) => ({
      start: new THREE.Vector3(segment.start.x + origin.x, segment.start.y + origin.y, segment.start.z + origin.z),
      end: new THREE.Vector3(segment.end.x + origin.x, segment.end.y + origin.y, segment.end.z + origin.z),
    }))
  }

  const getWallNodeDimensions = (node: SceneNode): { height: number; width: number; thickness: number } => {
    if (node.dynamicMesh?.type !== 'Wall') {
      return options.normalizeWallDimensionsForViewport({})
    }
    const dims = (node.dynamicMesh as WallDynamicMesh).dimensions
    return options.normalizeWallDimensionsForViewport({
      height: dims?.height,
      width: dims?.width,
      thickness: dims?.thickness,
    })
  }

  const getWallNodeRenderProps = (node: SceneNode): Partial<WallComponentProps> | null => {
    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined
    return wallComponent?.props ?? null
  }

  const getExplicitWallEditNode = (): SceneNode | null => {
    const nodeId = options.getWallEditNodeId()
    if (!nodeId) {
      return null
    }
    const node = findSceneNode(options.sceneStore.nodes, nodeId)
    return node?.dynamicMesh?.type === 'Wall' ? node : null
  }

  const applyWallPropsToSession = (
    target: WallBuildToolSession,
    wallProps: Partial<WallComponentProps> | WallComponentProps | null,
  ) => {
    target.wallRenderProps = wallProps
    if (!wallProps) {
      return
    }
    target.dimensions = options.normalizeWallDimensionsForViewport({
      height: wallProps.height,
      width: wallProps.width,
      thickness: wallProps.thickness,
    })
    target.bodyAssetId = wallProps.bodyAssetId ?? null
  }

  const syncBrushPresetToSession = (target: WallBuildToolSession, applyToCommittedNode = true) => {
    if (target.branchFrom) {
      return
    }

    const brush = options.getWallBrush()
    const presetAssetId = typeof brush?.presetAssetId === 'string' && brush.presetAssetId.trim().length
      ? brush.presetAssetId.trim()
      : null
    const presetData = brush?.presetData ?? null

    if (presetAssetId) {
      target.brushPresetAssetId = presetAssetId
      target.brushPresetData = presetData

      if (presetData) {
        applyWallPropsToSession(target, presetData.wallProps)
      }

      if (applyToCommittedNode && target.nodeId) {
        void options.sceneStore
          .applyWallPresetToNode(target.nodeId, presetAssetId, presetData)
          .catch((error: unknown) => {
            console.warn('Failed to sync active wall preset brush', presetAssetId, error)
          })
      }

      if (presetData) {
        return
      }

      target.dimensions = options.normalizeWallDimensionsForViewport(target.dimensions)
      return
    }

    target.brushPresetAssetId = null
    target.brushPresetData = null

    if (target.nodeId) {
      const node = findSceneNode(options.sceneStore.nodes, target.nodeId)
      if (node?.dynamicMesh?.type === 'Wall') {
        target.dimensions = getWallNodeDimensions(node)
        target.segments = expandWallSegmentsToWorld(node)
        applyWallPropsToSession(target, getWallNodeRenderProps(node))
        return
      }
    }

    if (!target.dragStart && !target.shapeDraft && target.segments.length === 0) {
      const selectedNode = getExplicitWallEditNode()
      if (selectedNode) {
        target.dimensions = getWallNodeDimensions(selectedNode)
        applyWallPropsToSession(target, getWallNodeRenderProps(selectedNode))
        return
      }
      applyWallPropsToSession(target, null)
      target.bodyAssetId = null
      target.dimensions = options.normalizeWallDimensionsForViewport(target.dimensions)
    }
  }

  const constrainWallEndPoint = (start: THREE.Vector3, target: THREE.Vector3, rawTarget?: THREE.Vector3): THREE.Vector3 => {
    // Keep legacy behavior of returning the start point when the movement doesn't cross a grid cell.
    const delta = target.clone().sub(start)
    const stepX = Math.round(delta.x / GRID_MAJOR_SPACING)
    const stepZ = Math.round(delta.z / GRID_MAJOR_SPACING)
    if (stepX === 0 && stepZ === 0) {
      return start.clone()
    }
    return constrainWallEndPointSoftSnap(start, target, rawTarget)
  }

  const constrainWallEndPointWithoutAngle = (start: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 => {
    const delta = target.clone().sub(start)
    const stepX = Math.round(delta.x / GRID_MAJOR_SPACING)
    const stepZ = Math.round(delta.z / GRID_MAJOR_SPACING)
    if (stepX === 0 && stepZ === 0) {
      return start.clone()
    }
    return target.clone()
  }

  const getActiveSnapExcludeNodeId = (): string | null => session?.nodeId ?? options.getWallEditNodeId()

  const snapPlacementPoint = (
    event: PointerEvent,
    point: THREE.Vector3,
    optionsOverride?: {
      fallback?: 'grid' | 'raw'
      excludeNodeIds?: readonly string[]
      keepSourceY?: boolean
      allowVertexSnap?: boolean
    },
  ): THREE.Vector3 => {
    const shiftConstraintActive = Boolean(event.shiftKey && WALL_ANGLE_STEP_CONSTRAINTS_ENABLED)
    const fallbackMode = optionsOverride?.fallback ?? (shiftConstraintActive ? 'grid' : 'raw')
    const shouldUseVertexSnap = optionsOverride?.allowVertexSnap ?? event.shiftKey
    if (!shouldUseVertexSnap) {
      options.clearVertexSnap?.()
    }
    const snapped = shouldUseVertexSnap
      ? (options.resolveVertexSnapPoint?.(event, point, {
          excludeNodeIds: optionsOverride?.excludeNodeIds,
          keepSourceY: optionsOverride?.keepSourceY,
        }) ?? (fallbackMode === 'raw' ? point.clone() : options.snapPoint(point.clone())))
      : (fallbackMode === 'raw' ? point.clone() : options.snapPoint(point.clone()))
    snapped.y = point.y
    return snapped
  }

  const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && isFinite(value)

  const resetPolygonDraft = (target: WallBuildToolSession) => {
    target.polygonPoints = []
    target.polygonPreviewEnd = null
    target.segments = []
  }

  const alignPointYToPolygonDraft = (point: THREE.Vector3, target: WallBuildToolSession): THREE.Vector3 => {
    const baseY = target.polygonPoints[0]?.y
    if (isFiniteNumber(baseY)) {
      point.y = baseY
    }
    return point
  }

  const syncPolygonPreviewSegments = (target: WallBuildToolSession) => {
    const nextSegments: WallPreviewSegment[] = []

    for (let index = 0; index < target.polygonPoints.length - 1; index += 1) {
      const start = target.polygonPoints[index]
      const end = target.polygonPoints[index + 1]
      if (!start || !end || start.distanceToSquared(end) <= 1e-6) {
        continue
      }
      nextSegments.push({ start: start.clone(), end: end.clone() })
    }

    const previewEnd = target.polygonPreviewEnd
    const lastPoint = target.polygonPoints[target.polygonPoints.length - 1]
    const firstPoint = target.polygonPoints[0]

    if (lastPoint && previewEnd && lastPoint.distanceToSquared(previewEnd) > 1e-6) {
      nextSegments.push({ start: lastPoint.clone(), end: previewEnd.clone() })

      if (
        firstPoint
        && target.polygonPoints.length >= 2
        && previewEnd.distanceToSquared(firstPoint) > 1e-6
      ) {
        nextSegments.push({ start: previewEnd.clone(), end: firstPoint.clone() })
      }
    }

    target.segments = nextSegments
    previewRenderer.markDirty()
  }

  const resolveLockedSegmentY = (target: WallBuildToolSession, fallbackY: number): number => {
    if (isFiniteNumber(target.lockedSegmentY)) {
      return target.lockedSegmentY
    }

    const dragY = target.dragStart?.y
    if (isFiniteNumber(dragY)) {
      target.lockedSegmentY = dragY
      return dragY
    }

    const segmentY = target.segments[0]?.start?.y
    if (isFiniteNumber(segmentY)) {
      target.lockedSegmentY = segmentY
      return segmentY
    }

    target.lockedSegmentY = isFiniteNumber(fallbackY) ? fallbackY : 0
    return target.lockedSegmentY
  }

  const alignPointYToLineDraft = (point: THREE.Vector3, target: WallBuildToolSession): THREE.Vector3 => {
    point.y = resolveLockedSegmentY(target, point.y)
    return point
  }

  const buildClosedPolygonSegments = (points: THREE.Vector3[]): WallPreviewSegment[] => {
    if (points.length < 3) {
      return []
    }

    const segments: WallPreviewSegment[] = []
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]
      const end = points[(index + 1) % points.length]
      if (!start || !end || start.distanceToSquared(end) <= 1e-6) {
        continue
      }
      segments.push({ start: start.clone(), end: end.clone() })
    }
    return segments
  }

  const WALL_SAME_NODE_ENDPOINT_SNAP_DISTANCE = GRID_MAJOR_SPACING * 0.35
  const WALL_SAME_NODE_ENDPOINT_SNAP_DISTANCE_SQ = WALL_SAME_NODE_ENDPOINT_SNAP_DISTANCE * WALL_SAME_NODE_ENDPOINT_SNAP_DISTANCE

  const snapToSameNodeChainEndpointIfClose = (point: THREE.Vector3): THREE.Vector3 => {
    if (!session?.nodeId) {
      return point
    }
    if (!Array.isArray(session.segments) || session.segments.length < 2) {
      return point
    }

    const chains = splitWallSegmentsIntoChains(session.segments as any[])
    if (!chains.length) {
      return point
    }

    // If we started from a specific chain endpoint, prefer snapping to *other* chains.
    const excludeChain = session.branchFrom && session.branchFrom.nodeId === session.nodeId
      ? { startIndex: session.branchFrom.chainStartIndex, endIndex: session.branchFrom.chainEndIndex }
      : null

    let best: THREE.Vector3 | null = null
    let bestDistSq = Number.POSITIVE_INFINITY

    for (const chain of chains) {
      if (excludeChain && chain.startIndex === excludeChain.startIndex && chain.endIndex === excludeChain.endIndex) {
        continue
      }

      const startSeg = session.segments[chain.startIndex]
      const endSeg = session.segments[chain.endIndex]
      if (!startSeg || !endSeg) {
        continue
      }

      const candidates = [startSeg.start, endSeg.end]
      for (const candidate of candidates) {
        if (!candidate) {
          continue
        }
        const distSq = distanceSqXZ(point.x, point.z, candidate.x, candidate.z)
        if (distSq <= WALL_SAME_NODE_ENDPOINT_SNAP_DISTANCE_SQ && distSq < bestDistSq) {
          bestDistSq = distSq
          best = candidate.clone()
        }
      }
    }

    if (!best) {
      return point
    }

    return best
  }

  const shouldConstrainWallAngleForActiveSegment = (): boolean => {
    if (!session) {
      return true
    }
    if (session.branchFrom) {
      return true
    }
    if (session.committedNewSegmentCount > 0) {
      return true
    }
    const hasExistingGeometry = Boolean(session.nodeId) || session.segments.length > 0
    return hasExistingGeometry
  }

  const constrainWallEndPointForBuild = (
    start: THREE.Vector3,
    target: THREE.Vector3,
    rawTarget: THREE.Vector3 | undefined,
    constrainActive: boolean,
  ): THREE.Vector3 => {
    if (!constrainActive) {
      return target.clone()
    }
    const shouldConstrainAngle = shouldConstrainWallAngleForActiveSegment()
    const base = shouldConstrainAngle
      ? constrainWallEndPoint(start, target, rawTarget)
      : constrainWallEndPointWithoutAngle(start, target)
    if (base.equals(start)) {
      return base
    }
    return snapToSameNodeChainEndpointIfClose(base)
  }

  const hydrateFromSelection = (target: WallBuildToolSession) => {
    const isFreshSession = !target.nodeId && target.segments.length === 0
    if (isFreshSession) {
      const brush = options.getWallBrush()
      const presetAssetId = typeof brush?.presetAssetId === 'string' && brush.presetAssetId.trim().length
        ? brush.presetAssetId.trim()
        : null
      const hasActiveBrushPreset = Boolean(presetAssetId)

      if (hasActiveBrushPreset) {
        syncBrushPresetToSession(target, false)
      } else {
        const selectedNode = getExplicitWallEditNode()
        target.wallRenderProps = null
        if (selectedNode) {
          const wallComponent = selectedNode.components?.[WALL_COMPONENT_TYPE] as
            | SceneNodeComponentState<WallComponentProps>
            | undefined
          target.dimensions = getWallNodeDimensions(selectedNode)
          target.bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
          applyWallPropsToSession(target, wallComponent?.props ?? null)
        }

        target.brushPresetAssetId = null
        target.brushPresetData = null
      }

      target.dimensions = options.normalizeWallDimensionsForViewport(target.dimensions)
      return
    }

    if (!target.nodeId) {
      const selectedNode = getExplicitWallEditNode()
      if (selectedNode) {
        target.nodeId = selectedNode.id
        target.dimensions = getWallNodeDimensions(selectedNode)
        target.segments = expandWallSegmentsToWorld(selectedNode)
        applyWallPropsToSession(target, getWallNodeRenderProps(selectedNode))
      }
    } else {
      const node = findSceneNode(options.sceneStore.nodes, target.nodeId)
      if (node?.dynamicMesh?.type === 'Wall') {
        target.dimensions = getWallNodeDimensions(node)
        target.segments = expandWallSegmentsToWorld(node)
        applyWallPropsToSession(target, getWallNodeRenderProps(node))
      }
    }

    target.dimensions = options.normalizeWallDimensionsForViewport(target.dimensions)
  }

  const beginSegmentDrag = (startPoint: THREE.Vector3) => {
    const current = ensureSession()
    hydrateFromSelection(current)
    alignPointYToLineDraft(startPoint, current)
    resetPolygonDraft(current)
    current.shapeDraft = null
    current.dragStart = startPoint.clone()
    current.dragEnd = startPoint.clone()
    previewRenderer.markDirty()
  }

  const cancelShapeDraft = () => {
    if (!session) {
      return
    }
    if (!session.shapeDraft) {
      return
    }
    session.shapeDraft = null
    session.segments = []
    previewRenderer.markDirty()
  }

  const beginShapeDraft = (kind: Exclude<WallBuildShape, 'polygon' | 'line'>, event: PointerEvent): boolean => {
    if (session?.shapeDraft) {
      return false
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }

    const rawPointer = groundPointerHelper.clone()
    const excludeNodeId = getActiveSnapExcludeNodeId()
    const start = snapPlacementPoint(event, rawPointer.clone(), {
      excludeNodeIds: excludeNodeId ? [excludeNodeId] : undefined,
    })
    const end = kind === 'circle' ? rawPointer.clone() : start.clone()

    const current = ensureSession()
    hydrateFromSelection(current)
    resetPolygonDraft(current)
    current.dragStart = null
    current.dragEnd = null
    current.nodeId = null
    current.lockedSegmentY = null
    current.committedNewSegmentCount = 0
    current.shapeDraft = {
      kind,
      pointerId: event.pointerId,
      start: start.clone(),
      end: end.clone(),
    }
    current.segments = []
    previewRenderer.markDirty()
    return true
  }

  const computeAdaptiveCircleSegments = (radius: number): number => {
    if (!isFiniteNumber(radius) || radius <= 0) {
      return 0
    }
    const targetSegmentLength = GRID_MAJOR_SPACING * 0.5
    const perimeter = 2 * Math.PI * radius
    const estimate = Math.ceil(perimeter / Math.max(targetSegmentLength, 1e-4))
    return Math.min(256, Math.max(12, estimate))
  }

  const buildRectangleSegments = (start: THREE.Vector3, end: THREE.Vector3): WallPreviewSegment[] => {
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minZ = Math.min(start.z, end.z)
    const maxZ = Math.max(start.z, end.z)
    const y = start.y
    if (Math.abs(maxX - minX) < 1e-4 || Math.abs(maxZ - minZ) < 1e-4) {
      return []
    }
    const p1 = new THREE.Vector3(minX, y, minZ)
    const p2 = new THREE.Vector3(maxX, y, minZ)
    const p3 = new THREE.Vector3(maxX, y, maxZ)
    const p4 = new THREE.Vector3(minX, y, maxZ)
    return [
      { start: p1, end: p2 },
      { start: p2, end: p3 },
      { start: p3, end: p4 },
      { start: p4, end: p1 },
    ]
  }

  const buildCircleSegments = (
    center: THREE.Vector3,
    radiusEnd: THREE.Vector3,
    requestedSides = 0,
  ): WallPreviewSegment[] => {
    const dx = radiusEnd.x - center.x
    const dz = radiusEnd.z - center.z
    const radius = Math.sqrt(dx * dx + dz * dz)
    if (!isFiniteNumber(radius) || radius < 1e-4) {
      return []
    }

    const segments = requestedSides >= 3 ? requestedSides : computeAdaptiveCircleSegments(radius)
    if (segments < 3) {
      return []
    }

    const points: THREE.Vector3[] = []
    for (let i = 0; i < segments; i += 1) {
      const t = (i / segments) * Math.PI * 2
      points.push(new THREE.Vector3(center.x + Math.cos(t) * radius, center.y, center.z + Math.sin(t) * radius))
    }

    const result: WallPreviewSegment[] = []
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      result.push({ start: a, end: b })
    }
    return result
  }

  const updateShapeDraft = (event: PointerEvent): boolean => {
    if (!session?.shapeDraft) {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }
    if (session.shapeDraft.pointerId !== event.pointerId) {
      return false
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }

    const rawPointer = groundPointerHelper.clone()
    const kind = session.shapeDraft.kind
    const start = session.shapeDraft.start.clone()
    const excludeNodeId = getActiveSnapExcludeNodeId()
    const end = kind === 'circle'
      ? snapPlacementPoint(event, rawPointer.clone(), { fallback: 'raw' })
      : snapPlacementPoint(event, rawPointer.clone(), {
          excludeNodeIds: excludeNodeId ? [excludeNodeId] : undefined,
        })

    const previousEnd = session.shapeDraft.end
    if (previousEnd.equals(end)) {
      return false
    }
    session.shapeDraft.end.copy(end)

    const regularPolygonSides = kind === 'circle' ? getRegularPolygonSides() : 0

    session.segments = kind === 'rectangle'
      ? buildRectangleSegments(start, end)
      : buildCircleSegments(start, end, regularPolygonSides)

    previewRenderer.markDirty()
    return true
  }

  const commitShapeDraft = (): boolean => {
    if (!session?.shapeDraft) {
      return false
    }

    const kind = session.shapeDraft.kind
    const start = session.shapeDraft.start.clone()
    const end = kind === 'circle'
      ? session.shapeDraft.end.clone()
      : session.shapeDraft.end.clone()

    const regularPolygonSides = kind === 'circle' ? getRegularPolygonSides() : 0

    const segments = kind === 'rectangle'
      ? buildRectangleSegments(start, end)
      : buildCircleSegments(start, end, regularPolygonSides)

    if (!segments.length) {
      cancelShapeDraft()
      clearSession(true)
      return false
    }

    const segmentPayload = segments.map((entry) => ({
      start: entry.start.clone(),
      end: entry.end.clone(),
    }))

    const shouldApplyBrushPreset = !!session.brushPresetAssetId

    const created = options.sceneStore.createWallNode({
      segments: segmentPayload,
      dimensions: session.dimensions,
      closed: true,
      bodyAssetId: session.bodyAssetId,
      wallComponentProps: session.wallRenderProps,
      wallPresetData: session.brushPresetData,
    })
    if (!created) {
      cancelShapeDraft()
      clearSession(true)
      return false
    }

    options.sceneStore.updateNodeUserData(created.id, mergeUserDataWithDynamicMeshBuildShape(created.userData, kind))

    if (shouldApplyBrushPreset && session.brushPresetAssetId) {
      void options.sceneStore
        .applyWallPresetToNode(created.id, session.brushPresetAssetId, session.brushPresetData)
        .catch((error: unknown) => {
          console.warn('Failed to apply wall preset brush', session?.brushPresetAssetId, error)
        })
    }

    clearSession(true)
    return true
  }

  const cancelDrag = () => {
    if (!session) {
      return
    }
    session.dragStart = null
    session.dragEnd = null
    previewRenderer.markDirty()
  }

  const commitLineSegmentDrag = (): boolean => {
    if (!session || !session.dragStart || !session.dragEnd) {
      return false
    }

    const startedFromBranch = Boolean(session.branchFrom)

    const start = session.dragStart.clone()
    const end = session.dragEnd.clone()
    if (start.distanceToSquared(end) < 1e-6) {
      cancelDrag()
      return false
    }

    const segment: WallPreviewSegment = { start, end }
    const currentSession = session
    const liveBaseSegments = currentSession.nodeId
      ? (() => {
          const liveNode = findSceneNode(options.sceneStore.nodes, currentSession.nodeId)
          return liveNode?.dynamicMesh?.type === 'Wall'
            ? expandWallSegmentsToWorld(liveNode)
            : currentSession.segments
        })()
      : []
    const pendingSegments = currentSession.nodeId ? [...liveBaseSegments, segment] : [segment]

    const segmentPayload = pendingSegments.map((entry) => ({
      start: entry.start.clone(),
      end: entry.end.clone(),
    }))

    let nodeId = session.nodeId
    let continuationAnchor = end.clone()
    const shouldApplyBrushPreset = !nodeId && !!session.brushPresetAssetId
    if (!nodeId) {
      const created = options.sceneStore.createWallNode({
        segments: segmentPayload,
        dimensions: session.dimensions,
        bodyAssetId: session.bodyAssetId,
        wallComponentProps: session.wallRenderProps,
        wallPresetData: session.brushPresetData,
      })
      if (!created) {
        clearSession(true)
        return false
      }

      options.sceneStore.updateNodeUserData(created.id, mergeUserDataWithDynamicMeshBuildShape(created.userData, 'line'))

      const createdNodeId = created.id
      nodeId = createdNodeId
      session.nodeId = createdNodeId
      const createdLive = findSceneNode(options.sceneStore.nodes, createdNodeId)
      session.segments = createdLive?.dynamicMesh?.type === 'Wall'
        ? expandWallSegmentsToWorld(createdLive)
        : expandWallSegmentsToWorld(created)
      const createdTail = session.segments[session.segments.length - 1]?.end
      if (createdTail) {
        continuationAnchor = createdTail.clone()
      }
      session.dimensions = createdLive?.dynamicMesh?.type === 'Wall'
        ? getWallNodeDimensions(createdLive)
        : getWallNodeDimensions(created)

      if (shouldApplyBrushPreset && session.brushPresetAssetId) {
        void options.sceneStore
          .applyWallPresetToNode(nodeId, session.brushPresetAssetId, session.brushPresetData)
          .catch((error: unknown) => {
            console.warn('Failed to apply wall preset brush', session?.brushPresetAssetId, error)
          })
      }
    } else {
      const updated = options.sceneStore.updateWallNodeGeometry(nodeId, {
        segments: segmentPayload,
        dimensions: session.dimensions,
      })
      if (!updated) {
        cancelDrag()
        return false
      }
      session.segments = pendingSegments
      const refreshed = findSceneNode(options.sceneStore.nodes, nodeId)
      if (refreshed?.dynamicMesh?.type === 'Wall') {
        session.segments = expandWallSegmentsToWorld(refreshed)
        const refreshedTail = session.segments[session.segments.length - 1]?.end
        if (refreshedTail) {
          continuationAnchor = refreshedTail.clone()
        }
        session.dimensions = getWallNodeDimensions(refreshed)
        options.sceneStore.updateNodeUserData(
          nodeId,
          mergeUserDataWithDynamicMeshBuildShape(refreshed.userData, 'line'),
        )
      }
    }

    if (startedFromBranch) {
      session.branchFrom = null
    }
    session.lockedSegmentY = isFiniteNumber(continuationAnchor.y) ? continuationAnchor.y : session.lockedSegmentY
    session.dragStart = continuationAnchor.clone()
    session.dragEnd = continuationAnchor.clone()
    session.committedNewSegmentCount += 1
    session.dimensions = options.normalizeWallDimensionsForViewport(session.dimensions)
    previewRenderer.markDirty()
    return true
  }

  const handleLinePlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'wall') {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }

    const rawPointer = groundPointerHelper.clone()
    const current = ensureSession()
    const excludeNodeId = current.nodeId ?? options.getWallEditNodeId()
    const snappedPoint = alignPointYToLineDraft(snapPlacementPoint(event, rawPointer.clone(), {
      fallback: event.shiftKey ? 'grid' : 'raw',
      excludeNodeIds: excludeNodeId ? [excludeNodeId] : undefined,
      allowVertexSnap: event.shiftKey,
    }), current)
    if (!current.dragStart) {
      beginSegmentDrag(snappedPoint)
      return true
    }

    const constrained = constrainWallEndPointForBuild(
      current.dragStart,
      snappedPoint,
      rawPointer,
      Boolean(event.shiftKey && WALL_ANGLE_STEP_CONSTRAINTS_ENABLED),
    )
    constrained.y = resolveLockedSegmentY(current, current.dragStart.y)
    const previous = current.dragEnd
    if (!previous || !previous.equals(constrained)) {
      current.dragEnd = constrained
      previewRenderer.markDirty()
    }

    const committed = commitLineSegmentDrag()
    if (!committed) {
      current.dragStart = constrained.clone()
      current.dragEnd = constrained.clone()
      previewRenderer.markDirty()
    }

    return true
  }

  const handlePolygonPlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'wall') {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }

    const current = ensureSession()
    if (!current.polygonPoints.length) {
      hydrateFromSelection(current)
    }

    current.dragStart = null
    current.dragEnd = null
    current.shapeDraft = null
    current.nodeId = null
    current.committedNewSegmentCount = 0

    const excludeNodeId = current.nodeId ?? options.getWallEditNodeId()
    const point = alignPointYToPolygonDraft(snapPlacementPoint(event, groundPointerHelper.clone(), {
      excludeNodeIds: excludeNodeId ? [excludeNodeId] : undefined,
    }), current)
    const firstPoint = current.polygonPoints[0]
    const lastPoint = current.polygonPoints[current.polygonPoints.length - 1]

    if (lastPoint && lastPoint.distanceToSquared(point) <= 1e-6) {
      current.polygonPreviewEnd = point.clone()
      syncPolygonPreviewSegments(current)
      return true
    }

    if (firstPoint && current.polygonPoints.length >= 3 && firstPoint.distanceToSquared(point) <= 1e-6) {
      current.polygonPreviewEnd = firstPoint.clone()
      syncPolygonPreviewSegments(current)
      return true
    }

    current.polygonPoints.push(point.clone())
    current.polygonPreviewEnd = point.clone()
    syncPolygonPreviewSegments(current)
    return true
  }

  const updatePolygonCursorPreview = (event: PointerEvent): boolean => {
    if (!session || session.polygonPoints.length === 0) {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }

    const excludeNodeId = getActiveSnapExcludeNodeId()
    const next = alignPointYToPolygonDraft(snapPlacementPoint(event, groundPointerHelper.clone(), {
      excludeNodeIds: excludeNodeId ? [excludeNodeId] : undefined,
    }), session)
    const previous = session.polygonPreviewEnd
    if (previous && previous.equals(next)) {
      return false
    }

    session.polygonPreviewEnd = next.clone()
    syncPolygonPreviewSegments(session)
    return true
  }

  const updateSegmentDrag = (event: PointerEvent) => {
    if (options.isAltOverrideActive()) {
      return
    }
    if (!session?.dragStart) {
      return
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return
    }

    const rawPointer = groundPointerHelper.clone()
    const excludeNodeId = getActiveSnapExcludeNodeId()
    const pointer = snapPlacementPoint(event, rawPointer.clone(), {
      fallback: event.shiftKey ? 'grid' : 'raw',
      excludeNodeIds: excludeNodeId ? [excludeNodeId] : undefined,
      allowVertexSnap: event.shiftKey,
    })
    alignPointYToLineDraft(pointer, session)
    const constrained = constrainWallEndPointForBuild(
      session.dragStart,
      pointer,
      rawPointer,
      Boolean(event.shiftKey && WALL_ANGLE_STEP_CONSTRAINTS_ENABLED),
    )
    constrained.y = resolveLockedSegmentY(session, session.dragStart.y)
    const previous = session.dragEnd
    if (previous && previous.equals(constrained)) {
      return
    }
    session.dragEnd = constrained
    previewRenderer.markDirty()
  }

  const finalizePolygon = () => {
    if (!session) {
      return
    }

    const polygonPoints = session.polygonPoints
      .map((point) => point.clone())
      .filter((point) => isFiniteNumber(point.x) && isFiniteNumber(point.y) && isFiniteNumber(point.z))

    if (polygonPoints.length < 3) {
      clearSession(true)
      return
    }

    const segments = buildClosedPolygonSegments(polygonPoints)
    if (segments.length < 3) {
      clearSession(true)
      return
    }

    const segmentPayload = segments.map((entry) => ({
      start: entry.start.clone(),
      end: entry.end.clone(),
    }))

    const shouldApplyBrushPreset = !!session.brushPresetAssetId
    const created = options.sceneStore.createWallNode({
      segments: segmentPayload,
      dimensions: session.dimensions,
      closed: true,
      bodyAssetId: session.bodyAssetId,
      wallComponentProps: session.wallRenderProps,
      wallPresetData: session.brushPresetData,
    })

    if (!created) {
      clearSession(true)
      return
    }

    options.sceneStore.updateNodeUserData(created.id, mergeUserDataWithDynamicMeshBuildShape(created.userData, 'polygon'))

    if (shouldApplyBrushPreset && session.brushPresetAssetId) {
      void options.sceneStore
        .applyWallPresetToNode(created.id, session.brushPresetAssetId, session.brushPresetData)
        .catch((error: unknown) => {
          console.warn('Failed to apply wall preset brush', session?.brushPresetAssetId, error)
        })
    }

    clearSession(true)
  }

  return {
    getSession: () => session,

    syncBrushPreset: () => {
      if (!session) {
        return
      }
      syncBrushPresetToSession(session)
      previewRenderer.markDirty()
    },

    flushPreviewIfNeeded: (scene: THREE.Scene | null) => {
      previewRenderer.flushIfNeeded(scene, session)
    },

    flushPreview: (scene: THREE.Scene | null) => {
      previewRenderer.flush(scene, session)
    },

    handlePointerDown: (_event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }
      const shape = getShape()
      if (shape !== 'line' && shape !== 'polygon') {
        const event = _event
        if (event.button === 0 && !options.isAltOverrideActive()) {
          beginShapeDraft(shape, event)
        }
      }
      return false
    },

    handlePointerMove: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }

      if (session?.shapeDraft) {
        const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
        if (!isCameraNavActive) {
          updateShapeDraft(event)
          return true
        }
        return false
      }

      if (session?.dragStart) {
        const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
        if (!isCameraNavActive) {
          updateSegmentDrag(event)
          return true
        }
      }

      if (session?.polygonPoints.length) {
        const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
        if (!isCameraNavActive) {
          return updatePolygonCursorPreview(event)
        }
      }

      return false
    },

    handlePointerUp: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }

      if (event.button === 0) {
        if (options.isAltOverrideActive()) {
          return false
        }
        const shape = getShape()
        const handled = shape === 'line'
          ? handleLinePlacementClick(event)
          : shape === 'polygon'
          ? handlePolygonPlacementClick(event)
          : (() => {
            const hadDraft = Boolean(session?.shapeDraft)
            if (hadDraft) {
              commitShapeDraft()
              return true
            }
            return false
          })()
        if (handled) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
        }
        return handled
      }

      if (event.button === 2) {
        if (options.isAltOverrideActive()) {
          return false
        }
        const active = options.pointerInteraction.get()
        if (active?.kind === 'buildToolRightClick' && active.pointerId === event.pointerId) {
          const clickWasDrag = active.moved || options.pointerInteraction.ensureMoved(event)
          if (!clickWasDrag && session) {
            const shape = getShape()
            if (shape === 'polygon') {
              finalizePolygon()
            } else if (shape === 'line') {
              clearSession(true)
            } else if (session.shapeDraft) {
              cancelShapeDraft()
              clearSession(true)
            }
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation()
          }
          // Treat both click and drag as handled so the right-button release does not
          // fall through to selection tools.
          return true
        }
        return false
      }

      return false
    },

    handlePointerCancel: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }
      if (!session) {
        return false
      }
      options.clearVertexSnap?.()
      cancelShapeDraft()
      cancelDrag()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return true
    },

    cancel: () => {
      if (!session) {
        options.clearVertexSnap?.()
        return false
      }
      cancelShapeDraft()
      cancelDrag()
      clearSession(true)
      return true
    },

    beginBranchFromEndpoint: ({ nodeId, chainStartIndex, chainEndIndex, endpointKind, worldPoint }) => {
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }
      if (getShape() !== 'line') {
        return false
      }

      const node = findSceneNode(options.sceneStore.nodes, nodeId)
      if (!node || node.dynamicMesh?.type !== 'Wall') {
        return false
      }

      const current = ensureSession()
      hydrateFromSelection(current)

      current.nodeId = nodeId
      current.dimensions = getWallNodeDimensions(node)
      current.segments = expandWallSegmentsToWorld(node)
      current.wallRenderProps = getWallNodeRenderProps(node)
      current.dragStart = worldPoint.clone()
      current.dragEnd = worldPoint.clone()
      current.lockedSegmentY = isFiniteNumber(worldPoint.y) ? worldPoint.y : 0
      current.committedNewSegmentCount = 0
      current.shapeDraft = null
      current.polygonPoints = []
      current.polygonPreviewEnd = null

      // When branching from an existing wall, never apply brush presets.
      current.brushPresetAssetId = null
      current.brushPresetData = null

      current.branchFrom = {
        nodeId,
        chainStartIndex: Math.max(0, Math.trunc(chainStartIndex)),
        chainEndIndex: Math.max(0, Math.trunc(chainEndIndex)),
        endpointKind: endpointKind === 'end' ? 'end' : 'start',
      }

      previewRenderer.markDirty()
      return true
    },

    dispose: () => {
      options.clearVertexSnap?.()
      previewRenderer.dispose(session)
      clearSession(false)
    },
  }
}
