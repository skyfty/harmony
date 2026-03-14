import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { Vector3Like } from '@schema'
import {
  buildFloorCircleOrRegularPolygonPoints,
  createFloorPreviewRenderer,
  type FloorPreviewSession,
} from './FloorPreviewRenderer'
import type { useSceneStore } from '@/stores/sceneStore'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { FloorPresetData } from '@/utils/floorPreset'
import { mergeUserDataWithDynamicMeshBuildShape } from '@/utils/dynamicMeshBuildShapeUserData'

export type FloorBuildToolHandle = {
  getSession: () => FloorPreviewSession | null
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
  kind: Exclude<FloorBuildShape, 'polygon'>
}

type VertexSnapResolverOptions = {
  excludeNodeIds?: readonly string[]
  keepSourceY?: boolean
}

export function createFloorBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  floorBuildShape: Ref<FloorBuildShape>
  floorRegularPolygonSides?: Ref<number>
  getDefaultCircleRadius: () => number
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  resolveBuildPlacementPoint?: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  resolveVertexSnapPoint?: (event: PointerEvent, point: THREE.Vector3, options?: VertexSnapResolverOptions) => THREE.Vector3 | null
  clearVertexSnap?: () => void
  isAltOverrideActive: () => boolean
  getFloorBrush: () => { presetAssetId: string | null; presetData: FloorPresetData | null }
  clickDragThresholdPx: number
}): FloorBuildToolHandle {
  const previewRenderer = createFloorPreviewRenderer({
    rootGroup: options.rootGroup,
    getRegularPolygonSides: () => getRegularPolygonSides(),
  })

  const groundPointerHelper = new THREE.Vector3()

  const raycastPlacementPoint = (event: PointerEvent, result: THREE.Vector3): boolean => {
    if (options.resolveBuildPlacementPoint) {
      return options.resolveBuildPlacementPoint(event, result)
    }
    return options.raycastGroundPoint(event, result)
  }

  const alignPointYToSession = (point: THREE.Vector3, targetSession: FloorPreviewSession | null): THREE.Vector3 => {
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

  let session: FloorPreviewSession | null = null
  let rightClickState: RightClickState | null = null
  let leftDragState: LeftDragState | null = null

  const getShape = (): FloorBuildShape => options.floorBuildShape.value ?? 'polygon'

  const getRegularPolygonSides = (): number => {
    const raw = options.floorRegularPolygonSides?.value ?? 0
    if (!Number.isFinite(raw)) {
      return 0
    }
    const rounded = Math.round(raw)
    const clamped = Math.min(256, Math.max(0, rounded))
    return clamped >= 3 ? clamped : 0
  }

  const ensureSession = (): FloorPreviewSession => {
    if (session) {
      return session
    }
    session = {
      shape: getShape(),
      points: [],
      previewEnd: null,
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

    const raw = groundPointerHelper.clone()
    const start = resolvePlacementPoint(event, raw)

    const current = ensureSession()
    current.shape = 'rectangle'
    current.points = [start.clone()]
    current.previewEnd = start.clone()
    leftDragState = { pointerId: event.pointerId, kind: 'rectangle' }
    previewRenderer.markDirty()
    return true
  }

  const startCircleDraft = (event: PointerEvent): boolean => {
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }

    const raw = groundPointerHelper.clone()
    const center = resolvePlacementPoint(event, raw)

    const baseRadiusRaw = options.getDefaultCircleRadius()
    const baseRadius = typeof baseRadiusRaw === 'number' && Number.isFinite(baseRadiusRaw) ? Math.max(1e-3, baseRadiusRaw) : 1

    const initialEnd = center.clone()
    initialEnd.x += baseRadius

    const current = ensureSession()
    current.shape = 'circle'
    current.points = [center.clone()]
    current.previewEnd = initialEnd
    leftDragState = { pointerId: event.pointerId, kind: 'circle' }
    previewRenderer.markDirty()
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

    // Circle radius endpoint should not be snapped to grid.
    const next = session.shape === 'circle'
      ? resolvePlacementPoint(event, raw, { fallback: 'raw' })
      : resolvePlacementPoint(event, raw)
    alignPointYToSession(next, session)

    const previous = session.previewEnd
    if (previous && previous.equals(next)) {
      return
    }

    session.previewEnd = next.clone()
    previewRenderer.markDirty()
  }

  const handlePlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'floor') {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }

    const raw = groundPointerHelper.clone()
    const point = resolvePlacementPoint(event, raw)

    const current = ensureSession()
    alignPointYToSession(point, current)
    current.shape = 'polygon'
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

    const created = options.sceneStore.createFloorNode({
      points: points.map((p) => ({ x: p.x, y: p.y, z: p.z }) satisfies Vector3Like),
    })

    if (created) {
      options.sceneStore.updateNodeUserData(created.id, mergeUserDataWithDynamicMeshBuildShape(created.userData, buildShape))
      options.sceneStore.selectNode(created.id)

      const brush = options.getFloorBrush?.()
      const presetAssetId = typeof brush?.presetAssetId === 'string' && brush.presetAssetId.trim().length
        ? brush.presetAssetId.trim()
        : null
      if (presetAssetId) {
        void options.sceneStore
          .applyFloorPresetToNode(created.id, presetAssetId, brush?.presetData ?? null)
          .catch((error: unknown) => {
            console.warn('Failed to apply floor preset brush', presetAssetId, error)
          })
      }
    }

    clearSession(true)
  }

  const finalizeFromVertices = (vertices: THREE.Vector3[]) => {
    const buildShape = session?.shape ?? 'polygon'
    const points = vertices
      .map((p) => new THREE.Vector3(Number(p.x), Number(p.y), Number(p.z)))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))

    if (points.length < 3) {
      clearSession(true)
      return
    }

    const created = options.sceneStore.createFloorNode({
      points: points.map((p) => ({ x: p.x, y: p.y, z: p.z }) satisfies Vector3Like),
    })

    if (created) {
      options.sceneStore.updateNodeUserData(created.id, mergeUserDataWithDynamicMeshBuildShape(created.userData, buildShape))
      options.sceneStore.selectNode(created.id)

      const brush = options.getFloorBrush?.()
      const presetAssetId = typeof brush?.presetAssetId === 'string' && brush.presetAssetId.trim().length
        ? brush.presetAssetId.trim()
        : null
      if (presetAssetId) {
        void options.sceneStore
          .applyFloorPresetToNode(created.id, presetAssetId, brush?.presetData ?? null)
          .catch((error: unknown) => {
            console.warn('Failed to apply floor preset brush', presetAssetId, error)
          })
      }
    }

    clearSession(true)
  }

  return {
    getSession: () => session,

    flushPreviewIfNeeded: (scene: THREE.Scene | null) => {
      previewRenderer.flushIfNeeded(scene, session)
    },

    handlePointerDown: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'floor') {
        return false
      }

      const shape = getShape()

      if (event.button === 0 && !options.isAltOverrideActive()) {
        if (shape === 'rectangle') {
          // Start drag-to-size draft.
          clearSession(true)
          startRectangleDraft(event)
          return false
        }
        if (shape === 'circle') {
          // Start draft with default radius; allow dragging to adjust.
          clearSession(true)
          startCircleDraft(event)
          return false
        }
      }

      // Right click ends the build only if it's a click (not a drag used for rotating the camera).
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

      if (options.activeBuildTool.value !== 'floor') {
        return false
      }

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
      if (options.activeBuildTool.value !== 'floor') {
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

          const raw = groundPointerHelper.clone()
          const end = resolvePlacementPoint(event, raw)
          end.y = session.points[0]?.y ?? end.y
          session.previewEnd = end.clone()
          previewRenderer.markDirty()

          const start = session.points[0]!
          const minX = Math.min(start.x, end.x)
          const maxX = Math.max(start.x, end.x)
          const minZ = Math.min(start.z, end.z)
          const maxZ = Math.max(start.z, end.z)
          const width = maxX - minX
          const depth = maxZ - minZ
          if (!Number.isFinite(width) || !Number.isFinite(depth) || width * depth <= 1e-6) {
            clearSession(true)
            return true
          }

          finalizeFromVertices([
            new THREE.Vector3(minX, start.y, minZ),
            new THREE.Vector3(minX, start.y, maxZ),
            new THREE.Vector3(maxX, start.y, maxZ),
            new THREE.Vector3(maxX, start.y, minZ),
          ])
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
        if (options.isAltOverrideActive()) {
          return false
        }
        if (shape !== 'polygon') {
          return false
        }
        const handled = handlePlacementClick(event)
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
        if (rightClickState && rightClickState.pointerId === event.pointerId) {
          const clickWasDrag = rightClickState.moved
          rightClickState = null
          if (!clickWasDrag && session) {
            // Rectangle/circle: right click cancels the current draft only.
            if (session.shape !== 'polygon') {
              clearSession(true)
              return true
            }

            // Polygon: right click finalizes.
            finalize()
            return true
          }
        }
        return false
      }

      return false
    },

    handlePointerCancel: (_event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'floor') {
        return false
      }
      if (!session) {
        return false
      }
      clearSession(true)
      return true
    },

    cancel: () => {
      if (!session) {
        options.clearVertexSnap?.()
        return false
      }
      clearSession(true)
      return true
    },

    dispose: () => {
      options.clearVertexSnap?.()
      previewRenderer.dispose(session)
      clearSession(false)
    },
  }
}
