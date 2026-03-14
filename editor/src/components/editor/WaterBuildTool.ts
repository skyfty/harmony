import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { WaterBuildShape } from '@/types/water-build-shape'
import type { useSceneStore } from '@/stores/sceneStore'
import { createWaterPreviewRenderer, type WaterPreviewSession } from './WaterPreviewRenderer'

export type WaterBuildToolHandle = {
  getSession: () => WaterPreviewSession | null
  flushPreviewIfNeeded: (scene: THREE.Scene | null) => void
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handlePointerCancel: (event: PointerEvent) => boolean
  cancel: () => boolean
  dispose: () => void
}

type Session = {
  shape: WaterBuildShape
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  previewGroup: THREE.Group | null
}

type RightClickState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

type LeftDragState = {
  pointerId: number
  kind: Exclude<WaterBuildShape, 'polygon'>
}

const WATER_MIN_SIZE = 1e-3
const WATER_CIRCLE_SEGMENTS = 32

export function createWaterBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  waterBuildShape: Ref<WaterBuildShape>
  getDefaultCircleRadius?: () => number
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  resolveBuildPlacementPoint?: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  isAltOverrideActive: () => boolean
  clickDragThresholdPx: number
}): WaterBuildToolHandle {
  const previewRenderer = createWaterPreviewRenderer({ rootGroup: options.rootGroup })
  const groundPointerHelper = new THREE.Vector3()
  const raycastPlacementPoint = (event: PointerEvent, result: THREE.Vector3): boolean => {
    if (options.resolveBuildPlacementPoint) {
      return options.resolveBuildPlacementPoint(event, result)
    }
    return options.raycastGroundPoint(event, result)
  }

  let session: Session | null = null
  let rightClickState: RightClickState | null = null
  let leftDragState: LeftDragState | null = null

  const getShape = (): WaterBuildShape => options.waterBuildShape.value ?? 'rectangle'

  const ensureSession = (): WaterPreviewSession => {
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
    session = null
    rightClickState = null
    leftDragState = null
    previewRenderer.reset()
  }

  const alignPointYToSession = (point: THREE.Vector3, targetSession: WaterPreviewSession | null): THREE.Vector3 => {
    const baseY = targetSession?.points?.[0]?.y
    if (typeof baseY === 'number' && Number.isFinite(baseY)) {
      point.y = baseY
    }
    return point
  }

  const markPreviewDirty = () => {
    previewRenderer.markDirty()
  }

  const startRectangleDraft = (event: PointerEvent): boolean => {
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }
    const start = options.snapPoint(groundPointerHelper.clone())
    const current = ensureSession()
    current.shape = 'rectangle'
    current.points = [start.clone()]
    current.previewEnd = start.clone()
    leftDragState = { pointerId: event.pointerId, kind: 'rectangle' }
    markPreviewDirty()
    return true
  }

  const startCircleDraft = (event: PointerEvent): boolean => {
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }
    const center = options.snapPoint(groundPointerHelper.clone())
    const baseRadiusRaw = options.getDefaultCircleRadius?.()
    const baseRadius = typeof baseRadiusRaw === 'number' && Number.isFinite(baseRadiusRaw) ? Math.max(1e-3, baseRadiusRaw) : 1
    const initialEnd = center.clone()
    initialEnd.x += baseRadius

    const current = ensureSession()
    current.shape = 'circle'
    current.points = [center.clone()]
    current.previewEnd = initialEnd
    leftDragState = { pointerId: event.pointerId, kind: 'circle' }
    markPreviewDirty()
    return true
  }

  const updateCursorPreview = (event: PointerEvent) => {
    if (!session || session.points.length === 0 || options.isAltOverrideActive()) {
      return
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return
    }

    const raw = groundPointerHelper.clone()
    const next = session.shape === 'circle' ? raw : options.snapPoint(raw)
    alignPointYToSession(next, session)

    const previous = session.previewEnd
    if (previous && previous.equals(next)) {
      return
    }

    session.previewEnd = next.clone()
    markPreviewDirty()
  }

  const handlePlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'water' || options.isAltOverrideActive()) {
      return false
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return false
    }

    const point = options.snapPoint(groundPointerHelper.clone())
    const current = ensureSession()
    alignPointYToSession(point, current)
    current.shape = 'polygon'

    if (current.points.length > 0) {
      const last = current.points[current.points.length - 1]!
      if (last.distanceToSquared(point) <= 1e-6) {
        current.previewEnd = point.clone()
        markPreviewDirty()
        return true
      }
    }

    current.points.push(point.clone())
    current.previewEnd = point.clone()
    markPreviewDirty()
    return true
  }

  const finalizePolygon = () => {
    if (!session) {
      return
    }
    const points = session.points
      .map((point) => point.clone())
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))
    if (points.length < 3) {
      clearSession(true)
      return
    }

    options.sceneStore.createWaterSurfaceMeshNode({
      buildShape: 'polygon',
      points: points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
    })
    clearSession(true)
  }

  const finalizeCircle = () => {
    if (!session || session.points.length < 1 || !session.previewEnd) {
      clearSession(true)
      return
    }

    const center = session.points[0]!
    const end = session.previewEnd
    const radius = Math.hypot(end.x - center.x, end.z - center.z)
    if (!Number.isFinite(radius) || radius <= WATER_MIN_SIZE) {
      clearSession(true)
      return
    }

    const points: THREE.Vector3[] = []
    for (let index = 0; index < WATER_CIRCLE_SEGMENTS; index += 1) {
      const t = (index / WATER_CIRCLE_SEGMENTS) * Math.PI * 2
      points.push(new THREE.Vector3(
        center.x + Math.cos(t) * radius,
        center.y,
        center.z + Math.sin(t) * radius,
      ))
    }

    options.sceneStore.createWaterSurfaceMeshNode({
      buildShape: 'circle',
      points: points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
    })
    clearSession(true)
  }

  return {
    getSession: () => session,

    flushPreviewIfNeeded: (scene) => {
      previewRenderer.flushIfNeeded(scene, session)
    },

    handlePointerDown: (event) => {
      if (options.activeBuildTool.value !== 'water') {
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

    handlePointerMove: (event) => {
      if (rightClickState && event.pointerId === rightClickState.pointerId && !rightClickState.moved) {
        const dx = event.clientX - rightClickState.startX
        const dy = event.clientY - rightClickState.startY
        if (Math.hypot(dx, dy) >= options.clickDragThresholdPx) {
          rightClickState.moved = true
        }
      }

      if (options.activeBuildTool.value !== 'water') {
        return false
      }

      if (leftDragState && session && event.pointerId === leftDragState.pointerId) {
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

    handlePointerUp: (event) => {
      if (options.activeBuildTool.value !== 'water') {
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

          const end = options.snapPoint(groundPointerHelper.clone())
          end.y = session.points[0]?.y ?? end.y
          session.previewEnd = end.clone()
          markPreviewDirty()

          const start = session.points[0]!
          const minX = Math.min(start.x, end.x)
          const maxX = Math.max(start.x, end.x)
          const minZ = Math.min(start.z, end.z)
          const maxZ = Math.max(start.z, end.z)
          const width = maxX - minX
          const depth = maxZ - minZ
          if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= WATER_MIN_SIZE || depth <= WATER_MIN_SIZE) {
            clearSession(true)
            return true
          }

          options.sceneStore.createWaterNode({
            center: {
              x: (minX + maxX) * 0.5,
              y: start.y,
              z: (minZ + maxZ) * 0.5,
            },
            width,
            depth,
          })
          clearSession(true)
          return true
        }

        if (shape === 'circle' && leftDragState?.kind === 'circle' && leftDragState.pointerId === event.pointerId) {
          leftDragState = null
          if (!session || session.shape !== 'circle') {
            clearSession(true)
            return true
          }
          if (!raycastPlacementPoint(event, groundPointerHelper)) {
            clearSession(true)
            return true
          }

          const end = groundPointerHelper.clone()
          end.y = session.points[0]?.y ?? end.y
          session.previewEnd = end.clone()
          markPreviewDirty()
          finalizeCircle()
          return true
        }

        if (shape === 'polygon') {
          const handled = handlePlacementClick(event)
          if (handled) {
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation()
          }
          return handled
        }
      }

      if (event.button === 2) {
        if (options.isAltOverrideActive()) {
          return false
        }
        if (rightClickState && rightClickState.pointerId === event.pointerId) {
          const clickWasDrag = rightClickState.moved
          rightClickState = null
          if (!clickWasDrag && session) {
            if (session.shape === 'polygon') {
              finalizePolygon()
              return true
            }
            clearSession(true)
            return true
          }
        }
      }

      return false
    },

    handlePointerCancel: () => {
      if (options.activeBuildTool.value !== 'water' || !session) {
        return false
      }
      clearSession(true)
      return true
    },

    cancel: () => {
      if (!session) {
        return false
      }
      clearSession(true)
      return true
    },

    dispose: () => {
      previewRenderer.dispose(session)
      clearSession(false)
    },
  }
}
