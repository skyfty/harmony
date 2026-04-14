import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { Vector3Like } from '@schema'
import type { useSceneStore } from '@/stores/sceneStore'

export type GuideRouteBuildToolSession = {
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  previewGroup: THREE.Group | null
}

export type GuideRouteBuildToolHandle = {
  getSession: () => GuideRouteBuildToolSession | null
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

type LeftClickState = {
  atMs: number
  clientX: number
  clientY: number
}

const DOUBLE_CLICK_MAX_INTERVAL_MS = 320
const DOUBLE_CLICK_MAX_DISTANCE_PX = 8
const PREVIEW_Y_OFFSET = 0.04

function getNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function createPreviewGroup(points: THREE.Vector3[]): THREE.Group {
  const group = new THREE.Group()
  group.name = '__GuideRoutePreview'

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: 0x27ffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  )
  line.renderOrder = 101
  group.userData.line = line
  group.userData.isGuideRoutePreview = true
  group.add(line)
  return group
}

function updatePreviewGroup(group: THREE.Group, points: THREE.Vector3[]): void {
  const line = group.userData.line as THREE.Line | undefined
  if (!line) {
    return
  }
  line.geometry?.dispose?.()
  line.geometry = new THREE.BufferGeometry().setFromPoints(points)
}

function disposePreviewGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const drawable = child as THREE.Line | THREE.Mesh
    drawable.geometry?.dispose?.()
    const material = drawable.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

export function createGuideRouteBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  resolveBuildPlacementPoint?: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  resolveVertexSnapPoint?: (event: PointerEvent, point: THREE.Vector3, options?: { excludeNodeIds?: readonly string[]; keepSourceY?: boolean }) => THREE.Vector3 | null
  clearVertexSnap?: () => void
  isAltOverrideActive: () => boolean
  showStartIndicator?: (point: THREE.Vector3, options?: { height?: number | null }) => void
  hideStartIndicator?: () => void
  holdStartIndicatorUntilNodeVisible?: (options: { nodeId: string; point: THREE.Vector3; height?: number | null }) => void
  clickDragThresholdPx: number
}): GuideRouteBuildToolHandle {
  const groundPointerHelper = new THREE.Vector3()
  let session: GuideRouteBuildToolSession | null = null
  let previewDirty = false
  let rightClickState: RightClickState | null = null
  let leftClickState: LeftClickState | null = null

  const raycastPlacementPoint = (event: PointerEvent, result: THREE.Vector3): boolean => {
    if (options.resolveBuildPlacementPoint) {
      return options.resolveBuildPlacementPoint(event, result)
    }
    return options.raycastGroundPoint(event, result)
  }

  const alignPointYToSession = (point: THREE.Vector3, target: GuideRouteBuildToolSession | null): THREE.Vector3 => {
    const baseY = target?.points?.[0]?.y
    if (typeof baseY === 'number' && Number.isFinite(baseY)) {
      point.y = baseY
    }
    return point
  }

  const resolvePlacementPoint = (event: PointerEvent, rawPoint: THREE.Vector3): THREE.Vector3 => {
    const snapped = options.resolveVertexSnapPoint?.(event, rawPoint, { keepSourceY: false })
    if (snapped) {
      return snapped.clone()
    }
    return options.snapPoint(rawPoint.clone())
  }

  const ensureSession = (): GuideRouteBuildToolSession => {
    if (session) {
      return session
    }
    session = { points: [], previewEnd: null, previewGroup: null }
    return session
  }

  const clearSession = () => {
    if (session?.previewGroup) {
      session.previewGroup.removeFromParent()
      disposePreviewGroup(session.previewGroup)
    }
    session = null
    previewDirty = false
    rightClickState = null
    options.hideStartIndicator?.()
    options.clearVertexSnap?.()
  }

  const getPreviewPoints = (target: GuideRouteBuildToolSession | null): THREE.Vector3[] => {
    if (!target) {
      return []
    }
    const combined = target.points.map((point) => point.clone())
    if (target.previewEnd) {
      const last = combined[combined.length - 1] ?? null
      if (!last || last.distanceToSquared(target.previewEnd) > 1e-10) {
        combined.push(target.previewEnd.clone())
      }
    }
    return combined.map((point) => new THREE.Vector3(point.x, point.y + PREVIEW_Y_OFFSET, point.z))
  }

  const flushPreview = (_scene: THREE.Scene | null) => {
    previewDirty = false
    const previewPoints = getPreviewPoints(session)
    if (previewPoints.length < 2) {
      if (session?.previewGroup) {
        session.previewGroup.removeFromParent()
        disposePreviewGroup(session.previewGroup)
        session.previewGroup = null
      }
      return
    }
    if (!session) {
      return
    }
    if (!session.previewGroup) {
      const group = createPreviewGroup(previewPoints)
      session.previewGroup = group
      options.rootGroup.add(group)
      return
    }
    updatePreviewGroup(session.previewGroup, previewPoints)
  }

  const isLeftDoubleClick = (event: PointerEvent): boolean => {
    if (event.button !== 0) {
      return false
    }
    const now = Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : getNowMs()
    const previous = leftClickState
    leftClickState = { atMs: now, clientX: event.clientX, clientY: event.clientY }
    if (!previous) {
      return false
    }
    const dt = now - previous.atMs
    if (dt < 0 || dt > DOUBLE_CLICK_MAX_INTERVAL_MS) {
      return false
    }
    return Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) <= DOUBLE_CLICK_MAX_DISTANCE_PX
  }

  const updateCursorPreview = (event: PointerEvent) => {
    if (!session || !session.points.length || options.isAltOverrideActive()) {
      return
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      return
    }
    const point = alignPointYToSession(resolvePlacementPoint(event, groundPointerHelper.clone()), session)
    const previous = session.previewEnd
    if (previous && previous.equals(point)) {
      return
    }
    session.previewEnd = point.clone()
    previewDirty = true
  }

  const updateStartIndicator = (event: PointerEvent) => {
    const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
    if (isCameraNavActive || options.isAltOverrideActive()) {
      options.hideStartIndicator?.()
      return
    }
    if (session?.points.length) {
      options.showStartIndicator?.(session.points[0]!, { height: 0.2 })
      return
    }
    if (!raycastPlacementPoint(event, groundPointerHelper)) {
      options.hideStartIndicator?.()
      return
    }
    options.showStartIndicator?.(resolvePlacementPoint(event, groundPointerHelper.clone()), { height: 0.2 })
  }

  const finalize = () => {
    if (!session || session.points.length < 2) {
      clearSession()
      return
    }
    const created = options.sceneStore.createGuideRouteNode({
      points: session.points.map((point) => ({ x: point.x, y: point.y, z: point.z }) satisfies Vector3Like),
      waypoints: session.points.map((_, index, points) => ({
        dock: index === 0 || index === points.length - 1,
      })),
    })
    const startPoint = session.points[0]?.clone() ?? null
    clearSession()
    if (created) {
      options.sceneStore.selectNode(created.id)
      if (startPoint) {
        options.holdStartIndicatorUntilNodeVisible?.({ nodeId: created.id, point: startPoint, height: 0.2 })
      }
    }
  }

  return {
    getSession: () => session,
    flushPreviewIfNeeded: (scene) => {
      if (!previewDirty) {
        return
      }
      flushPreview(scene)
    },
    handlePointerDown: (event) => {
      if (options.activeBuildTool.value !== 'guideRoute') {
        return false
      }
      if (event.button === 2 && session) {
        rightClickState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }
      }
      return false
    },
    handlePointerMove: (event) => {
      if (rightClickState && event.pointerId === rightClickState.pointerId && !rightClickState.moved) {
        if (Math.hypot(event.clientX - rightClickState.startX, event.clientY - rightClickState.startY) >= options.clickDragThresholdPx) {
          rightClickState.moved = true
        }
      }
      if (options.activeBuildTool.value !== 'guideRoute') {
        return false
      }
      updateStartIndicator(event)
      if (session?.points.length) {
        updateCursorPreview(event)
        return true
      }
      return false
    },
    handlePointerUp: (event) => {
      if (options.activeBuildTool.value !== 'guideRoute') {
        return false
      }
      if (event.button === 0) {
        if (options.isAltOverrideActive() || !raycastPlacementPoint(event, groundPointerHelper)) {
          return false
        }
        const current = ensureSession()
        const point = alignPointYToSession(resolvePlacementPoint(event, groundPointerHelper.clone()), current)
        const last = current.points[current.points.length - 1] ?? null
        if (!last || last.distanceToSquared(point) > 1e-6) {
          current.points.push(point.clone())
        }
        current.previewEnd = point.clone()
        previewDirty = true
        if (isLeftDoubleClick(event) && current.points.length >= 2) {
          finalize()
        }
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return true
      }
      if (event.button === 2 && rightClickState && rightClickState.pointerId === event.pointerId) {
        const clickWasDrag = rightClickState.moved
        rightClickState = null
        if (!clickWasDrag && session) {
          clearSession()
          return true
        }
      }
      return false
    },
    handlePointerCancel: (event) => {
      if (rightClickState?.pointerId === event.pointerId) {
        rightClickState = null
      }
      if (options.activeBuildTool.value !== 'guideRoute') {
        return false
      }
      if (!session) {
        return false
      }
      clearSession()
      return true
    },
    cancel: () => {
      if (!session) {
        return false
      }
      clearSession()
      return true
    },
    dispose: () => {
      clearSession()
      leftClickState = null
    },
  }
}