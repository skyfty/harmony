import * as THREE from 'three'
import type { SceneNode } from '@schema'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'
import {
  WATER_SURFACE_HANDLE_ELEVATION,
  computeWaterContourSignature,
  getWaterSurfaceMeshMetadata,
  getWaterContourLocalPointsFromMetadata,
} from './waterSurfaceEditUtils'

export type WaterVertexHandlePickResult = {
  nodeId: string
  vertexIndex: number
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type WaterVertexRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: { nodeId: string; vertexIndex: number; gizmoPart: EndpointGizmoPart } | null): void
  updateHover(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): void
  ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWaterNode: (nodeId: string) => SceneNode | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWaterNode: (nodeId: string) => SceneNode | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): WaterVertexHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
}

export const WATER_VERTEX_HANDLE_GROUP_NAME = '__WaterVertexHandles'
const WATER_VERTEX_HANDLE_RENDER_ORDER = 1001
const WATER_VERTEX_HANDLE_SCREEN_DIAMETER_PX = 32
const WATER_VERTEX_HANDLE_COLOR = 0xff4081

function disposeGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

export function createWaterVertexRenderer(): WaterVertexRenderer {
  let state: { nodeId: string; group: THREE.Group; signature: string } | null = null
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const tmpParentWorldScale = new THREE.Vector3(1, 1, 1)
  const NEAR_SCALE_DISTANCE = 2.5
  const NEAR_SCALE_MAX_MULT = 2.0

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeGroup(existing.group)
    hovered = null
    active = null
  }

  function refreshHighlight() {
    if (!state) {
      return
    }
    for (const handle of state.group.children) {
      const gizmo = handle?.userData?.endpointGizmo as { clearStates?: () => void; setState?: (p: EndpointGizmoPart, s: any) => void } | undefined
      if (!gizmo?.clearStates || !gizmo?.setState) {
        continue
      }
      gizmo.clearStates()
      const key = typeof handle.userData?.handleKey === 'string' ? handle.userData.handleKey : ''
      if (active && key === active.handleKey) {
        gizmo.setState(active.gizmoPart, 'active')
      } else if (hovered && key === hovered.handleKey) {
        gizmo.setState(hovered.gizmoPart, 'hover')
      }
    }
  }

  function clearHover() {
    if (!hovered) {
      return
    }
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: { nodeId: string; vertexIndex: number; gizmoPart: EndpointGizmoPart } | null) {
    if (!state) {
      active = null
      return
    }
    if (!next) {
      active = null
      refreshHighlight()
      return
    }
    active = {
      handleKey: `${next.nodeId}:${next.vertexIndex}`,
      gizmoPart: next.gizmoPart,
    }
    refreshHighlight()
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWaterNode: (nodeId: string) => SceneNode | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    force?: boolean
  }) {
    const selectedNodeId = options.selectedNodeId
    if (!options.active || !selectedNodeId) {
      clear()
      return
    }
    if (options.isSelectionLocked(selectedNodeId)) {
      clear()
      return
    }
    const node = options.resolveWaterNode(selectedNodeId)
    const metadata = getWaterSurfaceMeshMetadata(node)
    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!metadata || !runtimeObject) {
      clear()
      return
    }

    const signature = computeWaterContourSignature(metadata)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = WATER_VERTEX_HANDLE_GROUP_NAME
    group.userData.isWaterVertexHandles = true

    const points = getWaterContourLocalPointsFromMetadata(metadata)
    points.forEach(([x, y], index) => {
      const gizmo = createEndpointGizmoObject({
        axes: { x: true, y: true, z: false },
        showNegativeAxes: true,
        renderOrder: WATER_VERTEX_HANDLE_RENDER_ORDER,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        centerColor: WATER_VERTEX_HANDLE_COLOR,
      })

      const handle = gizmo.root
      handle.name = `WaterVertexHandle_${index + 1}`
      handle.position.set(x, y, WATER_SURFACE_HANDLE_ELEVATION)
      handle.layers.enableAll()
      handle.userData.isWaterVertexHandle = true
      handle.userData.nodeId = selectedNodeId
      handle.userData.waterVertexIndex = index
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.userData.endpointGizmo = gizmo
      handle.userData.handleKey = `${selectedNodeId}:${index}`
      handle.userData.zOffset = WATER_SURFACE_HANDLE_ELEVATION

      handle.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        mesh.userData.isWaterVertexHandle = true
        mesh.userData.nodeId = selectedNodeId
        mesh.userData.waterVertexIndex = index
      })

      group.add(handle)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
    hovered = null
    active = null
  }

  return {
    clear,
    clearHover,
    setActiveHandle,
    ensure: (options) => attachOrRebuild({ ...options, force: false }),
    forceRebuild: (options) => attachOrRebuild({ ...options, force: true }),
    pick: (options) => {
      if (!state || !options.camera || !options.canvas) {
        return null
      }
      const rect = options.canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        return null
      }

      options.pointer.x = ((options.event.clientX - rect.left) / rect.width) * 2 - 1
      options.pointer.y = -((options.event.clientY - rect.top) / rect.height) * 2 + 1
      options.raycaster.setFromCamera(options.pointer, options.camera)

      state.group.updateWorldMatrix(true, true)
      const intersections = options.raycaster.intersectObjects(state.group.children, true)
      intersections.sort((a, b) => a.distance - b.distance)
      const first = intersections[0]
      if (!first) {
        return null
      }

      const target = first.object as THREE.Object3D
      const nodeId = typeof target.userData?.nodeId === 'string' ? target.userData.nodeId : ''
      const vertexIndexRaw = target.userData?.waterVertexIndex
      const vertexIndex = typeof vertexIndexRaw === 'number' && Number.isFinite(vertexIndexRaw)
        ? Math.max(0, Math.floor(vertexIndexRaw))
        : -1
      const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
      const partInfo = getEndpointGizmoPartInfoFromObject(target)
      if (!nodeId || vertexIndex < 0 || !gizmoPart || !partInfo) {
        return null
      }

      return {
        nodeId,
        vertexIndex,
        gizmoPart,
        gizmoKind: partInfo.kind,
        gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
        point: first.point.clone(),
      }
    },
    updateHover: (options) => {
      if (!state || !options.camera || !options.canvas) {
        clearHover()
        return
      }
      const rect = options.canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        clearHover()
        return
      }

      options.pointer.x = ((options.event.clientX - rect.left) / rect.width) * 2 - 1
      options.pointer.y = -((options.event.clientY - rect.top) / rect.height) * 2 + 1
      options.raycaster.setFromCamera(options.pointer, options.camera)

      state.group.updateWorldMatrix(true, true)
      const intersections = options.raycaster.intersectObjects(state.group.children, true)
      intersections.sort((a, b) => a.distance - b.distance)
      const first = intersections[0]
      if (!first) {
        clearHover()
        return
      }

      const target = first.object as THREE.Object3D
      const nodeId = typeof target.userData?.nodeId === 'string' ? target.userData.nodeId : ''
      const vertexIndexRaw = target.userData?.waterVertexIndex
      const vertexIndex = typeof vertexIndexRaw === 'number' && Number.isFinite(vertexIndexRaw)
        ? Math.max(0, Math.floor(vertexIndexRaw))
        : -1
      const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
      if (!nodeId || vertexIndex < 0 || !gizmoPart) {
        clearHover()
        return
      }

      const handleKey = `${nodeId}:${vertexIndex}`
      if (hovered && hovered.handleKey === handleKey && hovered.gizmoPart === gizmoPart) {
        return
      }

      hovered = { handleKey, gizmoPart }
      refreshHighlight()
    },
    updateScreenSize: (options) => {
      if (!state || !options.camera || !options.canvas) {
        return
      }

      const diameterPx =
        typeof options.diameterPx === 'number' && Number.isFinite(options.diameterPx) && options.diameterPx > 0
          ? options.diameterPx
          : WATER_VERTEX_HANDLE_SCREEN_DIAMETER_PX

      const viewportHeightPx = Math.max(1, options.canvas.getBoundingClientRect().height)
      options.camera.getWorldPosition(tmpCameraWorldPos)

      state.group.updateWorldMatrix(true, false)
      for (const child of state.group.children) {
        const handle = child as THREE.Object3D
        const baseDiameterRaw = handle.userData?.baseDiameter
        const baseDiameter = typeof baseDiameterRaw === 'number' && Number.isFinite(baseDiameterRaw) && baseDiameterRaw > 1e-6
          ? baseDiameterRaw
          : 1

        handle.getWorldPosition(tmpWorldPos)
        const distance = tmpWorldPos.distanceTo(tmpCameraWorldPos)
        const worldUnitsPerPixel = computeWorldUnitsPerPixel({
          camera: options.camera,
          distance,
          viewportHeightPx,
        })

        const desiredWorldDiameter = Math.max(1e-4, worldUnitsPerPixel * diameterPx)
        let scale = desiredWorldDiameter / baseDiameter
        if (distance < NEAR_SCALE_DISTANCE) {
          const t = 1 - Math.max(0, distance) / NEAR_SCALE_DISTANCE
          scale *= 1 + t * (NEAR_SCALE_MAX_MULT - 1)
        }

        handle.parent?.getWorldScale(tmpParentWorldScale)
        const safeX = Math.max(1e-6, Math.abs(tmpParentWorldScale.x))
        const safeY = Math.max(1e-6, Math.abs(tmpParentWorldScale.y))
        const safeZ = Math.max(1e-6, Math.abs(tmpParentWorldScale.z))
        handle.scale.set(scale / safeX, scale / safeY, scale / safeZ)
      }
    },
  }
}
