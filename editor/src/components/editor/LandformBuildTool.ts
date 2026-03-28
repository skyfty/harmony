import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { Vector3Like } from '@schema'
import { createLandformGroup, updateLandformGroup } from '@schema/landformMesh'
import {
  buildFloorCircleOrRegularPolygonPoints,
  type FloorPreviewSession as LandformPreviewSession,
} from './FloorPreviewRenderer'
import { buildRotatedRectangleFromCorner, resolveRectangleDragDirection } from './rotatedRectangleBuild'
import type { useSceneStore } from '@/stores/sceneStore'
import type { LandformBuildShape } from '@/types/landform-build-shape'
import { mergeUserDataWithDynamicMeshBuildShape } from '@/utils/dynamicMeshBuildShapeUserData'
import { snapPointToRelativeAngleStep } from './planarEditMath'

type LandformPresetData = import('@/utils/landformPreset').LandformPresetData

export type LandformBuildToolHandle = {
  getSession: () => LandformPreviewSession | null
  flushPreviewIfNeeded: (scene: THREE.Scene | null) => void
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handlePointerCancel: (event: PointerEvent) => boolean
  cancel: () => boolean
  dispose: () => void
}

type RightClickState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

type LeftDragState = {
  pointerId: number
  kind: Exclude<LandformBuildShape, 'polygon'>
}

type LeftClickState = {
  atMs: number
  clientX: number
  clientY: number
}

type VertexSnapResolverOptions = {
  excludeNodeIds?: readonly string[]
  keepSourceY?: boolean
}

const PREVIEW_SIGNATURE_PRECISION = 1000
const LANDFORM_LINE_PREVIEW_Y_OFFSET = 0.03

function createLinePreviewGroup(points: THREE.Vector3[]): THREE.Group {
  const group = new THREE.Group()
  group.name = '__LandformLinePreview'
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: 0xffb74d,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  )
  line.renderOrder = 101
  group.userData.isLandformLinePreview = true
  group.userData.line = line
  group.add(line)
  return group
}

function updateLinePreviewGroup(group: THREE.Group, points: THREE.Vector3[]): void {
  const line = group.userData.line as THREE.Line | undefined
  if (!line) {
    return
  }
  line.geometry?.dispose?.()
  line.geometry = new THREE.BufferGeometry().setFromPoints(points)
}

function disposePreviewGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    const line = child as THREE.Line
    if (!mesh?.isMesh && !line?.isLine) {
      return
    }
    ;(child as THREE.Mesh | THREE.Line).geometry?.dispose?.()
    const material = (child as THREE.Mesh | THREE.Line).material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function encodePreviewNumber(value: number): string {
  return `${Math.round(value * PREVIEW_SIGNATURE_PRECISION)}`
}

function computePreviewSignature(points: THREE.Vector3[], presetSignature: string): string {
  if (!points.length) {
    return `empty|${presetSignature}`
  }
  const geometrySignature = points
    .map((point) => [encodePreviewNumber(point.x), encodePreviewNumber(point.y), encodePreviewNumber(point.z)].join(','))
    .join(';')
  return `${geometrySignature}|${presetSignature}`
}

export function createLandformBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  landformBuildShape: Ref<LandformBuildShape>
  landformRegularPolygonSides?: Ref<number>
  getDefaultCircleRadius: () => number
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  resolveBuildPlacementPoint?: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  resolveVertexSnapPoint?: (event: PointerEvent, point: THREE.Vector3, options?: VertexSnapResolverOptions) => THREE.Vector3 | null
  clearVertexSnap?: () => void
  isAltOverrideActive: () => boolean
  isRelativeAngleSnapActive?: () => boolean
  showStartIndicator?: (point: THREE.Vector3, options?: { height?: number | null }) => void
  hideStartIndicator?: () => void
  holdStartIndicatorUntilNodeVisible?: (options: {
    nodeId: string
    point: THREE.Vector3
    height?: number | null
  }) => void
  getLandformBrush?: () => {
    presetAssetId: string | null | undefined
    presetData: import('@/utils/landformPreset').LandformPresetData | null | undefined
  }
  applyLandformPresetToNode?: (
    nodeId: string,
    assetId: string,
    presetData?: LandformPresetData | null,
  ) => Promise<unknown>
  applyPreviewMaterials?: (group: THREE.Group, presetData: LandformPresetData | null) => void
  clickDragThresholdPx: number
}): LandformBuildToolHandle {
  const DOUBLE_CLICK_MAX_INTERVAL_MS = 320
  const DOUBLE_CLICK_MAX_DISTANCE_PX = 8
  const getRegularPolygonSides = (): number => {
    const raw = options.landformRegularPolygonSides?.value ?? 0
    if (!Number.isFinite(raw)) {
      return 0
    }
    const rounded = Math.round(raw)
    const clamped = Math.min(256, Math.max(0, rounded))
    return clamped >= 3 ? clamped : 0
  }

  const buildPreviewSignature = (): string => {
    const brush = options.getLandformBrush?.()
    const presetAssetId = typeof brush?.presetAssetId === 'string' ? brush.presetAssetId.trim() : ''
    const presetData = brush?.presetData ?? null
    if (!presetData && !presetAssetId) {
      return 'default'
    }
    return JSON.stringify({
      presetAssetId,
      materialSlotId: presetData?.materialSlotId ?? null,
      materialPatch: presetData?.materialPatch ?? null,
      landformProps: presetData?.landformProps ?? null,
    })
  }

  const buildPreviewVertices = (targetSession: LandformPreviewSession): THREE.Vector3[] => {
    if (!targetSession.points.length) {
      return []
    }
    if (targetSession.shape === 'rectangle' && targetSession.previewEnd) {
      const start = targetSession.points[0]
      if (start) {
        const rectangle = buildRotatedRectangleFromCorner(start, targetSession.previewEnd, targetSession.rectangleDirection)
        if (rectangle?.corners?.length) {
          return rectangle.corners.map((point) => point.clone())
        }
      }
    }
    if (targetSession.shape === 'circle' && targetSession.previewEnd) {
      const center = targetSession.points[0]
      if (center) {
        return buildFloorCircleOrRegularPolygonPoints(center, targetSession.previewEnd, getRegularPolygonSides())
      }
    }
    const combined = targetSession.points.map((point) => point.clone())
    if (targetSession.previewEnd) {
      const last = combined[combined.length - 1] ?? null
      if (!last || last.distanceToSquared(targetSession.previewEnd) > 1e-10) {
        combined.push(targetSession.previewEnd.clone())
      }
    }
    return combined
  }

  let previewNeedsSync = false
  let previewSignature: string | null = null
  let lastPresetSignature = buildPreviewSignature()
  let lastRegularPolygonSides = getRegularPolygonSides()

  const clearPreview = (targetSession: LandformPreviewSession | null): void => {
    if (targetSession?.previewGroup) {
      const group = targetSession.previewGroup
      group.removeFromParent()
      disposePreviewGroup(group)
      targetSession.previewGroup = null
    }
    previewSignature = null
  }

  const flushPreview = (scene: THREE.Scene | null, targetSession: LandformPreviewSession | null): void => {
    previewNeedsSync = false
    lastPresetSignature = buildPreviewSignature()
    lastRegularPolygonSides = getRegularPolygonSides()

    if (!scene || !targetSession) {
      clearPreview(targetSession)
      return
    }

    const previewPoints = buildPreviewVertices(targetSession)
    if (previewPoints.length < 2) {
      clearPreview(targetSession)
      return
    }

    const nextSignature = computePreviewSignature(previewPoints, lastPresetSignature)
    if (nextSignature === previewSignature) {
      return
    }

    const linePoints = previewPoints.map((point) => new THREE.Vector3(point.x, point.y + LANDFORM_LINE_PREVIEW_Y_OFFSET, point.z))
    if (previewPoints.length < 3) {
      if (!targetSession.previewGroup || targetSession.previewGroup.userData?.isLandformLinePreview !== true) {
        clearPreview(targetSession)
        targetSession.previewGroup = createLinePreviewGroup(linePoints)
        options.rootGroup.add(targetSession.previewGroup)
      } else {
        updateLinePreviewGroup(targetSession.previewGroup, linePoints)
      }
      previewSignature = nextSignature
      return
    }

    const build = options.sceneStore.buildLandformPreviewMesh({
      points: previewPoints.map((point) => ({ x: point.x, y: point.y, z: point.z }) satisfies Vector3Like),
      reason: 'landform-preview',
    })
    if (!build) {
      clearPreview(targetSession)
      return
    }

    if (!targetSession.previewGroup || targetSession.previewGroup.userData?.isLandformLinePreview === true) {
      clearPreview(targetSession)
      const previewGroup = createLandformGroup(build.definition)
      previewGroup.userData.isLandformPreview = true
      targetSession.previewGroup = previewGroup
      options.rootGroup.add(previewGroup)
    } else {
      updateLandformGroup(targetSession.previewGroup, build.definition)
      if (!options.rootGroup.children.includes(targetSession.previewGroup)) {
        options.rootGroup.add(targetSession.previewGroup)
      }
    }

    options.applyPreviewMaterials?.(targetSession.previewGroup, options.getLandformBrush?.().presetData ?? null)
    targetSession.previewGroup.position.set(build.center.x, build.center.y, build.center.z)
    previewSignature = nextSignature
  }

  const previewRenderer = {
    markDirty: () => {
      previewNeedsSync = true
    },
    flushIfNeeded: (scene: THREE.Scene | null, targetSession: LandformPreviewSession | null) => {
      const currentPresetSignature = buildPreviewSignature()
      const currentRegularPolygonSides = getRegularPolygonSides()
      if (currentPresetSignature !== lastPresetSignature || currentRegularPolygonSides !== lastRegularPolygonSides) {
        previewNeedsSync = true
      }
      if (!previewNeedsSync) {
        return
      }
      flushPreview(scene, targetSession)
    },
    flush: flushPreview,
    clear: clearPreview,
    reset: () => {
      previewNeedsSync = false
      previewSignature = null
      lastPresetSignature = buildPreviewSignature()
      lastRegularPolygonSides = getRegularPolygonSides()
    },
    dispose: (targetSession: LandformPreviewSession | null) => {
      clearPreview(targetSession)
      previewNeedsSync = false
      previewSignature = null
      lastPresetSignature = buildPreviewSignature()
      lastRegularPolygonSides = getRegularPolygonSides()
    },
  }

  const groundPointerHelper = new THREE.Vector3()

  const raycastPlacementPoint = (event: PointerEvent, result: THREE.Vector3): boolean => {
    if (options.resolveBuildPlacementPoint) {
      return options.resolveBuildPlacementPoint(event, result)
    }
    return options.raycastGroundPoint(event, result)
  }

  const alignPointYToSession = (point: THREE.Vector3, targetSession: LandformPreviewSession | null): THREE.Vector3 => {
    const baseY = targetSession?.points?.[0]?.y
    if (typeof baseY === 'number' && Number.isFinite(baseY)) {
      point.y = baseY
    }
    return point
  }

  const resolvePlacementPoint = (
    event: PointerEvent,
    rawPoint: THREE.Vector3,
    optionsOverride?: { fallback?: 'grid' | 'raw'; keepSourceY?: boolean; excludeNodeIds?: readonly string[] },
  ): THREE.Vector3 => {
    const snapped = options.resolveVertexSnapPoint?.(event, rawPoint, {
      excludeNodeIds: optionsOverride?.excludeNodeIds,
      keepSourceY: optionsOverride?.keepSourceY,
    })
    if (snapped) {
      return snapped.clone()
    }
    if (optionsOverride?.fallback === 'raw') {
      return rawPoint.clone()
    }
    return options.snapPoint(rawPoint.clone())
  }

  let session: LandformPreviewSession | null = null
  let rightClickState: RightClickState | null = null
  let leftDragState: LeftDragState | null = null
  let leftClickState: LeftClickState | null = null

  const isLeftDoubleClick = (event: PointerEvent): boolean => {
    if (event.button !== 0) {
      return false
    }
    const now = Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : Date.now()
    const previous = leftClickState
    leftClickState = {
      atMs: now,
      clientX: event.clientX,
      clientY: event.clientY,
    }
    if (!previous) {
      return false
    }
    const dt = now - previous.atMs
    if (dt < 0 || dt > DOUBLE_CLICK_MAX_INTERVAL_MS) {
      return false
    }
    const distance = Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY)
    return distance <= DOUBLE_CLICK_MAX_DISTANCE_PX
  }

  const hideStartIndicator = () => {
    options.hideStartIndicator?.()
  }

  const getStartIndicatorHeight = (): number => 0.2

  const showLockedStartIndicator = (point: THREE.Vector3 | null | undefined) => {
    if (!point) {
      return
    }
    options.showStartIndicator?.(point, { height: getStartIndicatorHeight() })
  }

  const holdStartIndicatorUntilNodeVisible = (nodeId: string | null | undefined, point: THREE.Vector3 | null | undefined) => {
    if (!nodeId || !point) {
      return
    }
    options.holdStartIndicatorUntilNodeVisible?.({
      nodeId,
      point: point.clone(),
      height: getStartIndicatorHeight(),
    })
  }

  const getShape = (): LandformBuildShape => options.landformBuildShape.value ?? 'polygon'

  const applyBrushPresetIfNeeded = (nodeId: string | null | undefined) => {
    if (!nodeId || !options.getLandformBrush || !options.applyLandformPresetToNode) {
      return
    }
    const brush = options.getLandformBrush()
    const presetAssetId = typeof brush?.presetAssetId === 'string' ? brush.presetAssetId.trim() : ''
    if (!presetAssetId) {
      return
    }
    void options.applyLandformPresetToNode(nodeId, presetAssetId, brush?.presetData ?? null).catch((error) => {
      console.warn('Failed to apply landform brush preset', presetAssetId, error)
    })
  }

  const ensureSession = (): LandformPreviewSession => {
    if (session) {
      return session
    }
    session = {
      shape: getShape(),
      points: [],
      previewEnd: null,
      rectangleDirection: null,
      previewGroup: null,
    }
    return session
  }

  const clearSession = (disposePreview = true) => {
    if (disposePreview) {
      previewRenderer.clear(session)
    } else if (session?.previewGroup) {
      session.previewGroup.removeFromParent()
    }
    hideStartIndicator()
    options.clearVertexSnap?.()
    session = null
    rightClickState = null
    leftDragState = null
    previewRenderer.reset()
  }

  const startRectangleDraft = (event: PointerEvent): boolean => {
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }
    const start = resolvePlacementPoint(event, groundPointerHelper.clone())
    const current = ensureSession()
    current.shape = 'rectangle'
    current.points = [start.clone()]
    current.previewEnd = start.clone()
    current.rectangleDirection = null
    leftDragState = { pointerId: event.pointerId, kind: 'rectangle' }
    showLockedStartIndicator(start)
    previewRenderer.markDirty()
    return true
  }

  const startCircleDraft = (event: PointerEvent): boolean => {
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }
    const center = resolvePlacementPoint(event, groundPointerHelper.clone())
    const baseRadiusRaw = options.getDefaultCircleRadius()
    const baseRadius = typeof baseRadiusRaw === 'number' && Number.isFinite(baseRadiusRaw) ? Math.max(1e-3, baseRadiusRaw) : 1
    const initialEnd = center.clone()
    initialEnd.x += baseRadius
    const current = ensureSession()
    current.shape = 'circle'
    current.points = [center.clone()]
    current.previewEnd = initialEnd
    current.rectangleDirection = null
    leftDragState = { pointerId: event.pointerId, kind: 'circle' }
    showLockedStartIndicator(center)
    previewRenderer.markDirty()
    return true
  }

  const updateStartIndicatorCursorPreview = (event: PointerEvent): boolean => {
    const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
    if (isCameraNavActive || options.isAltOverrideActive()) {
      hideStartIndicator()
      return false
    }
    if (session && session.points.length > 0) {
      showLockedStartIndicator(session.points[0] ?? null)
      return true
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      hideStartIndicator()
      return false
    }
    const point = resolvePlacementPoint(event, groundPointerHelper.clone())
    options.showStartIndicator?.(point, { height: getStartIndicatorHeight() })
    return true
  }

  const updateCursorPreview = (event: PointerEvent) => {
    if (!session || session.points.length === 0) {
      return
    }
    if (options.isAltOverrideActive()) {
      return
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return
    }

    const raw = groundPointerHelper.clone()
    const next = session.shape === 'circle'
      ? resolvePlacementPoint(event, raw, { fallback: 'raw' })
      : resolvePlacementPoint(event, raw)
    alignPointYToSession(next, session)

    if (session.shape === 'polygon' && options.isRelativeAngleSnapActive?.() && session.points.length >= 2) {
      const anchor = session.points[session.points.length - 1]
      const previous = session.points[session.points.length - 2]
      if (anchor && previous) {
        const relativeSnapped = snapPointToRelativeAngleStep({
          anchor,
          previous,
          target: next,
          angleStepRadians: Math.PI / 4,
        })
        next.copy(relativeSnapped)
        alignPointYToSession(next, session)
      }
    }

    if (session.shape === 'rectangle' && !session.rectangleDirection) {
      const start = session.points[0] ?? next
      const rawDirectionPoint = raw.clone()
      alignPointYToSession(rawDirectionPoint, session)
      session.rectangleDirection = resolveRectangleDragDirection(start, rawDirectionPoint)
    }

    const previous = session.previewEnd
    if (previous && previous.equals(next)) {
      return
    }
    session.previewEnd = next.clone()
    previewRenderer.markDirty()
  }

  const handlePlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'landform' || options.isAltOverrideActive()) {
      return false
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }
    let point = resolvePlacementPoint(event, groundPointerHelper.clone())
    const current = ensureSession()
    alignPointYToSession(point, current)
    current.shape = 'polygon'
    if (options.isRelativeAngleSnapActive?.() && current.points.length >= 2) {
      const anchor = current.points[current.points.length - 1]
      const previous = current.points[current.points.length - 2]
      if (anchor && previous) {
        point = snapPointToRelativeAngleStep({
          anchor,
          previous,
          target: point,
          angleStepRadians: Math.PI / 4,
        })
        alignPointYToSession(point, current)
      }
    }
    if (current.points.length > 0) {
      const last = current.points[current.points.length - 1]!
      if (last.distanceToSquared(point) <= 1e-6) {
        current.previewEnd = point.clone()
        previewRenderer.markDirty()
        return true
      }
    }
    current.points.push(point.clone())
    current.previewEnd = point.clone()
    showLockedStartIndicator(current.points[0] ?? point)
    previewRenderer.markDirty()
    return true
  }

  const finalize = () => {
    if (!session) {
      return
    }
    const buildShape = session.shape ?? 'polygon'
    const points = session.points
    if (points.length < 3) {
      clearSession(true)
      return
    }
    const created = options.sceneStore.createLandformNode({
      points: points.map((point) => ({ x: point.x, y: point.y, z: point.z }) satisfies Vector3Like),
    })
    if (created) {
      options.sceneStore.updateNodeUserData(created.id, mergeUserDataWithDynamicMeshBuildShape(created.userData, buildShape))
      options.sceneStore.selectNode(created.id)
      applyBrushPresetIfNeeded(created.id)
    }
    const startPoint = session?.points[0]?.clone() ?? points[0]?.clone() ?? null
    clearSession(true)
    if (created) {
      holdStartIndicatorUntilNodeVisible(created.id, startPoint)
    }
  }

  const finalizeFromVertices = (vertices: THREE.Vector3[]) => {
    const buildShape = session?.shape ?? 'polygon'
    const points = vertices
      .map((point) => new THREE.Vector3(Number(point.x), Number(point.y), Number(point.z)))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))
    if (points.length < 3) {
      clearSession(true)
      return
    }
    const created = options.sceneStore.createLandformNode({
      points: points.map((point) => ({ x: point.x, y: point.y, z: point.z }) satisfies Vector3Like),
    })
    if (created) {
      options.sceneStore.updateNodeUserData(created.id, mergeUserDataWithDynamicMeshBuildShape(created.userData, buildShape))
      options.sceneStore.selectNode(created.id)
      applyBrushPresetIfNeeded(created.id)
    }
    const startPoint = session?.points[0]?.clone() ?? points[0]?.clone() ?? null
    clearSession(true)
    if (created) {
      holdStartIndicatorUntilNodeVisible(created.id, startPoint)
    }
  }

  return {
    getSession: () => session,
    flushPreviewIfNeeded: (scene: THREE.Scene | null) => {
      previewRenderer.flushIfNeeded(scene, session)
    },
    handlePointerDown: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'landform') {
        return false
      }
      const shape = getShape()
      if (event.button === 0 && !options.isAltOverrideActive()) {
        if (shape === 'rectangle') {
          clearSession(true)
          startRectangleDraft(event)
          return false
        }
        if (shape === 'circle') {
          clearSession(true)
          startCircleDraft(event)
          return false
        }
      }
      if (event.button === 2 && session) {
        rightClickState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        }
      }
      return false
    },
    handlePointerMove: (event: PointerEvent) => {
      if (rightClickState && event.pointerId === rightClickState.pointerId && !rightClickState.moved) {
        const dx = event.clientX - rightClickState.startX
        const dy = event.clientY - rightClickState.startY
        if (Math.hypot(dx, dy) >= options.clickDragThresholdPx) {
          rightClickState.moved = true
        }
      }
      if (options.activeBuildTool.value !== 'landform') {
        return false
      }
      updateStartIndicatorCursorPreview(event)
      if (leftDragState && event.pointerId === leftDragState.pointerId) {
        const isLeftButtonDown = (event.buttons & 1) !== 0
        const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
        if (isLeftButtonDown && !isCameraNavActive) {
          updateCursorPreview(event)
          return true
        }
      }
      if (session && session.points.length > 0) {
        const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
        if (!isCameraNavActive) {
          if (session.shape === 'polygon') {
            updateCursorPreview(event)
          }
          return true
        }
      }
      return false
    },
    handlePointerUp: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'landform') {
        return false
      }
      const shape = getShape()
      if (event.button === 0 && !options.isAltOverrideActive()) {
        if (shape === 'rectangle' && leftDragState?.kind === 'rectangle' && leftDragState.pointerId === event.pointerId) {
          leftDragState = null
          if (!session || session.shape !== 'rectangle' || session.points.length < 1) {
            clearSession(true)
            return true
          }
          if (!raycastPlacementPoint(event, groundPointerHelper)) {
            clearSession(true)
            return true
          }
          const end = resolvePlacementPoint(event, groundPointerHelper.clone())
          end.y = session.points[0]?.y ?? end.y
          session.previewEnd = end.clone()
          previewRenderer.markDirty()
          const start = session.points[0]!
          const rectangle = buildRotatedRectangleFromCorner(start, end, session.rectangleDirection)
          if (!rectangle || rectangle.width * rectangle.depth <= 1e-6) {
            clearSession(true)
            return true
          }
          finalizeFromVertices(rectangle.corners)
          return true
        }
        if (shape === 'circle' && leftDragState?.kind === 'circle' && leftDragState.pointerId === event.pointerId) {
          leftDragState = null
          if (!session || session.shape !== 'circle' || session.points.length < 1) {
            clearSession(true)
            return true
          }
          if (!raycastPlacementPoint(event, groundPointerHelper)) {
            clearSession(true)
            return true
          }
          const previewEnd = resolvePlacementPoint(event, groundPointerHelper.clone(), { fallback: 'raw' })
          previewEnd.y = session.points[0]?.y ?? previewEnd.y
          session.previewEnd = previewEnd.clone()
          previewRenderer.markDirty()
          const center = session.points[0]!
          const end = session.previewEnd!
          const radius = Math.hypot(end.x - center.x, end.z - center.z)
          if (!Number.isFinite(radius) || radius <= 1e-3) {
            clearSession(true)
            return true
          }
          const circleVerts = buildFloorCircleOrRegularPolygonPoints(center, end, getRegularPolygonSides())
          finalizeFromVertices(circleVerts)
          return true
        }
      }
      if (event.button === 0) {
        if (options.isAltOverrideActive() || shape !== 'polygon') {
          return false
        }
        const handled = handlePlacementClick(event)
        if (handled) {
          if (isLeftDoubleClick(event) && session?.shape === 'polygon' && session.points.length >= 3) {
            finalize()
          }
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
        if (rightClickState && rightClickState.pointerId === event.pointerId) {
          const clickWasDrag = rightClickState.moved
          rightClickState = null
          if (!clickWasDrag && session) {
            clearSession(true)
            return true
          }
        }
      }
      return false
    },
    handlePointerCancel: (event: PointerEvent) => {
      if (rightClickState?.pointerId === event.pointerId) {
        rightClickState = null
      }
      if (leftDragState?.pointerId === event.pointerId) {
        clearSession(true)
        return true
      }
      return false
    },
    cancel: () => {
      if (!session) {
        hideStartIndicator()
        options.clearVertexSnap?.()
        return false
      }
      clearSession(true)
      return true
    },
    dispose: () => {
      clearSession(true)
    },
  }
}