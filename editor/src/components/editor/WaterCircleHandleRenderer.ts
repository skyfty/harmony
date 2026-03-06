import * as THREE from 'three'
import type { SceneNode } from '@schema'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'
import {
  WATER_SURFACE_HANDLE_ELEVATION,
  computeWaterCircleLocalFromPoints,
  computeWaterContourSignature,
  getWaterSurfaceMeshMetadata,
  getWaterContourLocalPointsFromMetadata,
} from './waterSurfaceEditUtils'

export type WaterCircleHandlePickResult = {
  nodeId: string
  circleKind: 'center' | 'radius'
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type WaterCircleHandleRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: { nodeId: string; circleKind: 'center' | 'radius'; gizmoPart: EndpointGizmoPart } | null): void
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
  }): WaterCircleHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
}

export const WATER_CIRCLE_HANDLE_GROUP_NAME = '__WaterCircleHandles'
const WATER_CIRCLE_HANDLE_RENDER_ORDER = 1001
const WATER_CIRCLE_HANDLE_SCREEN_DIAMETER_PX = 36
const WATER_CIRCLE_HANDLE_COLOR = 0xff4081

function disposeGroup(group: THREE.Group) {
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

export function createWaterCircleHandleRenderer(): WaterCircleHandleRenderer {
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

  function setActiveHandle(next: { nodeId: string; circleKind: 'center' | 'radius'; gizmoPart: EndpointGizmoPart } | null) {
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
      handleKey: `${next.nodeId}:circle:${next.circleKind}`,
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

    const points = getWaterContourLocalPointsFromMetadata(metadata)
    const circle = computeWaterCircleLocalFromPoints(points)
    if (!circle) {
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
    group.name = WATER_CIRCLE_HANDLE_GROUP_NAME
    group.userData.isWaterCircleHandles = true

    const centerGizmo = createEndpointGizmoObject({
      axes: { x: true, y: true, z: false },
      showNegativeAxes: true,
      renderOrder: WATER_CIRCLE_HANDLE_RENDER_ORDER,
      depthTest: false,
      depthWrite: false,
      opacity: 0.9,
      centerColor: WATER_CIRCLE_HANDLE_COLOR,
    })
    const centerHandle = centerGizmo.root
    centerHandle.name = 'WaterCircleCenterHandle'
    centerHandle.position.set(circle.centerX, circle.centerY, WATER_SURFACE_HANDLE_ELEVATION)
    centerHandle.layers.enableAll()
    centerHandle.userData.isWaterCircleHandle = true
    centerHandle.userData.nodeId = selectedNodeId
    centerHandle.userData.circleKind = 'center'
    centerHandle.userData.baseDiameter = centerGizmo.baseDiameter
    centerHandle.userData.endpointGizmo = centerGizmo
    centerHandle.userData.handleKey = `${selectedNodeId}:circle:center`

    centerHandle.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh) {
        return
      }
      mesh.userData.isWaterCircleHandle = true
      mesh.userData.nodeId = selectedNodeId
      mesh.userData.circleKind = 'center'
    })

    const radiusGizmo = createEndpointGizmoObject({
      axes: { x: false, y: false, z: false },
      showNegativeAxes: false,
      renderOrder: WATER_CIRCLE_HANDLE_RENDER_ORDER,
      depthTest: false,
      depthWrite: false,
      opacity: 0.9,
      centerColor: WATER_CIRCLE_HANDLE_COLOR,
    })
    const radiusHandle = radiusGizmo.root
    radiusHandle.name = 'WaterCircleRadiusHandle'
    radiusHandle.position.set(circle.centerX + circle.radius, circle.centerY, WATER_SURFACE_HANDLE_ELEVATION)
    radiusHandle.layers.enableAll()
    radiusHandle.userData.isWaterCircleHandle = true
    radiusHandle.userData.nodeId = selectedNodeId
    radiusHandle.userData.circleKind = 'radius'
    radiusHandle.userData.baseDiameter = radiusGizmo.baseDiameter
    radiusHandle.userData.endpointGizmo = radiusGizmo
    radiusHandle.userData.handleKey = `${selectedNodeId}:circle:radius`

    radiusHandle.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh) {
        return
      }
      mesh.userData.isWaterCircleHandle = true
      mesh.userData.nodeId = selectedNodeId
      mesh.userData.circleKind = 'radius'
    })

    group.add(centerHandle)
    group.add(radiusHandle)

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
      const circleKind = target.userData?.circleKind === 'radius' ? 'radius' : 'center'
      const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
      const partInfo = getEndpointGizmoPartInfoFromObject(target)
      if (!nodeId || !gizmoPart || !partInfo) {
        return null
      }

      return {
        nodeId,
        circleKind,
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
      const circleKind = target.userData?.circleKind === 'radius' ? 'radius' : 'center'
      const gizmoPart = (target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
      if (!nodeId || !gizmoPart) {
        clearHover()
        return
      }

      const handleKey = `${nodeId}:circle:${circleKind}`
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
          : WATER_CIRCLE_HANDLE_SCREEN_DIAMETER_PX

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
