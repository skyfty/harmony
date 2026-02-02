import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { PointerInteractionSession } from '@/types/pointer-interaction'
import type { SceneNodeComponentState, SceneNode } from '@harmony/schema'
import { WALL_COMPONENT_TYPE, type WallComponentProps } from '@schema/components'
import { createWallPreviewRenderer, type WallPreviewSession, type WallPreviewSegment } from './WallPreviewRenderer'
import { GRID_MAJOR_SPACING } from './constants'
import { findSceneNode } from './sceneUtils'
import { constrainWallEndPointSoftSnap } from './wallEndpointSnap'
import { distanceSqXZ, splitWallSegmentsIntoChains } from './wallSegmentUtils'
import type { useSceneStore } from '@/stores/sceneStore'
import type { WallPresetData } from '@/utils/wallPreset'
import type { WallBuildShape } from '@/types/wall-build-shape'

type PointerInteractionApi = {
  get: () => PointerInteractionSession | null
  ensureMoved: (event: PointerEvent) => boolean
}

export type WallBuildToolHandle = {
  getSession: () => WallBuildToolSession | null
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
  branchFrom: {
    nodeId: string
    chainStartIndex: number
    chainEndIndex: number
    endpointKind: 'start' | 'end'
  } | null
  shapeDraft: {
    kind: Exclude<WallBuildShape, 'polygon'>
    pointerId: number
    start: THREE.Vector3
    end: THREE.Vector3
  } | null
}

export function createWallBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  wallBuildShape: Ref<WallBuildShape>
  sceneStore: ReturnType<typeof useSceneStore>
  pointerInteraction: PointerInteractionApi
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  isAltOverrideActive: () => boolean
  getWallBrush: () => { presetAssetId: string | null; presetData: WallPresetData | null }
  normalizeWallDimensionsForViewport: (values: {
    height?: number
    width?: number
    thickness?: number
  }) => { height: number; width: number; thickness: number }
}) : WallBuildToolHandle {
  const previewRenderer = createWallPreviewRenderer({
    rootGroup: options.rootGroup,
    normalizeWallDimensionsForViewport: options.normalizeWallDimensionsForViewport,
  })

  const groundPointerHelper = new THREE.Vector3()

  let session: WallBuildToolSession | null = null

  const getShape = (): WallBuildShape => options.wallBuildShape.value ?? 'polygon'

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
      branchFrom: null,
      shapeDraft: null,
    }
    return session
  }

  const clearSession = (disposePreview = true) => {
    if (disposePreview) {
      previewRenderer.clear(session)
    } else if (session?.previewGroup) {
      session.previewGroup.removeFromParent()
    }
    session = null
    previewRenderer.reset()
  }

  const expandWallSegmentsToWorld = (node: SceneNode): WallPreviewSegment[] => {
    if (node.dynamicMesh?.type !== 'Wall') {
      return []
    }
    const origin = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
    return node.dynamicMesh.segments.map((segment) => ({
      start: new THREE.Vector3(segment.start.x + origin.x, segment.start.y + origin.y, segment.start.z + origin.z),
      end: new THREE.Vector3(segment.end.x + origin.x, segment.end.y + origin.y, segment.end.z + origin.z),
    }))
  }

  const getWallNodeDimensions = (node: SceneNode): { height: number; width: number; thickness: number } => {
    if (node.dynamicMesh?.type !== 'Wall' || node.dynamicMesh.segments.length === 0) {
      return options.normalizeWallDimensionsForViewport({})
    }
    const sample = node.dynamicMesh.segments[0]!
    return options.normalizeWallDimensionsForViewport({
      height: sample.height,
      width: sample.width,
      thickness: sample.thickness,
    })
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

  const constrainWallEndPointForBuild = (start: THREE.Vector3, target: THREE.Vector3, rawTarget?: THREE.Vector3): THREE.Vector3 => {
    const base = constrainWallEndPoint(start, target, rawTarget)
    if (base.equals(start)) {
      return base
    }
    return snapToSameNodeChainEndpointIfClose(base)
  }

  const hydrateFromSelection = (target: WallBuildToolSession) => {
    const isFreshSession = !target.nodeId && target.segments.length === 0
    if (isFreshSession) {
      let hydrated = false
      const selectedId = options.sceneStore.selectedNodeId
      if (selectedId) {
        const selectedNode = findSceneNode(options.sceneStore.nodes, selectedId)
        if (selectedNode?.dynamicMesh?.type === 'Wall') {
          target.dimensions = getWallNodeDimensions(selectedNode)
          const wallComponent = selectedNode.components?.[WALL_COMPONENT_TYPE] as
            | SceneNodeComponentState<WallComponentProps>
            | undefined
          target.bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
          target.brushPresetAssetId = null
          target.brushPresetData = null
          hydrated = true
        }
      }

      if (!hydrated) {
        const brush = options.getWallBrush()
        const presetAssetId = typeof brush?.presetAssetId === 'string' && brush.presetAssetId.trim().length
          ? brush.presetAssetId.trim()
          : null
        target.brushPresetAssetId = presetAssetId
        target.brushPresetData = brush?.presetData ?? null

        const wallProps = brush?.presetData?.wallProps ?? null
        if (wallProps) {
          target.dimensions = options.normalizeWallDimensionsForViewport({
            height: wallProps.height,
            width: wallProps.width,
            thickness: wallProps.thickness,
          })
          target.bodyAssetId = wallProps.bodyAssetId ?? null
        }
      }

      target.dimensions = options.normalizeWallDimensionsForViewport(target.dimensions)
      return
    }

    if (!target.nodeId) {
      const selectedId = options.sceneStore.selectedNodeId
      if (selectedId) {
        const selectedNode = findSceneNode(options.sceneStore.nodes, selectedId)
        if (selectedNode?.dynamicMesh?.type === 'Wall') {
          target.nodeId = selectedNode.id
          target.dimensions = getWallNodeDimensions(selectedNode)
          target.segments = expandWallSegmentsToWorld(selectedNode)
        }
      }
    } else {
      const node = findSceneNode(options.sceneStore.nodes, target.nodeId)
      if (node?.dynamicMesh?.type === 'Wall') {
        target.dimensions = getWallNodeDimensions(node)
        target.segments = expandWallSegmentsToWorld(node)
      }
    }

    target.dimensions = options.normalizeWallDimensionsForViewport(target.dimensions)
  }

  const beginSegmentDrag = (startPoint: THREE.Vector3) => {
    const current = ensureSession()
    hydrateFromSelection(current)
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

  const beginShapeDraft = (kind: Exclude<WallBuildShape, 'polygon'>, event: PointerEvent): boolean => {
    if (session?.shapeDraft) {
      return false
    }
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return false
    }

    const rawPointer = groundPointerHelper.clone()
    const start = options.snapPoint(rawPointer.clone())
    const end = kind === 'circle' ? rawPointer.clone() : start.clone()

    const current = ensureSession()
    hydrateFromSelection(current)
    current.dragStart = null
    current.dragEnd = null
    current.nodeId = null
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
    if (!Number.isFinite(radius) || radius <= 0) {
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

  const buildCircleSegments = (center: THREE.Vector3, radiusEnd: THREE.Vector3): WallPreviewSegment[] => {
    const dx = radiusEnd.x - center.x
    const dz = radiusEnd.z - center.z
    const radius = Math.hypot(dx, dz)
    if (!Number.isFinite(radius) || radius < 1e-4) {
      return []
    }

    const segments = computeAdaptiveCircleSegments(radius)
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
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return false
    }

    const rawPointer = groundPointerHelper.clone()
    const kind = session.shapeDraft.kind
    const start = session.shapeDraft.start.clone()
    const end = kind === 'circle' ? rawPointer.clone() : options.snapPoint(rawPointer.clone())

    const previousEnd = session.shapeDraft.end
    if (previousEnd.equals(end)) {
      return false
    }
    session.shapeDraft.end.copy(end)

    session.segments = kind === 'rectangle'
      ? buildRectangleSegments(start, end)
      : buildCircleSegments(start, end)

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
      : options.snapPoint(session.shapeDraft.end.clone())

    const segments = kind === 'rectangle'
      ? buildRectangleSegments(start, end)
      : buildCircleSegments(start, end)

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
      bodyAssetId: session.bodyAssetId,
    })
    if (!created) {
      cancelShapeDraft()
      clearSession(true)
      return false
    }

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

  const commitSegmentDrag = (): boolean => {
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
    const pendingSegments = [...session.segments, segment]

    const segmentPayload = pendingSegments.map((entry) => ({
      start: entry.start.clone(),
      end: entry.end.clone(),
    }))

    let nodeId = session.nodeId
    const shouldApplyBrushPreset = !nodeId && !!session.brushPresetAssetId
    if (!nodeId) {
      const created = options.sceneStore.createWallNode({
        segments: segmentPayload,
        dimensions: session.dimensions,
        bodyAssetId: session.bodyAssetId,
      })
      if (!created) {
        cancelDrag()
        return false
      }
      nodeId = created.id
      session.nodeId = nodeId
      session.segments = pendingSegments
      session.dimensions = getWallNodeDimensions(created)

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
        session.dimensions = getWallNodeDimensions(refreshed)
      }
    }

    session.dragStart = end.clone()
    session.dragEnd = end.clone()
    if (startedFromBranch) {
      session.branchFrom = null
    }
    session.dimensions = options.normalizeWallDimensionsForViewport(session.dimensions)
    previewRenderer.markDirty()
    return true
  }

  const handlePlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'wall') {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return false
    }

    const rawPointer = groundPointerHelper.clone()
    const snappedPoint = options.snapPoint(rawPointer.clone())

    const current = ensureSession()
    if (!current.dragStart) {
      beginSegmentDrag(snappedPoint)
      return true
    }

    const constrained = constrainWallEndPointForBuild(current.dragStart, snappedPoint, rawPointer)
    const previous = current.dragEnd
    if (!previous || !previous.equals(constrained)) {
      current.dragEnd = constrained
      previewRenderer.markDirty()
    }

    const committed = commitSegmentDrag()
    if (!committed) {
      current.dragStart = constrained.clone()
      current.dragEnd = constrained.clone()
      previewRenderer.markDirty()
    }

    return true
  }

  const updateSegmentDrag = (event: PointerEvent) => {
    if (options.isAltOverrideActive()) {
      return
    }
    if (!session?.dragStart) {
      return
    }
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return
    }

    const rawPointer = groundPointerHelper.clone()
    const pointer = options.snapPoint(rawPointer.clone())
    const constrained = constrainWallEndPointForBuild(session.dragStart, pointer, rawPointer)
    const previous = session.dragEnd
    if (previous && previous.equals(constrained)) {
      return
    }
    session.dragEnd = constrained
    previewRenderer.markDirty()
  }

  const finalize = () => {
    if (!session) {
      return
    }
    cancelDrag()
    clearSession(true)
  }

  return {
    getSession: () => session,

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
      if (shape !== 'polygon') {
        const event = _event
        if (event.button === 0 && !options.isAltOverrideActive()) {
          // Floor-like behavior: start a drag session for rectangle/circle.
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
        const handled = shape === 'polygon'
          ? handlePlacementClick(event)
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
              finalize()
              } else if (session.shapeDraft) {
                // Align with Floor: right click cancels rectangle/circle drafts.
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
      cancelShapeDraft()
      cancelDrag()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return true
    },

    cancel: () => {
      if (!session) {
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
      if (getShape() !== 'polygon') {
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
      current.dragStart = worldPoint.clone()
      current.dragEnd = worldPoint.clone()
      current.shapeDraft = null

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
      previewRenderer.dispose(session)
      clearSession(false)
    },
  }
}
