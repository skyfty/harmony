import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { WaterBuildShape } from '@/types/water-build-shape'
import type { useSceneStore } from '@/stores/sceneStore'

export type WaterBuildToolHandle = {
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
  start: THREE.Vector3
  end: THREE.Vector3
}

type RightClickState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

type LeftDragState = {
  pointerId: number
}

const PREVIEW_GROUP_NAME = '__WaterBuildPreview'
const WATER_MIN_SIZE = 1e-3

function disposeGroup(group: THREE.Group | null) {
  if (!group) {
    return
  }
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.geometry?.dispose?.()
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material?.dispose?.())
      } else {
        mesh.material?.dispose?.()
      }
    }
    const line = child as THREE.LineSegments
    if (line?.isLineSegments) {
      line.geometry?.dispose?.()
      if (Array.isArray(line.material)) {
        line.material.forEach((material) => material?.dispose?.())
      } else {
        line.material?.dispose?.()
      }
    }
  })
  group.removeFromParent()
}

function buildPreviewGroup(): THREE.Group {
  const group = new THREE.Group()
  group.name = PREVIEW_GROUP_NAME

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x03a9f4,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  plane.rotation.x = -Math.PI / 2
  plane.renderOrder = 100
  plane.name = 'WaterBuildPreviewPlane'

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1, 1, 1)),
    new THREE.LineBasicMaterial({
      color: 0x81d4fa,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  )
  outline.rotation.x = -Math.PI / 2
  outline.renderOrder = 101
  outline.name = 'WaterBuildPreviewOutline'

  group.add(plane)
  group.add(outline)
  return group
}

function updatePreviewGroup(group: THREE.Group, start: THREE.Vector3, end: THREE.Vector3) {
  const minX = Math.min(start.x, end.x)
  const maxX = Math.max(start.x, end.x)
  const minZ = Math.min(start.z, end.z)
  const maxZ = Math.max(start.z, end.z)
  const width = Math.max(WATER_MIN_SIZE, maxX - minX)
  const depth = Math.max(WATER_MIN_SIZE, maxZ - minZ)
  const centerX = (minX + maxX) * 0.5
  const centerZ = (minZ + maxZ) * 0.5
  group.position.set(centerX, start.y + 0.02, centerZ)
  group.scale.set(width, depth, 1)
}

export function createWaterBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  waterBuildShape: Ref<WaterBuildShape>
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  resolveBuildPlacementPoint?: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  isAltOverrideActive: () => boolean
  clickDragThresholdPx: number
}): WaterBuildToolHandle {
  const groundPointerHelper = new THREE.Vector3()
  const raycastPlacementPoint = (event: PointerEvent, result: THREE.Vector3): boolean => {
    if (options.resolveBuildPlacementPoint) {
      return options.resolveBuildPlacementPoint(event, result)
    }
    return options.raycastGroundPoint(event, result)
  }

  let session: Session | null = null
  let previewGroup: THREE.Group | null = null
  let previewDirty = false
  let rightClickState: RightClickState | null = null
  let leftDragState: LeftDragState | null = null

  const getShape = (): WaterBuildShape => options.waterBuildShape.value ?? 'rectangle'

  const clearSession = (disposePreview = true) => {
    if (disposePreview) {
      disposeGroup(previewGroup)
      previewGroup = null
    }
    session = null
    previewDirty = false
    rightClickState = null
    leftDragState = null
  }

  const ensurePreview = () => {
    if (!previewGroup) {
      previewGroup = buildPreviewGroup()
      previewDirty = true
    }
    return previewGroup
  }

  const markPreviewDirty = () => {
    previewDirty = true
  }

  return {
    flushPreviewIfNeeded: (scene) => {
      if (!scene || !session) {
        if (previewGroup && previewGroup.parent === scene) {
          previewGroup.removeFromParent()
        }
        return
      }
      const group = ensurePreview()
      if (previewDirty) {
        updatePreviewGroup(group, session.start, session.end)
        previewDirty = false
      }
      if (group.parent !== options.rootGroup) {
        options.rootGroup.add(group)
      }
    },

    handlePointerDown: (event) => {
      if (options.activeBuildTool.value !== 'water') {
        return false
      }

      const shape = getShape()
      if (event.button === 0 && !options.isAltOverrideActive()) {
        clearSession(true)
        if (!raycastPlacementPoint(event, groundPointerHelper)) {
          return false
        }
        const start = options.snapPoint(groundPointerHelper.clone())
        session = {
          shape,
          start: start.clone(),
          end: start.clone(),
        }
        leftDragState = { pointerId: event.pointerId }
        markPreviewDirty()
        return false
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
      if (!session) {
        return false
      }

      if (leftDragState && event.pointerId === leftDragState.pointerId) {
        const isLeftButtonDown = (event.buttons & 1) !== 0
        const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
        if (isLeftButtonDown && !isCameraNavActive) {
          if (!raycastPlacementPoint(event, groundPointerHelper)) {
            return true
          }
          const next = options.snapPoint(groundPointerHelper.clone())
          next.y = session.start.y
          session.end.copy(next)
          markPreviewDirty()
          return true
        }
      }

      return Boolean(session)
    },

    handlePointerUp: (event) => {
      if (options.activeBuildTool.value !== 'water') {
        return false
      }

      const shape = getShape()
      if (event.button === 0 && leftDragState?.pointerId === event.pointerId) {
        leftDragState = null

        if (!session) {
          clearSession(true)
          return true
        }

        if (!raycastPlacementPoint(event, groundPointerHelper)) {
          clearSession(true)
          return true
        }

        const end = options.snapPoint(groundPointerHelper.clone())
        end.y = session.start.y
        session.end.copy(end)
        markPreviewDirty()

        if (shape !== 'rectangle') {
          clearSession(true)
          return true
        }

        const minX = Math.min(session.start.x, session.end.x)
        const maxX = Math.max(session.start.x, session.end.x)
        const minZ = Math.min(session.start.z, session.end.z)
        const maxZ = Math.max(session.start.z, session.end.z)
        const width = maxX - minX
        const depth = maxZ - minZ
        if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= WATER_MIN_SIZE || depth <= WATER_MIN_SIZE) {
          clearSession(true)
          return true
        }

        options.sceneStore.createWaterNode({
          center: {
            x: (minX + maxX) * 0.5,
            y: session.start.y,
            z: (minZ + maxZ) * 0.5,
          },
          width,
          depth,
        })
        clearSession(true)
        return true
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
      disposeGroup(previewGroup)
      previewGroup = null
      clearSession(false)
    },
  }
}
